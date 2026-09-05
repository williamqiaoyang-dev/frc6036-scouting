import { useCallback, useEffect, useRef, useState } from 'react'
import { BallTracker, type VisionMode } from '@/lib/ballTracker'
import { detectBalls, sampleHue, type Detection, type VisionConfig } from '@/lib/vision'

/** Frames are processed at this width; height follows the aspect ratio. */
const PROC_WIDTH = 320

export interface FrameShot {
  /** Seconds into the video. */
  t: number
  /** Where it crossed, normalised to the frame. */
  x: number
  y: number
  mode: VisionMode
}

/**
 * Runs the ball detector over a <video> — a match recording or a shared tab
 * — rather than a live camera.
 *
 * Two things differ from the camera path and both matter:
 *
 *   1. The tracker is clocked on `video.currentTime`, not the wall clock.
 *      The repeat guard is therefore measured in video seconds, so a scan
 *      produces the same shots however fast it ran.
 *   2. Frames can be pulled on demand via `processFrame`, which is how a
 *      file is scanned: seek, read, repeat. The browser only presents
 *      frames while the tab is in front, so anything driven by the repaint
 *      or presented-frame callbacks stalls the moment a scout switches
 *      tabs. Seeking does not, so a scan of a file keeps running.
 *
 * The presented-frame loop is still used for a live stream, where there is
 * nothing to seek and the tab is by definition being watched.
 *
 * A cross-origin video (a YouTube iframe, an unproxied remote file) taints
 * the canvas and cannot be read at all; that surfaces as `blocked` rather
 * than a silent stream of zero detections.
 */
export function useFrameVision({
  video, mode, config, liveLoop, track, onShot,
}: {
  video: HTMLVideoElement | null
  mode: VisionMode
  config: VisionConfig
  /** Follow frames as they arrive — for a stream, which cannot be seeked. */
  liveLoop: boolean
  /** The stream's video track, when there is one. Preferred frame source. */
  track?: MediaStreamTrack | null
  onShot: (shot: FrameShot) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const trackerRef = useRef(new BallTracker(mode, config))
  const frameRef = useRef<ImageData | null>(null)
  const onShotRef = useRef(onShot)
  const processRef = useRef<(src?: any) => void>(() => {})

  const [detections, setDetections] = useState<Detection[]>([])
  const [procHeight, setProcHeight] = useState(180)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => { onShotRef.current = onShot }, [onShot])
  useEffect(() => { trackerRef.current.setMode(mode) }, [mode])
  useEffect(() => { trackerRef.current.setConfig(config) }, [config])

  // Build the frame reader. Independent of how it is driven.
  useEffect(() => {
    if (!video || mode === 'manual') {
      processRef.current = () => {}
      setDetections([])
      return
    }

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    let stopped = false

    // `src` is a VideoFrame when frames are pulled off a track directly;
    // otherwise the element itself is drawn.
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
        // Tainted canvas: the pixels belong to another origin.
        setBlocked(true)
        stopped = true
        return
      }
      frameRef.current = frame

      const found = detectBalls(frame, config)
      setDetections(found)

      // Video time, in ms, is the clock — see the note above.
      const at = video.currentTime * 1000
      for (const ev of trackerRef.current.update(found, PROC_WIDTH, h, at)) {
        onShotRef.current({ t: video.currentTime, x: ev.x, y: ev.y, mode: ev.mode })
      }
    }

    setBlocked(false)
    return () => { stopped = true }
  }, [video, mode, config])

  // Live loop, for a stream that cannot be seeked.
  //
  // Pulling frames off the track is strongly preferred over the presented-
  // frame callback, because sharing a tab means switching to it — which
  // backgrounds this page, and a background page is presented no frames at
  // all. Reading the track keeps working; the callback would sit silent
  // and count nothing for exactly as long as the scout was watching.
  useEffect(() => {
    if (!liveLoop || !video || mode === 'manual') return
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
          } catch {
            break
          }
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
  }, [video, liveLoop, mode, config, track])

  /** Read the frame currently displayed. Used by the seek-driven scan. */
  const processFrame = useCallback(() => processRef.current(), [])

  /** Sample the colour under a normalised point — used to calibrate. */
  const sampleAt = useCallback((nx: number, ny: number) => {
    if (!frameRef.current) processRef.current()
    const frame = frameRef.current
    return frame ? sampleHue(frame, nx, ny) : null
  }, [])

  const reset = useCallback(() => trackerRef.current.reset(), [])

  return { detections, blocked, sampleAt, reset, processFrame, procWidth: PROC_WIDTH, procHeight }
}
