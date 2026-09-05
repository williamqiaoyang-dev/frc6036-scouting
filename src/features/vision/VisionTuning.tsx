import { useMemo, useState } from 'react'
import { DEFAULT_VISION, type VisionConfig } from '@/lib/vision'

/**
 * Every detector threshold as a slider.
 *
 * Venue lighting never cooperates and no default survives contact with a
 * real field, so the numbers that decide what counts as a ball are exposed
 * rather than buried. Shared by the live camera counter and film review, so
 * a setting tuned in one place reads the same in the other.
 */
export function VisionTuning({
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
        <span className="font-display text-[15px] font-600 text-chalk-dim">Tuning</span>
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
