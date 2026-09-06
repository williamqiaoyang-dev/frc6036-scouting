import type { VanishPoint } from './detectors'

/**
 * Proposing the scoring area instead of asking for it.
 *
 * Drawing a box over the goal is the step everything else waits on, and it
 * is the step people do not do — a disabled Scan button with an explanation
 * beside it is still a disabled Scan button. But the video already contains
 * the answer, and it does not need recognising: balls stop being visible
 * because they went into something. Collect where moving tracks end across a
 * match and the densest cluster of endings *is* the goal.
 *
 * This is evidence rather than a guess, which matters for a system whose
 * whole design refuses to invent field knowledge. It also fails honestly: if
 * the endings are scattered — a camera that pans, a colour that is picking
 * up the crowd — no cluster dominates and it says it could not tell, rather
 * than proposing a box around the middle of nothing.
 */

export interface ZoneProposal {
  /** The suggested area, as a normalised rectangle polygon. */
  zone: { x: number; y: number }[]
  /** How many endings fell inside it. */
  support: number
  /** That, as a fraction of all endings seen. 1 means every ball ended here. */
  share: number
  /** Endings per cell in the cluster, against the average. Higher is sharper. */
  sharpness: number
}

export interface AutoZoneOptions {
  /** Grid resolution across the frame. */
  cells: number
  /** Endings needed before anything is proposed at all. */
  minSupport: number
  /** Fraction of endings the cluster must hold to be believable. */
  minShare: number
  /** Padding added around the cluster, in frame widths. */
  pad: number
}

const DEFAULTS: AutoZoneOptions = {
  cells: 24, minSupport: 6, minShare: 0.25, pad: 0.035,
}

/**
 * Find the densest cluster of endings and return a box around it.
 *
 * A grid rather than k-means: the number of goals is not known, the answer
 * has to be a rectangle anyway, and a grid cannot fail to converge in front
 * of a scout at an event. Cells are accumulated, the heaviest is taken as a
 * seed, and its neighbours are absorbed while they carry real weight — which
 * grows the cluster to the size of the goal instead of a fixed radius.
 */
export function proposeZone(
  points: VanishPoint[], options: Partial<AutoZoneOptions> = {},
): ZoneProposal | null {
  const opt = { ...DEFAULTS, ...options }
  const n = points.length
  if (n < opt.minSupport) return null

  const g = opt.cells
  const grid = new Float32Array(g * g)
  for (const p of points) {
    const cx = Math.min(g - 1, Math.max(0, Math.floor(p.x * g)))
    const cy = Math.min(g - 1, Math.max(0, Math.floor(p.y * g)))
    grid[cy * g + cx]++
  }

  // Blur by one cell so a goal straddling a cell boundary is one peak rather
  // than two half-peaks that each lose to a tighter piece of noise.
  const smooth = new Float32Array(g * g)
  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx
          if (yy < 0 || xx < 0 || yy >= g || xx >= g) continue
          sum += grid[yy * g + xx]
        }
      }
      smooth[y * g + x] = sum
    }
  }

  let peak = 0
  for (let i = 1; i < smooth.length; i++) if (smooth[i] > smooth[peak]) peak = i
  if (smooth[peak] <= 0) return null

  // Absorb neighbours that still carry a useful share of the peak. This is a
  // flood fill over the grid, so an L-shaped or wide opening is followed
  // rather than forced into a circle.
  const floor = smooth[peak] * 0.28
  const seen = new Uint8Array(g * g)
  const stack = [peak]
  seen[peak] = 1
  let minX = g, maxX = -1, minY = g, maxY = -1
  let support = 0

  while (stack.length) {
    const p = stack.pop()!
    const x = p % g, y = (p / g) | 0
    support += grid[p]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy
      if (xx < 0 || yy < 0 || xx >= g || yy >= g) continue
      const q = yy * g + xx
      if (seen[q] || smooth[q] < floor) continue
      seen[q] = 1
      stack.push(q)
    }
  }

  const share = support / n
  if (support < opt.minSupport || share < opt.minShare) return null

  const x0 = Math.max(0.005, minX / g - opt.pad)
  const x1 = Math.min(0.995, (maxX + 1) / g + opt.pad)
  const y0 = Math.max(0.005, minY / g - opt.pad)
  const y1 = Math.min(0.995, (maxY + 1) / g + opt.pad)

  const cells = (maxX - minX + 1) * (maxY - minY + 1)
  const average = n / (g * g)

  return {
    zone: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
    support: Math.round(support),
    share,
    sharpness: average > 0 ? (support / cells) / average : 0,
  }
}

/**
 * Why a proposal could not be made, in a scout's words.
 *
 * A goal finder that returns null and says nothing is worse than no goal
 * finder, because the scout has no idea whether to sample the colour, scan
 * more of the match, or give up and draw the box.
 */
export function explainFailure(points: VanishPoint[], options: Partial<AutoZoneOptions> = {}): string {
  const opt = { ...DEFAULTS, ...options }
  if (points.length === 0) {
    return 'No ball was tracked at all during that pass. Sample the colour on a '
      + 'frame where you can see FUEL clearly, or raise Detail, then try again.'
  }
  if (points.length < opt.minSupport) {
    return `Only ${points.length} ball${points.length === 1 ? '' : 's'} was tracked long `
      + 'enough to see where it ended. Scan more of the match, or loosen the colour.'
  }
  return 'Balls were tracked, but they stopped being visible all over the frame '
    + 'rather than in one place — so nothing here looks like a goal. That usually '
    + 'means the camera is panning, or the colour is picking up more than FUEL. '
    + 'Draw the box by hand.'
}
