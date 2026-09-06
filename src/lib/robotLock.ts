import { detectBlobs, sampleHue, type Appearance, type Detection } from './vision'
import { Tracker, type Track } from './tracker'

/**
 * Following one robot, so a shot can be credited to it.
 *
 * Everything else in this system is deliberately agnostic about *whose*
 * shot it saw, because nothing reads a bumper number and inventing an
 * attribution is worse than leaving the field blank. This is the honest
 * version of the same idea: the scout points at one robot, once, and from
 * then on the system knows where that robot is in every frame. A ball that
 * leaves that robot is that robot's shot. A ball that leaves the robot next
 * to it is not.
 *
 * The attribution is therefore geometric, not recognitive. It cannot tell
 * 6036 from 254; it can tell "the thing you pointed at" from "something
 * else", which is all a scout watching one robot actually needs. When the
 * lock is lost — the robot goes behind another, or leaves frame — it says
 * so, and shots in that window go out unattributed rather than guessed.
 */

export interface RobotLock {
  /** The team this lock stands for. Set by the scout, never inferred. */
  team: number | null
  alliance: 'red' | 'blue' | ''
  /** Learned by clicking the robot, not guessed from the alliance colour. */
  appearance: Appearance
}

export interface RobotSighting {
  /** Normalised centre. */
  x: number
  y: number
  /** Normalised radius — half the bumper's shorter side. */
  r: number
  at: number
  /** 0-1. Below ~0.35 the lock is coasting rather than seeing. */
  confidence: number
  /** The track this came from, so the UI can tell one robot from another. */
  id: number
  /** True for the robot the scout designated as theirs. */
  selected: boolean
  /**
   * This blob has swallowed a neighbouring robot, so its centre is somewhere
   * between two of them and means nothing.
   */
  merged?: boolean
}

/**
 * Starting colours for an alliance, so a fleet can be followed before anyone
 * has clicked anything.
 *
 * Guesses, and replaced the moment a scout clicks a real bumper — but good
 * enough to put boxes on screen immediately, which is what turns "point at
 * your robot" from a leap of faith into picking one of the things already
 * highlighted.
 */
export function allianceLook(alliance: 'red' | 'blue'): Appearance {
  const red = alliance === 'red'
  return {
    hue: red ? 355 : 215,
    hueTolerance: red ? 22 : 26,
    minSaturation: 0.32, minValue: 0.15,
    minRadius: 5, maxRadius: 150,
    minCircularity: 0.05, maxCircularity: 0.82,
    edgeSlack: 1.6, close: 2, blurTolerance: 1.6,
    groundY: 0.995,
  }
}

/** How far, in frame widths, a shot may start from the robot and still count. */
export const DEFAULT_ATTACH_RADIUS = 0.13

/**
 * Learn what a robot looks like from one click.
 *
 * The click gives a colour; the blob under the click gives a size. Guessing
 * the size instead is what makes a robot tracker lock onto a bumper-coloured
 * banner in the stands, so it is measured.
 */
export function learnRobot(
  frame: ImageData, nx: number, ny: number,
): { appearance: Appearance; radius: number } | null {
  const colour = sampleHue(frame, nx, ny, 7)
  if (colour.value < 0.08) return null

  // A bumper under arena light varies far more than a sample disc suggests,
  // so the measured spread sets a floor, not the answer.
  const tolerance = Math.max(14, Math.min(40, colour.hueSpread * 1.6 + 8))

  const probe: Appearance = {
    hue: colour.hue,
    hueTolerance: tolerance,
    minSaturation: Math.max(0.16, colour.saturation * 0.5),
    minValue: Math.max(0.1, colour.value * 0.4),
    minRadius: 3,
    maxRadius: Math.round(Math.min(frame.width, frame.height) * 0.45),
    // Wide open while probing: we are measuring the thing, not filtering it.
    minCircularity: 0,
    maxCircularity: 1,
    groundY: 1,
    edgeSlack: 2,
    close: 2,
  }

  const cx = nx * frame.width, cy = ny * frame.height
  const found = detectBlobs(frame, probe)
  // The blob the scout actually pointed at: the nearest one that contains
  // the click, falling back to the nearest one at all.
  let best: Detection | null = null
  let bestDist = Infinity
  for (const d of found) {
    const dist = Math.hypot(d.x - cx, d.y - cy)
    const inside = Math.abs(d.x - cx) <= d.width / 2 + 3
      && Math.abs(d.y - cy) <= d.height / 2 + 3
    const rank = inside ? dist : dist + 1e4
    if (rank < bestDist) { bestDist = rank; best = d }
  }
  if (!best || bestDist > 1e4) return null

  return {
    appearance: {
      ...probe,
      minRadius: Math.max(2, Math.round(best.radius * 0.45)),
      maxRadius: Math.round(best.radius * 2.6),
      // A bumper is a slab. Keeping the roundness ceiling below 1 is what
      // stops the lock drifting onto a ball of the same colour.
      minCircularity: 0.05,
      maxCircularity: 0.85,
    },
    // Handed back so the follow can be seeded at the size actually measured.
    // Seeding at a guess makes the first search window the wrong shape, and
    // the catchment for crediting a shot the wrong size with it.
    radius: best.radius / frame.width,
  }
}

/**
 * Follows every robot on one alliance, and knows which one is yours.
 *
 * Following a single blob was the wrong shape for the problem. Three robots
 * on an alliance wear the same colour, so a single-target follow has no way
 * to show that it has quietly swapped onto a partner — the box stays on
 * screen, looks confident, and credits the wrong team's shots. Tracking all
 * of them makes the swap visible: every robot of that colour gets a box, the
 * one the scout picked is highlighted, and if the highlight jumps you can
 * see it jump.
 *
 * It also makes re-acquisition honest. When the selected robot disappears
 * behind another, its track dies; rather than drifting, the fleet waits and
 * adopts a new track only when one appears near where the old one was going,
 * at about the right size. Everything else is left unattributed.
 */
export class RobotFleet {
  lock: RobotLock | null = null
  private tracker = new Tracker({
    minHits: 2, maxMissed: 14, stillPx: 4, pathLimit: 2400,
  })
  private selectedId: number | null = null
  /**
   * The selected robot's positions, kept separately from any one track so a
   * re-acquisition does not erase where it was before the occlusion — which
   * is exactly the stretch a shot needs crediting against.
   */
  private history: RobotSighting[] = []
  private last: RobotSighting | null = null
  private missing = 0
  /**
   * The selected robot's settled size, in frame widths.
   *
   * Used to notice when its blob has swallowed a neighbour. Two robots that
   * overlap on screen are genuinely one coloured shape, and no amount of
   * colour tracking can separate them — but the merged blob is suddenly half
   * again as big, which is detectable, and saying "I have lost it" is worth
   * far more than a confident centroid sitting between two robots.
   */
  private baseArea = 0
  /** Last sighting nobody could dispute, and where it was heading. */
  private lastGood: RobotSighting | null = null
  private predX = 0
  private predY = 0
  private vx = 0
  private vy = 0
  /** The follow cannot presently tell which blob is the right robot. */
  private uncertain = false
  /** Robots visible before the tangle; the count returning is it ending. */
  private preMergeCount = 0
  private lastCount = 0

  setLock(lock: RobotLock | null) {
    const teamChanged = lock?.team !== this.lock?.team
    const lookChanged = lock?.appearance !== this.lock?.appearance
    this.lock = lock

    // A different team is a different question entirely — forget everything.
    if (teamChanged) { this.reset(); return }

    // The colour changing is what *happens* when a scout points at a robot
    // the fleet had not found: the click teaches a better appearance. Wiping
    // everything there would throw away the click that caused it, and the
    // pick would silently do nothing. The tracks are rebuilt because they
    // were found with the old colour; where the scout pointed is kept.
    if (lookChanged) {
      const seed = this.last
      this.reset()
      this.last = seed
      if (seed) this.history = [seed]
    }
  }

  reset() {
    this.tracker.reset()
    this.selectedId = null
    this.history = []
    this.last = null
    this.missing = 0
    this.baseArea = 0
    this.lastGood = null
    this.predX = this.predY = 0
    this.vx = this.vy = 0
    this.uncertain = false
    this.preMergeCount = 0
    this.lastCount = 0
  }

  get sighting(): RobotSighting | null { return this.last }
  get lost(): boolean { return this.uncertain || !this.last || this.missing > 14 }
  /** Every robot of this alliance currently visible. */
  get robots(): RobotSighting[] {
    return this.tracker.confirmed
      .filter((t) => t.missed === 0)
      .map((t) => this.toSighting(t))
  }
  /** The selected robot's route, for drawing where it has been. */
  get trail(): RobotSighting[] { return this.history }

  /**
   * Designate which of the tracked robots is the one being scouted.
   * Returns false when the click was not on any of them.
   */
  selectAt(nx: number, ny: number): boolean {
    let best: Track | null = null
    let bestDist = Infinity
    for (const t of this.tracker.confirmed) {
      const dist = Math.hypot(t.x / this.w - nx, t.y / this.h - ny)
      // Generous: the scout is pointing at a robot, not at its centroid.
      if (dist > Math.max(0.06, (t.radius / this.w) * 2.5)) continue
      if (dist < bestDist) { bestDist = dist; best = t }
    }
    if (!best) return false
    this.selectedId = best.id
    this.missing = 0
    return true
  }

  /** Start following at a point, before any track exists there yet. */
  seed(nx: number, ny: number, r: number, atMs: number) {
    this.history = []
    this.last = { x: nx, y: ny, r, at: atMs, confidence: 1, id: -1, selected: true }
    this.history.push(this.last)
    this.selectedId = null
    this.missing = 0
  }

  update(frame: ImageData, w: number, h: number, atMs: number): RobotSighting | null {
    if (!this.lock) return null

    this.w = w
    this.h = h
    this.at = atMs

    const found = detectBlobs(frame, this.lock.appearance)
    this.tracker.update(found, w, h, atMs)

    const visible = this.tracker.confirmed.filter((t) => t.missed === 0).length
    let mine = this.selectedId != null
      ? this.tracker.confirmed.find((t) => t.id === this.selectedId && t.missed === 0) ?? null
      : null

    // Nothing selected yet — adopt whichever robot is nearest the seed the
    // scout clicked, once a track has actually formed there.
    if (!mine && this.selectedId == null && this.last) {
      mine = this.nearestTo(this.last.x, this.last.y, this.last.r, 0.09)
      if (mine) {
        this.selectedId = mine.id
        this.predX = this.last.x
        this.predY = this.last.y
      }
    }

    const bloated = mine != null && this.baseArea > 0
      && mine.rawPixels / this.baseArea > 1.35

    // Entering uncertainty: the blob has swallowed a neighbour, or the track
    // is simply gone. Remember how many robots were on screen beforehand —
    // that count is what says when the tangle has come apart again.
    if ((bloated || !mine) && !this.uncertain && this.lastGood) {
      this.uncertain = true
      this.preMergeCount = Math.max(this.lastCount, visible + 1)
      this.missing = 0
    }

    if (this.uncertain) {
      this.missing++
      this.predX += this.vx
      this.predY += this.vy

      // Two robots exactly on top of each other look *identical* to one
      // robot — same area, same width, same everything. No measurement of
      // that blob can resolve it. What does resolve it is the rest of the
      // fleet: while robots are tangled the alliance shows fewer of them
      // than it did, and the count coming back is the tangle ending. That
      // is the whole reason for tracking every robot rather than just one.
      const resolved = visible >= this.preMergeCount
      const candidate = resolved && this.lastGood
        ? this.nearestTo(this.predX, this.predY, this.lastGood.r, 0.13, true)
        : null

      if (candidate && this.missing <= 150) {
        this.uncertain = false
        this.selectedId = candidate.id
        this.missing = 0
        mine = candidate
      } else {
        this.lastCount = Math.max(this.lastCount, visible)
        const held: RobotSighting = {
          x: this.predX, y: this.predY, r: this.lastGood?.r ?? 0.03,
          at: atMs, confidence: 0, id: this.selectedId ?? -1,
          selected: true, merged: true,
        }
        this.last = held
        this.history.push(held)
        if (this.history.length > 3000) this.history.shift()
        return held
      }
    }

    if (!mine) {
      if (this.last) this.last = { ...this.last, at: atMs, confidence: 0, merged: true }
      return this.last
    }

    this.missing = 0
    this.lastCount = visible
    const sighting = this.toSighting(mine)

    if (this.baseArea === 0) this.baseArea = mine.rawPixels
    // Only learn the size from frames that are clearly one robot, or a slow
    // merge drags the baseline up behind it and nothing ever reads as merged.
    if (mine.rawPixels / this.baseArea < 1.2) {
      this.baseArea = this.baseArea * 0.9 + mine.rawPixels * 0.1
    }

    if (this.lastGood) {
      this.vx = this.vx * 0.5 + (sighting.x - this.lastGood.x) * 0.5
      this.vy = this.vy * 0.5 + (sighting.y - this.lastGood.y) * 0.5
    }
    this.lastGood = sighting
    this.predX = sighting.x
    this.predY = sighting.y

    this.last = sighting
    this.history.push(sighting)
    if (this.history.length > 3000) this.history.shift()
    return sighting
  }

  /**
   * Where the selected robot was at a moment — how a shot gets credited.
   *
   * The sample nearest that moment decides it, and if that sample is one the
   * follow was unsure about, the answer is nothing. Reaching past it to the
   * last confident sighting would be worse than useless: the whole reason
   * the follow lost track is that robots were on top of each other, and a
   * position from before that is exactly where the robot is *not*.
   */
  positionAt(atMs: number, toleranceMs = 700): RobotSighting | null {
    let best: RobotSighting | null = null
    let bestGap = Infinity
    for (const s of this.history) {
      const gap = Math.abs(s.at - atMs)
      if (gap < bestGap) { bestGap = gap; best = s }
    }
    if (!best || bestGap > toleranceMs) return null
    if (best.merged || best.confidence < 0.3) return null
    return best
  }

  /**
   * The best track near a point. `soleOnly` refuses a blob that is really two
   * robots stuck together, which is what re-acquisition must never grab.
   */
  private nearestTo(
    nx: number, ny: number, r: number, within: number, soleOnly = false,
  ): Track | null {
    let best: Track | null = null
    let bestCost = Infinity
    for (const t of this.tracker.confirmed) {
      if (t.missed > 0) continue
      if (soleOnly && this.baseArea > 0 && t.rawPixels / this.baseArea > 1.35) continue
      const dist = Math.hypot(t.x / this.w - nx, t.y / this.h - ny)
      if (dist > within) continue
      const sizeGap = Math.abs(t.radius / this.w - r) / Math.max(0.01, r)
      if (sizeGap > 1.4) continue
      const cost = dist + sizeGap * 0.05
      if (cost < bestCost) { bestCost = cost; best = t }
    }
    return best
  }

  /** Frame size of the last update, so `robots` can normalise without args. */
  private w = 1
  private h = 1
  private at = 0

  private toSighting(t: Track): RobotSighting {
    return {
      x: t.x / this.w,
      y: t.y / this.h,
      r: t.radius / this.w,
      at: this.at,
      confidence: Math.min(1, 0.5 + t.score * 0.5),
      id: t.id,
      selected: t.id === this.selectedId,
    }
  }
}

/**
 * Did this shot come out of the locked robot?
 *
 * Judged at the moment the ball's track *started*, not when it scored: by
 * the time a ball reaches the hub the shooter has usually driven off. A shot
 * whose launch point is not near any known robot position comes back
 * `null` — unattributed, which the UI shows as unassigned rather than
 * quietly crediting whoever was selected.
 */
export function attributeShot(
  watcher: RobotFleet,
  originX: number, originY: number, originAt: number,
  attachRadius = DEFAULT_ATTACH_RADIUS,
): { matched: boolean; distance: number; confidence: number } | null {
  const at = watcher.positionAt(originAt)
  if (!at) return null
  const distance = Math.hypot(originX - at.x, originY - at.y)
  // A big robot needs a bigger catchment than a distant one.
  const reach = Math.max(attachRadius, at.r * 2.2)
  return {
    matched: distance <= reach,
    distance,
    confidence: at.confidence * Math.max(0, 1 - distance / (reach * 1.6)),
  }
}

/** What an event could be credited to, worked out at the moment it fired. */
export interface ShotCredit {
  /** The locked robot's team, when the event belongs to that robot. */
  team: number | null
  /** True when a lock existed and the event demonstrably came from elsewhere. */
  rejected: boolean
  /** 0-1 attribution confidence, distinct from detection confidence. */
  confidence: number
  /** Normalised distance from the robot, for the UI to show. */
  distance: number | null
}

/**
 * The shape of a detector event this needs. Declared structurally rather
 * than imported so the robot lock stays independent of the rule engine.
 */
export interface CreditableEvent {
  rule: string
  x: number
  y: number
  t: number
  originX: number
  originY: number
  originT: number
}

/**
 * Which point of an event to judge against the robot's position.
 *
 * A ball is credited by where its flight *began* — by the time it reaches
 * the hub the shooter has usually driven off, so judging it at the goal
 * would credit whoever happened to be parked there. Everything else is a
 * statement about a robot rather than about a ball, so it is judged where it
 * actually happened: the thing that left the start zone, camped in the
 * depot, or stopped moving either is the robot being followed or is not.
 */
export function judgedAt(ev: CreditableEvent): { x: number; y: number; at: number } {
  const ballRule = ev.rule === 'vanish-in' || ev.rule === 'enter'
  return ballRule
    ? { x: ev.originX, y: ev.originY, at: ev.originT * 1000 }
    : { x: ev.x, y: ev.y, at: ev.t * 1000 }
}

/**
 * Credit one event to the followed robot, or to nobody.
 *
 * The three outcomes are deliberately distinct. Credited means the geometry
 * proved it. Rejected means the geometry disproved it. Neither means the
 * lock was not seeing the robot at that moment and nothing can be said —
 * and that case must not quietly become "credited", which is exactly what
 * defaulting to the selected team would do.
 */
export function creditEvent(watcher: RobotFleet, ev: CreditableEvent): ShotCredit {
  const none: ShotCredit = { team: null, rejected: false, confidence: 0, distance: null }
  if (!watcher.lock?.team) return none

  const point = judgedAt(ev)
  const verdict = attributeShot(watcher, point.x, point.y, point.at)
  if (!verdict) return none

  return {
    team: verdict.matched ? watcher.lock.team : null,
    rejected: !verdict.matched,
    confidence: verdict.confidence,
    distance: verdict.distance,
  }
}
