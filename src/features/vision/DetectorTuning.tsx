import { useState } from 'react'
import type { Detector } from '@/lib/detectors'

/**
 * Every threshold for one detector, as sliders.
 *
 * Venue lighting never cooperates and no default survives contact with a
 * real field, so the numbers that decide what counts are exposed rather
 * than buried. Per detector, because "what a ball looks like" and "what a
 * bumper looks like" have almost nothing in common.
 */
export function DetectorTuning({
  detectors, selectedId, onSelect, onChange,
}: {
  detectors: Detector[]
  selectedId: string
  onSelect: (id: string) => void
  onChange: (next: Detector) => void
}) {
  const [open, setOpen] = useState(false)
  const d = detectors.find((x) => x.id === selectedId) ?? detectors[0]
  if (!d) return null

  const look = d.appearance
  const swatch = `hsl(${look.hue} 85% 55%)`

  const appearanceRows: [string, keyof typeof look, number, number, number, string][] = [
    ['Colour', 'hue', 0, 360, 1, 'Sampled from the real thing, or set by hand.'],
    ['Colour tolerance', 'hueTolerance', 3, 60, 1, 'Wider catches more, but risks false hits.'],
    ['Min brightness', 'minValue', 0, 1, 0.01, 'Raise it to reject shadows.'],
    ['Min saturation', 'minSaturation', 0, 1, 0.01, 'Raise it to reject grey and white.'],
    ['Min size (px)', 'minRadius', 2, 60, 1, 'At 320px processing width.'],
    ['Max size (px)', 'maxRadius', 5, 140, 1, ''],
    ['Min roundness', 'minCircularity', 0, 1, 0.01, 'Higher rejects arms and streaks.'],
    ['Max roundness', 'maxCircularity', 0.1, 1, 0.01, 'Below 1 to require a non-round shape, like a bumper.'],
    ['Floor line', 'groundY', 0.2, 1, 0.01, 'Nothing below this fraction of the frame is looked at.'],
  ]

  const ruleRows: [string, keyof Detector, number, number, number, string][] = [
    ['Repeat guard (ms)', 'cooldownMs', 60, 20000, 10, 'Minimum gap between two events.'],
    ['Frames before gone', 'maxMissedFrames', 1, 30, 1, 'How long a thing may vanish before its track ends.'],
    ['Travel to count (px)', 'minTravelPx', 0, 120, 1, 'Only for "arrived and went in".'],
    ['Hold time (s)', 'dwellSec', 0.5, 30, 0.5, 'Only for "stayed here" and "stopped moving".'],
    ['Stillness (px)', 'stillPx', 1, 40, 1, 'Movement below this counts as not moving.'],
  ]

  return (
    <div className="mt-3 border-t border-deck-600 pt-2">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left">
        <span className="font-display text-[15px] font-600 text-chalk-dim">Tuning</span>
        <span className="flex items-center gap-2 text-[12px] text-chalk-faint">
          <span className="inline-block h-3 w-3 rounded-full border border-deck-500"
            style={{ background: swatch }} />
          {open ? 'hide' : 'show'}
        </span>
      </button>

      {open && (
        <>
          <select className="input mt-2 h-8 py-0 text-[13px]" value={d.id}
            onChange={(e) => onSelect(e.target.value)}>
            {detectors.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>

          <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
            {appearanceRows.map(([label, key, min, max, step, hint]) => (
              <label key={key} className="block">
                <span className="flex items-baseline justify-between">
                  <span className="label">{label}</span>
                  <span className="text-[12px] text-chalk-dim">{look[key] as number}</span>
                </span>
                <input type="range" min={min} max={max} step={step} value={look[key] as number}
                  onChange={(e) => onChange({
                    ...d, appearance: { ...look, [key]: Number(e.target.value) },
                  })}
                  className="mt-1 w-full accent-signal" />
                {hint && <span className="text-[11px] leading-tight text-chalk-faint">{hint}</span>}
              </label>
            ))}
            {ruleRows.map(([label, key, min, max, step, hint]) => (
              <label key={key} className="block">
                <span className="flex items-baseline justify-between">
                  <span className="label">{label}</span>
                  <span className="text-[12px] text-chalk-dim">{d[key] as number}</span>
                </span>
                <input type="range" min={min} max={max} step={step} value={d[key] as number}
                  onChange={(e) => onChange({ ...d, [key]: Number(e.target.value) })}
                  className="mt-1 w-full accent-signal" />
                {hint && <span className="text-[11px] leading-tight text-chalk-faint">{hint}</span>}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
