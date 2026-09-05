import clsx from 'clsx'
import type { Detector } from '@/lib/detectors'

/** One colour per detector, so an area on screen is traceable to its row. */
export const DETECTOR_COLORS = [
  '#3B8CFF', '#34d399', '#f472b6', '#fbbf24',
  '#a78bfa', '#22d3ee', '#fb7185', '#84cc16',
]

export function detectorColor(detectors: Detector[], id: string): string {
  const i = detectors.findIndex((d) => d.id === id)
  return DETECTOR_COLORS[(i < 0 ? 0 : i) % DETECTOR_COLORS.length]
}

const CONFIDENCE: Record<string, { label: string; className: string }> = {
  high: { label: 'reliable', className: 'bg-emerald-400/15 text-emerald-300' },
  medium: { label: 'check it', className: 'bg-signal/15 text-signal' },
  low: { label: 'rough', className: 'bg-alliance-red/15 text-alliance-red' },
}

/**
 * What the camera is being asked to watch for, and how much of it to
 * believe.
 *
 * Confidence is on the face of every row rather than in documentation
 * nobody reads. A rough detector left running unnoticed is how invented
 * numbers reach a picklist, so the ones that guess are labelled as guessing
 * and ship switched off.
 */
export function DetectorList({
  detectors, onChange, counts, drawing, onDraw, onSample, targetLabel,
}: {
  detectors: Detector[]
  onChange: (next: Detector[]) => void
  /** How many times each detector has fired this session. */
  counts: Record<string, number>
  /** Id of the detector whose area is being drawn, if any. */
  drawing: string | null
  onDraw: (id: string) => void
  onSample: (id: string) => void
  /** Human name of the form field a detector feeds. */
  targetLabel: (d: Detector) => string
}) {
  function patch(id: string, changes: Partial<Detector>) {
    onChange(detectors.map((d) => (d.id === id ? { ...d, ...changes } : d)))
  }

  return (
    <div className="space-y-1">
      {detectors.map((d) => {
        const colour = detectorColor(detectors, d.id)
        const ready = d.zone.length >= 3
        const conf = CONFIDENCE[d.confidence]
        return (
          <div key={d.id}
            className={clsx('rounded-panel border p-2 transition',
              drawing === d.id ? 'border-signal bg-signal/10'
                : d.enabled ? 'border-deck-500' : 'border-deck-600 opacity-60')}>
            <div className="flex items-start gap-2">
              <button type="button" role="switch" aria-checked={d.enabled}
                onClick={() => patch(d.id, { enabled: !d.enabled })}
                className={clsx('mt-0.5 h-4 w-7 shrink-0 rounded-full border transition',
                  d.enabled ? 'border-transparent bg-signal' : 'border-deck-500 bg-deck-900')}>
                <span className={clsx('block h-3 w-3 rounded-full bg-deck-900 transition',
                  d.enabled ? 'ml-3.5 bg-deck-900' : 'ml-0.5 bg-chalk-faint')} />
              </button>

              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: ready ? colour : 'transparent', border: `1px solid ${colour}` }} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-[15px] font-600 text-chalk">{d.label}</span>
                  <span className={clsx('rounded px-1.5 text-[11px] font-600', conf.className)}>
                    {conf.label}
                  </span>
                  <span className="text-[12px] text-chalk-faint">→ {targetLabel(d)}</span>
                  {counts[d.id] > 0 && (
                    <span className="ml-auto font-mono text-[13px] font-700 text-signal">
                      {counts[d.id]}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] leading-tight text-chalk-faint">{d.hint}</p>

                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <button type="button" onClick={() => onDraw(d.id)}
                    className={clsx('h-7 rounded-panel border px-2 text-[12px] font-600 transition',
                      ready ? 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk'
                        : 'border-signal/60 text-signal hover:bg-signal/10')}>
                    {ready ? 'Redraw area' : 'Draw its area'}
                  </button>
                  <button type="button" onClick={() => onSample(d.id)}
                    className="h-7 rounded-panel border border-deck-500 px-2 text-[12px] font-600
                               text-chalk-dim transition hover:bg-deck-600 hover:text-chalk">
                    Sample colour
                  </button>
                  {!ready && (
                    <span className="text-[11px] text-signal">no area — can't fire</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
