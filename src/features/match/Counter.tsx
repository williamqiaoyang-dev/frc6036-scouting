import clsx from 'clsx'
import type { CounterAction } from '@/games/types'

/**
 * The most-pressed control in the app — hundreds of taps per match, under
 * time pressure, in bad light. So: a very large primary target with the
 * value living inside it, a small dedicated decrement, and no animation that
 * could lag behind a fast sequence of taps.
 */
export function Counter({
  action, value, onChange, hotkey,
}: {
  action: CounterAction
  value: number
  onChange: (delta: number) => void
  hotkey?: string
}) {
  // Misses read as recessive; scoring actions read as live.
  const isMiss = action.isMiss
  const step = action.step ?? 1
  const primary = isMiss
    ? 'border-deck-500 bg-deck-700 text-chalk-dim hover:bg-deck-600'
    : 'border-signal/35 bg-signal/10 text-signal hover:bg-signal/20'

  return (
    <div className="tap-target panel">
      <div className="flex items-start justify-between gap-2 px-2.5 pb-1.5 pt-2">
        <div className="min-w-0">
          <div className="font-display text-[16px] font-600 leading-tight text-chalk">
            {action.label}
          </div>
          {action.hint && (
            <div className="mt-0.5 text-[12px] leading-tight text-chalk-faint">{action.hint}</div>
          )}
        </div>
        {hotkey && (
          <kbd className="hidden shrink-0 rounded-panel border border-deck-500 px-1.5 py-0.5
                          text-[11px] font-600 text-chalk-faint sm:block">
            {hotkey}
          </kbd>
        )}
      </div>

      <div className="flex items-stretch gap-px p-1 pt-0">
        <button
          type="button"
          onClick={() => onChange(-step)}
          disabled={value <= 0}
          aria-label={`${step} fewer ${action.label}`}
          className="tap-target w-11 shrink-0 rounded-panel border border-deck-500 bg-deck-900
                     text-[17px] font-600 text-chalk-faint transition
                     hover:bg-deck-600 hover:text-chalk active:translate-y-px
                     disabled:opacity-25"
        >
          −{step > 1 ? step : ''}
        </button>

        <button
          type="button"
          onClick={() => onChange(step)}
          aria-label={`${step} more ${action.label}`}
          className={clsx(
            'tap-target flex flex-1 items-center justify-center gap-3 rounded-panel border py-2.5',
            'transition active:translate-y-px',
            primary,
          )}
        >
          <span className="readout text-[34px] font-700">{value}</span>
          <span className="text-[18px] font-600 opacity-40">+{step > 1 ? step : ''}</span>
        </button>

        {/* A burst is rarely an exact multiple of the step, so keep an exact
            trim next to the big target rather than making scouts overshoot. */}
        {step > 1 && <Trim value={value} onChange={onChange} label={action.label} />}
      </div>
    </div>
  )
}

/** ±1 fine adjust for counters that step by more than one. */
export function Trim({
  value, onChange, label,
}: {
  value: number
  onChange: (delta: number) => void
  label: string
}) {
  const btn = `flex flex-1 items-center justify-center rounded-panel border border-deck-500
               bg-deck-900 text-[13px] font-600 text-chalk-faint transition
               hover:bg-deck-600 hover:text-chalk active:translate-y-px disabled:opacity-25`
  return (
    <div className="flex w-10 shrink-0 flex-col gap-px">
      <button type="button" onClick={() => onChange(1)} className={btn}
        aria-label={`One more ${label}`}>+1</button>
      <button type="button" onClick={() => onChange(-1)} disabled={value <= 0} className={btn}
        aria-label={`One fewer ${label}`}>−1</button>
    </div>
  )
}
