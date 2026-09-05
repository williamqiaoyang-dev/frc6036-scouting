import { useCallback, useEffect, useRef, useState } from 'react'
import { BallTracker, type ScoreEvent, type VisionMode } from '@/lib/ballTracker'
import { detectBalls, sampleHue, type Detection, type VisionConfig } from '@/lib/vision'

/** Frames are processed at this width; height follows the aspect ratio. */
const PROC_WIDTH = 320

/**
 * Runs the detector against a live <video> and reports scoring events.
 *
 * Processing happens on a small offscreen canvas — a 320px frame is plenty
 * to find a ball and keeps a school laptop at full frame rate, where a
 * full-resolution scan would not.
 */
export function useBallVision({
  video, mode, config, enabled, onScore,
}: {
  video: HTMLVideoElement | null
  mode: VisionMode
  config: VisionConfig
  enabled: boolean
  onScore: (event: ScoreEvent) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const trackerRef = useRef<BallTracker>(new BallTracker(mode, config))
  const frameRef = useRef<ImageData | null>(null)
  const rafRef = useRef<number>()
  const onScoreRef = useRef(onScore)

  const [detections, setDetections] = useState<Detection[]>([])
  const [fps, setFps] = useState(0)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { trackerRef.current.setMode(mode) }, [mode])
  useEffect(() => { trackerRef.current.setConfig(config) }, [config])

  useEffect(() => {
    if (!enabled || !video || mode === 'manual') {
      setDetections([])
      return
    }

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    trackerRef.current.reset()
    let cancelled = false
    let lastTick = performance.now()
    let smoothed = 0

    const tick = () => {
      if (cancelled) return
      rafRef.current = requestAnimationFrame(tick)

      if (video.readyState < 2 || !video.videoWidth) return

      const h = Math.round(PROC_WIDTH * (video.videoHeight / video.videoWidth))
      if (canvas.width !== PROC_WIDTH || canvas.height !== h) {
        canvas.width = PROC_WIDTH
        canvas.height = h
      }

      ctx.drawImage(video, 0, 0, PROC_WIDTH, h)
      const frame = ctx.getImageData(0, 0, PROC_WIDTH, h)
      frameRef.current = frame

      const found = detectBalls(frame, config)
      setDetections(found)

      for (const ev of trackerRef.current.update(found, PROC_WIDTH, h)) {
        onScoreRef.current(ev)
      }

      const now = performance.now()
      smoothed = smoothed * 0.9 + (1000 / Math.max(1, now - lastTick)) * 0.1
      lastTick = now
      setFps(Math.round(smoothed))
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [video, enabled, mode, config])

  /** Sample the colour under a normalised point — used to calibrate. */
  const sampleAt = useCallback((nx: number, ny: number) => {
    const frame = frameRef.current
    return frame ? sampleHue(frame, nx, ny) : null
  }, [])

  const reset = useCallback(() => trackerRef.current.reset(), [])

  return { detections, fps, sampleAt, reset, procWidth: PROC_WIDTH }
}
