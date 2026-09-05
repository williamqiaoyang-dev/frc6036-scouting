/** Stored record shapes. Keep these stable — exported data references them. */

export type Alliance = 'red' | 'blue'

/** A single timestamped counter tap. */
export interface ScoutEvent {
  /** Action id from the game config. */
  actionId: string
  /** Seconds since the scout pressed Start. */
  t: number
  /**
   * Units added by this tap. Usually the action's `step` (FUEL moves in
   * fives), negative for a correction. Analysis only ever sums deltas, so a
   * record written when FUEL stepped by 1 still totals correctly.
   */
  delta: number
}

export interface MatchRecord {
  /** Deterministic id: `${eventKey}_${matchNumber}_${team}`. Re-scouting overwrites. */
  id: string
  schemaVersion: number
  gameId: string
  eventKey: string
  matchNumber: number
  /** Qualification, playoff, practice. */
  matchLevel: 'qm' | 'sf' | 'f' | 'pr'
  teamNumber: number
  alliance: Alliance
  /** 1-3, position within the alliance as TBA lists it. Derived from the
   * team the scout picked; 0 when the team was typed by hand. */
  station: number
  scoutName: string
  /** Timestamped taps, the raw source of truth. */
  events: ScoutEvent[]
  /** Final values for select/toggle actions, keyed by action id. */
  states: Record<string, string | boolean>
  /** Did the robot stop moving at any point? */
  diedOnField: boolean
  /** Seconds of dead time, if known. */
  deadTimeSec?: number
  /** Was the robot a no-show? */
  noShow: boolean
  /** 0-5, how much defense this robot played. */
  defenseRating: number
  /** 0-5, driver skill impression. */
  driverRating: number
  notes: string
  /** Epoch ms when the record was committed. */
  createdAt: number
  updatedAt: number
  /** Set once the record has been exported/ingested centrally. */
  synced: boolean
}

export interface PitRecord {
  id: string
  schemaVersion: number
  gameId: string
  eventKey: string
  teamNumber: number
  scoutName: string
  /** Answers keyed by pit field id. */
  fields: Record<string, string | number | boolean | string[]>
  /** Data-URL photos of the robot. */
  photos: string[]
  createdAt: number
  updatedAt: number
  synced: boolean
}

export interface SuperRecord {
  id: string
  schemaVersion: number
  gameId: string
  eventKey: string
  matchNumber: number
  matchLevel: 'qm' | 'sf' | 'f' | 'pr'
  alliance: Alliance
  scoutName: string
  /** teamNumber -> { ratingId: 1-5 } */
  ratings: Record<number, Record<string, number>>
  /** teamNumber -> free text */
  notes: Record<number, string>
  createdAt: number
  updatedAt: number
  synced: boolean
}

export interface PicklistEntry {
  teamNumber: number
  /** Ordering rank, lower is earlier. */
  rank: number
  /** Free tier label: 'First pick', 'Do not pick', … */
  tier: string
  note: string
}

export interface Picklist {
  id: string
  eventKey: string
  name: string
  entries: PicklistEntry[]
  updatedAt: number
}

/** Cached TBA payloads so the app works offline once primed. */
export interface CachedEvent {
  eventKey: string
  name: string
  teams: number[]
  matches: CachedMatch[]
  /** Official standings, empty before qualification play begins. */
  rankings: CachedRanking[]
  /** Identity and robot photos, keyed by team number. */
  teamInfo: CachedTeam[]
  fetchedAt: number
}

/** A match video posted to The Blue Alliance. */
export interface MatchVideo {
  /** YouTube video id, or a TBA media key for other hosts. */
  key: string
  type: 'youtube' | 'tba'
}

export interface CachedMatch {
  key: string
  matchNumber: number
  matchLevel: 'qm' | 'sf' | 'f' | 'pr'
  red: number[]
  blue: number[]
  redScore: number | null
  blueScore: number | null
  predictedTime: number | null
  /** Match videos, once someone has posted them to TBA. */
  videos: MatchVideo[]
  /** Official ranking points earned, keyed by alliance. Null until played. */
  redRp: number | null
  blueRp: number | null
}

/**
 * One row of the event directory — every event in a season, so a scout can
 * find their competition by name instead of memorising a TBA event code.
 */
export interface EventDirectoryEntry {
  key: string
  name: string
  city: string
  stateProv: string
  country: string
  startDate: string
  endDate: string
  year: number
  /** TBA event_type: 0 regional, 1 district, 2 district champs, 3+ champs/offseason. */
  eventType: number
}

/** Team identity and robot photo, from TBA. */
export interface CachedTeam {
  teamNumber: number
  /** The name people actually use, e.g. "The Wildhats". */
  nickname: string
  /** Sponsor string. Long and rarely useful, but kept for the team page. */
  name: string
  city: string
  stateProv: string
  country: string
  rookieYear: number | null
  schoolName: string
  /** Direct image URL for the robot, when a photo has been posted. */
  robotPhotoUrl: string | null
  /** TBA avatar, stored as a base64 PNG. */
  avatarBase64: string | null
}

/** A timestamped note pinned to a point in a match video. */
export interface MarkerRecord {
  id: string
  schemaVersion: number
  eventKey: string
  /** TBA match key this marker belongs to. */
  matchKey: string
  matchNumber: number
  matchLevel: 'qm' | 'sf' | 'f' | 'pr'
  /** Seconds into the video. */
  t: number
  /** Which robot this is about, if it is about one. */
  teamNumber: number | null
  /** Preset category, see MARKER_TAGS. */
  tag: string
  note: string
  author: string
  createdAt: number
  updatedAt: number
  synced: boolean
}

/** Preset marker categories. Free-text goes in `note`. */
export const MARKER_TAGS = [
  { id: 'good', label: 'Good play', accent: 'emerald' },
  { id: 'shot', label: 'Shot scored', accent: 'lime' },
  { id: 'cycle', label: 'Fast cycle', accent: 'sky' },
  { id: 'defense', label: 'Defense', accent: 'violet' },
  { id: 'breakdown', label: 'Breakdown', accent: 'rose' },
  { id: 'penalty', label: 'Penalty', accent: 'amber' },
  { id: 'note', label: 'Note', accent: 'slate' },
] as const

/** A team's official standing at an event, straight from TBA. */
export interface CachedRanking {
  teamNumber: number
  rank: number
  /** Ranking score (average RP in most seasons). */
  rankingScore: number
  wins: number
  losses: number
  ties: number
  matchesPlayed: number
  /** Offensive Power Rating, when TBA has computed it. */
  opr: number | null
}

export const SCHEMA_VERSION = 1

/** Stable id builders — re-scouting a robot overwrites rather than duplicates. */
export const matchId = (eventKey: string, level: string, matchNumber: number, team: number) =>
  `${eventKey}_${level}${matchNumber}_${team}`
export const pitId = (eventKey: string, team: number) => `${eventKey}_pit_${team}`
export const superId = (eventKey: string, level: string, matchNumber: number, alliance: string) =>
  `${eventKey}_${level}${matchNumber}_${alliance}`
export const markerId = (matchKey: string, t: number, author: string) =>
  `${matchKey}_${Math.round(t * 10)}_${author || 'anon'}`
