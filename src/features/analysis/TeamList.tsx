import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { percentile } from '@/lib/stats'
import { Card, Empty, percentileColor } from '@/components/ui'
import { teamInfo } from '@/lib/tba'
import { useEventData } from './useEventData'

type Filter = 'all' | 'scouted' | 'unscouted'

/** Sortable event-wide table. The first stop when picking who to look at. */
export default function TeamList() {
  const { game, event, summaries, scouted, unscouted, roster, loading, eventKey, eventName } = useEventData()
  const [sortBy, setSortBy] = useState(game.keyMetrics[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(() => {
    const filtered = summaries.filter((s) => {
      if (query) {
        const q = query.trim().toLowerCase()
        const name = teamInfo(event, s.teamNumber)?.nickname?.toLowerCase() ?? ''
        if (!String(s.teamNumber).includes(q) && !name.includes(q)) return false
      }
      if (filter === 'scouted') return s.matchesPlayed > 0
      if (filter === 'unscouted') return s.matchesPlayed === 0
      return true
    })

    return [...filtered].sort((a, b) => {
      if (sortBy === 'team') return a.teamNumber - b.teamNumber
      // Teams with no data always sort last, whichever metric is active —
      // a zero mean is absence of evidence, not a bad robot.
      if (a.matchesPlayed === 0 || b.matchesPlayed === 0) {
        if (a.matchesPlayed !== b.matchesPlayed) return a.matchesPlayed === 0 ? 1 : -1
        return a.teamNumber - b.teamNumber
      }
      const metric = game.keyMetrics.find((m) => m.id === sortBy)
      const av = a.metrics[sortBy]?.mean ?? 0
      const bv = b.metrics[sortBy]?.mean ?? 0
      return metric?.higherIsBetter === false ? av - bv : bv - av
    })
  }, [summaries, sortBy, query, filter, game.keyMetrics, event])

  if (!eventKey) {
    return <div className="p-4"><Empty title="No event selected" hint="Choose an event in Settings to start." /></div>
  }
  if (loading) return <div className="p-8 text-center text-slate-600">Loading…</div>
  if (!summaries.length) {
    return (
      <div className="p-4">
        <Empty title="No teams yet"
          hint="Sync the event in Settings to pull its roster, or scout a match." />
      </div>
    )
  }

  const coverage = roster.length ? scouted.length / roster.length : 1

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      {/* ------------------------------------------------- coverage header */}
      <div className="flex flex-wrap items-center gap-3">
        <input className="input max-w-[220px]" placeholder="Filter by number or name…"
          value={query} onChange={(e) => setQuery(e.target.value)} />

        <div className="flex gap-1 rounded-lg border border-white/10 bg-surface-1/60 p-1">
          {([
            ['all', `All ${summaries.length}`],
            ['scouted', `Scouted ${scouted.length}`],
            ['unscouted', `No data ${unscouted.length}`],
          ] as [Filter, string][]).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)}
              className={clsx('rounded px-3 py-1 text-xs font-semibold transition',
                filter === id ? 'bg-peninsula-600 text-white' : 'text-slate-500 hover:text-slate-300')}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-1 items-center justify-end gap-3">
          <span className="text-xs text-slate-600">
            {eventName && <span className="mr-2 text-slate-500">{eventName}</span>}
            {scouted.reduce((n, s) => n + s.matchesPlayed, 0)} robot-matches
          </span>
          {roster.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-black/40">
                <div className={clsx('h-full transition-all',
                  coverage === 1 ? 'bg-emerald-500' : coverage > 0.5 ? 'bg-amber-500' : 'bg-rose-500')}
                  style={{ width: `${coverage * 100}%` }} />
              </div>
              <span className="text-xs tabular-nums text-slate-500">
                {Math.round(coverage * 100)}% covered
              </span>
            </div>
          )}
        </div>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="border-b border-white/10 bg-black/20">
            <tr>
              <Th active={sortBy === 'team'} onClick={() => setSortBy('team')}>Team</Th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Matches
              </th>
              {game.keyMetrics.map((m) => (
                <Th key={m.id} active={sortBy === m.id} onClick={() => setSortBy(m.id)}>{m.label}</Th>
              ))}
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Reliability
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const hasData = s.matchesPlayed > 0
              return (
                <tr key={s.teamNumber}
                  className={clsx('border-b border-white/5 transition hover:bg-white/5',
                    !hasData && 'opacity-45')}>
                  <td className="px-3 py-2">
                    <Link to={`/analysis/${s.teamNumber}`} className="group block">
                      <span className="font-mono font-bold text-peninsula-300 group-hover:text-peninsula-200">
                        {s.teamNumber}
                      </span>
                      {teamInfo(event, s.teamNumber)?.nickname && (
                        <span className="block max-w-[180px] truncate text-[11px] text-slate-500">
                          {teamInfo(event, s.teamNumber)!.nickname}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">
                    {hasData ? s.matchesPlayed : <span className="text-slate-600">not scouted</span>}
                  </td>

                  {game.keyMetrics.map((m) => {
                    if (!hasData) return <td key={m.id} className="px-3 py-2 text-slate-700">—</td>
                    const value = s.metrics[m.id]?.mean ?? 0
                    // Percentiles are computed against scouted teams only, so
                    // empty rows never drag the distribution down.
                    const p = percentile(summaries, m.id, value, m.higherIsBetter)
                    return (
                      <td key={m.id} className={clsx('px-3 py-2 font-semibold tabular-nums', percentileColor(p))}>
                        {m.format === 'percent' ? `${Math.round(value * 100)}%` : value.toFixed(1)}
                      </td>
                    )
                  })}

                  <td className="px-3 py-2">
                    {!hasData ? <span className="text-slate-700">—</span> : (
                      <span className={clsx('tabular-nums',
                        s.breakdownRate > 0.25 ? 'text-rose-400'
                          : s.breakdownRate > 0 ? 'text-amber-400' : 'text-slate-600')}>
                        {s.breakdownRate === 0 ? '—' : `${Math.round(s.breakdownRate * 100)}% issues`}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function Th({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <th className="px-3 py-2.5 text-left">
      <button type="button" onClick={onClick}
        className={clsx('text-[11px] font-semibold uppercase tracking-wider transition',
          active ? 'text-peninsula-300' : 'text-slate-500 hover:text-slate-300')}>
        {children}{active && ' ↓'}
      </button>
    </th>
  )
}
