import {
  detectBlobs, pointInZone, zoneCentre,
  type Appearance, type Detection,
} from './vision'
import { Tracker, headingTowards, speedOf, type Track } from './tracker'
import type { Phase } from '@/games/types'

/**
 * Turning pictures into scouting data.
 *
 * `vision.ts` answers "what coloured shapes are in this frame". That is not
 * scouting. Scouting is "6059 scored", "6059 left the starting zone", "6059
 * stopped moving" — statements about a robot, tied to a field the form
 * already has. A detector is the bridge: an appearance to look for, an area
 * to look in, a rule for what a sighting *means*, and the form field it
 * feeds.
 *
 * The rules are deliberately few and blunt. Each one is a sentence a scout
 * would recognise:
 *
 *   enter      the thing arrived in this area          (a ball reached the hub)
 *   exit       the thing left this area                (a robot left its start zone)
 *   vanish-in  the thing arrived and disappeared       (a ball went in)
 *   dwell      the thing stayed here a while           (a robot camped on defense)
 *   still      the thing stopped moving                (a robot died)
 *
 * What this cannot do on its own is say *which* robot: nothing here reads a
 * bumper number. `robotLock.ts` answers that geometrically — the scout
 * points at one robot and a shot leaving it is credited to it — and every
 * event below carries where and when its track began so that credit can be
 * worked out after the fact.
 *
 * One thing changed here that matters more than the rules: a detector with
 * no area drawn now still *looks*, and reports what it sees, even though it
 * can never fire. The old version returned early, so a scout tuning colour
 * against a real frame saw a blank overlay and no way to tell a wrong hue
 * from a wrong area. Seeing is free; firing is what needs the guard rails.
 */

export type DetectorRule = 'enter' | 'exit' | 'vanish-in' | 'dwell' | 'still'

/** How much to trust a rule. Shown in the UI; low ones ship disabled. */
export type Confidence = 'high' | 'medium' | 'low'

/** Where a detector's output goes on the scouting form. */
export type DetectorTarget =
  /** Increment a counter — which one depends on the phase. */
  | { kind: 'counter'; byPhase: Partial<Record<Phase, string>> }
  /** Set a select or toggle to a fixed value. */
  | { kind: 'state'; id: string; value: string | boolean }
  /** Set a record-level flag. */
  | { kind: 'flag'; id: 'died' }

export interface Detector {
  /** Stable key. Stored in settings — never rename after an event. */
  id: string
  label: string
  /** One line, in the scout's language, about what this watches for. */
  hint: string
  enabled: boolean
  target: DetectorTarget
  appearance: Appearance
  /** Normalised polygon. Empty means the detector cannot fire. */
  zone: { x: number; y: number }[]
  /**
   * Areas to pretend are empty. Anything found inside one is discarded
   * before it is ever tracked.
   *
   * A camera in the stands sees the far hopper, the far alliance's field and
   * the crowd, and a game piece is the same colour wherever it is. Colour and
   * shape cannot tell those apart from a live ball, because there is nothing
   * to tell apart — they are the same object somewhere irrelevant. Where to
   * look is the scout's knowledge, not the detector's.
   */
  ignore?: { x: number; y: number }[][]
  /**
   * Seconds a thing may sit motionless before it is treated as scenery and
   * stops being able to fire anything. 0 switches it off.
   *
   * A ball resting in a rack at the back of the field never moves. A ball
   * that was shot is only ever in view while moving. That difference costs
   * nothing to measure and removes almost all of the background at once.
   */
  scenerySec?: number
  rule: DetectorRule
  /** Units added per event. FUEL is seen one ball at a time, so 1. */
  step: number
  /** Seconds the thing must stay put, for `dwell` and `still`. */
  dwellSec: number
  /** Pixels of movement below which `still` considers it stopped. */
  stillPx: number
  /** Minimum ms between two events from this detector. */
  cooldownMs: number
  /** Frames unseen before a track is considered gone. */
  maxMissedFrames: number
  /** `vanish-in`: how far the thing must have travelled to count. */
  minTravelPx: number
  confidence: Confidence

  /**
   * Frames a thing must be seen before it may fire anything. Optional so a
   * saved setup keeps loading; 2 is enough to kill single-frame colour noise.
   */
  minHits?: number
  /**
   * `vanish-in`: how directly the thing must have been travelling at the
   * area, -1 to 1. A shot is aimed; a ball rolling past the hub is not.
   * 0 accepts anything approaching at all, which is the safe default.
   */
  minApproach?: number
  /** Minimum pixels per frame, to ignore things that are not going anywhere. */
  minSpeedPx?: number
}

/** Where a moving thing stopped being visible, and when. */
export interface VanishPoint {
  x: number
  y: number
  /** Seconds into the video. */
  at: number
}

export interface DetectorEvent {
  detectorId: string
  /**
   * The rule that fired. Carried because crediting an event to a robot means
   * something different depending on it: for a ball rule the question is
   * "did this ball leave that robot", for a robot rule it is "is this thing
   * that robot".
   */
  rule: DetectorRule
  /** Seconds into the match or video. */
  t: number
  /** Normalised position where it fired. */
  x: number
  y: number
  /**
   * Where and when this thing's track *began*, normalised and in seconds.
   * For a shot, that is roughly where it left the shooter — which is what
   * credits it to a robot.
   */
  originX: number
  originY: number
  originT: number
  /** 0-1: how sure the detector is, from colour fit, shape and track age. */
  confidence: number
  /** The track that produced it, for de-duplicating a re-scan. */
  trackId: number
}

/**
 * One detector's state across frames. Finds blobs, tracks them, applies the
 * rule.
 */
class DetectorState {
  private tracker = new Tracker()
  private lastFiredAt = -Infinity

  constructor(public detector: Detector) {}

  latest: Detection[] = []
  /** Confirmed tracks, exposed so the overlay can draw flight paths. */
  paths: Track[] = []
  /** Where moving things stopped being visible. Feeds the goal finder. */
  vanished: VanishPoint[] = []
  /** Positions currently judged to be scenery, for the overlay. */
  sceneryAt: { x: number; y: number; radius: number }[] = []

  reset() {
    this.tracker.reset()
    this.lastFiredAt = -Infinity
    this.latest = []
    this.paths = []
    this.sceneryAt = []
  }

  /** Kept across a reset, since a scan is how the evidence is gathered. */
  clearVanished() { this.vanished = [] }

  /**
   * Look at a frame without believing anything about it.
   *
   * Scrubbing a video, sampling a colour or aiming at a robot all need the
   * detector to report what it can see in the frame on screen. Running the
   * full update for that would advance every track and fire real rules, so
   * dragging the scrub bar would manufacture shots that never happened.
   */
  observe(frame: ImageData, w: number, h: number) {
    const d = this.detector
    if (!d.enabled) { this.latest = []; return }
    const found = detectBlobs(frame, d.appearance)
    this.latest = d.ignore?.length
      ? found.filter((det) => !inAnyZone(det.x / w, det.y / h, d.ignore!))
      : found
  }

  update(frame: ImageData, w: number, h: number, atMs: number): DetectorEvent[] {
    const d = this.detector
    if (!d.enabled) { this.latest = []; this.paths = []; return [] }

    let found = detectBlobs(frame, d.appearance)

    // Discard anything in an area the scout has marked as not part of the
    // game, before it can become a track or a count.
    if (d.ignore?.length) {
      found = found.filter((det) => !inAnyZone(det.x / w, det.y / h, d.ignore!))
    }
    this.latest = found

    this.tracker.configure({
      minHits: d.minHits ?? 2,
      maxMissed: d.maxMissedFrames,
      stillPx: d.stillPx,
    })
    this.tracker.update(found, w, h, atMs)

    // Mark what has stopped being part of the game. A thing that moved and
    // then parked — a ball that rolled to a stop against the wall — becomes
    // furniture once it has held still for `scenerySec`.
    const settleMs = (d.scenerySec ?? 0) * 1000
    if (settleMs > 0) {
      for (const t of this.tracker.tracks) {
        if (!t.scenery && atMs - t.restSince >= settleMs) t.scenery = true
      }
    }
    this.paths = this.tracker.confirmed

    // Where confirmed, moving tracks ended. Harvested whether or not this
    // detector has an area, because it is what proposes one.
    for (const dead of this.tracker.retired) {
      if (dead.scenery) continue
      const travelled = Math.hypot(dead.x - dead.originX, dead.y - dead.originY)
      if (travelled < d.minTravelPx) continue
      const seen = dead.path[dead.path.length - 1]
      if (!seen) continue
      this.vanished.push({ x: seen.x, y: seen.y, at: seen.at / 1000 })
      if (this.vanished.length > 4000) this.vanished.shift()
    }

    /** Detections belonging to a scenery track, so the overlay can dim them. */
    this.sceneryAt = this.tracker.tracks
      .filter((t) => t.scenery && t.missed === 0)
      .map((t) => ({ x: t.x, y: t.y, radius: t.radius }))

    // A detector with no area drawn watches, and shows what it watches, but
    // can never fire. That is the whole point of the area.
    const armed = d.zone.length >= 3
    if (!armed) return []

    const centre = zoneCentre(d.zone)
    const events: DetectorEvent[] = []

    // ---- keep each track's zone bookkeeping up to date -------------------
    for (const t of this.tracker.tracks) {
      const nowIn = t.missed === 0 && !t.scenery && pointInZone(t.x / w, t.y / h, d.zone)
      if (nowIn && !t.inZone) t.inZoneSince = atMs
      t.inZone = nowIn
      if (nowIn) t.everInZone = true
    }

    // ---- apply the rule --------------------------------------------------
    const hold = (d.scenerySec ?? 0) * 1000
    for (const t of this.tracker.confirmed) {
      if (t.counted || t.scenery) continue
      // With scenery suppression on, a thing must have actually gone
      // somewhere before it may fire. Waiting for the hold to expire would
      // be too late — `enter` fires within two frames of a track appearing,
      // and a ball resting in a rack looks identical to one arriving until
      // it fails to move. Requiring movement decides it immediately, and
      // costs a real shot nothing: a shot is moving by definition.
      if (hold > 0 && Math.hypot(t.x - t.originX, t.y - t.originY) <= d.stillPx) continue
      // A cooldown suppresses *this* track's turn, not the rest of the list:
      // breaking out here used to throw away a second, genuine event that
      // happened to land in another track during the quiet window.
      if (atMs - this.lastFiredAt < d.cooldownMs) continue

      let fires = false
      switch (d.rule) {
        case 'enter':
          fires = t.inZone
          break
        case 'exit':
          // Left the area it started in, and is now demonstrably outside.
          fires = t.everInZone && !t.inZone && t.missed === 0 && t.age > 1
          break
        case 'vanish-in':
          fires = this.wentIn(t, w, h, centre)
          break
        case 'dwell':
          // `inZone` is the guard, not a non-zero timestamp: a track that
          // starts inside the area at t=0 has a legitimate `inZoneSince` of
          // 0, and testing for truthiness would silently never fire it.
          fires = t.inZone && atMs - t.inZoneSince >= d.dwellSec * 1000
          break
        case 'still':
          fires = t.missed === 0 && t.everInZone
            && atMs - t.restSince >= d.dwellSec * 1000
          break
      }

      if (!fires) continue
      t.counted = true
      this.lastFiredAt = atMs
      events.push({
        detectorId: d.id,
        rule: d.rule,
        t: atMs / 1000,
        x: t.x / w, y: t.y / h,
        originX: t.originX / w, originY: t.originY / h,
        originT: t.originAt / 1000,
        confidence: confidenceOf(t),
        trackId: t.id,
      })
    }

    return events
  }

  /**
   * Did this track go *into* the area, rather than merely end near it?
   *
   * A ball that scores stops being visible, in the goal, having been
   * travelling at it. Requiring all three is what separates a shot from a
   * ball that rolled behind the hub, and from one the camera simply lost.
   */
  private wentIn(
    t: Track, w: number, h: number, centre: { x: number; y: number },
  ): boolean {
    const d = this.detector
    if (!t.everInZone) return false
    if (t.missed < d.maxMissedFrames) return false

    const travelled = Math.hypot(t.x - t.originX, t.y - t.originY)
    if (travelled < d.minTravelPx) return false

    const minSpeed = d.minSpeedPx ?? 0
    if (minSpeed > 0 && speedOf(t) < minSpeed) return false

    // Where it was last actually seen, rather than where coasting has since
    // carried it — a coasted position drifts straight out of the goal.
    const seen = t.path[t.path.length - 1]
    const lastIn = seen ? pointInZone(seen.x, seen.y, d.zone) : false
    const headed = headingTowards(t, centre.x * w, centre.y * h)

    // In the goal when last seen is the strong case. Lost just short of it
    // while flying straight at it is the honest second case — that is what a
    // ball disappearing into a dark opening looks like.
    return lastIn || headed >= Math.max(0.55, d.minApproach ?? 0.55)
  }
}

/** True when the point falls inside any of the polygons. */
function inAnyZone(nx: number, ny: number, zones: { x: number; y: number }[][]): boolean {
  for (const z of zones) if (pointInZone(nx, ny, z)) return true
  return false
}

/** 0-1, from how well the thing matched and how long it was followed. */
function confidenceOf(t: Track): number {
  const seen = Math.min(1, t.hits / 8)
  return Math.max(0, Math.min(1, t.score * 0.65 + seen * 0.35))
}

/** Runs every enabled detector over the same frame. */
export class DetectorEngine {
  private states: DetectorState[] = []

  constructor(detectors: Detector[]) {
    this.setDetectors(detectors)
  }

  setDetectors(detectors: Detector[]) {
    const existing = new Map(this.states.map((s) => [s.detector.id, s]))
    this.states = detectors.map((d) => {
      const prev = existing.get(d.id)
      if (prev) { prev.detector = d; return prev }
      return new DetectorState(d)
    })
  }

  reset() { for (const s of this.states) s.reset() }

  /** Throw away the harvested endings as well as the tracking state. */
  resetAll() { for (const s of this.states) { s.reset(); s.clearVanished() } }

  /** Where this detector's moving things stopped being visible. */
  vanished(detectorId: string): VanishPoint[] {
    return this.states.find((s) => s.detector.id === detectorId)?.vanished ?? []
  }

  /** Positions currently judged to be scenery, per detector. */
  scenery(): { detectorId: string; at: { x: number; y: number; radius: number }[] }[] {
    return this.states.map((s) => ({ detectorId: s.detector.id, at: s.sceneryAt }))
  }

  update(frame: ImageData, w: number, h: number, atMs: number): DetectorEvent[] {
    const out: DetectorEvent[] = []
    for (const s of this.states) out.push(...s.update(frame, w, h, atMs))
    return out
  }

  /** Look without tracking or firing — see `DetectorState.observe`. */
  observe(frame: ImageData, w: number, h: number) {
    for (const s of this.states) s.observe(frame, w, h)
  }

  /** Everything every enabled detector can currently see, for the overlay. */
  detections(): { detectorId: string; detections: Detection[] }[] {
    return this.states.map((s) => ({ detectorId: s.detector.id, detections: s.latest }))
  }

  /** Confirmed tracks per detector, so the overlay can draw flight paths. */
  paths(): { detectorId: string; tracks: Track[] }[] {
    return this.states.map((s) => ({ detectorId: s.detector.id, tracks: s.paths }))
  }
}

/** The action id a detector feeds during a given phase, if any. */
export function targetActionId(d: Detector, phase: Phase): string | null {
  return d.target.kind === 'counter' ? d.target.byPhase[phase] ?? null : null
}
