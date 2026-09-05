import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { VisionMode } from '@/lib/ballTracker'
import type { VisionConfig } from '@/lib/vision'
import { Panel } from '@/components/ui'
import { useBallVision } from './useBallVision'
import { VisionTuning } from './VisionTuning'
import { drawVisionOverlay } from './overlay'
import { Trim } from '@/features/match/Counter'

type Tool = 'none' | 'zone' | 'sample' | 'floor'

/**
 * Camera-assisted FUEL counting.
 *
 * The scout points a phone or laptop camera at the goal, marks where the goal
 * is, taps a ball to teach the app its colour, and the app counts shots going
 * in. Manual counting stays available and is always the fallback — the mode
 * switch is deliberately never hidden, because a scout who does not trust
 * what the camera is doing must be able to take over instantly.
 */
export function VisionCounter({
  mode, onModeChange, config, onConfigChange, onScore, counted, onManualAdjust, step = 1, label,
}: {
  mode: VisionMode
  onModeChange: (m: VisionMode) => void
  config: VisionConfig
  onConfigChange: (c: VisionConfig) => void
  onScore: () => void
  counted: number
  onManualAdjust: (delta: number) => void
  /** Units per manual tap. The camera always counts one ball at a time. */
  step?: number
  label: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [tool, setTool] = useState<Tool>('none')
  const [draft, setDraft] = useState<{ x: number; y: number }[]>([])
  const [lastHit, setLastHit] = useState(0)
  const [missedSec, setMissedSec] = useState(0)

  const active = mode !== 'manual'

  const { detections, fps, sampleAt, reset, procWidth } = useBallVision({
    video, mode, config, enabled: streaming && active,
    onScore: () => { setLastHit(Date.now()); onScore() },
  })

  // ---- camera ------------------------------------------------------------
  useEffect(() => {
    if (!active) return
    let stream: MediaStream | null = null
    let cancelled = false

    navigator.mediaDevices?.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 } },
      audio: false,
    }).then((s) => {
      if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
      stream = s
      if (videoRef.current) {
        videoRef.current.srcObject = s
        videoRef.current.play().then(() => {
          setVideo(videoRef.current)
          setStreaming(true)
        }).catch(() => setError('The camera stream would not start.'))
      }
    }).catch(() => setError('No camera access. Check the browser permission prompt.'))

    return () => {
      cancelled = true
      setStreaming(false)
      setVideo(null)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active])

  // A backgrounded tab is presented no frames, so the camera counts nothing
  // while the scout is looking at something else. Losing counts silently
  // would be worse than losing them, so say how long was missed.
  useEffect(() => {
    if (!active || !streaming) return
    let hiddenAt = 0
    const onChange = () => {
      if (document.hidden) hiddenAt = Date.now()
      else if (hiddenAt) {
        const gap = (Date.now() - hiddenAt) / 1000
        if (gap > 1.5) setMissedSec(Math.round(gap))
        hiddenAt = 0
      }
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [active, streaming])

  // ---- overlay -----------------------------------------------------------
  useEffect(() => {
    const canvas = overlayRef.current
    const v = videoRef.current
    if (!canvas || !v || !v.videoWidth) return
    drawVisionOverlay(canvas, {
      config, draft, detections,
      procWidth,
      procHeight: Math.round(procWidth * (v.videoHeight / v.videoWidth)),
    })
  }, [detections, config.zone, config.groundY, draft])

  function toNorm(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const p = toNorm(e)
    if (tool === 'zone') {
      setDraft((d) => [...d, p])
    } else if (tool === 'floor') {
      onConfigChange({ ...config, groundY: Math.min(0.99, Math.max(0.05, p.y)) })
      setTool('none')
    } else if (tool === 'sample') {
      const s = sampleAt(p.x, p.y)
      if (s && s.value > 0.08) {
        onConfigChange({
          ...config,
          hue: Math.round(s.hue),
          minSaturation: Math.max(0.15, s.saturation * 0.55),
          minValue: Math.max(0.12, s.value * 0.45),
        })
        setTool('none')
      } else {
        setError('That spot is too dark to sample. Try a lit part of the ball.')
      }
    }
  }

  function finishZone() {
    if (draft.length >= 3) onConfigChange({ ...config, zone: draft })
    setDraft([])
    setTool('none')
    reset()
  }

  const hitRecently = Date.now() - lastHit < 350
  const zoneReady = config.zone.length >= 3

  return (
    <Panel
      title="FUEL counter"
      right={<span className="text-[12px] text-chalk-faint">
        {active ? (streaming ? `${fps} fps · ${detections.length} seen` : 'starting camera…') : 'camera off'}
      </span>}
    >
      {/* ---- mode ------------------------------------------------------- */}
      <div className="mb-3 flex gap-px">
        {([
          ['manual', 'Manual count', 'You tap. Always works.'],
          ['static', 'AI static', 'Camera fixed on the goal. Counts on entry.'],
          ['dynamic', 'AI dynamic', 'Handheld. Counts a tracked shot going in.'],
        ] as [VisionMode, string, string][]).map(([id, label, hint]) => (
          <button key={id} type="button" onClick={() => onModeChange(id)} title={hint}
            className={clsx(
              'flex-1 rounded-panel border px-2 py-1.5 font-display text-[15px] font-600 transition',
              mode === id
                ? 'border-signal bg-signal/15 text-signal'
                : 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk',
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* ---- count ------------------------------------------------------ */}
      <div className="mb-3 flex items-stretch gap-1">
        <button type="button" onClick={() => onManualAdjust(-step)} disabled={counted <= 0}
          aria-label={`${step} fewer ${label}`}
          className="tap-target w-11 rounded-panel border border-deck-500 bg-deck-900 text-[17px]
                     font-600 text-chalk-faint hover:bg-deck-600 hover:text-chalk disabled:opacity-25">
          −{step > 1 ? step : ''}
        </button>
        <div className={clsx(
          'flex flex-1 items-center justify-center rounded-panel border py-2 transition-colors',
          hitRecently ? 'border-emerald-400 bg-emerald-400/20' : 'border-signal/35 bg-signal/10',
        )}>
          <span className={clsx('readout text-[40px] font-700',
            hitRecently ? 'text-emerald-300' : 'text-signal')}>{counted}</span>
        </div>
        <button type="button" onClick={() => onManualAdjust(step)}
          aria-label={`${step} more ${label}`}
          className="tap-target w-11 rounded-panel border border-deck-500 bg-deck-900 text-[17px]
                     font-600 text-chalk-dim hover:bg-deck-600 hover:text-chalk">
          +{step > 1 ? step : ''}
        </button>
        {step > 1 && <Trim value={counted} onChange={onManualAdjust} label={label} />}
      </div>

      {/* ---- camera ----------------------------------------------------- */}
      {active && (
        <>
          <div className="relative overflow-hidden rounded-panel border border-deck-500 bg-black">
            <video ref={videoRef} playsInline muted className="block w-full" />
            <canvas
              ref={overlayRef}
              onClick={onCanvasClick}
              className={clsx('absolute inset-0 h-full w-full',
                tool !== 'none' ? 'cursor-crosshair' : 'cursor-default')}
            />
            {tool !== 'none' && (
              <div className="absolute inset-x-0 top-0 bg-signal px-2 py-1 text-[12px] font-600 text-deck-900">
                {tool === 'zone' && `Click the corners of the goal, then Finish. ${draft.length} placed.`}
                {tool === 'sample' && 'Click a FUEL ball to learn its colour.'}
                {tool === 'floor' && 'Click where the floor starts.'}
              </div>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {tool === 'zone' ? (
              <>
                <button type="button" onClick={finishZone} disabled={draft.length < 3}
                  className="btn-primary h-8 py-0 text-[13px]">Finish goal area</button>
                <button type="button" onClick={() => { setDraft([]); setTool('none') }}
                  className="btn-ghost h-8 py-0 text-[13px]">Cancel</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setDraft([]); setTool('zone') }}
                  className="btn-ghost h-8 py-0 text-[13px]">
                  {zoneReady ? 'Redraw goal area' : 'Mark goal area'}
                </button>
                <button type="button" onClick={() => setTool('sample')}
                  className="btn-ghost h-8 py-0 text-[13px]">Sample ball colour</button>
                <button type="button" onClick={() => setTool('floor')}
                  className="btn-ghost h-8 py-0 text-[13px]">Set floor line</button>
                <button type="button" onClick={reset}
                  className="btn-ghost h-8 py-0 text-[13px]">Reset tracking</button>
              </>
            )}
          </div>

          {!zoneReady && (
            <p className="mt-2 text-[12px] leading-snug text-signal">
              Mark the goal area before counting starts. Nothing is counted until you do —
              that is what keeps balls on the floor out of the count.
            </p>
          )}
          {missedSec > 0 && (
            <p className="mt-2 flex items-center gap-2 text-[12px] leading-snug text-signal">
              <span>
                This tab was in the background for {missedSec}s — the camera counted
                nothing during that time. Add what you saw by hand.
              </span>
              <button type="button" onClick={() => setMissedSec(0)}
                className="shrink-0 underline">dismiss</button>
            </p>
          )}
          {error && <p className="mt-2 text-[12px] text-alliance-red">{error}</p>}

          <VisionTuning config={config} onChange={onConfigChange} />
        </>
      )}

      {mode === 'manual' && (
        <p className="text-[12px] leading-snug text-chalk-faint">
          Tap the counter as FUEL scores. Switch to a camera mode to have the app
          count for you.
        </p>
      )}
    </Panel>
  )
}
