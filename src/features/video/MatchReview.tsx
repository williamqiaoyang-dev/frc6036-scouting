import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { db } from '@/lib/db'
import { getGame } from '@/games'
import type { CachedEvent, CachedMatch, MarkerRecord } from '@/lib/schema'
import { loadSettings } from '@/lib/settings'
import { byMostRecent, matchLabel } from '@/lib/tba'
import { actionTotals, scoreBreakdown } from '@/lib/stats'
import { Card, Empty, Pill, SectionTitle } from '@/components/ui'
import { MatchVideo } from './MatchVideo'
import { VideoPlayer, type PlayerHandle } from './VideoPlayer'
import { MarkerPanel } from './MarkerPanel'
import { FilmAnalyzer } from './FilmAnalyzer'

/**
 * Match review: TBA footage beside what the scouts actually recorded.
 *
 * This is how a scouting team audits itself. Pull up a played match, watch
 * the video, and compare the per-robot numbers your scouts logged against
 * the official alliance score. A scout who is consistently low on a robot
 * shows up here, before the picklist is built on their data.
 */
export default function MatchReview() {
  const settings = loadSettings()
  const game = getGame(settings.gameId)

  const [event, setEvent] = useState<CachedEvent | null>(null)
  const [selected, setSelected] = useState<CachedMatch | null>(null)
  const [records, setRecords] = useState<any[]>([])
  const [onlyWithVideo, setOnlyWithVideo] = useState(false)
  const [player, setPlayer] = useState<PlayerHandle | null>(null)
  const [markers, setMarkers] = useState<MarkerRecord[]>([])
  const [markerBump, setMarkerBump] = useState(0)

  useEffect(() => {
    db.events.get(settings.eventKey).then((e) => setEvent(e ?? null))
  }, [settings.eventKey])

  // Played matches, newest first — you review what just happened.
  const played = useMemo(() => {
    const all = (event?.matches ?? []).filter((m) => m.redScore !== null)
    const filtered = onlyWithVideo ? all.filter((m) => m.videos.length > 0) : all
    return [...filtered].sort(byMostRecent)
  }, [event, onlyWithVideo])

  useEffect(() => {
    if (!selected && played.length) setSelected(played[0])
  }, [played, selected])

  useEffect(() => {
    if (!selected) { setMarkers([]); return }
    db.markers.where('matchKey').equals(selected.key).toArray().then(setMarkers)
  }, [selected, markerBump])

  // A new video means the old player handle is gone.
  useEffect(() => { setPlayer(null) }, [selected?.key])

  useEffect(() => {
    if (!selected) { setRecords([]); return }
    db.matches
      .where('eventKey').equals(settings.eventKey)
      .and((m) => m.matchNumber === selected.matchNumber && m.matchLevel === selected.matchLevel)
      .toArray()
      .then(setRecords)
  }, [selected, settings.eventKey])

  if (!settings.eventKey) {
    return <div className="p-4"><Empty title="No event selected" hint="Pick an event in Settings first." /></div>
  }
  if (!event) {
    return <div className="p-4"><Empty title="Event not synced" hint="Sync the event in Settings to pull the schedule and videos." /></div>
  }
  if (!played.length) {
    return (
      <div className="p-4">
        <Empty title={onlyWithVideo ? 'No videos posted yet' : 'No completed matches yet'}
          hint="Re-sync the event in Settings once matches have been played." />
      </div>
    )
  }

  const videoCount = event.matches.filter((m) => m.videos.length > 0).length

  // What our scouts logged per robot, so film review can be checked against
  // it rather than replacing it.
  const scoutedFuel: Record<number, number> = {}
  for (const rec of records) {
    const t = actionTotals(rec)
    scoutedFuel[rec.teamNumber] = (t.auto_fuel_scored ?? 0) + (t.teleop_fuel_scored ?? 0)
  }

  return (
    <div className="mx-auto grid max-w-[1600px] gap-4 p-4 lg:grid-cols-[280px_1fr]">
      {/* ------------------------------------------------------ match picker */}
      <Card className="p-0">
        <div className="border-b border-deck-500 p-3">
          <SectionTitle>Matches</SectionTitle>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-chalk-dim">
            <input type="checkbox" checked={onlyWithVideo}
              onChange={(e) => { setOnlyWithVideo(e.target.checked); setSelected(null) }}
              className="accent-signal" />
            Only with video ({videoCount})
          </label>
        </div>
        <div className="max-h-[70vh] divide-y divide-deck-600 overflow-y-auto">
          {played.map((m) => (
            <button key={m.key} type="button" onClick={() => setSelected(m)}
              className={clsx('flex w-full items-center gap-2 p-2.5 text-left transition',
                selected?.key === m.key ? 'bg-signal/15' : 'hover:bg-deck-600')}>
              <span className="w-14 shrink-0 font-mono text-xs font-bold text-chalk">
                {matchLabel(m)}
              </span>
              <span className="flex-1 text-xs tabular-nums">
                <span className={m.redScore! > m.blueScore! ? 'font-bold text-alliance-red' : 'text-chalk-dim'}>
                  {m.redScore}
                </span>
                <span className="mx-1 text-chalk-faint">–</span>
                <span className={m.blueScore! > m.redScore! ? 'font-bold text-alliance-blue' : 'text-chalk-dim'}>
                  {m.blueScore}
                </span>
              </span>
              {m.videos.length > 0 && <span className="shrink-0 text-[10px] text-chalk-dim">▶</span>}
            </button>
          ))}
        </div>
      </Card>

      {/* ----------------------------------------------------------- detail */}
      {selected && (
        <div className="space-y-4">
          {selected.videos.find((v) => v.type === 'youtube') ? (
            <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
              <VideoPlayer
                videoId={selected.videos.find((v) => v.type === 'youtube')!.key.split('?')[0]}
                markers={markers}
                onReady={setPlayer}
              />
              <Card className="max-h-[70vh] overflow-y-auto">
                <MarkerPanel
                  match={selected}
                  eventKey={settings.eventKey}
                  author={settings.scoutName || 'anonymous'}
                  player={player}
                  markers={markers}
                  onChange={() => setMarkerBump((n) => n + 1)}
                />
              </Card>
            </div>
          ) : (
            <MatchVideo match={selected} label={matchLabel(selected)} />
          )}

          <FilmAnalyzer
            match={selected}
            eventKey={settings.eventKey}
            author={settings.scoutName || 'anonymous'}
            scoutedFuel={scoutedFuel}
            onMarkersChanged={() => setMarkerBump((n) => n + 1)}
          />

          {/* Official score from TBA */}
          <Card>
            <SectionTitle>Official result</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              {(['red', 'blue'] as const).map((side) => {
                const score = side === 'red' ? selected.redScore : selected.blueScore
                const other = side === 'red' ? selected.blueScore : selected.redScore
                const rp = side === 'red' ? selected.redRp : selected.blueRp
                return (
                  <div key={side} className={clsx('rounded-panel border p-3',
                    side === 'red' ? 'border-alliance-red/40 bg-alliance-red/10' : 'border-alliance-blue/40 bg-alliance-blue/10')}>
                    <div className="flex items-baseline justify-between">
                      <span className={clsx('text-xs font-bold uppercase',
                        side === 'red' ? 'text-alliance-red' : 'text-alliance-blue')}>
                        {side}
                      </span>
                      <span className="text-2xl font-extrabold tabular-nums text-chalk">{score}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-chalk-dim">
                      <span className="font-mono">{selected[side].join(' · ')}</span>
                      {rp !== null && <span>{rp} RP</span>}
                    </div>
                    {score !== null && other !== null && score > other && (
                      <div className="mt-1"><Pill tone="green">Win</Pill></div>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>

          {/* What our scouts recorded, per robot */}
          <Card>
            <SectionTitle right={
              <span className="text-[11px] text-chalk-faint">
                {records.length}/6 robots scouted
              </span>
            }>
              Our scouting
            </SectionTitle>

            {records.length === 0 ? (
              <Empty title="Nobody scouted this match"
                hint="Import the scouts' data from the Data tab." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead className="border-b border-deck-500">
                    <tr>
                      <th className="px-2 py-2 text-left font-display text-[13px] font-600 text-chalk-dim">Team</th>
                      <th className="px-2 py-2 text-left font-display text-[13px] font-600 text-chalk-dim">Scout</th>
                      <th className="px-2 py-2 text-right font-display text-[13px] font-600 text-chalk-dim">FUEL</th>
                      <th className="px-2 py-2 text-right font-display text-[13px] font-600 text-chalk-dim">Climb</th>
                      <th className="px-2 py-2 text-right font-display text-[13px] font-600 text-chalk-dim">Est. pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(['red', 'blue'] as const).flatMap((side) =>
                      selected[side].map((team) => {
                        const rec = records.find((r) => r.teamNumber === team)
                        if (!rec) {
                          return (
                            <tr key={`${side}-${team}`} className="border-b border-deck-600 opacity-40">
                              <td className="px-2 py-2 font-mono font-bold text-chalk-dim">{team}</td>
                              <td colSpan={4} className="px-2 py-2 text-xs text-chalk-faint">not scouted</td>
                            </tr>
                          )
                        }
                        const totals = actionTotals(rec)
                        const score = scoreBreakdown(game, rec)
                        const fuel = (totals.auto_fuel_scored ?? 0) + (totals.teleop_fuel_scored ?? 0)
                        return (
                          <tr key={`${side}-${team}`} className="border-b border-deck-600">
                            <td className="px-2 py-2">
                              <Link to={`/analysis/${team}`}
                                className={clsx('font-mono font-bold hover:underline',
                                  side === 'red' ? 'text-alliance-red' : 'text-alliance-blue')}>
                                {team}
                              </Link>
                            </td>
                            <td className="px-2 py-2 text-xs text-chalk-dim">{rec.scoutName}</td>
                            <td className="px-2 py-2 text-right font-semibold tabular-nums text-chalk">{fuel}</td>
                            <td className="px-2 py-2 text-right text-xs text-chalk-dim">
                              {String(rec.states.endgame_climb ?? 'none')}
                            </td>
                            <td className="px-2 py-2 text-right font-semibold tabular-nums text-chalk">
                              {score.total}
                            </td>
                          </tr>
                        )
                      }))}
                  </tbody>
                </table>

                <ScoutVsOfficial game={game} match={selected} records={records} />
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

/**
 * Sums our scouts' per-robot estimates per alliance and shows them against
 * the official score. They will never match exactly — FUEL only counts in an
 * active HUB, and fouls are not scouted — but a consistently large gap on one
 * side means a scout is miscounting.
 */
function ScoutVsOfficial({
  game, match, records,
}: { game: ReturnType<typeof getGame>; match: CachedMatch; records: any[] }) {
  const rows = (['red', 'blue'] as const).map((side) => {
    const scouted = match[side]
      .map((t) => records.find((r) => r.teamNumber === t))
      .filter(Boolean)
    const estimate = scouted.reduce((sum, r) => sum + scoreBreakdown(game, r).total, 0)
    const official = side === 'red' ? match.redScore : match.blueScore
    return { side, estimate, official, complete: scouted.length === match[side].length }
  })

  return (
    <div className="mt-4 border-t border-deck-500 pt-3">
      <div className="label mb-2">Scouted vs official</div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.side} className="flex items-center gap-3 text-xs">
            <span className={clsx('w-10 font-bold uppercase',
              r.side === 'red' ? 'text-alliance-red' : 'text-alliance-blue')}>{r.side}</span>
            <span className="tabular-nums text-chalk-dim">
              scouted <span className="font-semibold text-chalk">{r.estimate}</span>
            </span>
            <span className="text-chalk-faint">vs</span>
            <span className="tabular-nums text-chalk-dim">
              official <span className="font-semibold text-chalk">{r.official}</span>
            </span>
            {!r.complete && <span className="text-signal">partial data</span>}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-chalk-faint">
        These will not match exactly — FUEL scores only in an active HUB, and fouls
        aren't scouted. A large, one-sided gap usually means a miscount, not a rules quirk.
      </p>
    </div>
  )
}
