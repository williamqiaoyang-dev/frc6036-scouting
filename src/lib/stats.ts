import type { GameConfig, CounterAction, SelectAction, ToggleAction } from '@/games/types'
import type { MatchRecord, SuperRecord } from './schema'

/**
 * Analysis math. Everything derives from the raw timestamped event log, so
 * new questions can be answered against already-collected data without
 * re-scouting — the whole reason taps are stored with timestamps.
 */

/** Net count per action id for one match, after applying undos. */
export function actionTotals(record: MatchRecord): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const ev of record.events) {
    totals[ev.actionId] = (totals[ev.actionId] ?? 0) + ev.delta
  }
  for (const key of Object.keys(totals)) {
    if (totals[key] < 0) totals[key] = 0
  }
  return totals
}

/** Counts bucketed into the game's named time windows, per action. */
export function totalsByWindow(
  game: GameConfig,
  record: MatchRecord,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const w of game.windows) out[w.id] = {}

  for (const ev of record.events) {
    const win = game.windows.find((w) => ev.t >= w.startSec && ev.t < w.endSec)
    if (!win) continue
    out[win.id][ev.actionId] = (out[win.id][ev.actionId] ?? 0) + ev.delta
  }
  return out
}

/**
 * Points this robot contributed, plus derived subtotals.
 * Note FUEL is scored at 1pt only when the HUB is active; without the FMS
 * shift assignment we cannot know which shifts were active, so this is an
 * upper bound and is labelled "est." everywhere in the UI.
 */
export function scoreBreakdown(game: GameConfig, record: MatchRecord) {
  const totals = actionTotals(record)
  let counterPoints = 0
  let towerPoints = 0

  for (const action of game.actions) {
    if (action.kind === 'counter') {
      counterPoints += (totals[action.id] ?? 0) * (action as CounterAction).points
    } else if (action.kind === 'select') {
      const value = record.states[action.id]
      const opt = (action as SelectAction).options.find((o) => o.value === value)
      const pts = opt?.points ?? 0
      if (action.group === 'TOWER') towerPoints += pts
      else counterPoints += pts
    } else if (action.kind === 'toggle') {
      if (record.states[action.id] === true) counterPoints += (action as ToggleAction).points
    }
  }

  return {
    totals: { ...totals, __tower_points: towerPoints, __total_points: counterPoints + towerPoints },
    towerPoints,
    total: counterPoints + towerPoints,
  }
}

export interface TeamSummary {
  teamNumber: number
  matchesPlayed: number
  /** metricId -> aggregate stats across matches */
  metrics: Record<string, {
    mean: number
    median: number
    max: number
    stdev: number
    /** Per-match values in match order, for sparklines. */
    series: { matchNumber: number; value: number }[]
  }>
  /** Fraction of matches where the robot died or no-showed. */
  breakdownRate: number
  noShows: number
  /** Distribution of final climb levels. */
  climbCounts: Record<string, number>
  /** Mean 1-5 super-scout ratings. */
  superRatings: Record<string, number>
  defenseRating: number
  driverRating: number
  notes: { matchNumber: number; text: string }[]
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

/** Roll every match (and super-scout sheet) for one team into a summary. */
export function summarizeTeam(
  game: GameConfig,
  teamNumber: number,
  matches: MatchRecord[],
  supers: SuperRecord[] = [],
): TeamSummary {
  const played = matches.filter((m) => !m.noShow)

  const metrics: TeamSummary['metrics'] = {}
  for (const metric of game.keyMetrics) {
    const series = played
      .map((m) => ({
        matchNumber: m.matchNumber,
        value: metric.compute(scoreBreakdown(game, m).totals),
      }))
      .sort((a, b) => a.matchNumber - b.matchNumber)
    const values = series.map((s) => s.value)
    metrics[metric.id] = {
      mean: mean(values),
      median: median(values),
      max: values.length ? Math.max(...values) : 0,
      stdev: stdev(values),
      series,
    }
  }

  const climbCounts: Record<string, number> = {}
  for (const m of played) {
    const climb = String(m.states.endgame_climb ?? 'none')
    climbCounts[climb] = (climbCounts[climb] ?? 0) + 1
  }

  // Super-scout ratings for this team, averaged across all sheets.
  const superRatings: Record<string, number> = {}
  const collected: Record<string, number[]> = {}
  for (const s of supers) {
    const r = s.ratings[teamNumber]
    if (!r) continue
    for (const [key, value] of Object.entries(r)) {
      ;(collected[key] ??= []).push(value)
    }
  }
  for (const [key, values] of Object.entries(collected)) superRatings[key] = mean(values)

  return {
    teamNumber,
    matchesPlayed: played.length,
    metrics,
    breakdownRate: matches.length
      ? matches.filter((m) => m.diedOnField || m.noShow).length / matches.length
      : 0,
    noShows: matches.filter((m) => m.noShow).length,
    climbCounts,
    superRatings,
    defenseRating: mean(played.map((m) => m.defenseRating).filter((r) => r > 0)),
    driverRating: mean(played.map((m) => m.driverRating).filter((r) => r > 0)),
    notes: matches
      .filter((m) => m.notes.trim())
      .map((m) => ({ matchNumber: m.matchNumber, text: m.notes }))
      .sort((a, b) => b.matchNumber - a.matchNumber),
  }
}

/** Summaries for every team with data at an event. */
export function summarizeEvent(
  game: GameConfig,
  matches: MatchRecord[],
  supers: SuperRecord[] = [],
  roster: number[] = [],
): TeamSummary[] {
  const byTeam = new Map<number, MatchRecord[]>()

  // Seed from the event roster first, so every registered team gets a row
  // even with nothing scouted yet. Knowing who has *no* data is the whole
  // point of a coverage view, and a team with no matches still has to be
  // addable to the picklist.
  for (const team of roster) byTeam.set(team, [])

  for (const m of matches) {
    if (!byTeam.has(m.teamNumber)) byTeam.set(m.teamNumber, [])
    byTeam.get(m.teamNumber)!.push(m)
  }

  return [...byTeam.entries()]
    .map(([team, recs]) => summarizeTeam(game, team, recs, supers))
    .sort((a, b) => a.teamNumber - b.teamNumber)
}

/**
 * Percentile rank (0-1) of a team's value for one metric, against the field.
 * Drives the colour ramp on team pages and the picklist.
 */
export function percentile(
  summaries: TeamSummary[],
  metricId: string,
  value: number,
  higherIsBetter: boolean,
): number {
  const values = summaries
    .filter((s) => s.matchesPlayed > 0)
    .map((s) => s.metrics[metricId]?.mean ?? 0)
  if (values.length < 2) return 0.5
  const below = values.filter((v) => (higherIsBetter ? v < value : v > value)).length
  return below / (values.length - 1)
}
