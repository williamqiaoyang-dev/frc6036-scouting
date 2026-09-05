import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { VisionMode } from '@/lib/ballTracker'
import { DEFAULT_VISION, type VisionConfig } from '@/lib/vision'
import { Panel } from '@/components/ui'
import { useBallVision } from './useBallVision'
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

  const active = mode !== 'manual'

  const { detections, fps, sampleAt, reset } = useBallVision({
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

  // ---- overlay -----------------------------------------------------------
  useEffect(() => {
    const canvas = overlayRef.current
    const v = videoRef.current
    if (!canvas || !v) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width = canvas.clientWidth
    const h = canvas.height = canvas.clientHeight
    ctx.clearRect(0, 0, w, h)

    // Floor line: everything below is ignored.
    ctx.strokeStyle = 'rgba(255,196,0,.55)'
    ctx.setLineDash([6, 5])
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, config.groundY * h)
    ctx.lineTo(w, config.groundY * h)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,196,0,.75)'
    ctx.font = '11px Barlow, sans-serif'
    ctx.fillText('floor — ignored below', 6, config.groundY * h + 13)

    const poly = draft.length ? draft : config.zone
    if (poly.length >= 2) {
      ctx.beginPath()
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)))
      if (!draft.length) ctx.closePath()
      ctx.strokeStyle = draft.length ? '#FFC400' : '#3B8CFF'
      ctx.lineWidth = 2
      ctx.stroke()
      if (!draft.length) { ctx.fillStyle = 'rgba(59,140,255,.14)'; ctx.fill() }
    }
    poly.forEach((p) => {
      ctx.beginPath()
      ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2)
      ctx.fillStyle = draft.length ? '#FFC400' : '#3B8CFF'
      ctx.fill()
    })

    // Detections, scaled from the processing canvas to display size.
    const sx = w / 320
    const sy = h / (320 * (v.videoHeight / Math.max(1, v.videoWidth)))
    for (const d of detections) {
      ctx.beginPath()
      ctx.arc(d.x * sx, d.y * sy, Math.max(5, d.radius * sx), 0, Math.PI * 2)
      ctx.strokeStyle = '#34d399'
      ctx.lineWidth = 2
      ctx.stroke()
    }
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
          {error && <p className="mt-2 text-[12px] text-alliance-red">{error}</p>}

          <Tuning config={config} onChange={onConfigChange} />
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

/** Every threshold is adjustable, because venue lighting never cooperates. */
function Tuning({
  config, onChange,
}: { config: VisionConfig; onChange: (c: VisionConfig) => void }) {
  const [open, setOpen] = useState(false)
  const swatch = useMemo(() => `hsl(${config.hue} 85% 55%)`, [config.hue])

  const rows: [string, keyof VisionConfig, number, number, number, string][] = [
    ['Ball colour', 'hue', 0, 360, 1, 'Sampled from a real ball, or set by hand.'],
    ['Colour tolerance', 'hueTolerance', 3, 60, 1, 'Wider catches more, but risks false hits.'],
    ['Min brightness', 'minValue', 0, 1, 0.01, 'Raise it to reject shadows.'],
    ['Min saturation', 'minSaturation', 0, 1, 0.01, 'Raise it to reject grey and white.'],
    ['Min ball size (px)', 'minRadius', 2, 40, 1, 'At 320px processing width.'],
    ['Max ball size (px)', 'maxRadius', 5, 120, 1, ''],
    ['Roundness', 'minCircularity', 0.2, 1, 0.01, 'Higher rejects arms, bumpers and streaks.'],
    ['Repeat guard (ms)', 'cooldownMs', 60, 1200, 10, 'Minimum gap between two counts.'],
    ['Travel to score (px)', 'minTravelPx', 0, 120, 1, 'Dynamic mode: how far a shot must move.'],
  ]

  return (
    <div className="mt-3 border-t border-deck-600 pt-2">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left">
        <span className="font-display text-[15px] font-600 text-chalk-dim">
          Tuning
        </span>
        <span className="flex items-center gap-2 text-[12px] text-chalk-faint">
          <span className="inline-block h-3 w-3 rounded-full border border-deck-500"
            style={{ background: swatch }} />
          {open ? 'hide' : 'show'}
        </span>
      </button>

      {open && (
        <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
          {rows.map(([label, key, min, max, step, hint]) => (
            <label key={key} className="block">
              <span className="flex items-baseline justify-between">
                <span className="label">{label}</span>
                <span className="text-[12px] text-chalk-dim">
                  {typeof config[key] === 'number' ? (config[key] as number) : ''}
                </span>
              </span>
              <input type="range" min={min} max={max} step={step}
                value={config[key] as number}
                onChange={(e) => onChange({ ...config, [key]: Number(e.target.value) })}
                className="mt-1 w-full accent-signal" />
              {hint && <span className="text-[11px] leading-tight text-chalk-faint">{hint}</span>}
            </label>
          ))}
          <div className="sm:col-span-2">
            <button type="button" onClick={() => onChange({ ...DEFAULT_VISION, zone: config.zone })}
              className="btn-ghost h-8 py-0 text-[13px]">Reset tuning to defaults</button>
          </div>
        </div>
      )}
    </div>
  )
}
