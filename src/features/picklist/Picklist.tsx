import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { db } from '@/lib/db'
import type { PicklistEntry } from '@/lib/schema'
import { percentile } from '@/lib/stats'
import { loadSettings } from '@/lib/settings'
import { Card, Empty, SectionTitle, percentileColor } from '@/components/ui'
import { teamInfo } from '@/lib/tba'
import { useEventData } from '../analysis/useEventData'

const TIERS = ['First pick', 'Second pick', 'Role player', 'Defense', 'Do not pick']

const TIER_STYLES: Record<string, string> = {
  'First pick': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'Second pick': 'bg-alliance-blue/15 text-alliance-blue border-alliance-blue/40',
  'Role player': 'bg-signal/15 text-signal border-signal/30',
  'Defense': 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'Do not pick': 'bg-alliance-red/15 text-alliance-red border-alliance-red/40',
}

/**
 * The picklist. Drag to reorder, tag with a tier, annotate.
 * Persisted locally and exportable — this is the artifact the strategy
 * team carries into the alliance selection.
 */
export default function PicklistView() {
  const settings = loadSettings()
  const { game, event, summaries, loading } = useEventData()
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

  if (loading) return <div className="p-8 text-center text-chalk-faint">Loading…</div>

  return (
    <div className="mx-auto grid max-w-[1600px] gap-4 p-4 lg:grid-cols-[1fr_320px]">
      <Card className="p-0">
        <div className="border-b border-deck-500 p-4">
          <SectionTitle right={
            <button type="button" onClick={() => setEntries([])} disabled={!entries.length}
              className="text-xs text-chalk-faint hover:text-alliance-red disabled:opacity-40">
              Clear
            </button>
          }>
            Picklist — {entries.length} teams
          </SectionTitle>
          <p className="text-xs text-chalk-faint">Drag rows to reorder. Changes save automatically.</p>
        </div>

        {entries.length === 0 ? (
          <div className="p-4">
            <Empty title="Empty picklist" hint="Add teams from the panel on the right." />
          </div>
        ) : (
          <div className="divide-y divide-deck-600">
            {entries.map((entry, i) => {
              const summary = summaries.find((s) => s.teamNumber === entry.teamNumber)
              return (
                <div key={entry.teamNumber}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragIndex !== null) reorder(dragIndex, i); setDragIndex(null) }}
                  className={clsx('flex cursor-grab items-start gap-3 p-3 transition hover:bg-deck-600',
                    dragIndex === i && 'opacity-40')}>
                  <div className="w-7 shrink-0 pt-1 text-center font-mono text-sm font-bold text-chalk-faint">
                    {i + 1}
                  </div>
                  <div className="w-32 shrink-0 pt-0.5">
                    <div className="font-mono text-lg font-bold text-chalk">{entry.teamNumber}</div>
                    {teamInfo(event, entry.teamNumber)?.nickname && (
                      <div className="truncate text-[11px] text-chalk-dim">
                        {teamInfo(event, entry.teamNumber)!.nickname}
                      </div>
                    )}
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
                          <div className="text-[10px] text-chalk-faint">{m.label}</div>
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
                              : 'border-deck-500 text-chalk-faint hover:bg-deck-600')}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <input className="input py-1 text-xs" placeholder="Note…"
                      value={entry.note}
                      onChange={(e) => update(entry.teamNumber, { note: e.target.value })} />
                  </div>

                  <button type="button" onClick={() => remove(entry.teamNumber)}
                    className="shrink-0 px-2 pt-1 text-chalk-faint hover:text-alliance-red">×</button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="border-b border-deck-500 p-4">
          <SectionTitle>Available — {available.length}</SectionTitle>
          <p className="text-xs text-chalk-faint">Sorted by {game.keyMetrics[0]?.label ?? 'team'}.</p>
        </div>
        <div className="max-h-[70vh] divide-y divide-deck-600 overflow-y-auto">
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
                  className={clsx('flex w-full items-center gap-3 p-2.5 text-left transition hover:bg-deck-600',
                    !hasData && 'opacity-50')}>
                  <span className="w-14 shrink-0 font-mono text-sm font-bold text-chalk">{s.teamNumber}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-chalk-dim">
                      {teamInfo(event, s.teamNumber)?.nickname ?? ''}
                    </span>
                    <span className="block text-[10px] text-chalk-faint">
                      {hasData ? `${s.matchesPlayed} matches` : 'no data'}
                    </span>
                  </span>
                  {hasData ? (
                    <span className={clsx('text-sm font-bold tabular-nums',
                      percentileColor(percentile(summaries, game.keyMetrics[0]?.id ?? '',
                        s.metrics[game.keyMetrics[0]?.id]?.mean ?? 0, true)))}>
                      {(s.metrics[game.keyMetrics[0]?.id]?.mean ?? 0).toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-sm text-chalk-faint">—</span>
                  )}
                  <span className="text-chalk-faint">+</span>
                </button>
              )
            })}
        </div>
      </Card>
    </div>
  )
}
