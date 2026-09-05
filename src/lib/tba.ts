import { db } from './db'
import { getConfig } from './config'
import type {
  CachedEvent, CachedMatch, CachedRanking, CachedTeam, EventDirectoryEntry, MatchVideo,
} from './schema'

/**
 * The Blue Alliance Read API v3.
 *
 * Fetches are cached into IndexedDB so the schedule and team list stay
 * available once the venue wifi inevitably dies. Every read goes through
 * the cache first and only hits the network when asked to refresh.
 *
 * The API key is stored in localStorage (see Settings) — TBA read keys are
 * per-user and low-sensitivity, but they are still never bundled into the
 * build. Get one at thebluealliance.com/account.
 */
const BASE = 'https://www.thebluealliance.com/api/v3'

/**
 * A key typed into Settings wins; otherwise fall back to the one shipped in
 * config.json, so a team can deploy a pre-configured build.
 */
export function getTbaKey(): string {
  return localStorage.getItem('tba_key') || getConfig().tbaApiKey || ''
}
export function setTbaKey(key: string) {
  localStorage.setItem('tba_key', key.trim())
}

async function tbaFetch<T>(path: string): Promise<T> {
  const key = getTbaKey()
  if (!key) throw new Error('No Blue Alliance API key set. Add one in Settings.')

  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-TBA-Auth-Key': key },
  })
  if (res.status === 401) throw new Error('Blue Alliance rejected the API key.')
  if (res.status === 404) throw new Error(`Not found on The Blue Alliance: ${path}`)
  if (!res.ok) throw new Error(`Blue Alliance error ${res.status}`)
  return res.json() as Promise<T>
}

const LEVEL_MAP: Record<string, CachedMatch['matchLevel']> = {
  qm: 'qm', sf: 'sf', f: 'f', qf: 'sf', ef: 'sf',
}

/** Strip the `frc` prefix TBA puts on team keys. */
const teamNum = (key: string) => parseInt(key.replace('frc', ''), 10)

/**
 * Pull an event's team list, schedule, standings and OPRs, then cache it.
 *
 * Uses `/matches` rather than `/matches/simple` because only the full payload
 * carries `videos` — the match footage links that make the review screen work.
 * Rankings and OPRs are best-effort: they 404 before qualification play
 * starts, which is normal and must not fail the whole sync.
 */
export async function fetchEvent(
  eventKey: string,
  onProgress?: (message: string) => void,
): Promise<CachedEvent> {
  onProgress?.('Fetching schedule…')
  const [info, teamList, matches] = await Promise.all([
    tbaFetch<{ name: string }>(`/event/${eventKey}/simple`),
    tbaFetch<any[]>(`/event/${eventKey}/teams`),
    tbaFetch<any[]>(`/event/${eventKey}/matches`),
  ])

  onProgress?.('Fetching standings…')
  const [rankingData, oprData] = await Promise.all([
    tbaFetch<any>(`/event/${eventKey}/rankings`).catch(() => null),
    tbaFetch<any>(`/event/${eventKey}/oprs`).catch(() => null),
  ])

  // Robot photos are one request per team, so they run pooled and are
  // strictly best-effort: a team with no photo posted must not fail the sync.
  const year = Number(eventKey.slice(0, 4)) || new Date().getFullYear()
  onProgress?.(`Fetching robot photos (0/${teamList.length})…`)
  let done = 0
  const teamInfo: CachedTeam[] = await pool(teamList, 6, async (t: any) => {
    const media = await tbaFetch<any[]>(`/team/${t.key}/media/${year}`).catch(() => [])
    onProgress?.(`Fetching robot photos (${++done}/${teamList.length})…`)
    return {
      teamNumber: t.team_number,
      nickname: t.nickname ?? `Team ${t.team_number}`,
      name: t.name ?? '',
      city: t.city ?? '',
      stateProv: t.state_prov ?? '',
      country: t.country ?? '',
      rookieYear: t.rookie_year ?? null,
      schoolName: t.school_name ?? '',
      robotPhotoUrl: pickRobotPhoto(media),
      avatarBase64: media.find((m) => m.type === 'avatar')?.details?.base64Image ?? null,
    }
  })
  teamInfo.sort((a, b) => a.teamNumber - b.teamNumber)

  const oprs: Record<string, number> = oprData?.oprs ?? {}

  const rankings: CachedRanking[] = (rankingData?.rankings ?? []).map((r: any): CachedRanking => ({
    teamNumber: teamNum(r.team_key),
    rank: r.rank,
    rankingScore: r.sort_orders?.[0] ?? 0,
    wins: r.record?.wins ?? 0,
    losses: r.record?.losses ?? 0,
    ties: r.record?.ties ?? 0,
    matchesPlayed: r.matches_played ?? 0,
    opr: oprs[r.team_key] ?? null,
  }))

  const cached: CachedEvent = {
    eventKey,
    name: info.name,
    teams: teamList.map((t: any) => t.team_number).sort((a: number, b: number) => a - b),
    matches: matches
      .filter((m) => LEVEL_MAP[m.comp_level])
      .map((m): CachedMatch => ({
        key: m.key,
        matchNumber: m.comp_level === 'qm' ? m.match_number : m.set_number * 100 + m.match_number,
        matchLevel: LEVEL_MAP[m.comp_level],
        red: (m.alliances?.red?.team_keys ?? []).map(teamNum),
        blue: (m.alliances?.blue?.team_keys ?? []).map(teamNum),
        redScore: m.alliances?.red?.score ?? null,
        blueScore: m.alliances?.blue?.score ?? null,
        predictedTime: m.predicted_time ?? m.time ?? null,
        videos: (m.videos ?? [])
          .filter((v: any) => v?.key && (v.type === 'youtube' || v.type === 'tba'))
          .map((v: any): MatchVideo => ({ key: v.key, type: v.type })),
        redRp: m.score_breakdown?.red?.rp ?? null,
        blueRp: m.score_breakdown?.blue?.rp ?? null,
      }))
      .sort((a, b) =>
        a.matchLevel === b.matchLevel
          ? a.matchNumber - b.matchNumber
          : ['qm', 'sf', 'f'].indexOf(a.matchLevel) - ['qm', 'sf', 'f'].indexOf(b.matchLevel)),
    rankings,
    teamInfo,
    fetchedAt: Date.now(),
  }

  await db.events.put(cached)
  return cached
}

/**
 * Pick the best robot photo from a team's media.
 * Prefers whatever the team marked `preferred`, then any real image host.
 * Ignores video thumbnails, which are not pictures of the robot.
 */
function pickRobotPhoto(media: any[]): string | null {
  const images = media.filter(
    (m) => m?.direct_url && ['imgur', 'cdphotothread', 'instagram-image', 'onshape'].includes(m.type),
  )
  const preferred = images.find((m) => m.preferred)
  return (preferred ?? images[0])?.direct_url ?? null
}

/** Run an async mapper over items with bounded concurrency. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/** Identity and robot photo for one team. */
export function teamInfo(event: CachedEvent | null, team: number): CachedTeam | null {
  return event?.teamInfo?.find((t) => t.teamNumber === team) ?? null
}

/** Display name: "1323 — Madtown Robotics", falling back to the number. */
export function teamDisplayName(event: CachedEvent | null, team: number): string {
  const info = teamInfo(event, team)
  return info?.nickname ? `${team} — ${info.nickname}` : String(team)
}

/** Every cached match a team appears in, newest first. */
export function teamMatches(event: CachedEvent | null, team: number): CachedMatch[] {
  if (!event) return []
  return event.matches
    .filter((m) => m.red.includes(team) || m.blue.includes(team))
    .sort(byMostRecent)
}

/** A team's official standing, if qualification play has started. */
export function teamRanking(event: CachedEvent | null, team: number): CachedRanking | null {
  return event?.rankings.find((r) => r.teamNumber === team) ?? null
}

/** Which alliance a team was on in a match, for result colouring. */
export function allianceOf(match: CachedMatch, team: number): 'red' | 'blue' | null {
  if (match.red.includes(team)) return 'red'
  if (match.blue.includes(team)) return 'blue'
  return null
}

/**
 * Human-readable match label.
 *
 * Playoff matches are cached as `set * 100 + match` to keep one sortable
 * number, so raw values look like "1301". Decode that back into the form
 * people actually say out loud: SF13, or SF13-2 when a set has replays.
 */
export function matchLabel(m: Pick<CachedMatch, 'matchLevel' | 'matchNumber'>): string {
  if (m.matchLevel === 'qm') return `Q${m.matchNumber}`
  if (m.matchLevel === 'pr') return `P${m.matchNumber}`
  const set = Math.floor(m.matchNumber / 100)
  const num = m.matchNumber % 100
  if (m.matchLevel === 'f') return `F${num}`
  return num > 1 ? `SF${set}-${num}` : `SF${set}`
}

/** Playing order rank, so finals sort after semifinals after quals. */
export const LEVEL_ORDER: Record<string, number> = { pr: -1, qm: 0, sf: 1, f: 2 }

/** Most recently played first: finals, then semis, then quals. */
export function byMostRecent(a: CachedMatch, b: CachedMatch): number {
  const la = LEVEL_ORDER[a.matchLevel] ?? 0
  const lb = LEVEL_ORDER[b.matchLevel] ?? 0
  return la === lb ? b.matchNumber - a.matchNumber : lb - la
}

/** Embeddable URL for a match video. Returns null for unsupported hosts. */
export function videoEmbedUrl(video: MatchVideo): string | null {
  // `tba`-type keys point at TBA's own player, which does not expose an
  // embed endpoint, so only YouTube is embeddable.
  if (video.type !== 'youtube') return null
  // TBA sometimes stores "id?t=123" to deep-link a timestamp.
  const [id, query] = video.key.split('?')
  const start = new URLSearchParams(query ?? '').get('t')
  const params = new URLSearchParams({ rel: '0', modestbranding: '1' })
  if (start) params.set('start', start.replace(/[^0-9]/g, ''))
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`
}

/** Watch-on-YouTube link, for when embedding is blocked. */
export function videoWatchUrl(video: MatchVideo): string {
  if (video.type === 'youtube') {
    return `https://www.youtube.com/watch?v=${video.key.split('?')[0]}`
  }
  return `https://www.thebluealliance.com/match/${video.key}`
}

/** Cached copy, or null if this event has never been fetched. */
export async function getCachedEvent(eventKey: string): Promise<CachedEvent | null> {
  return (await db.events.get(eventKey)) ?? null
}

/** Every event cached locally, newest fetch first. */
export async function listCachedEvents(): Promise<CachedEvent[]> {
  return db.events.orderBy('fetchedAt').reverse().toArray()
}

/**
 * The whole season's event list, cached so it can be searched by name.
 *
 * Nobody remembers that Silicon Valley is "casj". Scouts know their
 * competition by its name, so that is what they should be able to type.
 * ~320 events a season, about 120 KB — small enough to hold offline.
 */
export async function fetchEventDirectory(year: number): Promise<EventDirectoryEntry[]> {
  const raw = await tbaFetch<any[]>(`/events/${year}/simple`)
  const entries: EventDirectoryEntry[] = raw.map((e) => ({
    key: e.key,
    name: e.name,
    city: e.city ?? '',
    stateProv: e.state_prov ?? '',
    country: e.country ?? '',
    startDate: e.start_date ?? '',
    endDate: e.end_date ?? '',
    year: e.year ?? year,
    eventType: e.event_type ?? 0,
  }))

  await db.transaction('rw', db.eventDirectory, async () => {
    await db.eventDirectory.where('year').equals(year).delete()
    await db.eventDirectory.bulkPut(entries)
  })
  localStorage.setItem(`event_dir_fetched_${year}`, String(Date.now()))
  return entries
}

/** The cached directory for a season, or an empty list if never fetched. */
export async function getEventDirectory(year: number): Promise<EventDirectoryEntry[]> {
  return db.eventDirectory.where('year').equals(year).toArray()
}

export function eventDirectoryAge(year: number): number | null {
  const at = localStorage.getItem(`event_dir_fetched_${year}`)
  return at ? Date.now() - Number(at) : null
}

/**
 * Rank events against a typed query. Matches on name, city and key, so
 * "silicon", "san jose" and "casj" all find the same event, and prefers
 * events whose name starts with the query.
 */
export function searchEvents(
  entries: EventDirectoryEntry[],
  query: string,
  limit = 12,
): EventDirectoryEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const scored = entries
    .map((e) => {
      const name = e.name.toLowerCase()
      const place = `${e.city} ${e.stateProv}`.toLowerCase()
      let score = -1
      if (e.key.toLowerCase() === q) score = 100
      else if (name.startsWith(q)) score = 80
      else if (name.includes(q)) score = 60
      else if (place.startsWith(q)) score = 45
      else if (place.includes(q)) score = 35
      else if (e.key.toLowerCase().includes(q)) score = 25
      // A championship division is rarely what a scout is looking for.
      if (e.eventType >= 3) score -= 10
      return { e, score }
    })
    .filter((x) => x.score > 0)

  scored.sort((a, b) =>
    b.score - a.score || a.e.startDate.localeCompare(b.e.startDate))
  return scored.slice(0, limit).map((x) => x.e)
}

/** Human label for TBA's event_type. */
export function eventTypeLabel(t: number): string {
  if (t === 0) return 'Regional'
  if (t === 1) return 'District'
  if (t === 2) return 'District championship'
  if (t === 3 || t === 4) return 'Championship'
  return 'Offseason'
}

/** Events a team is registered for in a given year — used by the event picker. */
export async function fetchTeamEvents(team: number, year: number) {
  const events = await tbaFetch<any[]>(`/team/frc${team}/events/${year}/simple`)
  return events
    .map((e) => ({ key: e.key, name: e.name, start: e.start_date }))
    .sort((a, b) => a.start.localeCompare(b.start))
}

/** The three robots on a given alliance in a given match, from cache. */
export function allianceTeams(
  event: CachedEvent | null,
  level: string,
  matchNumber: number,
  alliance: 'red' | 'blue',
): number[] {
  const match = event?.matches.find(
    (m) => m.matchLevel === level && m.matchNumber === matchNumber,
  )
  return match ? match[alliance] : []
}
