import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { getGame } from '@/games'
import { summarizeEvent, type TeamSummary } from '@/lib/stats'
import { loadSettings } from '@/lib/settings'

/**
 * Live view of everything scouted at the active event. Backed by Dexie's
 * liveQuery, so importing a bundle on the analysis laptop pushes straight
 * into the charts with no refresh.
 */
export function useEventData() {
  const settings = loadSettings()
  const game = getGame(settings.gameId)

  const data = useLiveQuery(async () => {
    const [matches, supers, pits, event] = await Promise.all([
      db.matches.where('eventKey').equals(settings.eventKey).toArray(),
      db.supers.where('eventKey').equals(settings.eventKey).toArray(),
      db.pits.where('eventKey').equals(settings.eventKey).toArray(),
      db.events.get(settings.eventKey),
    ])
    return { matches, supers, pits, event: event ?? null }
  }, [settings.eventKey])

  // The roster comes from the TBA cache, so the analysis covers every team
  // registered at the event — not only the ones someone has already scouted.
  const roster = data?.event?.teams ?? []

  const summaries: TeamSummary[] = data
    ? summarizeEvent(game, data.matches, data.supers, roster)
    : []

  return {
    game,
    event: data?.event ?? null,
    eventKey: settings.eventKey,
    eventName: data?.event?.name ?? '',
    loading: !data,
    matches: data?.matches ?? [],
    supers: data?.supers ?? [],
    pits: data?.pits ?? [],
    roster,
    summaries,
    /** Teams with at least one scouted match. */
    scouted: summaries.filter((s) => s.matchesPlayed > 0),
    /** Registered teams nobody has scouted yet. */
    unscouted: summaries.filter((s) => s.matchesPlayed === 0),
  }
}
