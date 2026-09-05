import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { getGame } from '@/games'
import { db, saveSuper } from '@/lib/db'
import { superId, SCHEMA_VERSION, type Alliance, type CachedEvent } from '@/lib/schema'
import { loadSettings } from '@/lib/settings'
import { getCachedEvent } from '@/lib/tba'
import { Card, Field, Toast } from '@/components/ui'

/**
 * Super scouting: one scout watches a whole alliance and rates all three
 * robots on the qualitative things a counter can't capture — driver skill,
 * agility, how a robot holds up under defense. Orbit's key insight is that
 * these only mean anything *comparatively*, so all three robots are rated
 * side by side on one screen rather than in three separate forms.
 */
export default function SuperScout() {
  const settings = loadSettings()
  const game = getGame(settings.gameId)

  const [event, setEvent] = useState<CachedEvent | null>(null)
  const [matchLevel, setMatchLevel] = useState<'qm' | 'sf' | 'f' | 'pr'>('qm')
  const [matchNumber, setMatchNumber] = useState(1)
  const [alliance, setAlliance] = useState<Alliance>(settings.assignedAlliance || 'red')
  const [teams, setTeams] = useState<number[]>([0, 0, 0])
  const [ratings, setRatings] = useState<Record<number, Record<string, number>>>({})
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [toast, setToast] = useState<{ msg: string; tone: 'green' | 'red' } | null>(null)

  useEffect(() => { getCachedEvent(settings.eventKey).then(setEvent) }, [settings.eventKey])

  useEffect(() => {
    const m = event?.matches.find((x) => x.matchLevel === matchLevel && x.matchNumber === matchNumber)
    if (m && m[alliance].length === 3) setTeams(m[alliance])
  }, [event, matchLevel, matchNumber, alliance])

  function rate(team: number, ratingId: string, value: number) {
    setRatings((r) => ({
      ...r,
      [team]: { ...(r[team] ?? {}), [ratingId]: r[team]?.[ratingId] === value ? 0 : value },
    }))
  }

  async function submit() {
    if (teams.some((t) => !t)) { flash('All three team numbers are needed.', 'red'); return }
    if (!settings.eventKey) { flash('Set an event in Settings first.', 'red'); return }

    const id = superId(settings.eventKey, matchLevel, matchNumber, alliance)
    const existing = await db.supers.get(id)
    await saveSuper({
      id,
      schemaVersion: SCHEMA_VERSION,
      gameId: game.id,
      eventKey: settings.eventKey,
      matchNumber, matchLevel, alliance,
      scoutName: settings.scoutName || 'anonymous',
      ratings, notes,
      createdAt: existing?.createdAt ?? Date.now(),
      synced: false,
    })
    flash(`Saved ${alliance} alliance, match ${matchNumber}.`, 'green')
    setRatings({}); setNotes({}); setMatchNumber((n) => n + 1)
  }

  function flash(msg: string, tone: 'green' | 'red') {
    setToast({ msg, tone }); setTimeout(() => setToast(null), 2600)
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 pb-28">
      <Card className={clsx('border-l-4', alliance === 'red' ? 'border-l-alliance-red' : 'border-l-alliance-blue')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Level">
            <select className="input" value={matchLevel} onChange={(e) => setMatchLevel(e.target.value as any)}>
              <option value="qm">Quals</option><option value="sf">Playoff</option>
              <option value="f">Finals</option><option value="pr">Practice</option>
            </select>
          </Field>
          <Field label="Match">
            <input type="number" min={1} className="input tabular-nums" value={matchNumber}
              onChange={(e) => setMatchNumber(Math.max(1, Number(e.target.value)))} />
          </Field>
          <Field label="Alliance">
            <select className="input" value={alliance} onChange={(e) => setAlliance(e.target.value as Alliance)}>
              <option value="red">Red</option><option value="blue">Blue</option>
            </select>
          </Field>
          <div className="flex items-end">
            <div className="w-full rounded-panel border border-deck-500 bg-deck-900 px-3 py-2">
              <div className="label">Scout</div>
              <div className="truncate text-sm font-semibold text-chalk">
                {settings.scoutName || <span className="text-alliance-red">unset</span>}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* One column per robot, one row per rating — the comparison is the point. */}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className="w-56 pb-3 text-left" />
              {teams.map((t, i) => (
                <th key={i} className="pb-3 px-2">
                  <input type="number" placeholder="team"
                    className="input text-center text-lg font-bold tabular-nums"
                    value={t || ''}
                    onChange={(e) => setTeams((ts) => ts.map((x, j) => (j === i ? Number(e.target.value) : x)))} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {game.superRatings.map((rating) => (
              <tr key={rating.id} className="border-t border-deck-600">
                <td className="py-3 pr-4 align-top">
                  <div className="text-sm font-semibold text-chalk">{rating.label}</div>
                  <div className="mt-0.5 text-[11px] leading-tight text-chalk-dim">{rating.description}</div>
                  <div className="mt-1 text-[10px] text-chalk-faint">
                    1 = {rating.lowLabel} · 5 = {rating.highLabel}
                  </div>
                </td>
                {teams.map((team, i) => (
                  <td key={i} className="px-2 py-3 align-top">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" disabled={!team}
                          onClick={() => rate(team, rating.id, n)}
                          className={clsx(
                            'tap-target h-10 flex-1 rounded border text-xs font-bold transition active:scale-95 disabled:opacity-30',
                            (ratings[team]?.[rating.id] ?? 0) >= n
                              ? 'border-signal bg-signal/15 text-white'
                              : 'border-deck-500 bg-deck-900 text-chalk-dim hover:bg-deck-600',
                          )}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-deck-600">
              <td className="py-3 pr-4 align-top text-sm font-semibold text-chalk">Notes</td>
              {teams.map((team, i) => (
                <td key={i} className="px-2 py-3">
                  <textarea rows={3} className="input resize-none text-xs" disabled={!team}
                    value={notes[team] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [team]: e.target.value }))} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t border-deck-500 bg-deck-900/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-end gap-3">
          <button type="button" onClick={submit} className="btn-primary px-8">Save alliance</button>
        </div>
      </div>

      {toast && <Toast message={toast.msg} tone={toast.tone} />}
    </div>
  )
}
