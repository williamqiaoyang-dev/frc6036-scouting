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
 * Three mechanisms enforce that, and they are all in `Detector` below:
 *   1. A scoring zone the scout draws over the goal. Nothing outside counts.
 *   2. A floor line. Everything below it is ignored outright.
 *   3. A ball must *enter* the zone and then vanish, which is what going in
 *      looks like. A ball resting in view never scores.
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
  minRadius: 4,
  maxRadius: 40,
  minCircularity: 0.62,
  zone: [],
  groundY: 0.85,
  cooldownMs: 220,
  maxMissedFrames: 6,
  minTravelPx: 18,
}

/**
 * What a thing looks like. Split out from `VisionConfig` so the same blob
 * finder can be pointed at more than balls: a robot bumper is the same
 * search with a wider radius band and a *lower* roundness ceiling, since a
 * bumper is emphatically not a circle.
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
}

export interface Detection {
  /** Centre, in processing-canvas pixels. */
  x: number
  y: number
  radius: number
  /** 0-1: how ball-like this blob is. */
  circularity: number
  pixels: number
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

/** The general form: find blobs matching an appearance. */
export function detectBlobs(frame: ImageData, cfg: Appearance): Detection[] {
  const { width: w, height: h, data } = frame
  const mask = new Uint8Array(w * h)

  const floorPx = Math.floor(cfg.groundY * h)

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Anything at or below the floor line is not a scoring ball.
    if ((p / w | 0) >= floorPx) continue
    const [hue, sat, val] = rgbToHsv(data[i], data[i + 1], data[i + 2])
    if (sat < cfg.minSaturation || val < cfg.minValue) continue
    if (hueDistance(hue, cfg.hue) > cfg.hueTolerance) continue
    mask[p] = 1
  }

  const seen = new Uint8Array(w * h)
  const out: Detection[] = []
  const stack = new Int32Array(w * h)
  const maxPixels = Math.PI * cfg.maxRadius * cfg.maxRadius * 2.2
  const minPixels = Math.max(6, Math.PI * cfg.minRadius * cfg.minRadius * 0.45)

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue

    let sp = 0
    stack[sp++] = start
    seen[start] = 1

    let count = 0, sumX = 0, sumY = 0
    let minX = w, maxX = 0, minY = h, maxY = 0

    while (sp > 0) {
      const p = stack[--sp]
      const px = p % w, py = (p / w) | 0
      count++; sumX += px; sumY += py
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py

      // 4-connectivity is enough and roughly twice as fast as 8.
      if (px > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1 }
      if (px < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1 }
      if (py > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w }
      if (py < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w }

      if (count > maxPixels) break   // too big to be a ball; abandon early
    }

    if (count < minPixels || count > maxPixels) continue

    const bw = maxX - minX + 1, bh = maxY - minY + 1
    const radius = (bw + bh) / 4
    if (radius < cfg.minRadius || radius > cfg.maxRadius) continue

    // A disc fills π/4 of its bounding box; a limb or bumper edge fills far
    // less, and the aspect ratio penalty rejects long thin streaks.
    const fill = count / (bw * bh)
    const aspect = Math.min(bw, bh) / Math.max(bw, bh)
    const circularity = (fill / (Math.PI / 4)) * aspect
    if (circularity < cfg.minCircularity) continue
    if (circularity > cfg.maxCircularity) continue

    out.push({
      x: sumX / count,
      y: sumY / count,
      radius,
      circularity: Math.min(1, circularity),
      pixels: count,
    })
  }

  return out
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

/** Average colour under a small disc — used to calibrate from a real ball. */
export function sampleHue(
  frame: ImageData, nx: number, ny: number, radiusPx = 6,
): { hue: number; saturation: number; value: number } {
  const cx = Math.round(nx * frame.width)
  const cy = Math.round(ny * frame.height)
  let r = 0, g = 0, b = 0, n = 0

  for (let dy = -radiusPx; dy <= radiusPx; dy++) {
    for (let dx = -radiusPx; dx <= radiusPx; dx++) {
      if (dx * dx + dy * dy > radiusPx * radiusPx) continue
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue
      const i = (y * frame.width + x) * 4
      r += frame.data[i]; g += frame.data[i + 1]; b += frame.data[i + 2]; n++
    }
  }
  if (!n) return { hue: 0, saturation: 0, value: 0 }
  const [hue, saturation, value] = rgbToHsv(r / n, g / n, b / n)
  return { hue, saturation, value }
}
