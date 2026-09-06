import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { Detector, DetectorEvent } from '@/lib/detectors'
import { Panel } from '@/components/ui'
import { Trim } from '@/features/match/Counter'
import { DetectorList, detectorColor } from './DetectorList'
import { DetectorTuning } from './DetectorTuning'
import { drawDetectorOverlay, type Point } from './overlay'
import { useDetectors } from './useDetectors'

export type CameraMode = 'manual' | 'static' | 'dynamic' | 'volley'

/**
 * Camera-assisted scouting during a live match.
 *
 * The FUEL count is the headline because it is the number a scout is
 * hammering all match, but the same camera feeds every other detector the
 * game defines — leaving the start zone, intakes, a robot that stops
 * moving. Manual counting stays available and the mode switch is never
 * hidden: a scout who does not trust what the camera is doing has to be
 * able to take over instantly.
 *
 * "AI static" and "AI dynamic" set how the FUEL detector decides a ball
 * scored — the moment it arrives in the goal, or only when it arrives and
 * vanishes. Static suits a tripod pointed at the hub; dynamic is the honest
 * one for a phone held in the stands.
 */
export function VisionCounter({
  mode, onModeChange, detectors, onDetectorsChange, onEvent,
  counted, onManualAdjust, step = 1, label, fuelDetectorId = 'fuel_scored',
  volleyPanel,
}: {
  mode: CameraMode
  onModeChange: (m: CameraMode) => void
  detectors: Detector[]
  onDetectorsChange: (next: Detector[]) => void
  onEvent: (e: DetectorEvent) => void
  counted: number
  onManualAdjust: (delta: number) => void
  step?: number
  label: string
  fuelDetectorId?: string
  /** Rendered instead of the camera when counting by volleys. */
  volleyPanel?: React.ReactNode
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [track, setTrack] = useState<MediaStreamTrack | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [missedSec, setMissedSec] = useState(0)
  const [lastHit, setLastHit] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})

  const [drawing, setDrawing] = useState<string | null>(null)
  /** Two clicks for a box, or a traced polygon. See FilmAnalyzer for why. */
  const [drawMode, setDrawMode] = useState<'box' | 'poly'>('box')
  const [sampling, setSampling] = useState<string | null>(null)
  const [draft, setDraft] = useState<Point[]>([])
  const [tuned, setTuned] = useState(fuelDetectorId)

  const active = mode === 'static' || mode === 'dynamic'
  const armed = detectors.filter((d) => d.enabled && d.zone.length >= 3)

  const { detections, paths, fps, sampleAt, reset, previewFrame, procWidth, procHeight } =
    useDetectors({
      video, detectors,
      // Lower than film review on purpose: this runs on a phone in the
      // stands at thirty frames a second, and a scout who has to wait for
      // the overlay has already missed the shot.
      procWidth: 480,
      liveLoop: streaming && active,
      track,
      onEvent: (e) => {
        setLastHit(Date.now())
        setCounts((c) => ({ ...c, [e.detectorId]: (c[e.detectorId] ?? 0) + 1 }))
        onEvent(e)
      },
    })

  /** What each detector can pick out of the current frame, area or no area. */
  const seeing = useMemo(() => {
    const out: Record<string, number> = {}
    for (const g of detections) out[g.detectorId] = g.detections.length
    return out
  }, [detections])

  // The mode buttons choose how the FUEL detector decides a ball scored.
  useEffect(() => {
    if (mode === 'manual') return
    const rule = mode === 'static' ? 'enter' : 'vanish-in'
    const fuel = detectors.find((d) => d.id === fuelDetectorId)
    if (fuel && fuel.rule !== rule) {
      onDetectorsChange(detectors.map((d) => d.id === fuelDetectorId ? { ...d, rule } : d))
    }
  }, [mode, detectors, fuelDetectorId])

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
          setTrack(s.getVideoTracks()[0] ?? null)
          setStreaming(true)
        }).catch(() => setError('The camera stream would not start.'))
      }
    }).catch(() => setError('No camera access. Check the browser permission prompt.'))

    return () => {
      cancelled = true
      setStreaming(false)
      setVideo(null)
      setTrack(null)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active])

  // A backgrounded tab is presented no frames, and a camera has no track to
  // rewind — so counting simply stops. Losing counts silently would be
  // worse than losing them, so say how long was missed.
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
    if (!canvas) return
    drawDetectorOverlay(canvas, {
      detectors, colorOf: (id) => detectorColor(detectors, id),
      seen: detections, paths, draft, drawingId: drawing, procWidth, procHeight,
    })
  }, [detections, detectors, draft, drawing, procWidth, procHeight])

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }

    if (drawing) {
      if (drawMode === 'poly') { setDraft((d) => [...d, p]); return }
      if (!draft.length) { setDraft([p]); return }
      const a = draft[0]
      applyZone(drawing, [
        { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y) },
        { x: Math.max(a.x, p.x), y: Math.min(a.y, p.y) },
        { x: Math.max(a.x, p.x), y: Math.max(a.y, p.y) },
        { x: Math.min(a.x, p.x), y: Math.max(a.y, p.y) },
      ])
      return
    }
    if (sampling) {
      const s = sampleAt(p.x, p.y)
      if (s && s.value > 0.08) {
        onDetectorsChange(detectors.map((d) => d.id === sampling ? {
          ...d,
          appearance: {
            ...d.appearance,
            hue: Math.round(s.hue),
            minSaturation: Math.max(0.15, s.saturation * 0.55),
            minValue: Math.max(0.12, s.value * 0.45),
          },
        } : d))
        setSampling(null)
      } else setError('That spot is too dark to sample. Try a lit part of it.')
    }
  }

  function applyZone(id: string, zone: Point[]) {
    onDetectorsChange(detectors.map((d) => d.id === id ? { ...d, zone, enabled: true } : d))
    setDraft([])
    setDrawing(null)
    reset()
  }

  function finishZone() {
    if (drawing && draft.length >= 3) applyZone(drawing, draft)
    else { setDraft([]); setDrawing(null) }
  }

  /** The whole picture — proves the colour works, but counts everywhere. */
  function coverFrame(id: string) {
    applyZone(id, [{ x: 0.01, y: 0.01 }, { x: 0.99, y: 0.01 },
                   { x: 0.99, y: 0.99 }, { x: 0.01, y: 0.99 }])
  }

  useEffect(() => { if (sampling) previewFrame() }, [sampling, previewFrame])

  const hitRecently = Date.now() - lastHit < 350
  const modes: [CameraMode, string, string][] = [
    ['manual', 'Tap', 'Count the balls yourself, five at a time.'],
    ['volley', 'Volleys', 'Hold while it fires, then say how much of the magazine went out.'],
    ['static', 'AI static', 'Counts the moment a ball reaches the goal. For a fixed camera.'],
    ['dynamic', 'AI dynamic', 'Counts when a ball reaches the goal and vanishes into it.'],
  ]

  return (
    <Panel
      title="FUEL counter"
      right={<span className="text-[12px] text-chalk-faint">
        {active
          ? streaming ? `${fps} fps · ${armed.length} detector${armed.length === 1 ? '' : 's'} armed` : 'starting camera…'
          : 'camera off'}
      </span>}
    >
      {/* ---- mode ------------------------------------------------------- */}
      <div className="mb-3 flex gap-px">
        {modes.map(([id, text, hint]) => (
          <button key={id} type="button" onClick={() => onModeChange(id)} title={hint}
            className={clsx(
              'flex-1 rounded-panel border px-2 py-1.5 font-display text-[15px] font-600 transition',
              mode === id ? 'border-signal bg-signal/15 text-signal'
                : 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk')}>
            {text}
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
          hitRecently ? 'border-emerald-400 bg-emerald-400/20' : 'border-signal/35 bg-signal/10')}>
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
        <div className="grid gap-3 xl:grid-cols-[1fr_320px]">
          <div>
            <div className="relative overflow-hidden rounded-panel border border-deck-500 bg-black">
              <video ref={videoRef} playsInline muted className="block w-full" />
              <canvas ref={overlayRef} onClick={onCanvasClick}
                className={clsx('absolute inset-0 h-full w-full',
                  drawing || sampling ? 'cursor-crosshair' : 'cursor-default')} />
              {(drawing || sampling) && (
                <div className="absolute inset-x-0 top-0 bg-signal px-2 py-1 text-[12px] font-600 text-deck-900">
                  {drawing
                    ? drawMode === 'box'
                      ? (draft.length
                          ? `Now tap the opposite corner of the area for “${detectors.find((d) => d.id === drawing)?.label}”.`
                          : `Tap one corner of the area for “${detectors.find((d) => d.id === drawing)?.label}”, then the opposite one.`)
                      : `Click the corners of the area for “${detectors.find((d) => d.id === drawing)?.label}”, then Finish. ${draft.length} placed.`
                    : `Click the thing “${detectors.find((d) => d.id === sampling)?.label}” should look for.`}
                </div>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {drawing ? (
                <>
                  {drawMode === 'poly' && (
                    <button type="button" onClick={finishZone} disabled={draft.length < 3}
                      className="btn-primary h-8 py-0 text-[13px] disabled:opacity-30">Finish area</button>
                  )}
                  {drawMode === 'box' && (
                    <span className="text-[13px] text-signal">
                      {draft.length ? 'Tap the opposite corner.' : 'Tap one corner of the goal.'}
                    </span>
                  )}
                  <button type="button" onClick={() => { setDraft([]); setDrawing(null) }}
                    className="btn-ghost h-8 py-0 text-[13px]">Cancel</button>
                </>
              ) : (
                <button type="button" onClick={reset} className="btn-ghost h-8 py-0 text-[13px]">
                  Reset tracking
                </button>
              )}
            </div>

            {!armed.length && (() => {
              // Same reasoning as film review: the rule that blocks you and
              // the button that satisfies it belong in the same place.
              const target = detectors.find((d) => d.id === fuelDetectorId)
                ?? detectors.find((d) => d.enabled) ?? detectors[0]
              const totalSeen = Object.values(seeing).reduce((a, b) => a + b, 0)
              if (!target) return null
              return (
                <div className="mt-2 rounded-panel border border-signal/40 bg-signal/5 p-2">
                  <p className="text-[12px] leading-snug text-signal">
                    Nothing is counted until “{target.label}” has an area — that is what
                    keeps balls on the floor out of the count.
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <button type="button"
                      onClick={() => { setSampling(null); setDraft([]); setDrawMode('box'); setDrawing(target.id) }}
                      className="btn-primary h-7 py-0 text-[12px]">
                      Tap a box over the goal
                    </button>
                    <button type="button" onClick={() => coverFrame(target.id)}
                      className="btn-ghost h-7 py-0 text-[12px]"
                      title="Counts a ball anywhere in the picture, so it over-counts. Use it to check the colour, then draw the real area.">
                      Use the whole frame
                    </button>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-snug text-chalk-faint">
                    {totalSeen > 0
                      ? `Colour is working — ${totalSeen} thing${totalSeen === 1 ? '' : 's'} `
                        + 'picked out of this frame. Only the area is missing.'
                      : 'Nothing picked out of this frame either — use “Sample colour” '
                        + 'and tap a real FUEL ball first.'}
                  </p>
                </div>
              )
            })()}
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
          </div>

          <div>
            <DetectorList
              detectors={detectors}
              onChange={onDetectorsChange}
              counts={counts}
              seeing={seeing}
              onCover={coverFrame}
              drawing={drawing}
              onDraw={(id, mode) => { setSampling(null); setDraft([]); setDrawMode(mode); setDrawing(id) }}
              onSample={(id) => { setDrawing(null); setDraft([]); setSampling(id) }}
              targetLabel={() => ''}
            />
            <DetectorTuning detectors={detectors} selectedId={tuned} onSelect={setTuned}
              onChange={(next) => onDetectorsChange(
                detectors.map((d) => d.id === next.id ? next : d))} />
          </div>
        </div>
      )}

      {mode === 'volley' && volleyPanel}

      {mode === 'manual' && (
        <p className="text-[12px] leading-snug text-chalk-faint">
          Tap the counter as FUEL scores, five a tap. Switch to Volleys if it shoots
          faster than you can tap, or to a camera mode to have the app count for you.
        </p>
      )}
    </Panel>
  )
}
