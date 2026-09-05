import clsx from 'clsx'
import type { CounterAction } from '@/games/types'

const ACCENTS: Record<string, { ring: string; bg: string; text: string }> = {
  emerald: { ring: 'border-emerald-500/40', bg: 'bg-emerald-500/10 hover:bg-emerald-500/20', text: 'text-emerald-300' },
  rose:    { ring: 'border-rose-500/40',    bg: 'bg-rose-500/10 hover:bg-rose-500/20',       text: 'text-rose-300' },
  amber:   { ring: 'border-amber-500/40',   bg: 'bg-amber-500/10 hover:bg-amber-500/20',     text: 'text-amber-300' },
  sky:     { ring: 'border-sky-500/40',     bg: 'bg-sky-500/10 hover:bg-sky-500/20',         text: 'text-sky-300' },
  slate:   { ring: 'border-white/10',       bg: 'bg-white/5 hover:bg-white/10',              text: 'text-slate-300' },
}

/**
 * The most-pressed control in the app. Big hit area, instant visual
 * feedback, and a separate decrement so a mis-tap is one press to fix
 * rather than a trip into a menu.
 */
export function Counter({
  action, value, onChange, hotkey,
}: {
  action: CounterAction
  value: number
  onChange: (delta: 1 | -1) => void
  hotkey?: string
}) {
  const accent = ACCENTS[action.accent ?? 'slate'] ?? ACCENTS.slate

  return (
    <div className={clsx('tap-target rounded-xl border p-3 transition', accent.ring, 'bg-surface-1/60')}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-200">{action.label}</div>
          {action.hint && <div className="mt-0.5 text-[11px] leading-tight text-slate-500">{action.hint}</div>}
        </div>
        {hotkey && (
          <kbd className="hidden rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:block">
            {hotkey}
          </kbd>
        )}
      </div>

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => onChange(-1)}
          disabled={value <= 0}
          aria-label={`Decrease ${action.label}`}
          className="tap-target w-12 shrink-0 rounded-lg border border-white/10 bg-black/20 text-lg
                     font-bold text-slate-400 transition hover:bg-black/40 active:scale-95
                     disabled:opacity-25"
        >
          −
        </button>

        <button
          type="button"
          onClick={() => onChange(1)}
          aria-label={`Increase ${action.label}`}
          className={clsx(
            'tap-target flex flex-1 items-center justify-center gap-3 rounded-lg border py-3 transition active:scale-[.97]',
            accent.ring, accent.bg,
          )}
        >
          <span className={clsx('text-3xl font-extrabold tabular-nums', accent.text)}>{value}</span>
          <span className="text-lg font-bold text-slate-500">+</span>
        </button>
      </div>
    </div>
  )
}
