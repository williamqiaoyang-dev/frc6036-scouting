import { pointInZone, type Detection, type VisionConfig } from './vision'

/**
 * Turns per-frame detections into scoring events.
 *
 * Detecting a ball is easy; deciding that a ball *scored* is the whole
 * problem. The rules below are what separate a shot going in from a ball
 * sitting on the carpet:
 *
 *   Static mode  — a ball is inside the scoring zone this frame, and no ball
 *                  was counted at that spot recently. Suits a camera locked
 *                  on the goal, where anything reaching the zone has scored.
 *
 *   Dynamic mode — a ball is tracked across frames, and only counts when its
 *                  track *ends inside the zone* after travelling far enough
 *                  to be a shot rather than a wobble. A ball that enters the
 *                  frame, rolls, and stays visible never counts, because its
 *                  track never terminates in the goal.
 *
 * Dynamic is the honest one for a handheld phone in the stands. Static is
 * steadier when the camera is on a tripod pointed at the hub.
 */

export type VisionMode = 'manual' | 'static' | 'dynamic'

export interface Track {
  id: number
  x: number
  y: number
  radius: number
  /** Where the track was first seen, for travel distance. */
  originX: number
  originY: number
  /** Frames since this track was last matched to a detection. */
  missed: number
  /** Was this track ever inside the zone? */
  everInZone: boolean
  /** Has this track already produced a count? */
  counted: boolean
  age: number
}

export interface ScoreEvent {
  /** Epoch ms the count was registered. */
  at: number
  /** Where it happened, normalised. */
  x: number
  y: number
  mode: VisionMode
  /** Confidence carried from the detection that triggered it. */
  confidence: number
}

export class BallTracker {
  private tracks: Track[] = []
  private nextId = 1
  private lastCountAt = -Infinity
  /** Recent count positions, to suppress double-counting the same ball. */
  private recent: { x: number; y: number; at: number }[] = []

  constructor(private mode: VisionMode, private cfg: VisionConfig) {}

  setMode(mode: VisionMode) { this.mode = mode }
  setConfig(cfg: VisionConfig) { this.cfg = cfg }
  get activeTracks(): Track[] { return this.tracks }

  reset() {
    this.tracks = []
    this.recent = []
    this.lastCountAt = -Infinity
  }

  /**
   * Advance one frame. Returns any scoring events this frame produced.
   * `width`/`height` are the processing canvas size, for normalisation.
   */
  update(
    detections: Detection[],
    width: number,
    height: number,
    now = Date.now(),
  ): ScoreEvent[] {
    const events: ScoreEvent[] = []
    const norm = (d: Detection) => ({ nx: d.x / width, ny: d.y / height })

    // ---- associate detections with existing tracks, nearest-first --------
    const unmatched = new Set(detections.map((_, i) => i))
    for (const track of this.tracks) {
      let best = -1
      let bestDist = Infinity
      // A ball cannot jump further than a few radii between frames.
      const gate = Math.max(40, track.radius * 4)

      detections.forEach((d, i) => {
        if (!unmatched.has(i)) return
        const dist = Math.hypot(d.x - track.x, d.y - track.y)
        if (dist < bestDist && dist <= gate) { bestDist = dist; best = i }
      })

      if (best >= 0) {
        const d = detections[best]
        unmatched.delete(best)
        track.x = d.x; track.y = d.y; track.radius = d.radius
        track.missed = 0
        track.age++
        const { nx, ny } = norm(d)
        if (pointInZone(nx, ny, this.cfg.zone)) track.everInZone = true
      } else {
        track.missed++
      }
    }

    // ---- start tracks for anything left over ----------------------------
    for (const i of unmatched) {
      const d = detections[i]
      const { nx, ny } = norm(d)
      this.tracks.push({
        id: this.nextId++,
        x: d.x, y: d.y, radius: d.radius,
        originX: d.x, originY: d.y,
        missed: 0, age: 1,
        everInZone: pointInZone(nx, ny, this.cfg.zone),
        counted: false,
      })
    }

    // ---- count --------------------------------------------------------
    if (this.mode === 'static') {
      // Count the moment a ball enters the zone — not every frame it stays
      // there, or a ball that comes to rest in the goal would score forever.
      for (const t of this.tracks) {
        if (t.counted || !t.everInZone) continue
        const nx = t.x / width, ny = t.y / height
        if (!pointInZone(nx, ny, this.cfg.zone)) continue
        if (this.suppressed(nx, ny, now)) continue
        t.counted = true
        this.registerCount(nx, ny, now)
        events.push({ at: now, x: nx, y: ny, mode: 'static', confidence: 1 })
      }
    } else if (this.mode === 'dynamic') {
      // A shot is a track that reached the zone and then disappeared into it.
      for (const t of this.tracks) {
        if (t.counted || !t.everInZone) continue
        if (t.missed < this.cfg.maxMissedFrames) continue

        const travelled = Math.hypot(t.x - t.originX, t.y - t.originY)
        if (travelled < this.cfg.minTravelPx) continue

        const nx = t.x / width, ny = t.y / height
        if (!pointInZone(nx, ny, this.cfg.zone)) continue
        if (this.suppressed(nx, ny, now)) continue

        t.counted = true
        this.registerCount(nx, ny, now)
        events.push({ at: now, x: nx, y: ny, mode: 'dynamic', confidence: 1 })
      }
    }

    // ---- retire dead tracks ---------------------------------------------
    this.tracks = this.tracks.filter((t) => t.missed <= this.cfg.maxMissedFrames * 2)
    this.recent = this.recent.filter((r) => now - r.at < 1500)

    return events
  }

  /** True when this position was already counted a moment ago. */
  private suppressed(nx: number, ny: number, now: number): boolean {
    if (now - this.lastCountAt < this.cfg.cooldownMs) return true
    return this.recent.some((r) =>
      now - r.at < this.cfg.cooldownMs * 3 && Math.hypot(r.x - nx, r.y - ny) < 0.08)
  }

  private registerCount(nx: number, ny: number, now: number) {
    this.lastCountAt = now
    this.recent.push({ x: nx, y: ny, at: now })
  }
}
