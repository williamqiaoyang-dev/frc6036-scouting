# Data model

## Records

Four record types, all in `src/lib/schema.ts`.

### `MatchRecord`

One per robot per match — a six-robot match produces six records.

The important field is `events`: an array of `{ actionId, t, delta }`, one entry per tap.
`t` is seconds since the scout pressed *Start match*; `delta` is `+1` for a tap and `-1`
for an undo. Counts are derived by summing deltas, never stored directly.

`states` holds the final value of every select and toggle, keyed by action id.

### `PitRecord`

One per team per event. `fields` is keyed by pit field id; `photos` are downscaled JPEG
data URLs (max 1000px, quality 0.7 — a raw phone photo would break both IndexedDB
quotas and QR transfer).

### `SuperRecord`

One per alliance per match. `ratings` is `teamNumber → { ratingId: 1-5 }`.

### `Picklist`

One per event. An ordered array of `{ teamNumber, rank, tier, note }`.

## Ids are deterministic

```ts
matchId('2026casj', 'qm', 14, 6036)  // '2026casj_qm14_6036'
pitId('2026casj', 6036)              // '2026casj_pit_6036'
superId('2026casj', 'qm', 14, 'red') // '2026casj_qm14_red'
```

This is what makes re-scouting and merging safe. Two scouts covering the same robot
produce the same id, so a merge resolves to one record — whichever was edited last —
rather than a duplicate.

## Merging

`mergeRecords()` compares `updatedAt` per record and keeps the newer copy. Importing the
same bundle twice is a no-op. Records carry a `synced` flag, set when they are included
in an export that is marked transferred; it drives the "Not transferred" count.

## Derived values

Nothing computed is stored. `src/lib/stats.ts` derives everything on read:

- `actionTotals()` — net count per action for one match
- `totalsByWindow()` — the same, bucketed into the game's time windows
- `scoreBreakdown()` — points, with tower/climb points separated out
- `summarizeTeam()` / `summarizeEvent()` — mean, median, max, stdev and per-match series
- `percentile()` — a team's rank against the field, driving the colour ramps

Because these run over the raw event log, changing how a metric is calculated
re-analyses every match already collected. No migration, no re-scouting.

## Schema versioning

Every record carries `schemaVersion` (currently `1`). If a future change breaks
compatibility, bump `SCHEMA_VERSION` and branch on it at read time in `stats.ts` rather
than migrating in place — old exports on old devices should stay readable.
