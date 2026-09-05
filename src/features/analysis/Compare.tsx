import { useState } from 'react'
import clsx from 'clsx'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { percentile } from '@/lib/stats'
import { Card, Empty, SectionTitle, percentileColor } from '@/components/ui'
import { useEventData } from './useEventData'

const SERIES_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#a855f7', '#ef4444', '#06b6d4']

/** Side-by-side view for alliance selection and match strategy. */
export default function Compare() {
  const { game, summaries, loading } = useEventData()
  const [picked, setPicked] = useState<number[]>([])

  function toggle(team: number) {
    setPicked((p) => p.includes(team) ? p.filter((t) => t !== team) : p.length >= 6 ? p : [...p, team])
  }

  if (loading) return <div className="p-8 text-center text-chalk-faint">Loading…</div>
  if (!summaries.length) return <div className="p-4"><Empty title="No data to compare yet" /></div>

  const chartData = game.keyMetrics
    .filter((m) => m.format !== 'percent')
    .map((m) => {
      const row: Record<string, string | number> = { metric: m.label }
      for (const team of picked) {
        const s = summaries.find((x) => x.teamNumber === team)
        if (!s?.matchesPlayed) continue   // no bar rather than a bar at zero
        row[String(team)] = Number((s.metrics[m.id]?.mean ?? 0).toFixed(1))
      }
      return row
    })

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4">
      <Card>
        <SectionTitle right={<span className="text-[11px] text-chalk-faint">up to 6</span>}>
          Pick teams to compare
        </SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {summaries.map((s) => {
            const hasData = s.matchesPlayed > 0
            return (
              <button key={s.teamNumber} type="button" onClick={() => toggle(s.teamNumber)}
                title={hasData ? `${s.matchesPlayed} matches scouted` : 'No data yet'}
                className={clsx('rounded-panel border px-3 py-1.5 font-mono text-sm font-semibold transition',
                  picked.includes(s.teamNumber)
                    ? 'border-signal bg-signal/15 text-white'
                    : hasData
                      ? 'border-deck-500 bg-deck-900 text-chalk-dim hover:bg-deck-600'
                      : 'border-deck-600 bg-deck-800 text-chalk-faint hover:bg-deck-600')}>
                {s.teamNumber}
              </button>
            )
          })}
        </div>
      </Card>

      {picked.length === 0 ? (
        <Empty title="Select teams above" hint="Compare up to six robots side by side." />
      ) : (
        <>
          <Card>
            <SectionTitle>Metric comparison</SectionTitle>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="metric" stroke="#475569" fontSize={11} />
                <YAxis stroke="#475569" fontSize={11} />
                <Tooltip contentStyle={{ background: '#111726', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {picked.map((team, i) => (
                  <Bar key={team} dataKey={String(team)} fill={SERIES_COLORS[i]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead className="border-b border-deck-500 bg-deck-900">
                <tr>
                  <th className="px-3 py-2.5 text-left font-display text-[13px] font-600 text-chalk-dim">Metric</th>
                  {picked.map((t) => {
                    const s = summaries.find((x) => x.teamNumber === t)
                    return (
                      <th key={t} className="px-3 py-2.5 text-right">
                        <div className="font-mono text-sm font-bold text-chalk">{t}</div>
                        <div className="text-[10px] font-normal text-chalk-faint">
                          {s?.matchesPlayed ? `${s.matchesPlayed} matches` : 'no data'}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {game.keyMetrics.map((m) => (
                  <tr key={m.id} className="border-b border-deck-600">
                    <td className="px-3 py-2 text-chalk-dim">{m.label}</td>
                    {picked.map((team) => {
                      const s = summaries.find((x) => x.teamNumber === team)
                      // An un-scouted robot has no value here. Printing 0.0
                      // would read as "scores nothing", which is a claim the
                      // data does not support.
                      if (!s?.matchesPlayed) {
                        return <td key={team} className="px-3 py-2 text-right text-chalk-faint">—</td>
                      }
                      const value = s.metrics[m.id]?.mean ?? 0
                      const p = percentile(summaries, m.id, value, m.higherIsBetter)
                      return (
                        <td key={team} className={clsx('px-3 py-2 text-right font-semibold tabular-nums', percentileColor(p))}>
                          {m.format === 'percent' ? `${Math.round(value * 100)}%` : value.toFixed(1)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="border-b border-deck-600">
                  <td className="px-3 py-2 text-chalk-dim">Reliability issues</td>
                  {picked.map((team) => {
                    const s = summaries.find((x) => x.teamNumber === team)
                    return (
                      <td key={team} className="px-3 py-2 text-right tabular-nums text-chalk-dim">
                        {s?.matchesPlayed
                          ? `${Math.round(s.breakdownRate * 100)}%`
                          : <span className="text-chalk-faint">—</span>}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}
