import clsx from 'clsx'
import type { ReactNode } from 'react'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('card p-4', className)}>{children}</div>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">{children}</h2>
      {right}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 p-10 text-center">
      <p className="font-semibold text-slate-400">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-600">{hint}</p>}
    </div>
  )
}

export function Pill({ tone = 'slate', children }: { tone?: string; children: ReactNode }) {
  const tones: Record<string, string> = {
    slate: 'bg-white/5 text-slate-400 border-white/10',
    red: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    blue: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  }
  return (
    <span className={clsx('rounded-full border px-2 py-0.5 text-[11px] font-semibold', tones[tone] ?? tones.slate)}>
      {children}
    </span>
  )
}

/** Colour ramp for percentile values, red (worst) through green (best). */
export function percentileColor(p: number): string {
  if (p >= 0.85) return 'text-emerald-300'
  if (p >= 0.65) return 'text-lime-300'
  if (p >= 0.4) return 'text-amber-300'
  if (p >= 0.2) return 'text-orange-400'
  return 'text-rose-400'
}

export function percentileBg(p: number): string {
  if (p >= 0.85) return 'bg-emerald-500/20 border-emerald-500/30'
  if (p >= 0.65) return 'bg-lime-500/15 border-lime-500/25'
  if (p >= 0.4) return 'bg-amber-500/15 border-amber-500/25'
  if (p >= 0.2) return 'bg-orange-500/15 border-orange-500/25'
  return 'bg-rose-500/15 border-rose-500/25'
}

export function StatTile({
  label, value, sub, tone,
}: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-surface-0/60 px-3 py-2.5">
      <div className="label">{label}</div>
      <div className={clsx('mt-0.5 text-xl font-bold tabular-nums', tone ?? 'text-slate-100')}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

export function Toast({ message, tone = 'green' }: { message: string; tone?: 'green' | 'red' }) {
  return (
    <div
      className={clsx(
        'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm font-semibold shadow-xl',
        tone === 'green'
          ? 'border-emerald-500/40 bg-emerald-600/90 text-white'
          : 'border-rose-500/40 bg-rose-600/90 text-white',
      )}
    >
      {message}
    </div>
  )
}
