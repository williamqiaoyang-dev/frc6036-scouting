import clsx from 'clsx'
import type { ReactNode } from 'react'

/**
 * Instrument panel. `accent` paints the top edge in a semantic colour —
 * alliance red/blue on scouting surfaces, signal yellow when something is
 * live. Panels without an accent stay quiet, so the accent means something.
 */
export function Panel({
  title, accent, right, className, bodyClass, children,
}: {
  title?: string
  accent?: 'red' | 'blue' | 'signal' | null
  right?: ReactNode
  className?: string
  bodyClass?: string
  children: ReactNode
}) {
  const edge = accent === 'red' ? 'before:bg-alliance-red'
    : accent === 'blue' ? 'before:bg-alliance-blue'
    : accent === 'signal' ? 'before:bg-signal'
    : ''

  return (
    <section className={clsx(
      'panel relative overflow-hidden',
      edge && 'before:absolute before:inset-x-0 before:top-0 before:h-px before:content-[""]',
      className,
    )}>
      {title && (
        <header className="panel-head">
          <h2 className="panel-title">{title}</h2>
          {right}
        </header>
      )}
      <div className={bodyClass ?? 'p-3'}>{children}</div>
    </section>
  )
}

/** Kept for panels that are just a frame around content. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('panel p-3', className)}>{children}</div>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3 border-b border-deck-600 pb-1.5">
      <h2 className="panel-title">{children}</h2>
      {right}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] leading-tight text-chalk-faint">{hint}</span>}
    </label>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-panel border border-dashed border-deck-500 px-6 py-10 text-center">
      <p className="font-display text-[17px] font-600 text-chalk-dim">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-[13px] leading-snug text-chalk-faint">{hint}</p>}
    </div>
  )
}

export function Pill({ tone = 'slate', children }: { tone?: string; children: ReactNode }) {
  const tones: Record<string, string> = {
    slate: 'border-deck-500 text-chalk-dim',
    red: 'border-alliance-red/50 text-alliance-red',
    blue: 'border-alliance-blue/50 text-alliance-blue',
    green: 'border-emerald-500/50 text-emerald-400',
    amber: 'border-signal/50 text-signal',
  }
  return (
    <span className={clsx(
      'rounded-panel border px-1.5 py-0.5 text-[12px] font-600 leading-tight',
      tones[tone] ?? tones.slate,
    )}>
      {children}
    </span>
  )
}

/**
 * Percentile colour ramp. Deliberately not a red-to-green gradient at full
 * saturation: alliance red already means "red alliance" everywhere else, so
 * poor performance reads as dim and desaturated rather than as a warning.
 */
export function percentileColor(p: number): string {
  if (p >= 0.85) return 'text-emerald-300'
  if (p >= 0.65) return 'text-emerald-400/85'
  if (p >= 0.4) return 'text-chalk'
  if (p >= 0.2) return 'text-chalk-dim'
  return 'text-chalk-faint'
}

export function percentileBg(p: number): string {
  if (p >= 0.85) return 'bg-emerald-500/15 border-emerald-500/30'
  if (p >= 0.65) return 'bg-emerald-500/10 border-emerald-500/20'
  if (p >= 0.4) return 'bg-deck-600 border-deck-500'
  return 'bg-transparent border-deck-600'
}

/** A single measured value. The number is the content; the label supports it. */
export function StatTile({
  label, value, sub, tone,
}: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="rounded-panel border border-deck-500/70 bg-deck-800 px-2.5 py-2">
      <div className="label">{label}</div>
      <div className={clsx('readout mt-1 text-[26px] font-700', tone ?? 'text-chalk')}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] leading-tight text-chalk-faint">{sub}</div>}
    </div>
  )
}

export function Toast({ message, tone = 'green' }: { message: string; tone?: 'green' | 'red' }) {
  return (
    <div
      role="status"
      className={clsx(
        'fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-panel border px-4 py-2 text-[14px] font-600 shadow-lg',
        tone === 'green'
          ? 'border-emerald-400/40 bg-emerald-950 text-emerald-200'
          : 'border-alliance-red/50 bg-[#2A0A0F] text-alliance-red',
      )}
    >
      {message}
    </div>
  )
}
