/**
 * Pluggable game definition schema.
 *
 * Every season is one file in `src/games/` that exports a `GameConfig`.
 * Nothing else in the app hardcodes game rules — the match form, the pit
 * survey, the super-scout sheet and the analysis charts are all generated
 * from the active config. To add 2027: copy `rebuilt2026.ts`, edit it,
 * register it in `index.ts`, done.
 */

/** Which part of the match an action belongs to. */
export type Phase = 'auto' | 'teleop' | 'endgame'

/**
 * A repeatable scoring action recorded with a +/- counter.
 * Each tap is stored as a timestamped event, so analysis can slice counts
 * by time window (e.g. REBUILT's alternating ALLIANCE SHIFTS) after the
 * fact rather than forcing the scout to track windows live.
 */
export interface CounterAction {
  kind: 'counter'
  /** Stable key. Never rename after an event — stored records reference it. */
  id: string
  label: string
  /** Short label for dense/phone layouts. */
  shortLabel?: string
  phase: Phase
  /** Points awarded per unit, used for derived scoring estimates. */
  points: number
  /**
   * Units recorded per tap, default 1. Game pieces that score in bursts too
   * fast to tap one-for-one (REBUILT FUEL) use a bigger step; the form still
   * offers a +/-1 trim so a short burst can be corrected exactly.
   */
  step?: number
  /** Groups actions into a visual cluster on the form. */
  group?: string
  /** Marks a miss/failed attempt: excluded from points, used for accuracy. */
  isMiss?: boolean
  /** Pairs a miss counter with the make counter it belongs to. */
  pairsWith?: string
  /** Tailwind accent for the button. */
  accent?: string
  hint?: string
}

/** A one-of-N state, e.g. final climb level. */
export interface SelectAction {
  kind: 'select'
  id: string
  label: string
  phase: Phase
  group?: string
  options: {
    value: string
    label: string
    /** Points if this option is the final state. */
    points: number
    accent?: string
  }[]
  defaultValue: string
  hint?: string
}

/** A yes/no event, e.g. leaving the starting line. */
export interface ToggleAction {
  kind: 'toggle'
  id: string
  label: string
  phase: Phase
  group?: string
  points: number
  defaultValue?: boolean
  hint?: string
}

export type GameAction = CounterAction | SelectAction | ToggleAction

/**
 * A named time window inside the match. REBUILT uses these for ALLIANCE
 * SHIFTS; other games can leave this empty. Timestamped counter events are
 * bucketed into these windows during analysis.
 */
export interface MatchWindow {
  id: string
  label: string
  /** Seconds from match start (t=0 is the start of AUTO). */
  startSec: number
  endSec: number
  phase: Phase
  /** Notes shown in analysis tooltips. */
  note?: string
}

/** A bonus ranking point condition, evaluated per alliance. */
export interface RankingPointDef {
  id: string
  label: string
  description: string
}

/** One question on the pit survey. */
export interface PitField {
  id: string
  label: string
  type: 'text' | 'longtext' | 'number' | 'select' | 'multiselect' | 'boolean'
  options?: string[]
  group: string
  hint?: string
}

/** A 1-5 subjective rating on the super-scout sheet. */
export interface RatingField {
  id: string
  label: string
  description: string
  /** Labels for the low and high ends of the scale. */
  lowLabel: string
  highLabel: string
}

export interface GameConfig {
  /** e.g. 'rebuilt2026' */
  id: string
  year: number
  name: string
  /** Length of the autonomous period, seconds. */
  autoSec: number
  /** Length of the teleoperated period (including endgame), seconds. */
  teleopSec: number
  /** Length of endgame, seconds, measured from the end of the match. */
  endgameSec: number
  actions: GameAction[]
  windows: MatchWindow[]
  rankingPoints: RankingPointDef[]
  pitFields: PitField[]
  superRatings: RatingField[]
  /**
   * Metrics surfaced on team pages and the picklist, in display order.
   * `expr` is evaluated against a team's aggregated per-match totals.
   */
  keyMetrics: {
    id: string
    label: string
    /** Derives a per-match value from that match's action totals. */
    compute: (totals: Record<string, number>) => number
    /** Higher is better? Drives percentile colouring. */
    higherIsBetter: boolean
    format?: 'number' | 'percent'
  }[]
}
