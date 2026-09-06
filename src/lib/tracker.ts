import type { Detection } from './vision'

/**
 * Multi-object tracking, shared by every detector and by the robot lock.
 *
 * Finding a ball in one frame is a colour problem. Deciding that the ball in
 * this frame is the *same* ball as the one in the last frame is a different
 * problem, and it is the one that decides whether a shot is counted once,
 * twice, or not at all. Three things here that the naive version got wrong:
 *
 *   Prediction   — a ball in flight moves tens of pixels between frames. If
 *                  you look for it where it *was*, you need a search radius
 *                  so wide that it also finds the next ball along. Looking
 *                  where it is *going* lets the gate be tight and the
 *                  association stay right.
 *   Competition  — walking the tracks in order and letting each grab its
 *                  nearest detection means the first track wins a detection
 *                  that belonged to the second. Every pair is scored, then
 *                  the best pairs are taken first, whichever track they
 *                  belong to.
 *   Confirmation — a single frame of colour noise used to become a track,
 *                  and a track is all a rule needs to fire. A track must now
 *                  be seen more than once before anything is allowed to
 *                  believe in it.
 *
 * Coasting matters as much as any of it: a ball crossing in front of a
 * bright light disappears for two or three frames, and a track that dies
 * there splits one shot into two.
 */

export interface TrackPoint {
  /** Normalised position, so a path stays meaningful across resolutions. */
  x: number
  y: number
  /** Video-time milliseconds. */
  at: number
}

export interface Track {
  id: number
  /** Current position in processing pixels — measured, or coasted. */
  x: number
  y: number
  /** Pixels per frame. */
  vx: number
  vy: number
  radius: number
  /** Where and when the track began, in processing pixels and video ms. */
  originX: number
  originY: number
  originAt: number
  /** Where it was when it last moved appreciably, and when. */
  restX: number
  restY: number
  restSince: number
  /** Consecutive frames unmatched. */
  missed: number
  /** Frames actually matched to a detection. */
  hits: number
  age: number
  /** Seen enough times to be believed. */
  confirmed: boolean
  /** Smoothed detection score, 0-1. */
  score: number
  /** Normalised path, capped, for attribution and drawing. */
  path: TrackPoint[]
  /** Free-form per-rule state, owned by whoever created the tracker. */
  inZone: boolean
  everInZone: boolean
  inZoneSince: number
  counted: boolean
}

export interface TrackerOptions {
  /** Frames a track must be seen before rules may act on it. */
  minHits: number
  /** Frames unmatched before a track is considered gone. */
  maxMissed: number
  /** Movement below this counts as standing still, in pixels. */
  stillPx: number
  /** Longest path retained, in samples. */
  pathLimit: number
}

const DEFAULTS: TrackerOptions = {
  minHits: 2, maxMissed: 6, stillPx: 6, pathLimit: 240,
}

export class Tracker {
  private items: Track[] = []
  private nextId = 1
  private opts: TrackerOptions

  constructor(options: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULTS, ...options }
  }

  configure(options: Partial<TrackerOptions>) {
    this.opts = { ...this.opts, ...options }
  }

  get tracks(): Track[] { return this.items }
  /** Only the tracks anything is allowed to act on. */
  get confirmed(): Track[] { return this.items.filter((t) => t.confirmed) }

  reset() { this.items = []; this.nextId = 1 }

  /**
   * Advance one frame. `w`/`h` are the processing canvas size, used to keep
   * the retained path in normalised coordinates.
   */
  update(detections: Detection[], w: number, h: number, atMs: number): Track[] {
    const { minHits, maxMissed, stillPx, pathLimit } = this.opts

    // ---- 1. score every plausible pairing --------------------------------
    // Distance is measured from where the track is *predicted* to be, so a
    // fast ball is looked for along its flight rather than behind it.
    const pairs: { t: number; d: number; cost: number }[] = []
    this.items.forEach((track, ti) => {
      const px = track.x + track.vx
      const py = track.y + track.vy
      const speed = Math.hypot(track.vx, track.vy)
      // The gate grows with speed and with how long the track has been
      // unseen, because a coasted prediction drifts.
      const gate = Math.max(14, track.radius * 3) + speed * 0.8 + track.missed * speed * 0.5

      detections.forEach((det, di) => {
        const dist = Math.hypot(det.x - px, det.y - py)
        if (dist > gate) return
        // A ball does not change size between frames; something that does is
        // a different object that happens to be nearby.
        const sizeGap = Math.abs(det.radius - track.radius)
          / Math.max(2, Math.max(det.radius, track.radius))
        pairs.push({ t: ti, d: di, cost: dist / gate + sizeGap * 0.6 })
      })
    })

    // ---- 2. take the best pairings first ---------------------------------
    pairs.sort((a, b) => a.cost - b.cost)
    const takenTrack = new Set<number>()
    const takenDet = new Set<number>()
    for (const p of pairs) {
      if (takenTrack.has(p.t) || takenDet.has(p.d)) continue
      takenTrack.add(p.t)
      takenDet.add(p.d)
      this.absorb(this.items[p.t], detections[p.d], w, h, atMs, stillPx, pathLimit, minHits)
    }

    // ---- 3. coast the rest ------------------------------------------------
    // An unmatched track keeps moving on its last known velocity, decayed.
    // Two or three frames of that reunites a ball that passed behind a light
    // with its own track instead of starting a second one.
    this.items.forEach((track, ti) => {
      if (takenTrack.has(ti)) return
      track.missed++
      track.age++
      track.x += track.vx
      track.y += track.vy
      track.vx *= 0.85
      track.vy *= 0.85
    })

    // ---- 4. start tracks for what is left ---------------------------------
    const started: Track[] = []
    detections.forEach((det, di) => {
      if (takenDet.has(di)) return
      const track: Track = {
        id: this.nextId++,
        x: det.x, y: det.y, vx: 0, vy: 0, radius: det.radius,
        originX: det.x, originY: det.y, originAt: atMs,
        restX: det.x, restY: det.y, restSince: atMs,
        missed: 0, hits: 1, age: 1,
        confirmed: minHits <= 1,
        score: det.score,
        path: [{ x: det.x / w, y: det.y / h, at: atMs }],
        inZone: false, everInZone: false, inZoneSince: 0, counted: false,
      }
      this.items.push(track)
      started.push(track)
    })

    // ---- 5. retire ---------------------------------------------------------
    // An unconfirmed track is dropped the moment it is missed: it was one
    // frame of noise and keeping it alive only invites a false association.
    this.items = this.items.filter((t) =>
      t.confirmed ? t.missed <= maxMissed * 2 : t.missed === 0)

    return started
  }

  private absorb(
    track: Track, det: Detection, w: number, h: number, atMs: number,
    stillPx: number, pathLimit: number, minHits: number,
  ) {
    const dx = det.x - track.x
    const dy = det.y - track.y
    // Velocity is smoothed: a single noisy centroid should nudge the
    // prediction, not throw it across the frame.
    const blend = track.hits < 3 ? 0.6 : 0.4
    track.vx = track.vx * (1 - blend) + dx * blend
    track.vy = track.vy * (1 - blend) + dy * blend

    if (Math.hypot(det.x - track.restX, det.y - track.restY) > stillPx) {
      track.restX = det.x; track.restY = det.y; track.restSince = atMs
    }

    track.x = det.x
    track.y = det.y
    // Radius is smoothed too: a partially occluded ball measures small for a
    // frame, and letting that through would break the size gate next frame.
    track.radius = track.radius * 0.7 + det.radius * 0.3
    track.score = track.score * 0.7 + det.score * 0.3
    track.missed = 0
    track.hits++
    track.age++
    if (track.hits >= minHits) track.confirmed = true

    track.path.push({ x: det.x / w, y: det.y / h, at: atMs })
    if (track.path.length > pathLimit) track.path.shift()
  }
}

/** Speed in pixels per frame. */
export function speedOf(t: Track): number {
  return Math.hypot(t.vx, t.vy)
}

/**
 * How directly a track is heading at a point, -1 to 1.
 *
 * This is what separates a shot from a ball that merely happened to be near
 * the goal: a shot is *aimed*. A ball rolling past the hub scores near
 * zero here however close it gets.
 */
export function headingTowards(t: Track, tx: number, ty: number): number {
  const speed = Math.hypot(t.vx, t.vy)
  if (speed < 0.3) return 0
  const dx = tx - t.x, dy = ty - t.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-6) return 1
  return (t.vx * dx + t.vy * dy) / (speed * dist)
}

/** Where a track was at a given moment, from its retained path. */
export function positionAt(
  t: Track, atMs: number, toleranceMs = 500,
): TrackPoint | null {
  let best: TrackPoint | null = null
  let bestGap = Infinity
  for (const p of t.path) {
    const gap = Math.abs(p.at - atMs)
    if (gap < bestGap) { bestGap = gap; best = p }
  }
  return best && bestGap <= toleranceMs ? best : null
}
