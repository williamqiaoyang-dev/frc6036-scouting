/**
 * FUEL detection.
 *
 * Not a neural network, deliberately. FUEL is a uniformly coloured sphere,
 * which is the case classical vision handles best: colour thresholding plus a
 * roundness test is faster, needs no model download, runs offline on a school
 * Chromebook, and — unlike a black-box detector — every parameter can be
 * tuned at the venue when the lighting turns out to be terrible.
 *
 * The hard requirement is not "find balls". It is "count only the ones that
 * score". Balls on the floor, in a hopper, or in a robot must never count.
 * Three mechanisms enforce that, and they live in `detectors.ts`:
 *   1. A scoring zone the scout draws over the goal. Nothing outside counts.
 *   2. A floor line. Everything below it is ignored outright.
 *   3. A ball must *enter* the zone and then vanish, which is what going in
 *      looks like. A ball resting in view never scores.
 *
 * What the finder itself has to survive is a real frame rather than a
 * diagram, and three properties of real frames used to defeat it:
 *
 *   Size   — a 5" ball across a 27' field is under 1.5% of the frame width.
 *            At the old 320px processing width that is a *two pixel radius*,
 *            below the minimum size, so nothing was ever found. Frames are
 *            now read at 640px by default and the size floor goes down to 1px.
 *   Shade  — a ball is lit on top and shadowed underneath, and the shadowed
 *            half failed the brightness gate and was cut away, leaving a
 *            crescent that is not round. Thresholding is now hysteretic:
 *            confident pixels seed a blob, and marginal ones join it only
 *            when they touch one. The whole ball survives; a marginal patch
 *            of carpet on its own still does not.
 *   Motion  — a ball in flight smears across a frame. Closing the mask
 *            re-fuses a ball that a highlight split in two, and roundness is
 *            scored so that a smear stays round-*ended* rather than being
 *            rejected for being long.
 */

export interface VisionConfig {
  /** Target hue, 0-360. Sampled from the frame rather than guessed. */
  hue: number
  /** How far from the target hue still counts, in degrees. */
  hueTolerance: number
  /** Reject washed-out greys: 0-1. */
  minSaturation: number
  /** Reject shadows: 0-1. */
  minValue: number
  /** Blob radius bounds in pixels, at the processing resolution. */
  minRadius: number
  maxRadius: number
  /** How round a blob must be, 0-1. A ball is ~0.8+; an arm or bumper is not. */
  minCircularity: number
  /**
   * Scoring zone as normalised polygon points (0-1). Drawn over the goal.
   * Empty means "count nothing", which is the safe default.
   */
  zone: { x: number; y: number }[]
  /** Normalised y below which detections are ignored — the floor. */
  groundY: number
  /** Minimum ms between counts, so one ball cannot register twice. */
  cooldownMs: number
  /** Frames a track may go unseen before it is considered gone. */
  maxMissedFrames: number
  /** Dynamic mode: how much of the track must move toward the zone. */
  minTravelPx: number
}

export const DEFAULT_VISION: VisionConfig = {
  hue: 30,
  hueTolerance: 18,
  minSaturation: 0.35,
  minValue: 0.25,
  minRadius: 2,
  maxRadius: 40,
  minCircularity: 0.55,
  zone: [],
  groundY: 0.85,
  cooldownMs: 220,
  maxMissedFrames: 6,
  minTravelPx: 12,
}

/**
 * What a thing looks like. Split out from `VisionConfig` so the same blob
 * finder can be pointed at more than balls: a robot bumper is the same
 * search with a wider radius band and a *lower* roundness ceiling, since a
 * bumper is emphatically not a circle.
 *
 * Everything below `groundY` is optional and defaulted at use, because a
 * scout's saved setup from a previous build will not have those keys and
 * must keep loading rather than silently detecting nothing.
 */
export interface Appearance {
  hue: number
  hueTolerance: number
  minSaturation: number
  minValue: number
  minRadius: number
  maxRadius: number
  minCircularity: number
  /** Upper roundness bound. 1 for balls; ~0.6 to *require* a non-round shape. */
  maxCircularity: number
  /** Normalised y below which pixels are ignored — the floor. */
  groundY: number
  /**
   * Normalised y *above* which pixels are ignored — the back of the field.
   *
   * The companion to the floor and just as necessary. A camera in the stands
   * sees the far end of the field, the far alliance's hopper and whatever is
   * behind the guardrail, all of it full of game pieces of exactly the right
   * colour. They are above the goal in the frame, so a single line excludes
   * them. 0 keeps everything.
   */
  ceilingY?: number

  /**
   * How far a *marginal* pixel may stray from the gates above and still be
   * absorbed into a blob it touches. 1 disables it; ~1.8 recovers the
   * shadowed underside of a ball without letting carpet seed anything.
   *
   * It is deliberately not applied evenly. Shading moves a pixel's
   * saturation and brightness a long way and its hue barely at all, so the
   * slack goes almost entirely to the first two. Widening hue as freely
   * would reach from orange into red — and a FUEL ball held against a red
   * bumper would be absorbed into the bumper and lost, which is the
   * opposite of the repair intended.
   */
  edgeSlack?: number
  /**
   * Morphological closing radius, in processing pixels. 1 re-fuses a ball
   * that a specular highlight split down the middle. Larger values start
   * welding two nearby balls into one.
   */
  close?: number
  /**
   * Longest elongation still considered round-ended, for a ball smeared by
   * motion. 1 demands a circle; ~2.4 accepts a ball travelling fast.
   */
  blurTolerance?: number
  /** Reject blown-out pixels: 0-1, 1 to keep everything. */
  maxValue?: number
  /**
   * Brightness above which a colourless pixel is read as a specular
   * highlight rather than as background — but only where it touches
   * something already matching. 1 switches it off.
   *
   * A highlight on a glossy ball is blown to white, has no hue at all, and
   * used to cut the ball into two crescents that both failed the roundness
   * test. It is not background; it is the ball, overexposed.
   */
  specularValue?: number
}

export interface Detection {
  /** Centre, in processing-canvas pixels. */
  x: number
  y: number
  radius: number
  /** 0-1: how ball-like this blob is. */
  circularity: number
  pixels: number
  /**
   * 0-1: how confidently the colour matched, averaged over the blob. A blob
   * built mostly from marginal pixels scores low even when its shape is
   * perfect, which is what tracking needs in order to prefer the real ball
   * over a colour-adjacent smudge.
   */
  colourScore: number
  /** 0-1: colour and shape together. What downstream ranking should use. */
  score: number
  /** Bounding box, kept for overlay and debugging. */
  width: number
  height: number
}

/** RGB → HSV. h in degrees, s and v in 0-1. */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  if (h < 0) h += 360
  return [h, max === 0 ? 0 : d / max, max]
}

/** Smallest angular distance between two hues, in degrees. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Fills in the optional appearance keys a saved setup will not have. */
function resolve(cfg: Appearance) {
  return {
    edgeSlack: cfg.edgeSlack ?? 1.8,
    close: cfg.close ?? 1,
    blurTolerance: cfg.blurTolerance ?? 2.4,
    maxValue: cfg.maxValue ?? 1,
    specularValue: cfg.specularValue ?? 0.88,
    ceilingY: cfg.ceilingY ?? 0,
  }
}

/** Mask values. Ordering matters: `STRONG > WEAK` is used as a comparison. */
const WEAK = 1
const STRONG = 2

/**
 * Find ball-like blobs in a frame.
 *
 * Two passes: threshold pixels to a colour mask, then label connected
 * components with an iterative flood fill. Iterative rather than recursive
 * because a large blob would blow the call stack on a real frame.
 */
export function detectBalls(frame: ImageData, cfg: VisionConfig): Detection[] {
  return detectBlobs(frame, { ...cfg, maxCircularity: 1 })
}

/**
 * Scratch buffers, reused across calls.
 *
 * A 640x360 frame needs about 1.5MB of working memory, and a scan asks for
 * it thirty times a second per detector. Allocating that every frame put more
 * time into the garbage collector than into finding balls, so the buffers
 * are grown once and kept.
 */
const scratch = {
  n: 0,
  mask: new Uint8Array(0),
  fit: new Uint8Array(0),
  specular: new Uint8Array(0),
  work: new Uint8Array(0),
  work2: new Uint8Array(0),
  seen: new Uint8Array(0),
  stack: new Int32Array(0),
}

function buffers(n: number) {
  if (scratch.n < n) {
    scratch.n = n
    scratch.mask = new Uint8Array(n)
    scratch.fit = new Uint8Array(n)
    scratch.specular = new Uint8Array(n)
    scratch.work = new Uint8Array(n)
    scratch.work2 = new Uint8Array(n)
    scratch.seen = new Uint8Array(n)
    scratch.stack = new Int32Array(n)
  }
  return scratch
}

/** The general form: find blobs matching an appearance. */
export function detectBlobs(frame: ImageData, cfg: Appearance): Detection[] {
  const { width: w, height: h, data } = frame
  const opt = resolve(cfg)
  const n = w * h

  const buf = buffers(n)
  const mask = buf.mask, fit = buf.fit, specular = buf.specular
  mask.fill(0, 0, n)
  // Cleared as well as the mask: a pixel promoted by the highlight rescue or
  // by closing is one nothing wrote a confidence for this frame, and a
  // pooled buffer would otherwise hand it last frame's.
  fit.fill(0, 0, n)
  let anySpecular = false

  const floorPx = Math.min(h, Math.floor(cfg.groundY * h))
  const ceilPx = Math.max(0, Math.min(floorPx, Math.floor(opt.ceilingY * h)))
  const tol = Math.max(1, cfg.hueTolerance)
  // Hue gets a fraction of the slack the other two get; see `edgeSlack`.
  const slackTol = tol * (1 + (opt.edgeSlack - 1) * 0.45)
  const slackSat = cfg.minSaturation / opt.edgeSlack
  const slackVal = cfg.minValue / opt.edgeSlack
  // Compared against the raw 0-255 channel maximum, so the common rejection
  // needs no division at all.
  const slackVal255 = slackVal * 255
  const maxVal255 = opt.maxValue * 255
  const specular255 = opt.specularValue * 255

  // ---- 1. hysteretic colour thresholding --------------------------------
  // A single hard gate cuts the shaded half off a ball and leaves a crescent
  // that fails every roundness test. Two gates fix that: a confident pixel
  // may start a blob, a marginal one may only ever join one.
  //
  // HSV is computed inline rather than through `rgbToHsv`, which returns a
  // tuple: at a third of a million pixels a frame that array is the single
  // most expensive thing in the pipeline.
  const scanFrom = ceilPx * w
  const scanTo = floorPx * w
  for (let p = scanFrom, i = scanFrom * 4; p < scanTo; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b)
    // Too dark to be anything, and far the most common case — out first.
    if (max < slackVal255) continue
    if (max > maxVal255) continue
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b)
    const delta = max - min
    const sat = delta / max

    if (sat < slackSat) {
      // No usable hue, but bright enough to be a highlight rather than
      // background. Remembered, not admitted — see step 2.
      if (max >= specular255) { specular[p] = 1; anySpecular = true }
      continue
    }

    let hue: number
    if (max === r) hue = 60 * (((g - b) / delta) % 6)
    else if (max === g) hue = 60 * ((b - r) / delta + 2)
    else hue = 60 * ((r - g) / delta + 4)
    if (hue < 0) hue += 360

    let hd = Math.abs(hue - cfg.hue) % 360
    if (hd > 180) hd = 360 - hd

    if (hd > slackTol) {
      if (max >= specular255 && sat < slackSat * 1.6) {
        specular[p] = 1; anySpecular = true
      }
      continue
    }

    const val = max / 255
    mask[p] = (sat >= cfg.minSaturation && val >= cfg.minValue && hd <= tol) ? STRONG : WEAK
    // Confidence is dominated by hue: saturation and brightness vary wildly
    // across one ball, hue barely does.
    fit[p] = (255 * (1 - hd / slackTol)) | 0
  }

  // ---- 2. rescue highlights that sit on top of a match -------------------
  // Bounded on purpose: only blown-out pixels within a couple of pixels of
  // something that genuinely matched are admitted. That is enough to bridge
  // the white stripe across a glossy ball, and far too little for the blob
  // to escape into a white field wall.
  if (anySpecular && opt.specularValue < 1) {
    const reach = Math.max(1, Math.round(opt.close) + 1)
    const near = buf.work
    for (let p = 0; p < n; p++) near[p] = mask[p] === STRONG ? 1 : 0
    dilate(near, buf.work2, w, h, reach)
    for (let p = 0; p < n; p++) {
      if (specular[p] && near[p] && !mask[p]) mask[p] = WEAK
      specular[p] = 0
    }
  } else if (anySpecular) {
    specular.fill(0, 0, n)
  }

  // ---- 3. closing, to re-fuse anything still broken ---------------------
  if (opt.close > 0) closeMask(mask, buf.work, buf.work2, w, h, Math.round(opt.close))

  // ---- 4. connected components, 8-connected ------------------------------
  // 8 rather than 4: a two-pixel-wide ball at the far end of the field is
  // held together by its diagonals, and 4-connectivity shatters it.
  const seen = buf.seen
  seen.fill(0, 0, n)
  const stack = buf.stack
  const out: Detection[] = []
  const maxPixels = Math.PI * cfg.maxRadius * cfg.maxRadius * 2.4
  const minPixels = Math.max(3, Math.PI * cfg.minRadius * cfg.minRadius * 0.4)

  for (let start = 0; start < n; start++) {
    // Only a confident pixel may seed a blob. Marginal ones are absorbed
    // below, so a halo of near-misses can never become a detection alone.
    if (mask[start] !== STRONG || seen[start]) continue

    let sp = 0
    stack[sp++] = start
    seen[start] = 1

    let count = 0, strongCount = 0, sumX = 0, sumY = 0, sumFit = 0
    let minX = w, maxX = 0, minY = h, maxY = 0
    let overflowed = false

    while (sp > 0) {
      const p = stack[--sp]
      const px = p % w, py = (p / w) | 0

      if (!overflowed) {
        count++; sumX += px; sumY += py; sumFit += fit[p]
        if (mask[p] === STRONG) strongCount++
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
        // Too big to be what we are looking for. Keep draining so the
        // unvisited remainder cannot be picked up as a second, smaller blob,
        // but stop measuring it.
        if (count > maxPixels) overflowed = true
      }

      const left = px > 0, right = px < w - 1
      const up = py > 0, down = py < h - 1
      let q: number
      if (left) { q = p - 1; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q } }
      if (right) { q = p + 1; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q } }
      if (up) { q = p - w; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q } }
      if (down) { q = p + w; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q } }
      if (up && left) { q = p - w - 1; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q } }
      if (up && right) { q = p - w + 1; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q } }
      if (down && left) { q = p + w - 1; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q } }
      if (down && right) { q = p + w + 1; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q } }
    }

    if (overflowed || count < minPixels) continue
    // A blob held together mostly by marginal pixels is a colour smear, not
    // a thing. Demand a confident core.
    if (strongCount < Math.max(2, count * 0.18)) continue

    const bw = maxX - minX + 1, bh = maxY - minY + 1
    // The minor axis is the honest diameter: a ball smeared by motion is
    // still exactly as wide as it is across.
    const radius = Math.min(bw, bh) / 2
    if (radius < cfg.minRadius || radius > cfg.maxRadius) continue

    const circularity = roundness(count, bw, bh, opt.blurTolerance)
    if (circularity < cfg.minCircularity) continue
    if (circularity > cfg.maxCircularity) continue

    const colourScore = sumFit / count / 255
    out.push({
      x: sumX / count,
      y: sumY / count,
      radius,
      circularity,
      pixels: count,
      colourScore,
      score: colourScore * 0.5 + circularity * 0.5,
      width: bw,
      height: bh,
    })
  }

  return out
}

/**
 * How round a blob is, 0-1.
 *
 * Two independent things are being asked, and separating them is what lets
 * a ball in flight pass while a bumper still fails:
 *
 *   round ends — a disc fills π/4 of its bounding box and a rectangle fills
 *                all of it, so *over*-filling the box is the signature of a
 *                slab and under-filling it the signature of a ragged smear.
 *                Only something near π/4 has curved ends.
 *   stretch    — how long it is. Tolerated up to `blurTolerance`, because a
 *                ball crossing the frame at 40mph is a capsule, not a
 *                circle, and rejecting it is how shots get missed.
 *
 * A bumper fails on the first test whatever its aspect ratio, which is why
 * a square-on robot — which the old aspect-only measure scored as *too
 * round* and threw away — is now correctly read as a slab.
 */
export function roundness(
  pixels: number, bw: number, bh: number, blurTolerance = 2.4,
): number {
  const solidity = (pixels / (bw * bh)) / (Math.PI / 4)   // 1 disc, 1.27 rect
  const elongation = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh))
  const roundEnds = Math.max(0, 1 - Math.abs(solidity - 1) * 1.6)
  const stretch = Math.min(1, Math.max(1, blurTolerance) / elongation)
  return Math.max(0, Math.min(1, roundEnds * stretch))
}

/**
 * Morphological closing — dilate, then erode. Fills small holes and bridges
 * gaps of up to twice the radius without growing the blob, which is the
 * repair an antialiased or partly occluded edge needs.
 */
function closeMask(
  mask: Uint8Array, work: Uint8Array, work2: Uint8Array,
  w: number, h: number, r: number,
) {
  if (r <= 0) return
  const n = w * h
  for (let p = 0; p < n; p++) work[p] = mask[p] ? 1 : 0
  dilate(work, work2, w, h, r)
  erode(work, work2, w, h, r)
  for (let p = 0; p < n; p++) {
    // Never downgrade a pixel that was already confident, and never promote
    // one the closing invented: a repaired gap is marginal by definition.
    if (work[p] && !mask[p]) mask[p] = WEAK
  }
}

/** Separable square dilation of `buf`, in place, using `tmp` as scratch. */
function dilate(buf: Uint8Array, tmp: Uint8Array, w: number, h: number, r: number) {
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let v = 0
      const lo = x - r < 0 ? 0 : x - r
      const hi = x + r >= w ? w - 1 : x + r
      for (let xx = lo; xx <= hi; xx++) if (buf[row + xx]) { v = 1; break }
      tmp[row + x] = v
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 0
      const lo = y - r < 0 ? 0 : y - r
      const hi = y + r >= h ? h - 1 : y + r
      for (let yy = lo; yy <= hi; yy++) if (tmp[yy * w + x]) { v = 1; break }
      buf[y * w + x] = v
    }
  }
}

/** Separable square erosion of `buf`, in place, using `tmp` as scratch. */
function erode(buf: Uint8Array, tmp: Uint8Array, w: number, h: number, r: number) {
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let v = 1
      for (let d = -r; d <= r; d++) {
        const xx = x + d
        if (xx < 0 || xx >= w || !buf[row + xx]) { v = 0; break }
      }
      tmp[row + x] = v
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 1
      for (let d = -r; d <= r; d++) {
        const yy = y + d
        if (yy < 0 || yy >= h || !tmp[yy * w + x]) { v = 0; break }
      }
      buf[y * w + x] = v
    }
  }
}

/** Even-odd point-in-polygon, on normalised coordinates. */
export function pointInZone(
  nx: number, ny: number, zone: { x: number; y: number }[],
): boolean {
  if (zone.length < 3) return false
  let inside = false
  for (let i = 0, j = zone.length - 1; i < zone.length; j = i++) {
    const a = zone[i], b = zone[j]
    if ((a.y > ny) !== (b.y > ny) &&
        nx < ((b.x - a.x) * (ny - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** Centroid of a polygon's vertices — good enough to aim a shot at. */
export function zoneCentre(zone: { x: number; y: number }[]): { x: number; y: number } {
  if (!zone.length) return { x: 0.5, y: 0.5 }
  let x = 0, y = 0
  for (const p of zone) { x += p.x; y += p.y }
  return { x: x / zone.length, y: y / zone.length }
}

/**
 * Average colour under a small disc — used to calibrate from a real ball.
 *
 * The spread is returned alongside the average because it is the number
 * that should set the tolerance: a matte ball under flat light varies by a
 * couple of degrees, the same ball under arena spotlights by twenty, and a
 * scout has no way to know which they are looking at.
 */
export function sampleHue(
  frame: ImageData, nx: number, ny: number, radiusPx = 6,
): { hue: number; saturation: number; value: number; hueSpread: number } {
  const cx = Math.round(nx * frame.width)
  const cy = Math.round(ny * frame.height)
  // Hue is an angle, so it has to be averaged as a vector — the mean of 359
  // and 1 is 0, not 180, and red is exactly where that matters.
  let sx = 0, sy = 0, sSat = 0, sVal = 0, n = 0
  const hues: number[] = []

  for (let dy = -radiusPx; dy <= radiusPx; dy++) {
    for (let dx = -radiusPx; dx <= radiusPx; dx++) {
      if (dx * dx + dy * dy > radiusPx * radiusPx) continue
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue
      const i = (y * frame.width + x) * 4
      const [hue, sat, val] = rgbToHsv(frame.data[i], frame.data[i + 1], frame.data[i + 2])
      // Grey pixels have a meaningless hue; letting them vote drags the
      // average toward whatever noise produced them.
      if (sat < 0.12 || val < 0.08) continue
      const rad = (hue * Math.PI) / 180
      sx += Math.cos(rad); sy += Math.sin(rad)
      sSat += sat; sVal += val; n++
      hues.push(hue)
    }
  }
  if (!n) return { hue: 0, saturation: 0, value: 0, hueSpread: 0 }

  let hue = (Math.atan2(sy, sx) * 180) / Math.PI
  if (hue < 0) hue += 360

  // Spread as a robust percentile rather than a standard deviation, so one
  // stray pixel of background inside the disc cannot blow the tolerance up.
  const spread = hues.map((x) => hueDistance(x, hue)).sort((a, b) => a - b)
  const hueSpread = spread[Math.floor(spread.length * 0.9)] ?? 0

  return { hue, saturation: sSat / n, value: sVal / n, hueSpread }
}
