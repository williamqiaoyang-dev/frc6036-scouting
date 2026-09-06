import { detectBlobs, rgbToHsv, type Appearance } from './vision'

/**
 * Recognising a robot from a photograph of it.
 *
 * Worth saying plainly what this is not: there is no neural network here and
 * nothing is trained in the sense of epochs over a labelled dataset. One
 * photograph is not a training set — a detector learned from a single image
 * would memorise that image, and a team has no way to produce the thousands
 * of annotated frames a real detector needs between one match and the next.
 *
 * What one photograph *is* enough for is an appearance model. A robot is a
 * particular arrangement of a few particular colours, and that is measurable
 * from one picture and comparable against a region of video without any
 * learned weights at all. Two things come out of the photo:
 *
 *   a signature — a colour histogram, weighted toward the colours that make
 *                 this robot different from its own background, so a red
 *                 bumper counts for less than the odd green intake beside it.
 *   a search    — thresholds for the cheap blob finder, fitted by actually
 *                 optimising them against the photo rather than guessed.
 *
 * The fit is a real optimisation with a real objective and real iterations,
 * and it converges: more iterations stop helping somewhere around eighty. It
 * is coordinate descent, not gradient descent, because the objective runs
 * through a connected-components pass that has no useful derivative.
 */

/**
 * Steps the colour fit is allowed.
 *
 * From the histogram seed it converges in about sixteen — the seed is
 * usually already right, and the fit only polishes. The budget is sized for
 * the case where it is not: from a maximally wrong start, walking a hundred
 * and seventy degrees of hue at an annealing stride takes a little over
 * three hundred. It costs a few milliseconds either way, so the insurance
 * is free and the fit stops early when it stops improving.
 */
export const DEFAULT_FIT_STEPS = 400

const HUE_BINS = 18
const SAT_BINS = 3
const VAL_BINS = 3
const BINS = HUE_BINS * SAT_BINS * VAL_BINS

export interface RobotSignature {
  /** Colour histogram, weighted to what makes this robot distinctive. */
  hist: Float32Array
  /** Thresholds for the blob finder, fitted against the photo. */
  appearance: Appearance
  /** Width over height in the photo — a robot is roughly one shape. */
  aspect: number
  /**
   * 0-1: how cleanly the fitted search separated the robot from its
   * background in the photo it was built from. Low means the photo was the
   * problem — a robot against a red curtain cannot be picked out by colour,
   * and the scout needs to know that before trusting the follow.
   */
  quality: number
  /** How many optimisation steps ran, and how many actually improved it. */
  iterations: number
  improvements: number
}

/** Which histogram bin a pixel falls in, or -1 when it is too dark to mean anything. */
function binOf(r: number, g: number, b: number): number {
  const [h, s, v] = rgbToHsv(r, g, b)
  if (v < 0.12) return -1
  const hb = Math.min(HUE_BINS - 1, Math.floor((h / 360) * HUE_BINS))
  const sb = Math.min(SAT_BINS - 1, Math.floor(s * SAT_BINS))
  const vb = Math.min(VAL_BINS - 1, Math.floor(v * VAL_BINS))
  return (hb * SAT_BINS + sb) * VAL_BINS + vb
}

/** Histogram of a rectangular region, normalised to sum 1. */
export function regionHistogram(
  frame: ImageData, x0: number, y0: number, x1: number, y1: number,
): Float32Array {
  const hist = new Float32Array(BINS)
  const lx = Math.max(0, Math.floor(x0)), ly = Math.max(0, Math.floor(y0))
  const hx = Math.min(frame.width, Math.ceil(x1)), hy = Math.min(frame.height, Math.ceil(y1))
  let n = 0
  for (let y = ly; y < hy; y++) {
    for (let x = lx; x < hx; x++) {
      const i = (y * frame.width + x) * 4
      const b = binOf(frame.data[i], frame.data[i + 1], frame.data[i + 2])
      if (b < 0) continue
      hist[b]++
      n++
    }
  }
  if (n === 0) return hist

  // Power normalisation. Without it the histogram is whatever the robot has
  // most of, which is always the bumper — and the bumper is the one thing
  // every robot on the alliance shares. Taking the square root compresses
  // the dominant bin and lets the parts that actually distinguish one
  // machine from another, a green intake against a yellow one, carry real
  // weight. Standard practice wherever histograms are used to retrieve
  // images, and for exactly this reason.
  let total = 0
  for (let i = 0; i < BINS; i++) {
    hist[i] = Math.sqrt(hist[i] / n)
    total += hist[i]
  }
  if (total > 0) for (let i = 0; i < BINS; i++) hist[i] /= total
  return hist
}

/**
 * How alike two histograms are, 0-1.
 *
 * Intersection rather than a chi-squared or Bhattacharyya distance: it is
 * bounded, it degrades gracefully when part of the robot is occluded — the
 * visible part still contributes its full share — and it needs no epsilon
 * around empty bins, of which a robot has most.
 */
export function histogramMatch(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < BINS; i++) sum += Math.min(a[i], b[i])
  return sum
}

/**
 * Build a signature from a photo of one robot.
 *
 * The photo is assumed to be mostly robot, centred — which is what someone
 * takes when asked for a photo of their robot. The middle is treated as the
 * robot and the outer border as background, and colours are weighted by how
 * much more they appear in the first than the second. That is what stops the
 * signature being dominated by whatever colour the carpet is.
 */
/** The region of a photo treated as the robot: the centre 62%. */
export function robotBox(photo: ImageData) {
  return {
    x0: photo.width * 0.19, y0: photo.height * 0.19,
    x1: photo.width * 0.81, y1: photo.height * 0.81,
  }
}

export function buildSignature(
  photo: ImageData, options: { iterations?: number } = {},
): RobotSignature {
  const w = photo.width, h = photo.height
  // Centre 62% is the robot; the outer eighth is background. Deliberately
  // not touching: the band between them is ignored, so a soft edge or a
  // shadow does not get counted as both.
  const cx0 = w * 0.19, cx1 = w * 0.81
  const cy0 = h * 0.19, cy1 = h * 0.81

  const fg = regionHistogram(photo, cx0, cy0, cx1, cy1)
  const bg = backgroundHistogram(photo)

  // Distinctiveness: a colour that is everywhere in the background tells you
  // nothing about the robot, however much of the robot it covers.
  const hist = new Float32Array(BINS)
  let total = 0
  for (let i = 0; i < BINS; i++) {
    const weight = fg[i] / (fg[i] + bg[i] * 1.5 + 1e-6)
    hist[i] = fg[i] * weight
    total += hist[i]
  }
  if (total > 0) for (let i = 0; i < BINS; i++) hist[i] /= total

  const seed = seedAppearance(hist, photo)
  const fit = fitAppearance(photo, seed, cx0, cy0, cx1, cy1,
    options.iterations ?? DEFAULT_FIT_STEPS)

  return {
    hist,
    appearance: fit.appearance,
    aspect: (cx1 - cx0) / Math.max(1, cy1 - cy0),
    quality: fit.score,
    iterations: fit.iterations,
    improvements: fit.improvements,
  }
}

/** Background is the outer frame of the photo, sampled as four strips. */
function backgroundHistogram(photo: ImageData): Float32Array {
  const w = photo.width, h = photo.height
  const strips: [number, number, number, number][] = [
    [0, 0, w, h * 0.12],
    [0, h * 0.88, w, h],
    [0, 0, w * 0.12, h],
    [w * 0.88, 0, w, h],
  ]
  const out = new Float32Array(BINS)
  for (const [x0, y0, x1, y1] of strips) {
    const s = regionHistogram(photo, x0, y0, x1, y1)
    for (let i = 0; i < BINS; i++) out[i] += s[i] / strips.length
  }
  return out
}

/** Start the fit from the most distinctive colour the robot actually has. */
export function seedAppearance(hist: Float32Array, photo: ImageData): Appearance {
  let peak = 0
  for (let i = 1; i < BINS; i++) if (hist[i] > hist[peak]) peak = i
  const vb = peak % VAL_BINS
  const sb = ((peak - vb) / VAL_BINS) % SAT_BINS
  const hb = Math.floor(peak / (SAT_BINS * VAL_BINS))
  const hue = ((hb + 0.5) / HUE_BINS) * 360
  const sat = (sb + 0.5) / SAT_BINS
  const val = (vb + 0.5) / VAL_BINS
  const span = Math.min(photo.width, photo.height)

  return {
    hue,
    hueTolerance: 22,
    minSaturation: Math.max(0.12, sat * 0.5),
    minValue: Math.max(0.1, val * 0.45),
    minRadius: Math.max(2, Math.round(span * 0.04)),
    maxRadius: Math.round(span * 0.75),
    minCircularity: 0.04,
    maxCircularity: 0.95,
    groundY: 1,
    edgeSlack: 1.7,
    close: 2,
    blurTolerance: 1.8,
  }
}

/**
 * The colour gate the fit moves, and how far.
 *
 * Only the four thresholds that decide whether a *pixel* matches. Size and
 * roundness are measured from the result afterwards rather than searched:
 * they do not change which pixels are the robot, only how those pixels are
 * grouped, and putting them in the inner loop makes the objective flat over
 * most of its range — which is exactly what an optimiser cannot climb.
 */
const KNOBS: [keyof Appearance, number, number, number][] = [
  ['hue', 0, 360, 10],
  ['hueTolerance', 5, 70, 6],
  ['minSaturation', 0.03, 0.85, 0.07],
  ['minValue', 0.03, 0.85, 0.07],
]

/**
 * Fit the colour gate to the photo by coordinate descent.
 *
 * The objective is measured per pixel: of the pixels this gate accepts, how
 * many are the robot, and of the robot, how many does it accept. That is
 * smooth in all four thresholds — every step moves some pixels — which is
 * what makes it climbable. An earlier version scored the *bounding box* of a
 * connected component instead, and was flat across most of the range: whole
 * sweeps of hue tolerance produced byte-identical scores, so the fit ran two
 * hundred steps and improved nothing. A number that does not move is not an
 * objective.
 *
 * Steps shrink as it goes, so early rounds move a long way and later ones
 * polish. Deterministic, because two scouts comparing why their setups
 * disagree should not also be comparing two different random seeds.
 */
export function fitAppearance(
  photo: ImageData, seed: Appearance,
  x0: number, y0: number, x1: number, y1: number,
  budget: number,
): { appearance: Appearance; score: number; iterations: number; improvements: number } {
  const stats = sampleRegions(photo, x0, y0, x1, y1)

  let best = { ...seed }
  let bestScore = separation(stats, best)
  let improvements = 0
  let used = 0

  const rounds = Math.max(1, Math.ceil(budget / (KNOBS.length * 2)))
  let idle = 0
  for (let round = 0; round < rounds && used < budget; round++) {
    // Anneal: a long stride first, a short one at the end.
    const scale = 1 - (round / rounds) * 0.85
    let moved = false

    for (const [key, lo, hi, step] of KNOBS) {
      for (const dir of [1, -1]) {
        if (used >= budget) break
        used++
        const current = best[key] as number
        let next = current + dir * step * scale
        // Hue is an angle; it wraps rather than clamping, or a fit that
        // starts near 0 can never walk down into the reds at 350.
        if (key === 'hue') next = ((next % 360) + 360) % 360
        else next = Math.max(lo, Math.min(hi, next))
        if (next === current) continue
        const candidate = { ...best, [key]: next } as Appearance
        const score = separation(stats, candidate)
        if (score > bestScore + 1e-5) {
          best = candidate
          bestScore = score
          improvements++
          moved = true
        }
      }
    }
    idle = moved ? 0 : idle + 1
    // Converged: two whole rounds at a shrinking stride changed nothing.
    if (idle >= 2) break
  }

  // Shape and size come from what the fitted gate actually finds, rather
  // than being searched for or left at the seed's guess.
  const probe: Appearance = { ...best, minRadius: 2, maxRadius: Math.max(photo.width, photo.height), minCircularity: 0, maxCircularity: 1 }
  const found = detectBlobs(photo, probe)
  const inside = found
    .filter((d) => d.x >= x0 && d.x <= x1 && d.y >= y0 && d.y <= y1)
    .sort((a, b) => b.pixels - a.pixels)
  const biggest = inside[0]
  if (biggest) {
    best = {
      ...best,
      minRadius: Math.max(2, Math.round(biggest.radius * 0.4)),
      maxRadius: Math.round(biggest.radius * 3),
      minCircularity: Math.max(0, biggest.circularity - 0.35),
      maxCircularity: Math.min(1, biggest.circularity + 0.35),
    }
  }

  return { appearance: best, score: bestScore, iterations: used, improvements }
}

/**
 * The photo reduced to two lists of pixels: the robot, and its surroundings.
 *
 * Sampled once and reused for every candidate, so the inner loop is a few
 * thousand comparisons rather than a full pass over the image. That is what
 * makes a two-hundred-step fit finish while a scout is still looking at the
 * upload button.
 */
function sampleRegions(
  photo: ImageData, x0: number, y0: number, x1: number, y1: number,
): { fg: Float32Array; bg: Float32Array } {
  const fg: number[] = []
  const bg: number[] = []
  const stride = Math.max(1, Math.round(Math.sqrt((photo.width * photo.height) / 6000)))

  for (let y = 0; y < photo.height; y += stride) {
    for (let x = 0; x < photo.width; x += stride) {
      const i = (y * photo.width + x) * 4
      const [h, s, v] = rgbToHsv(photo.data[i], photo.data[i + 1], photo.data[i + 2])
      const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1
      const outer = x < photo.width * 0.12 || x > photo.width * 0.88
        || y < photo.height * 0.12 || y > photo.height * 0.88
      // The band between the two is skipped: a soft edge or a cast shadow
      // belongs to neither, and counting it as both teaches the fit nothing.
      if (inside) { fg.push(h, s, v) }
      else if (outer) { bg.push(h, s, v) }
    }
  }
  return { fg: Float32Array.from(fg), bg: Float32Array.from(bg) }
}

/**
 * Of the pixels this gate accepts, how many are the robot — and vice versa.
 *
 * Returns a value in (-2, 1]. Above zero it is the real measure: precision
 * times the square root of recall. At or below zero the gate is not letting
 * any of the robot through at all, and the value is instead a graded hint
 * about how far away it is.
 *
 * That second half is not decoration. A hard pass-or-fail objective is zero
 * everywhere the gate misses, so every direction looks equally bad and the
 * fit cannot move — start it on cyan when the robot is red and it sits
 * there for four hundred steps improving nothing, which is precisely what
 * this did before. A dead zone in an objective is indistinguishable from a
 * broken optimiser, and it made the whole fit worthless from any seed that
 * was not already right.
 */
function separation(
  stats: { fg: Float32Array; bg: Float32Array }, look: Appearance,
): number {
  const hueGap = (h: number) => {
    let d = Math.abs(h - look.hue) % 360
    return d > 180 ? 360 - d : d
  }
  const passes = (a: Float32Array, i: number) =>
    a[i + 1] >= look.minSaturation && a[i + 2] >= look.minValue
    && hueGap(a[i]) <= look.hueTolerance

  let fgHit = 0
  for (let i = 0; i < stats.fg.length; i += 3) if (passes(stats.fg, i)) fgHit++

  if (fgHit === 0) {
    // Nothing yet. Score how nearly each robot pixel would have qualified,
    // so there is a slope running back toward the robot's actual colour.
    // Kept strictly below zero so any gate that does let the robot through
    // beats every gate that does not.
    let near = 0
    const n = stats.fg.length / 3
    for (let i = 0; i < stats.fg.length; i += 3) {
      const hue = Math.max(0, 1 - hueGap(stats.fg[i]) / 180)
      const sat = Math.max(0, 1 - Math.max(0, look.minSaturation - stats.fg[i + 1]) * 4)
      const val = Math.max(0, 1 - Math.max(0, look.minValue - stats.fg[i + 2]) * 4)
      near += hue * sat * val
    }
    return -1 + (n > 0 ? near / n : 0)
  }

  let bgHit = 0
  for (let i = 0; i < stats.bg.length; i += 3) if (passes(stats.bg, i)) bgHit++

  const fgN = stats.fg.length / 3
  const precision = fgHit / (fgHit + bgHit)
  const recall = fgHit / Math.max(1, fgN)
  // Recall is square-rooted: getting from a tenth of the robot to half of it
  // matters far more than the last fifth, and demanding all of it drives the
  // gate wide enough to swallow the wall behind it.
  return precision * Math.sqrt(recall)
}

/**
 * How well a region of video matches the photo, 0-1.
 *
 * Used to choose between robots that a colour threshold cannot separate,
 * which is every robot on the same alliance.
 */
export function matchRegion(
  frame: ImageData, sig: RobotSignature,
  cx: number, cy: number, halfW: number, halfH: number,
): number {
  const hist = regionHistogram(frame, cx - halfW, cy - halfH, cx + halfW, cy + halfH)
  // The region's histogram is raw while the signature is distinctiveness
  // weighted, so a perfect match scores well below 1. Rescaled against the
  // signature's own mass so the number means something to a person.
  let ceiling = 0
  for (let i = 0; i < BINS; i++) ceiling += Math.min(sig.hist[i], 1)
  const raw = histogramMatch(hist, sig.hist)
  return Math.max(0, Math.min(1, raw / Math.max(1e-6, Math.min(1, ceiling))))
}
