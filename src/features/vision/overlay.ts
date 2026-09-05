import type { Detection, VisionConfig } from '@/lib/vision'
import type { Detector } from '@/lib/detectors'

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
    detectors, colorOf, seen, draft, drawingId, procWidth, procHeight,
  }: {
    detectors: Detector[]
    colorOf: (id: string) => string
    seen: { detectorId: string; detections: Detection[] }[]
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

  const sx = w / procWidth
  const sy = h / Math.max(1, procHeight)
  for (const group of seen) {
    const d = detectors.find((x) => x.id === group.detectorId)
    if (!d?.enabled) continue
    ctx.strokeStyle = colorOf(group.detectorId)
    ctx.lineWidth = 2
    for (const det of group.detections) {
      ctx.beginPath()
      ctx.arc(det.x * sx, det.y * sy, Math.max(5, det.radius * sx), 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}
