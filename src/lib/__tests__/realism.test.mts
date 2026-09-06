// The cases that a diagram passes and a real frame does not.
//
// The first version of this pipeline passed every synthetic test it had and
// detected nothing whatsoever on actual match footage. Every group below is
// a property of a real frame that broke it, written as a test so it cannot
// break the same way twice.
import { detectBlobs, roundness, sampleHue, rgbToHsv } from '../vision.ts'
import { Tracker, headingTowards } from '../tracker.ts'
import { learnRobot, RobotFleet, attributeShot, creditEvent, allianceLook } from '../robotLock.ts'
import { proposeZone, explainFailure } from '../autoZone.ts'
import {
  buildSignature, matchRegion, histogramMatch, regionHistogram,
  fitAppearance, seedAppearance, robotBox,
} from '../robotSignature.ts'
import { DetectorEngine, type Detector } from '../detectors.ts'

// The processing resolution the app actually uses.
const W = 640, H = 360

function blank(noise = 10): ImageData {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * noise
    d[i] = 58 + n; d[i + 1] = 62 + n; d[i + 2] = 68 + n; d[i + 3] = 255
  }
  return { data: d, width: W, height: H } as ImageData
}

/**
 * A ball as a camera sees one: antialiased edge, lit on top, shadowed
 * underneath, optionally smeared along its travel and optionally blown out
 * by a highlight.
 */
function ball(
  f: ImageData, cx: number, cy: number, r: number,
  { blur = 0, shade = 0.55, highlight = false, rgb = [240, 150, 30] } = {},
): ImageData {
  const R = Math.ceil(r) + Math.ceil(blur) + 1
  for (let y = Math.round(cy - R); y <= Math.round(cy + R); y++) {
    for (let x = Math.round(cx - R); x <= Math.round(cx + R); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      let cov = 0, n = 0
      for (let s = -blur; s <= blur; s += 0.5) {
        n++
        const dd = Math.hypot(x - (cx + s), y - cy)
        cov += dd <= r - 0.5 ? 1 : dd <= r + 0.5 ? (r + 0.5 - dd) : 0
      }
      cov /= Math.max(1, n)
      if (cov <= 0) continue
      const i = (y * W + x) * 4
      // Lambertian-ish: bright top-left, dark bottom-right.
      const lit = 1 - shade / 2 + (shade / 2) * ((cx - x) + (cy - y)) / (2 * r)
      let out = [rgb[0] * lit, rgb[1] * lit, rgb[2] * lit]
      // A specular highlight is white, so it fails the colour gate and cuts
      // the ball in half unless the mask is closed afterwards.
      if (highlight && Math.abs(y - cy) < Math.max(1, r * 0.22)) out = [252, 250, 246]
      for (let c = 0; c < 3; c++) f.data[i + c] = f.data[i + c] * (1 - cov) + out[c] * cov
    }
  }
  return f
}

function slab(
  f: ImageData, cx: number, cy: number, hw: number, hh: number, rgb = [214, 44, 54],
): ImageData {
  for (let y = Math.max(0, cy - hh); y <= Math.min(H - 1, cy + hh); y++) {
    for (let x = Math.max(0, cx - hw); x <= Math.min(W - 1, cx + hw); x++) {
      const i = (y * W + x) * 4
      const lit = 0.82 + 0.18 * (1 - Math.abs(y - cy) / Math.max(1, hh))
      f.data[i] = rgb[0] * lit; f.data[i + 1] = rgb[1] * lit; f.data[i + 2] = rgb[2] * lit
    }
  }
  return f
}

const FUEL = {
  hue: rgbToHsv(240, 150, 30)[0], hueTolerance: 20,
  minSaturation: 0.3, minValue: 0.22,
  minRadius: 2, maxRadius: 56, minCircularity: 0.55, maxCircularity: 1,
  edgeSlack: 1.9, close: 2, blurTolerance: 2.6, groundY: 0.85,
}

let pass = 0, fail = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}

console.log('\n1. A ball the size it really is')
{
  // 5" FUEL across a 27' field is ~1.5% of the frame width. At 640px that is
  // a three pixel radius, and the shipped floor used to be four — which is
  // the whole reason a scan of real footage reported nothing at all.
  for (const r of [2, 3, 4, 6, 12, 24]) {
    const found = detectBlobs(ball(blank(), 300, 120, r), FUEL)
    check(`finds a ${r}px-radius ball`, found.length === 1, `got ${found.length}`)
  }
}
{
  const far = detectBlobs(ball(blank(), 300, 120, 3), FUEL)
  check('measures a far ball roughly right',
    !!far[0] && Math.abs(far[0].radius - 3) <= 1.5, far[0] ? `r=${far[0].radius.toFixed(1)}` : '')
}

console.log('\n2. Lighting a real ball has and a drawn one does not')
{
  // Hard thresholding cut the shadowed half off and left a crescent, which
  // then failed every roundness test there was.
  const found = detectBlobs(ball(blank(), 300, 120, 9, { shade: 0.85 }), FUEL)
  check('a steeply shaded ball survives whole', found.length === 1, `got ${found.length}`)
  check('and still reads as round', !!found[0] && found[0].circularity > 0.6,
    found[0] ? found[0].circularity.toFixed(2) : '')
}
{
  // A specular highlight is white, fails the colour gate, and splits the
  // ball down the middle. Closing the mask puts it back together.
  const found = detectBlobs(ball(blank(), 300, 120, 11, { highlight: true }), FUEL)
  check('a highlight does not split one ball into two', found.length === 1, `got ${found.length}`)
}
{
  // The other edge of the same knob: closing bridges gaps, so it must not
  // bridge the gap between two balls that are merely near each other.
  const f = blank()
  ball(f, 292, 120, 7); ball(f, 316, 120, 7)
  check('two balls close together stay two', detectBlobs(f, FUEL).length === 2,
    `got ${detectBlobs(f, FUEL).length}`)
}
{
  const found = detectBlobs(ball(blank(), 300, 120, 8, { blur: 7 }), FUEL)
  check('a ball smeared by motion is still found', found.length === 1, `got ${found.length}`)
  check('and is not rejected for being long',
    !!found[0] && found[0].circularity >= FUEL.minCircularity,
    found[0] ? found[0].circularity.toFixed(2) : '')
}

{
  // Orange FUEL and a red bumper are about 38 degrees apart, which is inside
  // a 20-degree window widened by the edge slack. When that happened the
  // ball was absorbed into the bumper, the merged blob failed the shape test,
  // and the ball vanished for exactly the frames it was leaving the shooter
  // — the frames that say whose shot it was.
  const f = blank()
  slab(f, 300, 200, 44, 18)
  ball(f, 300, 200, 7)
  const found = detectBlobs(f, FUEL)
  check('a ball against a red bumper is still its own blob', found.length === 1,
    `got ${found.length}`)
  check('and is measured as a ball, not as the bumper',
    !!found[0] && found[0].radius < 12, found[0] ? `r=${found[0].radius.toFixed(1)}` : '')
}

console.log('\n3. Roundness tells a ball from a slab, at any aspect ratio')
{
  const disc = roundness(Math.PI * 100, 20, 20)
  const square = roundness(30 * 30, 30, 30)
  const bumper = roundness(90 * 38, 90, 38)
  const streak = roundness(160 * 10, 160, 10)
  check('a disc is round', disc > 0.9, disc.toFixed(2))
  // The old aspect-only measure scored a square-on robot as *more* round
  // than a ball and threw it away, so a robot facing the camera was
  // invisible to every robot detector.
  check('a square-on robot is not round', square < 0.7, square.toFixed(2))
  check('a bumper is not round', bumper < 0.7, bumper.toFixed(2))
  check('a streak is not round', streak < 0.3, streak.toFixed(2))
  check('a square robot still outranks a streak', square > streak)
}

console.log('\n4. Sampling a colour off a real ball')
{
  const f = ball(blank(), 300, 120, 14, { shade: 0.8 })
  const s = sampleHue(f, 300 / W, 120 / H, 6)
  check('finds the ball hue', Math.abs(s.hue - FUEL.hue) < 12, s.hue.toFixed(1))
  check('reports how much it varied', s.hueSpread > 0 && s.hueSpread < 60, s.hueSpread.toFixed(1))
}
{
  // Hue is an angle: averaging red arithmetically lands on cyan.
  const f = blank()
  ball(f, 300, 120, 14, { rgb: [225, 40, 42], shade: 0.3 })
  const s = sampleHue(f, 300 / W, 120 / H, 6)
  const red = rgbToHsv(225, 40, 42)[0]
  const gap = Math.min(Math.abs(s.hue - red), 360 - Math.abs(s.hue - red))
  check('averages red without wrapping to cyan', gap < 15, `${s.hue.toFixed(1)} vs ${red.toFixed(1)}`)
}

console.log('\n5. Tracking: the same ball, not a new one every frame')
{
  // Two balls crossing. Nearest-neighbour association swaps them; predicting
  // where each is going does not.
  const t = new Tracker({ minHits: 2 })
  const ids = new Set<number>()
  for (let i = 0; i < 30; i++) {
    const f = blank()
    ball(f, 120 + i * 12, 100, 9)
    ball(f, 480 - i * 12, 104, 9)
    const dets = detectBlobs(f, FUEL)
    t.update(dets, W, H, i * 33)
    for (const tr of t.confirmed) ids.add(tr.id)
  }
  check('two crossing balls stay two tracks', ids.size === 2, `got ${ids.size}`)
}
{
  // A ball passing a bright light vanishes for a few frames. A track that
  // dies there turns one shot into two.
  const t = new Tracker({ minHits: 2, maxMissed: 6 })
  const ids = new Set<number>()
  for (let i = 0; i < 30; i++) {
    const f = blank()
    const occluded = i >= 12 && i <= 14
    if (!occluded) ball(f, 100 + i * 14, 120, 9)
    t.update(detectBlobs(f, FUEL), W, H, i * 33)
    for (const tr of t.confirmed) ids.add(tr.id)
  }
  check('a three-frame occlusion does not split the track', ids.size === 1, `got ${ids.size}`)
}
{
  const t = new Tracker({ minHits: 2 })
  for (let i = 0; i < 12; i++) t.update(detectBlobs(ball(blank(), 100 + i * 16, 200 - i * 9, 9), FUEL), W, H, i * 33)
  const tr = t.confirmed[0]
  check('a track knows where it is going', !!tr && headingTowards(tr, 500, 60) > 0.8,
    tr ? headingTowards(tr, 500, 60).toFixed(2) : 'no track')
  check('and knows it is not going the other way', !!tr && headingTowards(tr, 20, 340) < -0.8)
}
{
  // One frame of colour noise must never become a track anything acts on.
  const t = new Tracker({ minHits: 2 })
  const f = blank(); ball(f, 300, 120, 9)
  t.update(detectBlobs(f, FUEL), W, H, 0)
  check('one sighting is not yet believed', t.confirmed.length === 0)
  t.update(detectBlobs(ball(blank(), 306, 122, 9), FUEL), W, H, 33)
  check('two sightings are', t.confirmed.length === 1)
}

console.log('\n6. Rejecting what is not in play')
{
  // The complaint that started this: game pieces at the back of the field,
  // in the far hopper and behind the guardrail are exactly the right colour
  // and were counted as live balls.
  const withBackground = () => {
    const f = blank()
    // A rack of balls across the back of the field.
    for (let i = 0; i < 6; i++) ball(f, 120 + i * 40, 40, 5)
    return f
  }

  // 6a. A ceiling line excludes the back of the field outright.
  const plain = detectBlobs(withBackground(), FUEL)
  check('without a ceiling, the back rack is all detected', plain.length === 6,
    `got ${plain.length}`)
  const capped = detectBlobs(withBackground(), { ...FUEL, ceilingY: 0.2 })
  check('a ceiling line removes them', capped.length === 0, `got ${capped.length}`)
  // ...and must not remove the ball that is in play below it.
  const f = withBackground(); ball(f, 320, 180, 8)
  const kept = detectBlobs(f, { ...FUEL, ceilingY: 0.2 })
  check('while keeping the ball in play', kept.length === 1, `got ${kept.length}`)
}
{
  // 6b. Scenery: a ball that never moves is furniture, whatever its colour.
  const goal = [{ x: 0.1, y: 0.05 }, { x: 0.9, y: 0.05 },
                { x: 0.9, y: 0.6 }, { x: 0.1, y: 0.6 }]
  const det = (over: Partial<Detector>): Detector => ({
    id: 'd', label: 'd', hint: '', enabled: true,
    target: { kind: 'counter', byPhase: { teleop: 'x' } },
    appearance: FUEL, zone: goal, rule: 'enter',
    step: 1, dwellSec: 2, stillPx: 6, cooldownMs: 200,
    maxMissedFrames: 5, minTravelPx: 20, confidence: 'high', minHits: 2,
    ...over,
  } as Detector)

  const still = (d: Detector) => {
    const e = new DetectorEngine([d])
    let n = 0
    for (let i = 0; i < 90; i++) n += e.update(ball(blank(), 300, 80, 7), W, H, i * 33).length
    return n
  }
  check('a motionless ball fires once without scenery suppression',
    still(det({})) === 1)
  check('and never with it', still(det({ scenerySec: 1 })) === 0)

  // A ball that is actually moving must still count.
  const e = new DetectorEngine([det({ scenerySec: 1 })])
  let fired = 0
  for (let i = 0; i < 40; i++) {
    fired += e.update(ball(blank(), 60 + i * 14, 300 - i * 6, 7), W, H, i * 33).length
  }
  check('a moving ball still counts with scenery suppression on', fired === 1, `got ${fired}`)
}
{
  // 6c. Ignore areas: the scout says where not to look.
  const goal = [{ x: 0.05, y: 0.02 }, { x: 0.95, y: 0.02 },
                { x: 0.95, y: 0.9 }, { x: 0.05, y: 0.9 }]
  const base: Detector = {
    id: 'd', label: 'd', hint: '', enabled: true,
    target: { kind: 'counter', byPhase: { teleop: 'x' } },
    appearance: FUEL, zone: goal, rule: 'enter',
    step: 1, dwellSec: 2, stillPx: 6, cooldownMs: 200,
    maxMissedFrames: 5, minTravelPx: 20, confidence: 'high', minHits: 2,
  } as Detector
  const f = blank()
  ball(f, 100, 80, 7)   // in the corner we will mask off
  ball(f, 400, 200, 7)  // in play
  const open = new DetectorEngine([base])
  open.observe(f, W, H)
  check('both balls are seen without a mask', open.detections()[0].detections.length === 2)

  const masked = new DetectorEngine([{ ...base,
    ignore: [[{ x: 0.05, y: 0.05 }, { x: 0.35, y: 0.05 },
              { x: 0.35, y: 0.4 }, { x: 0.05, y: 0.4 }]] }])
  masked.observe(f, W, H)
  check('an ignore area removes only the one inside it',
    masked.detections()[0].detections.length === 1,
    `got ${masked.detections()[0].detections.length}`)
}

console.log('\n7. Proposing the goal from where balls end')
{
  // Twenty shots that all vanish around the same opening, plus noise
  // elsewhere. The proposal should land on the opening.
  const pts = []
  for (let i = 0; i < 20; i++) {
    pts.push({ x: 0.72 + (Math.random() - 0.5) * 0.05, y: 0.18 + (Math.random() - 0.5) * 0.05, at: i })
  }
  for (let i = 0; i < 4; i++) pts.push({ x: Math.random(), y: Math.random(), at: i })

  const p = proposeZone(pts)
  check('proposes an area at all', !!p)
  if (p) {
    const cx = (p.zone[0].x + p.zone[1].x) / 2
    const cy = (p.zone[0].y + p.zone[2].y) / 2
    check('centred on where the balls actually went',
      Math.abs(cx - 0.72) < 0.09 && Math.abs(cy - 0.18) < 0.09,
      `(${cx.toFixed(2)}, ${cy.toFixed(2)})`)
    check('and reports how much of the evidence backs it', p.share > 0.6,
      p.share.toFixed(2))
  }
}
{
  // Scattered endings mean a panning camera or a colour picking up the
  // crowd. Proposing a box around the middle of nothing would be worse than
  // proposing nothing.
  const scattered = Array.from({ length: 60 }, (_, i) =>
    ({ x: (i * 0.137) % 1, y: (i * 0.229) % 1, at: i }))
  check('refuses when the endings are scattered', proposeZone(scattered) === null)
  check('and says why', explainFailure(scattered).includes('all over the frame'))
  check('says something different when nothing was tracked',
    explainFailure([]).includes('No ball was tracked'))
}

console.log('\n8. Following a whole alliance, and knowing which one is yours')
{
  // Three robots of the same colour. A single-target follow has no way to
  // show that it has quietly swapped onto a partner; tracking all of them
  // makes a swap visible, and lets the scout point at the one they mean.
  const frameAt = (i: number) => {
    const f = blank()
    slab(f, 120 + i * 6, 250, 42, 17)   // mine, driving right
    slab(f, 330 - i * 4, 250, 42, 17)   // a partner, driving left
    slab(f, 520, 180, 42, 17)           // a partner, parked
    return f
  }

  const learned = learnRobot(frameAt(0), 120 / W, 250 / H)!
  const fleet = new RobotFleet()
  fleet.setLock({ team: 6036, alliance: 'red', appearance: learned.appearance })

  for (let i = 0; i < 5; i++) fleet.update(frameAt(i), W, H, i * 33)
  check('sees every robot of the alliance, not just one', fleet.robots.length === 3,
    `got ${fleet.robots.length}`)

  check('picking one by pointing at it works',
    fleet.selectAt((120 + 5 * 6) / W, 250 / H))
  const chosen = fleet.robots.find((r) => r.selected)
  check('and it is the one that was pointed at',
    !!chosen && Math.abs(chosen.x * W - (120 + 5 * 6)) < 30,
    chosen ? `${(chosen.x * W) | 0}` : 'none')

  // A partner drives straight through it. While they are apart the follow
  // must hold; while they physically overlap they are one coloured shape and
  // no colour tracker can separate them — so the requirement there is that it
  // says so, rather than reporting a confident centroid between two robots.
  let apartOk = 0, apartN = 0
  let mergedFlagged = 0, overlapN = 0
  for (let i = 5; i < 40; i++) {
    const mineX = 120 + i * 6
    const theirsX = 330 - i * 4
    const overlapping = Math.abs(mineX - theirsX) < 84
    const s = fleet.update(frameAt(i), W, H, i * 33)
    if (overlapping) {
      overlapN++
      if (!s || s.merged || s.confidence < 0.3) mergedFlagged++
    } else {
      apartN++
      if (s && s.confidence >= 0.3 && Math.abs(s.x * W - mineX) < 45) apartOk++
    }
  }
  check('holds the right robot whenever they are apart', apartOk === apartN,
    `${apartOk}/${apartN}`)
  check('and admits it cannot tell them apart while they overlap',
    mergedFlagged >= overlapN - 2, `${mergedFlagged}/${overlapN}`)

  // The point of admitting it: a shot from that stretch is not credited.
  const duringMerge = fleet.positionAt(21 * 33)
  check('so a shot during the overlap is left unattributed', duringMerge === null)

  check('an alliance colour is available before anyone clicks',
    allianceLook('red').hue > 300 && allianceLook('blue').hue > 180)
}
{
  // Pointing at empty carpet must not select anything.
  const f = blank(); slab(f, 200, 250, 42, 17)
  const learned = learnRobot(f, 200 / W, 250 / H)!
  const fleet = new RobotFleet()
  fleet.setLock({ team: 1, alliance: 'red', appearance: learned.appearance })
  for (let i = 0; i < 4; i++) fleet.update(f, W, H, i * 33)
  check('pointing at nothing selects nothing', !fleet.selectAt(0.05, 0.9))
}

{
  // Pointing at a robot the fleet has not found teaches it a better colour,
  // and the lock is then updated with that colour. If that update wiped the
  // fleet, it would also wipe the click that produced it — and pointing at a
  // robot would silently do nothing at all.
  const frame = (i: number) => {
    const f = blank()
    slab(f, 200 + i * 5, 250, 42, 17, [214, 44, 54])
    return f
  }
  const fleet = new RobotFleet()
  // Start on the generic alliance colour, as picking a team does.
  fleet.setLock({ team: 6036, alliance: 'red', appearance: allianceLook('red') })
  fleet.update(frame(0), W, H, 0)

  const learned = learnRobot(frame(0), 200 / W, 250 / H)!
  fleet.seed(200 / W, 250 / H, learned.radius, 0)
  // Exactly what the UI does next.
  fleet.setLock({ team: 6036, alliance: 'red', appearance: learned.appearance })

  let followed = 0
  for (let i = 1; i < 12; i++) {
    const s = fleet.update(frame(i), W, H, i * 33)
    if (s && s.confidence >= 0.3 && Math.abs(s.x * W - (200 + i * 5)) < 40) followed++
  }
  check('a click that teaches a new colour still selects the robot',
    followed >= 8, `${followed}/11`)

  // Changing team, though, must forget everything.
  fleet.setLock({ team: 254, alliance: 'red', appearance: learned.appearance })
  check('changing team forgets the old selection', fleet.sighting === null)
}

console.log('\n9. Recognising a robot from a photograph of it')
{
  /** A photo of a robot: a bumper, a distinctive intake, on some carpet. */
  function photo(
    bumper: number[], intake: number[], carpet: number[],
  ): ImageData {
    const PW = 240, PH = 180
    const d = new Uint8ClampedArray(PW * PH * 4)
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 12
      d[i] = carpet[0] + n; d[i + 1] = carpet[1] + n; d[i + 2] = carpet[2] + n; d[i + 3] = 255
    }
    // Lit from the top left and noisy, like a photograph rather than a
    // diagram — a fit that only works on flat colour is no use at a venue.
    const put = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * PW + x) * 4
        const lit = 0.72 + 0.38 * (1 - (x - x0 + (y - y0)) / ((x1 - x0) + (y1 - y0)))
        const n = (Math.random() - 0.5) * 16
        d[i] = c[0] * lit + n; d[i + 1] = c[1] * lit + n; d[i + 2] = c[2] * lit + n
      }
    }
    put(58, 60, 182, 130, bumper)
    put(92, 44, 148, 62, intake)
    return { data: d, width: PW, height: PH } as ImageData
  }

  const mine = photo([214, 44, 54], [70, 210, 120], [70, 74, 80])
  const sig = buildSignature(mine, { iterations: 200 })

  check('a photo produces a usable search', sig.quality > 0.3, sig.quality.toFixed(2))
  // From the histogram seed the fit usually has nothing to do — the seed is
  // already the answer — and stopping early is correct rather than a failure.
  // What must hold is that it stopped because it converged, not because it
  // ran out of budget.
  check('stops early when the seed was already right',
    sig.iterations < 200 && sig.quality > 0.5,
    `${sig.improvements} improvements in ${sig.iterations} steps, q=${sig.quality.toFixed(2)}`)
  check('and it is deterministic — two scouts get the same setup',
    Math.abs(buildSignature(mine, { iterations: 200 }).appearance.hue - sig.appearance.hue) < 1e-9)

  // The point of the photo: telling two robots of the same alliance apart.
  const partner = photo([214, 44, 54], [235, 225, 60], [70, 74, 80])
  const mineScore = matchRegion(mine, sig, 120, 90, 62, 45)
  const theirsScore = matchRegion(partner, sig, 120, 90, 62, 45)
  check('matches the robot it was built from', mineScore > 0.55, mineScore.toFixed(2))
  check('and scores a same-bumper partner lower',
    theirsScore < mineScore - 0.1, `${theirsScore.toFixed(2)} vs ${mineScore.toFixed(2)}`)

  // Carpet is not a robot.
  const empty = matchRegion(mine, sig, 20, 165, 18, 12)
  check('and scores empty carpet lowest of all', empty < theirsScore, empty.toFixed(2))

  check('histogram intersection is bounded and self-consistent', (() => {
    const a = regionHistogram(mine, 58, 60, 182, 130)
    return Math.abs(histogramMatch(a, a) - 1) < 0.01
  })())

  // More iterations must never make the fit worse than fewer.
  const quick = buildSignature(mine, { iterations: 24 })
  check('a longer fit is never worse than a short one',
    sig.quality >= quick.quality - 1e-6,
    `${quick.quality.toFixed(3)} -> ${sig.quality.toFixed(3)}`)

  // The fit has to be able to climb, not just sit on a good seed. Started on
  // cyan for a red robot, a hard pass-or-fail objective scores zero in every
  // direction and the fit cannot move at all — which is what it did before
  // the objective was given a slope through its dead zone.
  const box = robotBox(mine)
  const wrong = { ...seedAppearance(sig.hist, mine), hue: 185, hueTolerance: 9,
                  minSaturation: 0.55, minValue: 0.6 }
  const stuck = fitAppearance(mine, wrong, box.x0, box.y0, box.x1, box.y1, 1)
  const climbed = fitAppearance(mine, wrong, box.x0, box.y0, box.x1, box.y1, 400)
  check('climbs out of a deliberately wrong start',
    climbed.score > stuck.score + 0.5,
    `${stuck.score.toFixed(2)} -> ${climbed.score.toFixed(2)}`)
  check('and lands on the robot\'s actual colour',
    Math.min(Math.abs(climbed.appearance.hue - 356), 360 - Math.abs(climbed.appearance.hue - 356)) < 25,
    `hue ${climbed.appearance.hue.toFixed(0)}`)
  check('and more steps got it further than fewer',
    climbed.score > fitAppearance(mine, wrong, box.x0, box.y0, box.x1, box.y1, 100).score)
}

{
  // The box a scout sees has to be the robot's box.
  //
  // Two separate bugs made it "massive and doesn't make sense". The photo's
  // pixel sizes were carried into video, where they mean nothing: a close-up
  // gave a floor of 21px radius and a ceiling of 159px, so in a 640px frame
  // the real robot was rejected for being too small and only enormous merged
  // patches of field passed. And the box was drawn as a square from the
  // *minor* half-axis, which fits a wide bumper in neither direction.
  const closeUp = (() => {
    const PW = 320, PH = 240
    const d = new Uint8ClampedArray(PW * PH * 4)
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 12
      d[i] = 70 + n; d[i + 1] = 74 + n; d[i + 2] = 80 + n; d[i + 3] = 255
    }
    // Robot filling 80% of the photo, the way people photograph a robot.
    const bw = PW * 0.8, bh = PH * 0.44
    const x0 = (PW - bw) / 2 | 0, y0 = (PH - bh) / 2 | 0
    for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) {
      const i = (y * PW + x) * 4
      const lit = 0.7 + 0.4 * (1 - ((x - x0) + (y - y0)) / (bw + bh))
      d[i] = 214 * lit; d[i + 1] = 44 * lit; d[i + 2] = 54 * lit
    }
    return { data: d, width: PW, height: PH } as ImageData
  })()

  const sig = buildSignature(closeUp)
  check('a photo carries no video pixel sizes',
    sig.appearance.minRadius <= 6 && sig.minRadiusFrac > 0 && sig.maxRadiusFrac < 0.3,
    `min ${sig.appearance.minRadius}, frac ${sig.minRadiusFrac}-${sig.maxRadiusFrac}`)

  // Applied to match footage, that photo must still find a normal robot.
  const matchFrame = (x: number) => {
    const f = blank()
    slab(f, x, 250, 42, 17)
    return f
  }
  const fleet = new RobotFleet()
  fleet.setLock({ team: 6036, alliance: 'red', appearance: sig.appearance, signature: sig })
  fleet.seed(200 / W, 250 / H, 17 / W, 0)
  let seen: ReturnType<typeof fleet.update> = null
  for (let i = 0; i < 6; i++) seen = fleet.update(matchFrame(200 + i * 4), W, H, i * 33)

  check('a close-up photo still finds a robot in a wide match shot', !!seen, 'nothing found')
  if (seen) {
    // The bumper is 84x34. The box must be that, not a square, and not huge.
    check('the box is the robot, not a quarter of the picture',
      seen.w * W < 140 && seen.h * H < 90,
      `${(seen.w * W) | 0}x${(seen.h * H) | 0}`)
    check('and it is wider than it is tall, like a bumper',
      seen.w * W > seen.h * H,
      `${(seen.w * W) | 0}x${(seen.h * H) | 0}`)
    check('and it actually matches the bumper it is drawn around',
      Math.abs(seen.w * W - 85) < 25 && Math.abs(seen.h * H - 35) < 20,
      `${(seen.w * W) | 0}x${(seen.h * H) | 0} vs 85x35`)
  }
}

console.log('\n10. End to end: a shot, found and credited, off one pass')
{
  // Everything at once, the way the app runs it: two robots of the same
  // colour, one of them shoots, the detector finds the shot, and the lock
  // decides whose it was.
  const goal = [{ x: 0.62, y: 0.06 }, { x: 0.84, y: 0.06 },
                { x: 0.84, y: 0.30 }, { x: 0.62, y: 0.30 }]
  const detector: Detector = {
    id: 'fuel_scored', label: 'FUEL scored', hint: '', enabled: true,
    target: { kind: 'counter', byPhase: { teleop: 'teleop_fuel_scored' } },
    appearance: FUEL, zone: goal, rule: 'vanish-in',
    step: 1, dwellSec: 2, stillPx: 8, cooldownMs: 200,
    maxMissedFrames: 5, minTravelPx: 20, confidence: 'high',
    minHits: 2, minApproach: 0.55, minSpeedPx: 0.6,
  }

  /** Mine on the left, theirs on the right; the ball flies from `from`. */
  function play(from: 'mine' | 'theirs') {
    const engine = new DetectorEngine([detector])
    const fleet = new RobotFleet()
    const first = (() => { const f = blank(); slab(f, 150, 250, 42, 17); slab(f, 380, 250, 42, 17); return f })()
    const learned = learnRobot(first, 150 / W, 250 / H)!
    fleet.setLock({ team: 6036, alliance: 'red', appearance: learned.appearance })
    fleet.seed(150 / W, 250 / H, learned.radius, 0)

    const startX = from === 'mine' ? 150 : 380
    const credits: ReturnType<typeof creditEvent>[] = []

    for (let i = 0; i < 34; i++) {
      const f = blank()
      slab(f, 150, 250, 42, 17)
      slab(f, 380, 250, 42, 17)
      // 22 frames of flight into the goal, then it is gone.
      if (i < 22) {
        const k = i / 21
        ball(f, startX + (470 - startX) * k, 250 - 185 * k, 7, { blur: 2 })
      }
      const at = i * 33
      fleet.update(f, W, H, at)
      for (const ev of engine.update(f, W, H, at)) credits.push(creditEvent(fleet, ev))
    }
    return credits
  }

  const mine = play('mine')
  check('the shot is found at all', mine.length === 1, `got ${mine.length}`)
  check('and credited to the robot it left', mine[0]?.team === 6036,
    mine[0] ? `team ${mine[0].team}, ${mine[0].distance?.toFixed(3)} away` : '')

  const theirs = play('theirs')
  check('a shot from the other robot is found too', theirs.length === 1, `got ${theirs.length}`)
  check('but is not credited to the followed one',
    theirs[0]?.team === null && theirs[0]?.rejected === true,
    theirs[0] ? `team ${theirs[0].team}, rejected ${theirs[0].rejected}` : '')
}

console.log('\n11. Looking without believing')
{
  // Scrubbing a video, sampling a colour and aiming at a robot all need the
  // detectors to report what is in the frame on screen. If that ran the real
  // update, dragging the scrub bar would manufacture shots.
  const goal = [{ x: 0.3, y: 0.05 }, { x: 0.7, y: 0.05 },
                { x: 0.7, y: 0.45 }, { x: 0.3, y: 0.45 }]
  const detector: Detector = {
    id: 'fuel_scored', label: 'FUEL scored', hint: '', enabled: true,
    target: { kind: 'counter', byPhase: { teleop: 'x' } },
    appearance: FUEL, zone: goal, rule: 'enter',
    step: 1, dwellSec: 2, stillPx: 8, cooldownMs: 200,
    maxMissedFrames: 5, minTravelPx: 20, confidence: 'high', minHits: 2,
  }
  const engine = new DetectorEngine([detector])
  // A ball sitting in the goal, looked at fifty times over.
  for (let i = 0; i < 50; i++) engine.observe(ball(blank(), 320, 90, 9), W, H)
  check('observing never fires anything', engine.detections()[0].detections.length === 1)

  // And it must still report what it sees, or the readout that tells a scout
  // their colour is right would always say zero.
  check('but still reports what it can see',
    engine.detections()[0].detections.length === 1,
    `${engine.detections()[0].detections.length}`)

  // The real update on the same picture does fire — so the difference is the
  // observe path, not the setup.
  let fired = 0
  for (let i = 0; i < 6; i++) fired += engine.update(ball(blank(), 320, 90, 9), W, H, i * 33).length
  check('while the real update on the same frames does', fired === 1, `got ${fired}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
