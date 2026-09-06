import type { Detection, VisionConfig } from '@/lib/vision'
import type { Detector } from '@/lib/detectors'
import type { Track } from '@/lib/tracker'
import type { RobotSighting } from '@/lib/robotLock'

export interface Point { x: number; y: number }

/**
 * Draws what the detector is thinking on top of the picture: the floor line
 * it ignores below, the goal area it counts inside, and a ring around every
 * ball it can currently see.
 *
 * Shared by the live camera counter and film review — the operator has to
 * be able to tell at a glance *why* something did or did not count, and a
 * second drawing routine would eventually disagree with the first.
 */
export function drawVisionOverlay(
  canvas: HTMLCanvasElement,
  {
    config, draft, detections, procWidth, procHeight,
  }: {
    config: VisionConfig
    draft: Point[]
    detections: Detection[]
    procWidth: number
    procHeight: number
  },
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width = canvas.clientWidth
  const h = canvas.height = canvas.clientHeight
  if (!w || !h) return
  ctx.clearRect(0, 0, w, h)

  // Floor line: everything below is ignored.
  ctx.strokeStyle = 'rgba(255,196,0,.55)'
  ctx.setLineDash([6, 5])
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, config.groundY * h)
  ctx.lineTo(w, config.groundY * h)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(255,196,0,.75)'
  ctx.font = '11px Barlow, sans-serif'
  ctx.fillText('floor — ignored below', 6, config.groundY * h + 13)

  const poly = draft.length ? draft : config.zone
  if (poly.length >= 2) {
    ctx.beginPath()
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)))
    if (!draft.length) ctx.closePath()
    ctx.strokeStyle = draft.length ? '#FFC400' : '#3B8CFF'
    ctx.lineWidth = 2
    ctx.stroke()
    if (!draft.length) { ctx.fillStyle = 'rgba(59,140,255,.14)'; ctx.fill() }
  }
  poly.forEach((p) => {
    ctx.beginPath()
    ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2)
    ctx.fillStyle = draft.length ? '#FFC400' : '#3B8CFF'
    ctx.fill()
  })

  // Detections, scaled from the processing canvas to display size.
  const sx = w / procWidth
  const sy = h / Math.max(1, procHeight)
  for (const d of detections) {
    ctx.beginPath()
    ctx.arc(d.x * sx, d.y * sy, Math.max(5, d.radius * sx), 0, Math.PI * 2)
    ctx.strokeStyle = '#34d399'
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

/**
 * Multi-detector overlay: every enabled detector's area in its own colour,
 * with what it can currently see ringed in the same colour.
 *
 * The colour link is the whole point. When a detector fires on something it
 * should not have, the operator needs to see *which* area caught it without
 * cross-referencing anything.
 */
export function drawDetectorOverlay(
  canvas: HTMLCanvasElement,
  {
    detectors, colorOf, seen, paths, scenery, robot, robots, trail, robotTeam,
    draft, drawingId, procWidth, procHeight,
  }: {
    detectors: Detector[]
    colorOf: (id: string) => string
    seen: { detectorId: string; detections: Detection[] }[]
    /** Confirmed tracks, drawn as the trail each thing has taken. */
    paths?: { detectorId: string; tracks: Track[] }[]
    /** Positions currently judged to be scenery rather than in play. */
    scenery?: { detectorId: string; at: { x: number; y: number; radius: number }[] }[]
    /** The robot being followed, if the scout picked one. */
    robot?: RobotSighting | null
    /** Every robot of that alliance, so a swap is visible when it happens. */
    robots?: RobotSighting[]
    /** Where the followed robot has been. */
    trail?: RobotSighting[]
    robotTeam?: number | null
    draft: Point[]
    drawingId: string | null
    procWidth: number
    procHeight: number
  },
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width = canvas.clientWidth
  const h = canvas.height = canvas.clientHeight
  if (!w || !h) return
  ctx.clearRect(0, 0, w, h)
  ctx.font = '11px Barlow, sans-serif'

  for (const d of detectors) {
    if (!d.enabled || d.zone.length < 3) continue
    const colour = colorOf(d.id)
    ctx.beginPath()
    d.zone.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)))
    ctx.closePath()
    ctx.strokeStyle = colour
    ctx.lineWidth = drawingId === d.id ? 3 : 1.5
    ctx.stroke()
    ctx.fillStyle = colour + '22'
    ctx.fill()

    const top = d.zone.reduce((a, b) => (b.y < a.y ? b : a))
    ctx.fillStyle = colour
    ctx.fillText(d.label, top.x * w + 4, top.y * h - 4)

    // The floor line this detector ignores below, when it has one.
    if (d.appearance.groundY < 0.98) {
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = colour + '77'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, d.appearance.groundY * h)
      ctx.lineTo(w, d.appearance.groundY * h)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // Areas the scout has excluded. Hatched rather than filled, so they read
  // as "nothing is looked at here" and not as another scoring area.
  for (const d of detectors) {
    for (const mask of d.ignore ?? []) {
      if (mask.length < 3) continue
      ctx.beginPath()
      mask.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)))
      ctx.closePath()
      ctx.fillStyle = 'rgba(20,22,24,.55)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,120,120,.6)'
      ctx.setLineDash([5, 4])
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
      const top = mask.reduce((a, b) => (b.y < a.y ? b : a))
      ctx.fillStyle = 'rgba(255,140,140,.85)'
      ctx.fillText('ignored', top.x * w + 4, top.y * h + 12)
    }
  }

  // The polygon being drawn right now.
  if (draft.length) {
    ctx.beginPath()
    draft.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)))
    ctx.strokeStyle = '#FFC400'
    ctx.lineWidth = 2
    ctx.stroke()
    draft.forEach((p) => {
      ctx.beginPath()
      ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#FFC400'
      ctx.fill()
    })
  }

  // ---- flight paths -------------------------------------------------------
  // Drawn under the detections, because the trail is what tells an operator
  // whether the tracker is following one ball or repeatedly losing it and
  // starting again. A count that looks right for the wrong reason is the
  // thing this is here to expose.
  for (const group of paths ?? []) {
    const d = detectors.find((x) => x.id === group.detectorId)
    if (!d?.enabled) continue
    ctx.strokeStyle = colorOf(group.detectorId) + '88'
    ctx.lineWidth = 1.5
    for (const t of group.tracks) {
      if (t.path.length < 2) continue
      ctx.beginPath()
      t.path.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)))
      ctx.stroke()
    }
  }

  const sx = w / procWidth
  const sy = h / Math.max(1, procHeight)
  for (const group of seen) {
    const d = detectors.find((x) => x.id === group.detectorId)
    if (!d?.enabled) continue
    const colour = colorOf(group.detectorId)
    for (const det of group.detections) {
      // Ring weight carries the detector's own confidence, so a marginal
      // blob reads as marginal rather than as a decision already made.
      ctx.strokeStyle = colour
      ctx.globalAlpha = 0.35 + det.score * 0.65
      ctx.lineWidth = det.score > 0.7 ? 2 : 1
      ctx.beginPath()
      ctx.arc(det.x * sx, det.y * sy, Math.max(5, det.radius * sx), 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  // Scenery — balls that have not moved, so they are furniture rather than
  // game pieces. Drawn crossed out: they must be visible, or a scout cannot
  // tell "ignored it" from "never saw it", but they must not look counted.
  for (const group of scenery ?? []) {
    const d = detectors.find((x) => x.id === group.detectorId)
    if (!d?.enabled) continue
    ctx.strokeStyle = 'rgba(150,155,160,.75)'
    ctx.lineWidth = 1
    for (const at of group.at) {
      const cx = at.x * sx, cy = at.y * sy, r = Math.max(5, at.radius * sx)
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.7, cy - r * 0.7)
      ctx.lineTo(cx + r * 0.7, cy + r * 0.7)
      ctx.stroke()
    }
  }

  // ---- the robot being followed -------------------------------------------
  // A square rather than a ring, so it can never be mistaken for a ball, and
  // dashed while the lock is coasting — an operator has to be able to see
  // the difference between "following it" and "guessing where it went".
  // Every robot of the alliance gets a box, so a follow that has quietly
  // jumped to a partner is visible as a jump rather than hidden behind a
  // confident-looking outline.
  for (const r of robots ?? []) {
    if (r.selected) continue
    const cx = r.x * w, cy = r.y * h
    const rad = Math.max(12, r.r * w * 1.15)
    ctx.strokeStyle = 'rgba(200,205,210,.45)'
    ctx.lineWidth = 1
    ctx.strokeRect(cx - rad, cy - rad, rad * 2, rad * 2)
  }

  // Where the followed robot has been. Only the confident stretches: a
  // dotted gap is the honest picture of a moment nobody could see it.
  if (trail && trail.length > 1) {
    ctx.strokeStyle = 'rgba(255,196,0,.45)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    let pen = false
    for (const s of trail) {
      if (s.merged || s.confidence < 0.3) { pen = false; continue }
      if (pen) ctx.lineTo(s.x * w, s.y * h)
      else { ctx.moveTo(s.x * w, s.y * h); pen = true }
    }
    ctx.stroke()
  }

  if (robot) {
    const cx = robot.x * w, cy = robot.y * h
    const r = Math.max(14, robot.r * w * 1.15)
    const solid = robot.confidence >= 0.45 && !robot.merged
    ctx.strokeStyle = solid ? '#FFC400' : '#FFC40088'
    ctx.lineWidth = solid ? 2 : 1.5
    ctx.setLineDash(solid ? [] : [4, 4])
    ctx.strokeRect(cx - r, cy - r, r * 2, r * 2)
    ctx.setLineDash([])
    ctx.fillStyle = '#FFC400'
    const label = !robotTeam ? 'tracked robot'
      : robot.merged ? `${robotTeam} — can't tell which`
      : solid ? `${robotTeam}` : `${robotTeam} — lost`
    ctx.fillText(label, cx - r, cy - r - 5)
  }
}
