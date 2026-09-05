import type { GameConfig } from './types'

/**
 * FRC 2026 — REBUILT
 *
 * Scoring summary this config encodes:
 *   FUEL in an ACTIVE HUB ........ 1 pt  (AUTO and TELEOP alike)
 *   FUEL in an INACTIVE HUB ...... 0 pts
 *   TOWER Level 1 in AUTO ........ 15 pts (max 2 robots per alliance)
 *   TOWER Level 1 in TELEOP ...... 10 pts
 *   TOWER Level 2 ................ 20 pts (bumpers above LOW RUNG)
 *   TOWER Level 3 ................ 30 pts (bumpers above MID RUNG)
 *   Bonus RPs: ENERGIZED (100 FUEL), SUPERCHARGED (360 FUEL), TRAVERSAL (50 TOWER pts)
 *
 * The HUB alternates active/inactive across four 25-second ALLIANCE SHIFTS,
 * with both HUBs active during AUTO, the TRANSITION SHIFT and END GAME.
 * Which alliance owns which shift depends on AUTO performance, so the scout
 * never tries to judge "was my hub active?" live — they just tap FUEL as it
 * scores and every tap is timestamped. `lib/stats.ts` buckets those events
 * into the windows below afterwards.
 */
export const rebuilt2026: GameConfig = {
  id: 'rebuilt2026',
  year: 2026,
  name: 'REBUILT',
  autoSec: 20,
  teleopSec: 140,
  endgameSec: 30,

  actions: [
    // ---------------------------------------------------------------- AUTO
    {
      kind: 'toggle',
      id: 'auto_leave',
      label: 'Left starting zone',
      phase: 'auto',
      group: 'Mobility',
      points: 0,
      defaultValue: false,
      hint: 'Robot moved off its starting position during AUTO.',
    },
    {
      kind: 'counter',
      id: 'auto_fuel_scored',
      label: 'FUEL scored',
      shortLabel: 'Scored',
      phase: 'auto',
      points: 1,
      group: 'HUB',
      accent: 'emerald',
      hint: 'Both HUBs are active during AUTO, so every FUEL counts.',
    },
    {
      kind: 'counter',
      id: 'auto_fuel_missed',
      label: 'FUEL missed',
      shortLabel: 'Missed',
      phase: 'auto',
      points: 0,
      group: 'HUB',
      isMiss: true,
      pairsWith: 'auto_fuel_scored',
      accent: 'rose',
    },
    {
      kind: 'select',
      id: 'auto_climb',
      label: 'AUTO climb',
      phase: 'auto',
      group: 'TOWER',
      defaultValue: 'none',
      hint: 'Only LEVEL 1 is available in AUTO, and only 2 robots per alliance may score it.',
      options: [
        { value: 'none', label: 'No climb', points: 0 },
        { value: 'l1', label: 'Level 1', points: 15, accent: 'sky' },
        { value: 'failed', label: 'Attempted, failed', points: 0, accent: 'rose' },
      ],
    },

    // -------------------------------------------------------------- TELEOP
    {
      kind: 'counter',
      id: 'teleop_fuel_scored',
      label: 'FUEL scored',
      shortLabel: 'Scored',
      phase: 'teleop',
      points: 1,
      group: 'HUB',
      accent: 'emerald',
      hint: 'Tap on every FUEL that goes in. Active/inactive HUB is resolved later from the timestamp.',
    },
    {
      kind: 'counter',
      id: 'teleop_fuel_missed',
      label: 'FUEL missed',
      shortLabel: 'Missed',
      phase: 'teleop',
      points: 0,
      group: 'HUB',
      isMiss: true,
      pairsWith: 'teleop_fuel_scored',
      accent: 'rose',
    },
    {
      kind: 'counter',
      id: 'teleop_intake_depot',
      label: 'Depot pickup',
      shortLabel: 'Depot',
      phase: 'teleop',
      points: 0,
      group: 'Intake source',
      accent: 'amber',
    },
    {
      kind: 'counter',
      id: 'teleop_intake_human',
      label: 'Human player feed',
      shortLabel: 'Human',
      phase: 'teleop',
      points: 0,
      group: 'Intake source',
      accent: 'amber',
    },
    {
      kind: 'counter',
      id: 'teleop_intake_floor',
      label: 'Floor / centre field',
      shortLabel: 'Floor',
      phase: 'teleop',
      points: 0,
      group: 'Intake source',
      accent: 'amber',
    },

    // ------------------------------------------------------------- ENDGAME
    {
      kind: 'select',
      id: 'endgame_climb',
      label: 'Final TOWER level',
      phase: 'endgame',
      group: 'TOWER',
      defaultValue: 'none',
      hint: 'Where the robot finished the match. Bumpers above LOW RUNG = L2, above MID RUNG = L3.',
      options: [
        { value: 'none', label: 'Not on tower', points: 0 },
        { value: 'l1', label: 'Level 1', points: 10, accent: 'sky' },
        { value: 'l2', label: 'Level 2', points: 20, accent: 'indigo' },
        { value: 'l3', label: 'Level 3', points: 30, accent: 'violet' },
        { value: 'failed', label: 'Attempted, failed', points: 0, accent: 'rose' },
      ],
    },
  ],

  /**
   * REBUILT match timeline. t=0 is the start of AUTO.
   * AUTO 0-20, then a 10s TRANSITION SHIFT, four 25s ALLIANCE SHIFTS,
   * and a 30s END GAME where both HUBs go active again.
   */
  windows: [
    { id: 'auto', label: 'AUTO', startSec: 0, endSec: 20, phase: 'auto', note: 'Both HUBs active' },
    { id: 'transition', label: 'Transition', startSec: 20, endSec: 30, phase: 'teleop', note: 'Both HUBs active' },
    { id: 'shift1', label: 'Shift 1', startSec: 30, endSec: 55, phase: 'teleop', note: 'One HUB active' },
    { id: 'shift2', label: 'Shift 2', startSec: 55, endSec: 80, phase: 'teleop', note: 'One HUB active' },
    { id: 'shift3', label: 'Shift 3', startSec: 80, endSec: 105, phase: 'teleop', note: 'One HUB active' },
    { id: 'shift4', label: 'Shift 4', startSec: 105, endSec: 130, phase: 'teleop', note: 'One HUB active' },
    { id: 'endgame', label: 'END GAME', startSec: 130, endSec: 160, phase: 'endgame', note: 'Both HUBs active' },
  ],

  rankingPoints: [
    { id: 'energized', label: 'Energized', description: 'FUEL scored in the active HUB is at or above 100.' },
    { id: 'supercharged', label: 'Supercharged', description: 'FUEL scored in the active HUB is at or above 360.' },
    { id: 'traversal', label: 'Traversal', description: 'TOWER points scored in the match is at or above 50.' },
  ],

  pitFields: [
    { id: 'drivetrain', label: 'Drivetrain', type: 'select', group: 'Chassis',
      options: ['Swerve', 'West Coast / Tank', 'Mecanum', 'Other'] },
    { id: 'drivetrain_motors', label: 'Drive motors', type: 'select', group: 'Chassis',
      options: ['Kraken X60', 'Falcon 500', 'NEO / NEO Vortex', 'CIM', 'Other'] },
    { id: 'weight', label: 'Weight (lbs)', type: 'number', group: 'Chassis' },
    { id: 'dimensions', label: 'Frame size (in)', type: 'text', group: 'Chassis', hint: 'e.g. 28 x 28' },
    { id: 'intake_type', label: 'FUEL intake', type: 'multiselect', group: 'Mechanisms',
      options: ['Ground', 'Human player', 'Depot', 'None'] },
    { id: 'fuel_capacity', label: 'FUEL capacity', type: 'number', group: 'Mechanisms',
      hint: 'How many FUEL can it hold at once?' },
    { id: 'shooter_type', label: 'Scoring mechanism', type: 'select', group: 'Mechanisms',
      options: ['Flywheel shooter', 'Conveyor / dump', 'Arm placement', 'Other'] },
    { id: 'climb_levels', label: 'Climb levels achievable', type: 'multiselect', group: 'Mechanisms',
      options: ['None', 'Level 1', 'Level 2', 'Level 3'] },
    { id: 'climb_time', label: 'Typical climb time (s)', type: 'number', group: 'Mechanisms' },
    { id: 'auto_count', label: 'Number of autos', type: 'number', group: 'Autonomous' },
    { id: 'auto_best', label: 'Best auto — describe', type: 'longtext', group: 'Autonomous' },
    { id: 'auto_climb_capable', label: 'Can climb L1 in auto?', type: 'boolean', group: 'Autonomous' },
    { id: 'vision', label: 'Vision system', type: 'text', group: 'Software', hint: 'Limelight, PhotonVision, none…' },
    { id: 'programming_lang', label: 'Language', type: 'select', group: 'Software',
      options: ['Java', 'C++', 'Python', 'LabVIEW', 'Other'] },
    { id: 'notes', label: 'General notes', type: 'longtext', group: 'Notes' },
  ],

  superRatings: [
    { id: 'driver_skill', label: 'Driver skill', description: 'Control, awareness, recovery from mistakes.',
      lowLabel: 'Struggling', highLabel: 'Elite' },
    { id: 'agility', label: 'Agility / speed', description: 'How quickly it crosses the field and repositions.',
      lowLabel: 'Slow', highLabel: 'Very fast' },
    { id: 'defense', label: 'Defense played', description: 'Quality and effectiveness of defense on opponents.',
      lowLabel: 'None / poor', highLabel: 'Shutdown' },
    { id: 'defense_resistance', label: 'Defense resistance', description: 'How well it keeps scoring while defended.',
      lowLabel: 'Shut down easily', highLabel: 'Unfazed' },
    { id: 'reliability', label: 'Reliability', description: 'Mechanism failures, tipping, disconnects, dead time.',
      lowLabel: 'Broke down', highLabel: 'Flawless' },
  ],

  keyMetrics: [
    { id: 'total_fuel', label: 'FUEL / match', higherIsBetter: true,
      compute: (t) => (t.auto_fuel_scored ?? 0) + (t.teleop_fuel_scored ?? 0) },
    { id: 'teleop_fuel', label: 'Teleop FUEL', higherIsBetter: true,
      compute: (t) => t.teleop_fuel_scored ?? 0 },
    { id: 'auto_fuel', label: 'Auto FUEL', higherIsBetter: true,
      compute: (t) => t.auto_fuel_scored ?? 0 },
    { id: 'accuracy', label: 'FUEL accuracy', higherIsBetter: true, format: 'percent',
      compute: (t) => {
        const made = (t.auto_fuel_scored ?? 0) + (t.teleop_fuel_scored ?? 0)
        const missed = (t.auto_fuel_missed ?? 0) + (t.teleop_fuel_missed ?? 0)
        return made + missed === 0 ? 0 : made / (made + missed)
      } },
    { id: 'tower_points', label: 'TOWER pts', higherIsBetter: true,
      compute: (t) => t.__tower_points ?? 0 },
    { id: 'total_points', label: 'Est. points', higherIsBetter: true,
      compute: (t) => t.__total_points ?? 0 },
  ],
}
