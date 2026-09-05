# Adding a season

The whole game lives in one file. This walks through building it.

## 1. Create the file

```bash
cp src/games/rebuilt2026.ts src/games/<name><year>.ts
```

## 2. Fill in the config

### Identity and timing

```ts
id: 'newgame2027',
year: 2027,
name: 'NEWGAME',
autoSec: 15,      // autonomous length
teleopSec: 135,   // teleop length, including endgame
endgameSec: 20,   // endgame length, measured back from the end
```

### Actions

Three kinds, all optional, all keyed by `phase` (`'auto' | 'teleop' | 'endgame'`):

**`counter`** — a repeatable +/- tap. Use for anything scored more than once.

```ts
{
  kind: 'counter',
  id: 'teleop_score_high',    // never rename after an event
  label: 'High goal',
  shortLabel: 'High',         // used in dense layouts
  phase: 'teleop',
  points: 5,
  group: 'Scoring',           // clusters actions visually
  accent: 'emerald',          // emerald | rose | amber | sky | slate
  hint: 'Shown under the label.',
}
```

Pair a miss counter with its make counter to get accuracy for free:

```ts
{ kind: 'counter', id: 'teleop_score_high_miss', label: 'Missed',
  phase: 'teleop', points: 0, group: 'Scoring',
  isMiss: true, pairsWith: 'teleop_score_high', accent: 'rose' }
```

**`select`** — one-of-N final state, e.g. climb level. Give `group: 'TOWER'` (or whatever
your endgame structure is called) if you want the points totalled separately from
everything else in `scoreBreakdown()`.

```ts
{
  kind: 'select',
  id: 'endgame_climb',
  label: 'Final climb',
  phase: 'endgame',
  group: 'TOWER',
  defaultValue: 'none',
  options: [
    { value: 'none',   label: 'None',   points: 0 },
    { value: 'low',    label: 'Low',    points: 10, accent: 'sky' },
    { value: 'high',   label: 'High',   points: 20, accent: 'violet' },
    { value: 'failed', label: 'Failed', points: 0,  accent: 'rose' },
  ],
}
```

**`toggle`** — a yes/no event, e.g. leaving the starting line.

### Windows

Named time slices, measured in seconds from the start of AUTO. Counter taps are bucketed
into these during analysis. If the game has no time-varying mechanic, one window per
phase is fine.

```ts
windows: [
  { id: 'auto',    label: 'AUTO',    startSec: 0,   endSec: 15,  phase: 'auto' },
  { id: 'teleop',  label: 'Teleop',  startSec: 15,  endSec: 130, phase: 'teleop' },
  { id: 'endgame', label: 'END GAME',startSec: 130, endSec: 150, phase: 'endgame' },
]
```

REBUILT splits teleop into four ALLIANCE SHIFTS because HUB ownership alternates; that is
what this field exists for. Windows drive the timer ribbon on the match form and the
"by match window" chart on team pages.

### Key metrics

What shows up on team pages, the event table and the picklist, in order. `compute`
receives that match's action totals, plus two derived keys the app adds:
`__tower_points` and `__total_points`.

```ts
keyMetrics: [
  { id: 'total_score', label: 'Score / match', higherIsBetter: true,
    compute: (t) => t.__total_points ?? 0 },
  { id: 'accuracy', label: 'Accuracy', higherIsBetter: true, format: 'percent',
    compute: (t) => {
      const made = t.teleop_score_high ?? 0
      const missed = t.teleop_score_high_miss ?? 0
      return made + missed === 0 ? 0 : made / (made + missed)
    } },
]
```

### Pit fields and super ratings

`pitFields` supports `text`, `longtext`, `number`, `select`, `multiselect`, `boolean`;
`group` sorts them into cards. `superRatings` are 1–5 scales rendered as one row per
rating, one column per robot.

## 3. Register it

```ts
// src/games/index.ts
import { newgame2027 } from './newgame2027'

export const GAMES = {
  [rebuilt2026.id]: rebuilt2026,
  [newgame2027.id]: newgame2027,
}

export const ACTIVE_GAME_ID = newgame2027.id
```

Old seasons stay registered so last year's data still renders.

## 4. Check it

```bash
npm run typecheck && npm run dev
```

Walk the Match tab through all three phases, save one record, and confirm it appears
under Analysis.

---

## The one hard rule

**Never rename an action `id` once real matches have been scouted with it.** Records
store `actionId` directly, so a rename silently orphans the collected data. Changing a
`label` is always safe; changing an `id` is not.
