import { Link } from 'react-router-dom'
import clsx from 'clsx'
import type { CachedEvent, CachedMatch } from '@/lib/schema'
import { allianceOf, matchLabel, teamInfo } from '@/lib/tba'
import { Card, Pill, SectionTitle } from '@/components/ui'

/**
 * Team identity: who they are, what the robot looks like, where they're from.
 * The number alone is fine mid-match; for picklist discussions people talk
 * about robots by name and appearance.
 */
export function TeamIdentity({
  event, team, extraPills,
}: { event: CachedEvent | null; team: number; extraPills?: React.ReactNode }) {
  const info = teamInfo(event, team)

  return (
    <div className="flex flex-wrap items-start gap-4">
      {info?.avatarBase64 && (
        <img src={`data:image/png;base64,${info.avatarBase64}`} alt=""
          className="h-12 w-12 shrink-0 rounded-panel border border-deck-500 bg-deck-700" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-3">
          <Link to="/analysis" className="text-sm text-chalk-dim hover:text-chalk">← All teams</Link>
          <h1 className="font-mono text-3xl font-extrabold text-chalk">{team}</h1>
          {info?.nickname && (
            <span className="text-xl font-bold text-chalk">{info.nickname}</span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2">
          {info && (info.city || info.stateProv) && (
            <span className="text-xs text-chalk-dim">
              {[info.city, info.stateProv, info.country === 'USA' ? '' : info.country]
                .filter(Boolean).join(', ')}
              {info.rookieYear && <span className="ml-2 text-chalk-faint">rookie {info.rookieYear}</span>}
            </span>
          )}
          {extraPills}
        </div>
      </div>
    </div>
  )
}

/** The robot itself, when a photo has been posted to TBA. */
export function RobotPhoto({ event, team }: { event: CachedEvent | null; team: number }) {
  const info = teamInfo(event, team)
  if (!info?.robotPhotoUrl) return null

  return (
    <Card>
      <SectionTitle right={<span className="text-[11px] text-chalk-faint">from The Blue Alliance</span>}>
        Robot
      </SectionTitle>
      <img src={info.robotPhotoUrl} alt={`Team ${team} robot`} loading="lazy"
        className="max-h-80 w-full rounded-panel border border-deck-500 object-contain bg-deck-900" />
    </Card>
  )
}

/**
 * Every match this team played at the event, with the official result from
 * their perspective — the thing you scroll on a Blue Alliance team page.
 */
export function MatchHistory({
  event, team, matches,
}: { event: CachedEvent | null; team: number; matches: CachedMatch[] }) {
  if (!matches.length) return null

  const played = matches.filter((m) => m.redScore !== null)
  const record = played.reduce(
    (acc, m) => {
      const side = allianceOf(m, team)
      if (!side) return acc
      const mine = side === 'red' ? m.redScore! : m.blueScore!
      const theirs = side === 'red' ? m.blueScore! : m.redScore!
      if (mine > theirs) acc.w++
      else if (mine < theirs) acc.l++
      else acc.t++
      return acc
    },
    { w: 0, l: 0, t: 0 },
  )

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-deck-500 p-4">
        <SectionTitle>Match history</SectionTitle>
        <span className="text-xs tabular-nums text-chalk-dim">
          {record.w}-{record.l}-{record.t} · {matches.length} matches
        </span>
      </div>

      <div className="max-h-[480px] overflow-y-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {matches.map((m) => {
              const side = allianceOf(m, team)
              const finished = m.redScore !== null
              const mine = side === 'red' ? m.redScore : m.blueScore
              const theirs = side === 'red' ? m.blueScore : m.redScore
              const won = finished && mine! > theirs!
              const tied = finished && mine === theirs

              return (
                <tr key={m.key} className="border-b border-deck-600 hover:bg-deck-600">
                  <td className="w-16 px-3 py-2 font-mono text-xs font-bold text-chalk">
                    {matchLabel(m)}
                  </td>
                  <td className="w-10 px-1 py-2">
                    {finished && (
                      <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-bold',
                        tied ? 'bg-slate-500/20 text-chalk-dim'
                          : won ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-alliance-red/20 text-alliance-red')}>
                        {tied ? 'T' : won ? 'W' : 'L'}
                      </span>
                    )}
                  </td>

                  {/* Alliance partners and opponents, this team highlighted. */}
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-x-1.5 text-[11px]">
                      {(['red', 'blue'] as const).map((s, i) => (
                        <span key={s} className="flex items-center gap-1">
                          {i === 1 && <span className="mx-1 text-chalk-faint">vs</span>}
                          {m[s].map((t) => (
                            <Link key={t} to={`/analysis/${t}`}
                              className={clsx('font-mono hover:underline',
                                t === team ? 'font-bold text-chalk'
                                  : s === 'red' ? 'text-alliance-red/70' : 'text-alliance-blue/70')}>
                              {t}
                            </Link>
                          ))}
                        </span>
                      ))}
                    </div>
                  </td>

                  <td className="w-24 px-3 py-2 text-right font-mono text-xs tabular-nums">
                    {finished ? (
                      <>
                        <span className={won ? 'font-bold text-chalk' : 'text-chalk-dim'}>{mine}</span>
                        <span className="mx-1 text-chalk-faint">–</span>
                        <span className="text-chalk-dim">{theirs}</span>
                      </>
                    ) : (
                      <span className="text-chalk-faint">upcoming</span>
                    )}
                  </td>

                  <td className="w-8 px-2 py-2 text-center">
                    {m.videos.length > 0 && (
                      <Link to="/review" title="Watch in Review"
                        className="text-[10px] text-chalk-dim hover:text-chalk">▶</Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
