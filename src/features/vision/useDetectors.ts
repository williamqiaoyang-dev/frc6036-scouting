import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DetectorEngine, type Detector, type DetectorEvent } from '@/lib/detectors'
import { sampleHue, type Detection } from '@/lib/vision'

/** Frames are processed at this width; height follows the aspect ratio. */
const PROC_WIDTH = 320

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
  video, detectors, liveLoop, track, onEvent,
}: {
  video: HTMLVideoElement | null
  detectors: Detector[]
  /** Follow frames as they arrive. False when frames are pulled by a scan. */
  liveLoop: boolean
  /** The stream's video track, when the source is a stream. */
  track?: MediaStreamTrack | null
  onEvent: (event: DetectorEvent) => void
}) {
  const engine = useMemo(() => new DetectorEngine(detectors), [])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<ImageData | null>(null)
  const onEventRef = useRef(onEvent)
  const processRef = useRef<(src?: any) => void>(() => {})

  const [detections, setDetections] = useState<{ detectorId: string; detections: Detection[] }[]>([])
  const [procHeight, setProcHeight] = useState(180)
  const [fps, setFps] = useState(0)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => { onEventRef.current = onEvent }, [onEvent])
  useEffect(() => { engine.setDetectors(detectors) }, [engine, detectors])

  // Build the frame reader. Independent of how it is driven.
  useEffect(() => {
    if (!video) { processRef.current = () => {}; setDetections([]); return }

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    let stopped = false
    let lastTick = performance.now()
    let smoothed = 0

    processRef.current = (src?: any) => {
      if (stopped) return
      if (!src && video.readyState < 2) return

      const sw = src ? src.displayWidth : video.videoWidth
      const sh = src ? src.displayHeight : video.videoHeight
      if (!sw || !sh) return

      const h = Math.round(PROC_WIDTH * (sh / sw))
      if (canvas.width !== PROC_WIDTH || canvas.height !== h) {
        canvas.width = PROC_WIDTH
        canvas.height = h
        setProcHeight(h)
      }

      ctx.drawImage(src ?? video, 0, 0, PROC_WIDTH, h)

      let frame: ImageData
      try {
        frame = ctx.getImageData(0, 0, PROC_WIDTH, h)
      } catch {
        setBlocked(true)
        stopped = true
        return
      }
      frameRef.current = frame

      // Video time is the clock, so a scan yields the same events however
      // fast it ran.
      const at = video.currentTime * 1000
      for (const ev of engine.update(frame, PROC_WIDTH, h, at)) onEventRef.current(ev)
      setDetections(engine.detections())

      const now = performance.now()
      smoothed = smoothed * 0.9 + (1000 / Math.max(1, now - lastTick)) * 0.1
      lastTick = now
      setFps(Math.round(smoothed))
    }

    setBlocked(false)
    return () => { stopped = true }
  }, [video, engine])

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

  /** Sample the colour under a normalised point — used to calibrate. */
  const sampleAt = useCallback((nx: number, ny: number) => {
    if (!frameRef.current) processRef.current()
    const frame = frameRef.current
    return frame ? sampleHue(frame, nx, ny) : null
  }, [])

  const reset = useCallback(() => engine.reset(), [engine])

  return {
    detections, blocked, fps, sampleAt, reset, processFrame,
    procWidth: PROC_WIDTH, procHeight,
  }
}
