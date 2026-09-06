import { detectBlobs, sampleHue, type Appearance, type Detection } from './vision'

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
 * Follows a locked robot frame by frame.
 *
 * Searching a window around the predicted position rather than the whole
 * frame is both faster and more correct: the alliance partner two feet away
 * wears exactly the same colour, and a global search would happily swap onto
 * it. The window grows while the lock is lost, so a robot that ducks behind
 * another is picked back up instead of needing a re-click.
 */
export class RobotWatcher {
  lock: RobotLock | null = null
  /** Normalised history, for asking where the robot was at a past moment. */
  private history: RobotSighting[] = []
  private last: RobotSighting | null = null
  private vx = 0
  private vy = 0
  private missed = 0

  setLock(lock: RobotLock | null) {
    if (lock?.team !== this.lock?.team || lock?.appearance !== this.lock?.appearance) {
      this.history = []
      this.last = null
      this.vx = this.vy = 0
      this.missed = 0
    }
    this.lock = lock
  }

  reset() {
    this.history = []
    this.last = null
    this.vx = this.vy = 0
    this.missed = 0
  }

  get sighting(): RobotSighting | null { return this.last }
  get lost(): boolean { return !this.last || this.missed > 12 }

  /** Seed the follow at the point the scout clicked. */
  seed(nx: number, ny: number, r: number, atMs: number) {
    this.last = { x: nx, y: ny, r, at: atMs, confidence: 1 }
    this.history = [this.last]
    this.vx = this.vy = 0
    this.missed = 0
  }

  update(frame: ImageData, w: number, h: number, atMs: number): RobotSighting | null {
    if (!this.lock) return null
    const look = this.lock.appearance

    // Predict, then search a window around the prediction. The window is
    // generous when the lock is fresh and generous again when it is lost;
    // it is tight in between, which is where the swaps happen.
    const prev = this.last
    const px = prev ? prev.x + this.vx : 0.5
    const py = prev ? prev.y + this.vy : 0.5
    const spanN = prev
      ? Math.min(0.6, prev.r * 6 + 0.06 + this.missed * 0.03)
      : 1

    const found = prev
      ? detectBlobs(cropFrame(frame, px, py, spanN, spanN * (w / h)), look)
        .map((d) => offset(d, frame, px, py, spanN, spanN * (w / h)))
      : detectBlobs(frame, look)

    let best: Detection | null = null
    let bestCost = Infinity
    for (const d of found) {
      const nx = d.x / w, ny = d.y / h
      const dist = prev ? Math.hypot(nx - px, ny - py) : 0
      const sizeGap = prev ? Math.abs(d.radius / w - prev.r) / Math.max(0.01, prev.r) : 0
      // Closeness dominates; colour quality breaks ties between the robot
      // and its own shadow.
      const cost = dist * 4 + sizeGap * 0.8 + (1 - d.score) * 0.5
      if (cost < bestCost) { bestCost = cost; best = d }
    }

    if (!best) {
      this.missed++
      if (prev && this.missed <= 12) {
        // Coast, so a two-frame occlusion does not orphan the shots either
        // side of it.
        const coasted: RobotSighting = {
          x: prev.x + this.vx, y: prev.y + this.vy, r: prev.r, at: atMs,
          confidence: Math.max(0, 0.4 - this.missed * 0.03),
        }
        this.vx *= 0.85; this.vy *= 0.85
        this.last = coasted
        this.push(coasted)
        return coasted
      }
      this.last = null
      return null
    }

    const nx = best.x / w, ny = best.y / h
    if (prev) {
      this.vx = this.vx * 0.5 + (nx - prev.x) * 0.5
      this.vy = this.vy * 0.5 + (ny - prev.y) * 0.5
    }
    this.missed = 0
    const sighting: RobotSighting = {
      x: nx, y: ny,
      r: prev ? prev.r * 0.7 + (best.radius / w) * 0.3 : best.radius / w,
      at: atMs,
      confidence: Math.min(1, 0.55 + best.score * 0.45),
    }
    this.last = sighting
    this.push(sighting)
    return sighting
  }

  /** Where the robot was at a moment — how a shot gets credited. */
  positionAt(atMs: number, toleranceMs = 700): RobotSighting | null {
    let best: RobotSighting | null = null
    let bestGap = Infinity
    for (const s of this.history) {
      const gap = Math.abs(s.at - atMs)
      if (gap < bestGap) { bestGap = gap; best = s }
    }
    return best && bestGap <= toleranceMs ? best : null
  }

  private push(s: RobotSighting) {
    this.history.push(s)
    // ~40 seconds at 30fps is far more lookback than any shot needs.
    if (this.history.length > 1200) this.history.shift()
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
  watcher: RobotWatcher,
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

/**
 * Copy a normalised window out of a frame.
 *
 * Searching a window instead of the whole frame is the difference between
 * following one robot and following whichever robot of that colour happens
 * to be brightest.
 */
export function cropFrame(
  frame: ImageData, cx: number, cy: number, halfW: number, halfH: number,
): ImageData {
  const x0 = Math.max(0, Math.floor((cx - halfW) * frame.width))
  const y0 = Math.max(0, Math.floor((cy - halfH) * frame.height))
  const x1 = Math.min(frame.width, Math.ceil((cx + halfW) * frame.width))
  const y1 = Math.min(frame.height, Math.ceil((cy + halfH) * frame.height))
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * frame.width + x0) * 4
    out.set(frame.data.subarray(src, src + w * 4), y * w * 4)
  }
  return { data: out, width: w, height: h, colorSpace: 'srgb' } as ImageData
}

/** Put a detection found in a crop back into full-frame coordinates. */
function offset(
  d: Detection, frame: ImageData, cx: number, cy: number, halfW: number, halfH: number,
): Detection {
  const x0 = Math.max(0, Math.floor((cx - halfW) * frame.width))
  const y0 = Math.max(0, Math.floor((cy - halfH) * frame.height))
  return { ...d, x: d.x + x0, y: d.y + y0 }
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
export function creditEvent(watcher: RobotWatcher, ev: CreditableEvent): ShotCredit {
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
