import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DetectorEngine, type Detector, type DetectorEvent } from '@/lib/detectors'
import { sampleHue, type Detection } from '@/lib/vision'
import type { Track } from '@/lib/tracker'
import {
  creditEvent, learnRobot, RobotFleet,
  type RobotLock, type RobotSighting, type ShotCredit,
} from '@/lib/robotLock'
import { proposeZone, explainFailure, type ZoneProposal } from '@/lib/autoZone'
import { buildSignature, type RobotSignature } from '@/lib/robotSignature'

export type { ShotCredit }

/**
 * Frames are processed at this width; height follows the aspect ratio.
 *
 * 640 rather than the 320 this started at, and the difference is not
 * cosmetic. A FUEL ball is about 1.5% of the frame width in a shot that
 * takes in the whole field, which at 320px is a two-pixel radius — below
 * any usable size threshold, and the reason a scan of real footage used to
 * report nothing whatsoever. Doubling the width quadruples the pixels on
 * the ball, which is what makes it findable at all.
 */
export const PROC_WIDTHS = [320, 480, 640, 854] as const
export const DEFAULT_PROC_WIDTH = 640

/**
 * Runs every enabled detector against a <video>, whatever is behind it: a
 * live camera, a match recording, or a shared tab.
 *
 * Frames reach the detectors by whichever route actually works for the
 * source, which is not the same in all three cases:
 *
 *   a stream  — read off the MediaStreamTrack. Sharing a tab means leaving
 *               this one, and a backgrounded page is presented no frames at
 *               all, so anything driven by the repaint callback would go
 *               quiet for exactly as long as the scout was watching.
 *   a file    — pulled on demand by `processFrame`, so a scan can seek
 *               through faster than real time and survive a tab switch.
 *   a camera  — the repaint loop, which is honest here: the scout is
 *               looking at the screen, and there is no track to rewind.
 *
 * A cross-origin video taints the canvas and cannot be read at all; that
 * surfaces as `blocked` rather than a silent absence of detections.
 */
export function useDetectors({
  video, detectors, liveLoop, track, onEvent, procWidth = DEFAULT_PROC_WIDTH,
  robotLock = null,
}: {
  video: HTMLVideoElement | null
  detectors: Detector[]
  /** Follow frames as they arrive. False when frames are pulled by a scan. */
  liveLoop: boolean
  /** The stream's video track, when the source is a stream. */
  track?: MediaStreamTrack | null
  onEvent: (event: DetectorEvent, credit: ShotCredit) => void
  /** Processing resolution. Higher finds smaller things and costs more. */
  procWidth?: number
  /** The robot being followed, if the scout has picked one. */
  robotLock?: RobotLock | null
}) {
  const engine = useMemo(() => new DetectorEngine(detectors), [])
  const fleet = useMemo(() => new RobotFleet(), [])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<ImageData | null>(null)
  const onEventRef = useRef(onEvent)
  const processRef = useRef<(src?: any, preview?: boolean) => void>(() => {})

  const [detections, setDetections] = useState<{ detectorId: string; detections: Detection[] }[]>([])
  const [paths, setPaths] = useState<{ detectorId: string; tracks: Track[] }[]>([])
  const [robot, setRobot] = useState<RobotSighting | null>(null)
  const [robots, setRobots] = useState<RobotSighting[]>([])
  /**
   * Which alliance each ball in flight came from, keyed by track.
   *
   * Worked out live rather than at the moment a shot counts, so a ball is
   * already coloured while it is in the air. `null` means nobody knows,
   * which is drawn grey — a colour that claims nothing.
   */
  const [tints, setTints] = useState<Record<number, 'red' | 'blue' | null>>({})
  const [scenery, setScenery] = useState<{ detectorId: string; at: { x: number; y: number; radius: number }[] }[]>([])
  const [procHeight, setProcHeight] = useState(Math.round(procWidth * 9 / 16))
  const [fps, setFps] = useState(0)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => { onEventRef.current = onEvent }, [onEvent])
  useEffect(() => { engine.setDetectors(detectors) }, [engine, detectors])
  useEffect(() => { fleet.setLock(robotLock) }, [fleet, robotLock])

  // Build the frame reader. Independent of how it is driven.
  useEffect(() => {
    if (!video) { processRef.current = () => {}; setDetections([]); setPaths([]); return }

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    let stopped = false
    let lastTick = performance.now()
    let smoothed = 0
    // The overlay is redrawn from React state, and a seek-driven scan calls
    // this thousands of times as fast as the file decodes. Publishing every
    // frame would put more time into re-rendering the overlay than into
    // reading the video; twelve updates a second is past the point anyone
    // can see, and events themselves are never throttled.
    let lastPublish = 0

    processRef.current = (src?: any, preview = false) => {
      if (stopped) return
      if (!src && video.readyState < 2) return

      const sw = src ? src.displayWidth : video.videoWidth
      const sh = src ? src.displayHeight : video.videoHeight
      if (!sw || !sh) return

      const h = Math.round(procWidth * (sh / sw))
      if (canvas.width !== procWidth || canvas.height !== h) {
        canvas.width = procWidth
        canvas.height = h
        setProcHeight(h)
      }

      ctx.drawImage(src ?? video, 0, 0, procWidth, h)

      let frame: ImageData
      try {
        frame = ctx.getImageData(0, 0, procWidth, h)
      } catch {
        setBlocked(true)
        stopped = true
        return
      }
      frameRef.current = frame

      // A preview reads the picture and reports what is in it, without
      // advancing a single track or firing a single rule — otherwise
      // dragging the scrub bar would invent shots.
      if (preview) {
        engine.observe(frame, procWidth, h)
        setDetections(engine.detections())
        return
      }

      // Video time is the clock, so a scan yields the same events however
      // fast it ran.
      const at = video.currentTime * 1000

      // The robot is followed *before* the detectors run, so a shot found
      // this frame can be credited against a position from this frame.
      const seen = fleet.update(frame, procWidth, h, at)

      for (const ev of engine.update(frame, procWidth, h, at)) {
        onEventRef.current(ev, creditEvent(fleet, ev))
      }

      const now = performance.now()
      smoothed = smoothed * 0.9 + (1000 / Math.max(1, now - lastTick)) * 0.1
      lastTick = now

      if (now - lastPublish >= 80) {
        lastPublish = now
        setDetections(engine.detections())
        const groups = engine.paths()
        setPaths(groups)
        setScenery(engine.scenery())
        setRobot(seen)
        setRobots(fleet.robots)

        // Colour every ball in flight by whose it is.
        const tint: Record<number, 'red' | 'blue' | null> = {}
        const alliance = fleet.lock?.alliance
        for (const g of groups) {
          for (const t of g.tracks) {
            const from = fleet.positionAt(t.originAt)
            const near = from
              && Math.hypot(t.originX / procWidth - from.x, t.originY / h - from.y)
                 <= Math.max(0.13, from.r * 2.2)
            tint[t.id] = near && alliance ? alliance : null
          }
        }
        setTints(tint)
        setFps(Math.round(smoothed))
      }
    }

    setBlocked(false)
    return () => { stopped = true }
  }, [video, engine, fleet, procWidth])

  // Live loop: track-reader where there is a track, repaint loop otherwise.
  useEffect(() => {
    if (!liveLoop || !video) return
    let cancelled = false

    const Processor = (window as any).MediaStreamTrackProcessor
    if (track && Processor) {
      const reader = new Processor({ track }).readable.getReader()
      void (async () => {
        while (!cancelled) {
          let frame: any
          try {
            const { value, done } = await reader.read()
            if (done) break
            frame = value
          } catch { break }
          try { processRef.current(frame) } finally { frame.close?.() }
        }
      })()
      return () => { cancelled = true; reader.cancel().catch(() => {}) }
    }

    let rvfcHandle: number | undefined
    let rafHandle: number | undefined
    const rvfc = (video as any).requestVideoFrameCallback?.bind(video)
    const step = () => {
      if (cancelled) return
      processRef.current()
      if (cancelled) return
      if (rvfc) rvfcHandle = rvfc(step)
      else rafHandle = requestAnimationFrame(step)
    }
    if (rvfc) rvfcHandle = rvfc(step)
    else rafHandle = requestAnimationFrame(step)

    return () => {
      cancelled = true
      if (rvfcHandle && (video as any).cancelVideoFrameCallback) {
        (video as any).cancelVideoFrameCallback(rvfcHandle)
      }
      if (rafHandle) cancelAnimationFrame(rafHandle)
    }
  }, [video, liveLoop, track])

  /** Read the frame currently displayed. Used by the seek-driven scan. */
  const processFrame = useCallback(() => processRef.current(), [])

  /**
   * Show what the detectors can see in the frame on screen, changing
   * nothing. Safe to call while scrubbing, sampling or aiming.
   */
  const previewFrame = useCallback(() => processRef.current(undefined, true), [])

  /** Sample the colour under a normalised point — used to calibrate. */
  const sampleAt = useCallback((nx: number, ny: number) => {
    if (!frameRef.current) processRef.current(undefined, true)
    const frame = frameRef.current
    return frame ? sampleHue(frame, nx, ny) : null
  }, [])

  /**
   * Learn a robot from a click: colour *and* size, measured off the frame.
   * Returns the appearance to lock with, or null when the spot is unusable.
   */
  const learnRobotAt = useCallback((nx: number, ny: number) => {
    if (!frameRef.current) processRef.current(undefined, true)
    const frame = frameRef.current
    if (!frame) return null
    const learned = learnRobot(frame, nx, ny)
    if (!learned) return null
    fleet.seed(nx, ny, learned.radius, (video?.currentTime ?? 0) * 1000)
    return learned.appearance
  }, [fleet, video])

  const reset = useCallback(() => { engine.reset(); fleet.reset() }, [engine, fleet])

  /**
   * Build a robot's appearance model from a photograph of it.
   *
   * Returns the signature and the fit's own account of itself, so the scout
   * is told how well it separated the robot from its background rather than
   * finding out during a match.
   */
  const learnFromPhoto = useCallback((photo: ImageData, steps?: number) =>
    buildSignature(photo, steps ? { iterations: steps } : {}), [])

  /** Forget the harvested evidence as well as the tracking state. */
  const resetAll = useCallback(() => { engine.resetAll(); fleet.reset() }, [engine, fleet])

  /**
   * Point at a robot. Picks whichever of the tracked robots was clicked; if
   * none was — no fleet yet, or the click missed — learns a fresh appearance
   * from the bumper under the cursor instead.
   */
  const pickRobotAt = useCallback((nx: number, ny: number) => {
    if (fleet.selectAt(nx, ny)) return { picked: true as const, appearance: null }
    if (!frameRef.current) processRef.current(undefined, true)
    const frame = frameRef.current
    if (!frame) return { picked: false as const, appearance: null }
    const learned = learnRobot(frame, nx, ny)
    if (!learned) return { picked: false as const, appearance: null }
    fleet.seed(nx, ny, learned.radius, (video?.currentTime ?? 0) * 1000)
    return { picked: true as const, appearance: learned.appearance }
  }, [fleet, video])

  /**
   * Propose the scoring area from where balls actually stopped being visible.
   * Returns the proposal, or the reason there isn't one.
   */
  const findZone = useCallback((detectorId: string): {
    proposal: ZoneProposal | null; why: string
  } => {
    const points = engine.vanished(detectorId)
    const proposal = proposeZone(points)
    return { proposal, why: proposal ? '' : explainFailure(points) }
  }, [engine])

  return {
    detections, paths, scenery, tints, robot, robots, trail: fleet.trail,
    blocked, fps, sampleAt, learnRobotAt, pickRobotAt, findZone, learnFromPhoto,
    reset, resetAll, processFrame, previewFrame, procWidth, procHeight,
  }
}
