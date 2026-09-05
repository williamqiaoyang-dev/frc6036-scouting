import { detectBlobs, pointInZone, type Appearance, type Detection } from './vision'
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
 * What this cannot do is say *which* robot. Nothing here reads a bumper
 * number, so every detector is scoped to the one robot the scout says they
 * are watching. Claiming otherwise would put invented attributions into a
 * picklist, which is worse than no data.
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
}

export interface DetectorEvent {
  detectorId: string
  /** Seconds into the match or video. */
  t: number
  /** Normalised position where it fired. */
  x: number
  y: number
}

interface Track {
  id: number
  x: number
  y: number
  radius: number
  originX: number
  originY: number
  /** Where the track was when it last moved appreciably, and when. */
  restX: number
  restY: number
  restSince: number
  missed: number
  age: number
  inZone: boolean
  everInZone: boolean
  /** When the track first entered the zone, for `dwell`. */
  inZoneSince: number
  counted: boolean
}

/**
 * One detector's state across frames. Tracks blobs and applies the rule.
 */
class DetectorState {
  private tracks: Track[] = []
  private nextId = 1
  private lastFiredAt = -Infinity

  constructor(public detector: Detector) {}

  latest: Detection[] = []

  reset() {
    this.tracks = []
    this.lastFiredAt = -Infinity
    this.latest = []
  }

  update(frame: ImageData, w: number, h: number, atMs: number): DetectorEvent[] {
    const d = this.detector
    if (!d.enabled || d.zone.length < 3) { this.latest = []; return [] }

    const found = detectBlobs(frame, d.appearance)
    this.latest = found
    const events: DetectorEvent[] = []
    const inZone = (det: Detection) => pointInZone(det.x / w, det.y / h, d.zone)

    // ---- associate detections with existing tracks ----------------------
    const unmatched = new Set(found.map((_, i) => i))
    for (const track of this.tracks) {
      let best = -1
      let bestDist = Infinity
      const gate = Math.max(40, track.radius * 4)

      found.forEach((det, i) => {
        if (!unmatched.has(i)) return
        const dist = Math.hypot(det.x - track.x, det.y - track.y)
        if (dist < bestDist && dist <= gate) { bestDist = dist; best = i }
      })

      if (best < 0) { track.missed++; continue }

      const det = found[best]
      unmatched.delete(best)
      const moved = Math.hypot(det.x - track.restX, det.y - track.restY)
      if (moved > d.stillPx) {
        track.restX = det.x; track.restY = det.y; track.restSince = atMs
      }
      track.x = det.x; track.y = det.y; track.radius = det.radius
      track.missed = 0
      track.age++

      const nowIn = inZone(det)
      if (nowIn && !track.inZone) track.inZoneSince = atMs
      track.inZone = nowIn
      if (nowIn) track.everInZone = true
    }

    for (const i of unmatched) {
      const det = found[i]
      const nowIn = inZone(det)
      this.tracks.push({
        id: this.nextId++,
        x: det.x, y: det.y, radius: det.radius,
        originX: det.x, originY: det.y,
        restX: det.x, restY: det.y, restSince: atMs,
        missed: 0, age: 1,
        inZone: nowIn, everInZone: nowIn, inZoneSince: nowIn ? atMs : 0,
        counted: false,
      })
    }

    // ---- apply the rule --------------------------------------------------
    for (const t of this.tracks) {
      if (t.counted) continue
      if (atMs - this.lastFiredAt < d.cooldownMs) break

      let fires = false
      switch (d.rule) {
        case 'enter':
          fires = t.inZone
          break
        case 'exit':
          // Left the area it started in, and is now demonstrably outside.
          fires = t.everInZone && !t.inZone && t.age > 1
          break
        case 'vanish-in':
          fires = t.everInZone
            && t.missed >= d.maxMissedFrames
            && Math.hypot(t.x - t.originX, t.y - t.originY) >= d.minTravelPx
            && pointInZone(t.x / w, t.y / h, d.zone)
          break
        case 'dwell':
          // `inZone` is the guard, not a non-zero timestamp: a track that
          // starts inside the area at t=0 has a legitimate `inZoneSince` of
          // 0, and testing for truthiness would silently never fire it.
          fires = t.inZone && atMs - t.inZoneSince >= d.dwellSec * 1000
          break
        case 'still':
          fires = t.missed === 0 && atMs - t.restSince >= d.dwellSec * 1000
          break
      }

      if (!fires) continue
      t.counted = true
      this.lastFiredAt = atMs
      events.push({ detectorId: d.id, t: atMs / 1000, x: t.x / w, y: t.y / h })
    }

    // ---- retire dead tracks ---------------------------------------------
    this.tracks = this.tracks.filter((t) => t.missed <= d.maxMissedFrames * 2)
    return events
  }
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

  update(frame: ImageData, w: number, h: number, atMs: number): DetectorEvent[] {
    const out: DetectorEvent[] = []
    for (const s of this.states) out.push(...s.update(frame, w, h, atMs))
    return out
  }

  /** Everything every enabled detector can currently see, for the overlay. */
  detections(): { detectorId: string; detections: Detection[] }[] {
    return this.states.map((s) => ({ detectorId: s.detector.id, detections: s.latest }))
  }
}

/** The action id a detector feeds during a given phase, if any. */
export function targetActionId(d: Detector, phase: Phase): string | null {
  return d.target.kind === 'counter' ? d.target.byPhase[phase] ?? null : null
}
