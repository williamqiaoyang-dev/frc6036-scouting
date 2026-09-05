import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { db } from '@/lib/db'
import type { PicklistEntry } from '@/lib/schema'
import { percentile } from '@/lib/stats'
import { loadSettings } from '@/lib/settings'
import { Card, Empty, SectionTitle, percentileColor } from '@/components/ui'
import { useEventData } from '../analysis/useEventData'

const TIERS = ['First pick', 'Second pick', 'Role player', 'Defense', 'Do not pick']

const TIER_STYLES: Record<string, string> = {
  'First pick': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'Second pick': 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'Role player': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'Defense': 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'Do not pick': 'bg-rose-500/15 text-rose-300 border-rose-500/30',
}

/**
 * The picklist. Drag to reorder, tag with a tier, annotate.
 * Persisted locally and exportable — this is the artifact the strategy
 * team carries into the alliance selection.
 */
export default function PicklistView() {
  const settings = loadSettings()
  const { game, summaries, loading } = useEventData()
  const [entries, setEntries] = useState<PicklistEntry[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const listId = `${settings.eventKey}_main`

  useEffect(() => {
    db.picklists.get(listId).then((p) => setEntries(p?.entries ?? []))
  }, [listId])

  // Persist on every change; there is no explicit save button because
  // losing a picklist to a forgotten click is unacceptable.
  useEffect(() => {
    if (!settings.eventKey) return
    db.picklists.put({
      id: listId, eventKey: settings.eventKey, name: 'Main picklist',
      entries, updatedAt: Date.now(),
    })
  }, [entries, listId, settings.eventKey])

  const listed = new Set(entries.map((e) => e.teamNumber))
  const available = summaries.filter((s) => !listed.has(s.teamNumber))

  function add(team: number) {
    setEntries((e) => [...e, { teamNumber: team, rank: e.length, tier: '', note: '' }])
  }
  function remove(team: number) {
    setEntries((e) => e.filter((x) => x.teamNumber !== team).map((x, i) => ({ ...x, rank: i })))
  }
  function update(team: number, patch: Partial<PicklistEntry>) {
    setEntries((e) => e.map((x) => (x.teamNumber === team ? { ...x, ...patch } : x)))
  }
  function reorder(from: number, to: number) {
    setEntries((e) => {
      const next = [...e]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next.map((x, i) => ({ ...x, rank: i }))
    })
  }

  if (loading) return <div className="p-8 text-center text-slate-600">Loading…</div>

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[1fr_320px]">
      <Card className="p-0">
        <div className="border-b border-white/10 p-4">
          <SectionTitle right={
            <button type="button" onClick={() => setEntries([])} disabled={!entries.length}
              className="text-xs text-slate-600 hover:text-rose-400 disabled:opacity-40">
              Clear
            </button>
          }>
            Picklist — {entries.length} teams
          </SectionTitle>
          <p className="text-xs text-slate-600">Drag rows to reorder. Changes save automatically.</p>
        </div>

        {entries.length === 0 ? (
          <div className="p-4">
            <Empty title="Empty picklist" hint="Add teams from the panel on the right." />
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {entries.map((entry, i) => {
              const summary = summaries.find((s) => s.teamNumber === entry.teamNumber)
              return (
                <div key={entry.teamNumber}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragIndex !== null) reorder(dragIndex, i); setDragIndex(null) }}
                  className={clsx('flex cursor-grab items-start gap-3 p-3 transition hover:bg-white/5',
                    dragIndex === i && 'opacity-40')}>
                  <div className="w-7 shrink-0 pt-1 text-center font-mono text-sm font-bold text-slate-600">
                    {i + 1}
                  </div>
                  <div className="w-16 shrink-0 pt-0.5 font-mono text-lg font-bold text-peninsula-300">
                    {entry.teamNumber}
                  </div>

                  <div className="hidden shrink-0 gap-3 pt-1 sm:flex">
                    {game.keyMetrics.slice(0, 3).map((m) => {
                      const value = summary?.metrics[m.id]?.mean ?? 0
                      const p = percentile(summaries, m.id, value, m.higherIsBetter)
                      return (
                        <div key={m.id} className="w-16 text-center">
                          <div className={clsx('text-sm font-bold tabular-nums', percentileColor(p))}>
                            {m.format === 'percent' ? `${Math.round(value * 100)}%` : value.toFixed(1)}
                          </div>
                          <div className="text-[9px] uppercase text-slate-600">{m.label}</div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex-1 space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                      {TIERS.map((t) => (
                        <button key={t} type="button"
                          onClick={() => update(entry.teamNumber, { tier: entry.tier === t ? '' : t })}
                          className={clsx('rounded border px-2 py-0.5 text-[10px] font-semibold transition',
                            entry.tier === t ? TIER_STYLES[t]
                              : 'border-white/10 text-slate-600 hover:bg-white/5')}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <input className="input py-1 text-xs" placeholder="Note…"
                      value={entry.note}
                      onChange={(e) => update(entry.teamNumber, { note: e.target.value })} />
                  </div>

                  <button type="button" onClick={() => remove(entry.teamNumber)}
                    className="shrink-0 px-2 pt-1 text-slate-700 hover:text-rose-400">×</button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="border-b border-white/10 p-4">
          <SectionTitle>Available — {available.length}</SectionTitle>
          <p className="text-xs text-slate-600">Sorted by {game.keyMetrics[0]?.label ?? 'team'}.</p>
        </div>
        <div className="max-h-[70vh] divide-y divide-white/5 overflow-y-auto">
          {available
            .sort((a, b) => {
              // Un-scouted teams sink to the bottom rather than ranking as
              // zeroes, but stay pickable — you still draft a robot you
              // watched from the stands.
              if (a.matchesPlayed === 0 || b.matchesPlayed === 0) {
                if (a.matchesPlayed !== b.matchesPlayed) return a.matchesPlayed === 0 ? 1 : -1
                return a.teamNumber - b.teamNumber
              }
              return (b.metrics[game.keyMetrics[0]?.id]?.mean ?? 0)
                   - (a.metrics[game.keyMetrics[0]?.id]?.mean ?? 0)
            })
            .map((s) => {
              const hasData = s.matchesPlayed > 0
              return (
                <button key={s.teamNumber} type="button" onClick={() => add(s.teamNumber)}
                  className={clsx('flex w-full items-center gap-3 p-2.5 text-left transition hover:bg-white/5',
                    !hasData && 'opacity-50')}>
                  <span className="w-14 font-mono text-sm font-bold text-slate-300">{s.teamNumber}</span>
                  <span className="flex-1 text-xs text-slate-600">
                    {hasData ? `${s.matchesPlayed} matches` : 'no data'}
                  </span>
                  {hasData ? (
                    <span className={clsx('text-sm font-bold tabular-nums',
                      percentileColor(percentile(summaries, game.keyMetrics[0]?.id ?? '',
                        s.metrics[game.keyMetrics[0]?.id]?.mean ?? 0, true)))}>
                      {(s.metrics[game.keyMetrics[0]?.id]?.mean ?? 0).toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-sm text-slate-700">—</span>
                  )}
                  <span className="text-slate-700">+</span>
                </button>
              )
            })}
        </div>
      </Card>
    </div>
  )
}
