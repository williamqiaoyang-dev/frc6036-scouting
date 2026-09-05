# 6036 Scouting

An offline-first FRC scouting system for **Team 6036, Peninsula Robotics**, built in the
spirit of Team 1690 Orbit's scouting app: timeline-based match scouting, comparative
super-scouting, and an analysis layer that turns it into a picklist.

Configured for **2026 REBUILT**, with the game rules isolated in a single pluggable file
so next season is a drop-in, not a rewrite.

### ▶ Live: <https://williamqiaoyang-dev.github.io/frc6036-scouting/>

Open it on any laptop or phone — nothing to install. Add a Blue Alliance key and an
event key in **Settings** and it's ready to scout. All data stays in that browser
until you export it, so anyone can open the link without touching your team's data.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static files in dist/
```

### Configure once, deploy everywhere

`public/config.json` sets the defaults for every device that loads the build:

```json
{
  "team": 6036,
  "teamName": "Peninsula Robotics",
  "tbaApiKey": "",
  "defaultEventKey": "2026casj",
  "gameId": "rebuilt2026",
  "autoSyncOnLaunch": true
}
```

Edit it, redeploy `dist/`, and no scout has to touch Settings. Anything a scout
does change in Settings is per-device and overrides the file.

> **On `tbaApiKey`:** whatever is in this file is served to anyone who can load the
> app. Fill it in only for a deployment you control — a team laptop, a LAN server, a
> private host. For a public URL leave it empty and have scouts paste their own key.
> TBA read keys are read-only and revocable from your TBA account dashboard.

Or configure a single device by hand — open **Settings** and:

1. Paste a **Blue Alliance read API key** (get one at
   [thebluealliance.com/account](https://www.thebluealliance.com/account)).
2. Enter your **event key** (e.g. `2026casj`) and press **Sync**. This caches the team
   list and match schedule so everything works with the wifi off.
3. Set the **scout name**, **device name**, and optionally the assigned alliance/station
   so the match form pre-fills itself.

---

## How the pieces fit together

```
  Scout devices (laptops, phones)          Strategy laptop
  ┌───────────────────────────┐            ┌────────────────────────┐
  │  Match / Pit / Super      │            │  Analysis  · Picklist  │
  │           ↓               │            │           ↑            │
  │      IndexedDB            │  QR / file │      IndexedDB         │
  │   (survives refresh,      │ ─────────► │   (merged by record    │
  │    crashes, dead wifi)    │            │    id, newest wins)    │
  └───────────────────────────┘            └────────────────────────┘
                    ▲                                   ▲
                    └────── The Blue Alliance ──────────┘
                          (schedule + team list, cached)
```

Nothing depends on a live network at the venue. Scouts collect offline; data moves to the
strategy laptop by QR code or a JSON file; analysis reads whatever has been merged in.

---

## The modules

| Screen | What it's for |
|---|---|
| **Match** | Per-robot quantitative scouting. Counters, match clock, endgame state, notes. |
| **Pit** | Pre-event robot survey with photos, plus a "who's left to scout" tracker. |
| **Super** | One scout rates all three robots on an alliance side by side. |
| **Analysis** | Sortable event table over the full roster, per-team pages, percentile colouring. |
| **Review** | TBA match footage beside what your scouts recorded, for auditing data quality. |
| **Compare** | Up to six robots head to head, for alliance selection and match strategy. |
| **Picklist** | Drag-to-order list with tiers and notes. Saves as you type. |
| **Data** | QR and file transfer in both directions, plus CSV export. |
| **Settings** | Identity, TBA key, event sync, season selection. |

---

## What comes from The Blue Alliance

Syncing an event caches far more than the schedule:

| Pulled | Used for |
|---|---|
| Team list | The full-roster analysis and coverage tracking below |
| Match schedule | Auto-filling the team number on the match form from your station |
| Match results + RP | The Review tab's official score, beside your scouts' numbers |
| **Match videos** | Embedded footage on team pages and the Review tab |
| Rankings + record | Rank, W-L-T and ranking score on every team page |
| OPR | A second opinion on scoring output, independent of your scouts |

All of it is cached to IndexedDB, so it stays readable with the wifi off. With
`autoSyncOnLaunch`, the app refreshes it once on launch whenever there's a network —
new results and newly posted videos arrive without anyone remembering to sync.

### Match video

TBA exposes match footage as `videos: [{ key, type: "youtube" }]`. The app embeds it
two places:

- **Team pages** — the most recent matches that have footage, for a quick look at how
  a robot actually plays.
- **Review tab** — one match at a time, with the official result and your scouts'
  per-robot numbers directly beneath it.

Videos are **click-to-play**: only a thumbnail loads until you press play, because a
page listing a dozen matches should not open a dozen YouTube players on venue wifi.
Non-YouTube media links out to TBA rather than embedding.

### Auditing your scouts

The Review tab sums your scouts' per-robot estimates per alliance and shows them
against the official score:

```
RED    scouted 83  vs  official 23
BLUE   scouted 88  vs  official 78
```

These never match exactly — FUEL scores only in an active HUB, and fouls aren't
scouted — but a large, one-sided gap is usually a miscount. Catching that mid-event is
much cheaper than discovering it while building the picklist.

## The full roster, not just what's been scouted

Once an event is synced, the analysis covers **every team registered at it**, not only
the ones someone has already scouted. Un-scouted teams appear dimmed, marked *not
scouted*, and always sort last — so the event table doubles as a coverage report, and
the **Analysis** header shows how much of the roster you have:

```
All 45   Scouted 32   No data 13          ████████░░  71% covered
```

Two rules keep that honest:

- **A team with no data shows `—`, never `0.0`.** A zero would read as "this robot scores
  nothing", which is a different claim from "nobody has watched it yet". This applies on
  the event table, team pages, the picklist and Compare.
- **Percentiles are computed over scouted teams only**, so empty rows never distort the
  colour ramp or make a mediocre robot look good by comparison.

Un-scouted teams are still fully pickable — you draft robots you watched from the stands
too, and the picklist should not stop you.

## Two design decisions worth knowing

### 1. Every tap is timestamped

A counter press is not stored as a running total. It is stored as an event:

```ts
{ actionId: 'teleop_fuel_scored', t: 47.3, delta: 1 }
```

This matters in REBUILT specifically. The HUB alternates active/inactive across four
25-second **ALLIANCE SHIFTS**, and asking a scout to track which shift is live while also
counting FUEL is how you get bad data. Instead the scout just taps, and the analysis
buckets those taps into shifts afterwards.

The payoff is that **new questions can be asked of old data**. "Does this robot keep
cycling when its HUB is inactive?" is answerable from matches scouted before anyone
thought to ask, because the timeline was always there.

See `src/lib/stats.ts` → `totalsByWindow()`.

### 2. Estimated points are an upper bound

FUEL scores 1 point only in an *active* HUB, and which alliance owns which shift is
decided by AUTO performance — information the app does not receive from the FMS. So
"Est. points" assumes every FUEL counted. It is labelled *est.* throughout and is useful
for ranking robots against each other, not for reconstructing an official score.

---

## Adding next season

The game is one file. Nothing else in the app hardcodes game rules — the match form, pit
survey, super sheet and every chart are generated from it.

1. Copy `src/games/rebuilt2026.ts` to `src/games/<newgame><year>.ts`.
2. Edit the `actions`, `windows`, `rankingPoints`, `pitFields`, `superRatings` and
   `keyMetrics`.
3. Register it in `src/games/index.ts` and point `ACTIVE_GAME_ID` at it.

The schema, with every field documented, is in `src/games/types.ts`.

**One rule:** never rename an `id` once an event has been scouted. Stored records
reference action ids directly, so a rename orphans collected data.

---

## Data transfer

The **Data** tab moves records between devices.

- **QR** — the scout's screen cycles through a set of codes; the strategy laptop scans
  them with its camera. Chunks may arrive in any order. A full 48-match event compresses
  from ~154 KB of JSON to about 10 codes, via tuple-encoded event logs plus gzip.
- **File** — a `.json` bundle over USB or AirDrop, for bulk moves.
- **CSV** — one row per robot-match with every action flattened into a column, for
  anyone who would rather work in a spreadsheet.

Imports merge by record id and keep whichever copy was edited most recently, so
re-importing the same file is safe and two scouts covering the same robot will not
produce duplicates.

---

## Project layout

```
src/
├── games/            # Pluggable season definitions — the only place game rules live
│   ├── types.ts      #   The schema, fully commented
│   ├── rebuilt2026.ts#   2026 REBUILT
│   └── index.ts      #   Registry + active season
├── lib/              # Core, no UI
│   ├── config.ts     #   Loads public/config.json at boot
│   ├── schema.ts     #   Stored record shapes and id builders
│   ├── db.ts         #   IndexedDB (Dexie) + merge logic
│   ├── tba.ts        #   The Blue Alliance API + offline cache
│   ├── stats.ts      #   Aggregation, window bucketing, percentiles
│   ├── transfer.ts   #   QR chunking, compression, CSV
│   └── settings.ts   #   Per-device settings (localStorage)
├── components/       # Shared UI primitives
├── features/         # One folder per screen
│   ├── match/  pit/  super/
│   ├── analysis/  picklist/
│   ├── video/        #   Match footage + the Review screen
│   ├── data/  settings/
└── styles/
```

---

## Notes for running an event

- **Set a distinct device name per tablet/laptop.** It is stamped on exports and is how
  you work out which device still holds untransferred data.
- **Keyboard shortcuts.** On a laptop, number keys `1`–`9` hit the counters in the order
  they appear, and `Cmd/Ctrl+Z` undoes the last tap.
- **The clock is the data.** Press *Start match* when the match actually starts. If it
  drifts, tap counts stay correct but shift attribution degrades.
- **Transfer between matches, not at the end of the day.** "Not transferred" on the Data
  tab tells you what is still only on that device.
