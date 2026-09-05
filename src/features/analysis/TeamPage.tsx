import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import clsx from 'clsx'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { db } from '@/lib/db'
import type { CachedEvent } from '@/lib/schema'
import { matchLabel, teamMatches as tbaTeamMatches, teamRanking } from '@/lib/tba'
import { MatchHistory, RobotPhoto, TeamIdentity } from './TeamHeader'
import { MatchVideo } from '@/features/video/MatchVideo'
import { percentile, totalsByWindow } from '@/lib/stats'
import { Card, Empty, Pill, SectionTitle, StatTile, percentileColor } from '@/components/ui'
import { useEventData } from './useEventData'

const AXIS = { stroke: '#475569', fontSize: 11 }
const GRID = '#1e293b'

export default function TeamPage() {
  const { teamNumber } = useParams()
  const team = Number(teamNumber)
  const { game, summaries, matches, pits, loading, eventKey } = useEventData()

  // TBA's own view of this team: official ranking, record, OPR, and any match
  // footage posted for the matches they played.
  const [event, setEvent] = useState<CachedEvent | null>(null)
  useEffect(() => { db.events.get(eventKey).then((e) => setEvent(e ?? null)) }, [eventKey])
  const ranking = teamRanking(event, team)
  const allTbaMatches = tbaTeamMatches(event, team)
  const videos = allTbaMatches.filter((m) => m.videos.length > 0)

  const summary = summaries.find((s) => s.teamNumber === team)
  const teamMatches = useMemo(
    () => matches.filter((m) => m.teamNumber === team).sort((a, b) => a.matchNumber - b.matchNumber),
    [matches, team],
  )
  const pit = pits.find((p) => p.teamNumber === team)

  // Average FUEL per ALLIANCE SHIFT — reveals whether a robot is a
  // consistent cycler or one that only produces when its HUB is active.
  const windowData = useMemo(() => {
    if (!teamMatches.length) return []
    return game.windows.map((w) => {
      const values = teamMatches.map((m) => {
        const byWindow = totalsByWindow(game, m)[w.id] ?? {}
        return (byWindow.auto_fuel_scored ?? 0) + (byWindow.teleop_fuel_scored ?? 0)
      })
      return {
        window: w.label,
        fuel: values.reduce((a, b) => a + b, 0) / values.length,
        phase: w.phase,
      }
    })
  }, [teamMatches, game])

  if (loading) return <div className="p-8 text-center text-slate-600">Loading…</div>
  if (!summary) {
    return (
      <div className="p-4">
        <Empty title={`Team ${team} is not at this event`}
          hint="No scouting data, and not on the synced event roster." />
      </div>
    )
  }

  // Header pills are shared by both branches: our scouting may be missing,
  // but TBA's ranking and record are still real information about the robot.
  const headerPills = (
    <>
      {ranking && (
        <>
          <Pill tone="blue">Rank {ranking.rank}</Pill>
          <Pill>{ranking.wins}-{ranking.losses}-{ranking.ties}</Pill>
          {ranking.opr !== null && <Pill>OPR {ranking.opr.toFixed(1)}</Pill>}
        </>
      )}
    </>
  )

  const videoSection = videos.length > 0 && (
    <Card>
      <SectionTitle right={<span className="text-[11px] text-slate-600">from The Blue Alliance</span>}>
        Match footage
      </SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {videos.slice(0, 6).map((m) => (
          <MatchVideo key={m.key} match={m} label={matchLabel(m)} />
        ))}
      </div>
      {videos.length > 6 && (
        <p className="mt-2 text-xs text-slate-600">
          Showing 6 of {videos.length}. The Review tab has the full list.
        </p>
      )}
    </Card>
  )

  // Nothing scouted yet. Charts of zeroes would read as "this robot scores
  // nothing", which is a different and wrong claim — so skip the charts, but
  // still show everything that *is* known: standings, footage, pit sheet.
  if (summary.matchesPlayed === 0) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-4">
        <TeamIdentity event={event} team={team}
          extraPills={<><Pill tone="amber">Not scouted</Pill>{headerPills}</>} />

        <Empty title="No match data from our scouts"
          hint={ranking
            ? "Official standings and footage below come from The Blue Alliance."
            : "It's on the event roster, but no match records have come in."} />

        {ranking && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Rank" value={ranking.rank} />
            <StatTile label="Record" value={`${ranking.wins}-${ranking.losses}-${ranking.ties}`} />
            <StatTile label="Ranking score" value={ranking.rankingScore.toFixed(2)} />
            <StatTile label="OPR" value={ranking.opr !== null ? ranking.opr.toFixed(1) : '—'}
              sub="TBA estimate" />
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <RobotPhoto event={event} team={team} />
          <MatchHistory event={event} team={team} matches={allTbaMatches} />
        </div>

        {videoSection}
        {pit && <PitSheet game={game} pit={pit} team={team} />}
      </div>
    )
  }

  const radarData = game.superRatings.map((r) => ({
    rating: r.label,
    value: summary.superRatings[r.id] ?? 0,
  }))
  const hasSuperData = radarData.some((d) => d.value > 0)

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <TeamIdentity event={event} team={team}
        extraPills={<>
          <Pill>{summary.matchesPlayed} scouted</Pill>
          {headerPills}
          {summary.noShows > 0 && <Pill tone="red">{summary.noShows} no-show</Pill>}
          {summary.breakdownRate > 0.2 && <Pill tone="amber">Reliability risk</Pill>}
        </>} />

      {/* --------------------------------------------------------- headline */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {game.keyMetrics.map((m) => {
          const stat = summary.metrics[m.id]
          const p = percentile(summaries, m.id, stat?.mean ?? 0, m.higherIsBetter)
          return (
            <StatTile key={m.id} label={m.label} tone={percentileColor(p)}
              value={m.format === 'percent'
                ? `${Math.round((stat?.mean ?? 0) * 100)}%`
                : (stat?.mean ?? 0).toFixed(1)}
              sub={`max ${m.format === 'percent'
                ? `${Math.round((stat?.max ?? 0) * 100)}%`
                : (stat?.max ?? 0).toFixed(0)} · σ ${(stat?.stdev ?? 0).toFixed(1)}`} />
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --------------------------------------------- per-match trend */}
        <Card>
          <SectionTitle>FUEL by match</SectionTitle>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={buildTrend(summary)}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="match" {...AXIS} />
              <YAxis {...AXIS} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Auto" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="Teleop" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* ------------------------------------------------ shift profile */}
        <Card>
          <SectionTitle right={<span className="text-[11px] text-slate-600">avg per match</span>}>
            FUEL by match window
          </SectionTitle>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={windowData}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="window" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="fuel" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {windowData.map((d, i) => (
                  <Cell key={i} fill={
                    d.phase === 'auto' ? '#fbbf24'
                      : d.phase === 'endgame' ? '#a78bfa' : '#3b82f6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            Flat bars across shifts mean the robot cycles regardless of HUB state.
            Big swings suggest it only produces when its own HUB is active.
          </p>
        </Card>

        {/* ---------------------------------------------------- endgame */}
        <Card>
          <SectionTitle>TOWER outcomes</SectionTitle>
          <div className="space-y-2">
            {climbRows(summary).map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="w-28 text-xs font-semibold text-slate-400">{row.label}</span>
                <div className="h-6 flex-1 overflow-hidden rounded bg-black/30">
                  <div className={clsx('h-full transition-all', row.color)}
                    style={{ width: `${row.pct}%` }} />
                </div>
                <span className="w-16 text-right text-xs tabular-nums text-slate-500">
                  {row.count}× · {Math.round(row.pct)}%
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* ------------------------------------------------ super ratings */}
        <Card>
          <SectionTitle>Super-scout profile</SectionTitle>
          {hasSuperData ? (
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={radarData}>
                <PolarGrid stroke={GRID} />
                <PolarAngleAxis dataKey="rating" tick={{ fill: '#64748b', fontSize: 11 }} />
                <Radar dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.35} isAnimationActive={false} />
                <Tooltip contentStyle={tooltipStyle} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <Empty title="No super-scout data" hint="Rate this alliance from the Super tab." />
          )}
        </Card>
      </div>

      {/* ------------------------------------------- robot + match history */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RobotPhoto event={event} team={team} />
        <MatchHistory event={event} team={team} matches={allTbaMatches} />
      </div>

      {/* ----------------------------------------------------------- video */}
      {videoSection}

      {/* ------------------------------------------------------------- pit */}
      {pit && <PitSheet game={game} pit={pit} team={team} />}

      {/* ----------------------------------------------------------- notes */}
      {summary.notes.length > 0 && (
        <Card>
          <SectionTitle>Scout notes</SectionTitle>
          <div className="space-y-2">
            {summary.notes.map((n, i) => (
              <div key={i} className="flex gap-3 border-b border-white/5 pb-2 text-sm">
                <span className="shrink-0 font-mono text-xs text-slate-600">M{n.matchNumber}</span>
                <span className="text-slate-300">{n.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function PitSheet({ game, pit, team }: { game: any; pit: any; team: number }) {
  return (
    <Card>
      <SectionTitle>Pit sheet</SectionTitle>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {game.pitFields.map((f: any) => {
          const v = pit.fields[f.id]
          if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null
          return (
            <div key={f.id} className="flex justify-between gap-3 border-b border-white/5 py-1.5">
              <span className="text-xs text-slate-500">{f.label}</span>
              <span className="text-right text-xs font-semibold text-slate-300">
                {Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}
              </span>
            </div>
          )
        })}
      </div>
      {pit.photos.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {pit.photos.map((src: string, i: number) => (
            <img key={i} src={src} alt={`Team ${team} robot`}
              className="h-32 rounded-lg border border-white/10 object-cover" />
          ))}
        </div>
      )}
    </Card>
  )
}

function buildTrend(summary: ReturnType<typeof useEventData>['summaries'][number]) {
  const auto = summary.metrics.auto_fuel?.series ?? []
  const teleop = summary.metrics.teleop_fuel?.series ?? []
  return auto.map((point, i) => ({
    match: `M${point.matchNumber}`,
    Auto: point.value,
    Teleop: teleop[i]?.value ?? 0,
  }))
}

function climbRows(summary: ReturnType<typeof useEventData>['summaries'][number]) {
  const labels: Record<string, { label: string; color: string }> = {
    l3: { label: 'Level 3', color: 'bg-violet-500' },
    l2: { label: 'Level 2', color: 'bg-indigo-500' },
    l1: { label: 'Level 1', color: 'bg-sky-500' },
    none: { label: 'No climb', color: 'bg-slate-600' },
    failed: { label: 'Failed', color: 'bg-rose-500' },
  }
  const total = Math.max(1, summary.matchesPlayed)
  return Object.entries(labels).map(([key, meta]) => ({
    ...meta,
    count: summary.climbCounts[key] ?? 0,
    pct: ((summary.climbCounts[key] ?? 0) / total) * 100,
  }))
}

const tooltipStyle = {
  background: '#111726',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 8,
  fontSize: 12,
}
