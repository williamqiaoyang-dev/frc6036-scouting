// The cases that a diagram passes and a real frame does not.
//
// The first version of this pipeline passed every synthetic test it had and
// detected nothing whatsoever on actual match footage. Every group below is
// a property of a real frame that broke it, written as a test so it cannot
// break the same way twice.
import { detectBlobs, roundness, sampleHue, rgbToHsv } from '../vision.ts'
import { Tracker, headingTowards } from '../tracker.ts'
import { learnRobot, RobotWatcher, attributeShot, creditEvent } from '../robotLock.ts'
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

console.log('\n6. Following one robot, and crediting its shots')
{
  // Two robots of the same alliance colour, one either side of the field.
  const frameAt = (mineX: number, otherX: number, shot?: { x: number; y: number }) => {
    const f = blank()
    slab(f, mineX, 250, 42, 17)
    slab(f, otherX, 250, 42, 17)
    if (shot) ball(f, shot.x, shot.y, 8)
    return f
  }

  const first = frameAt(160, 470)
  const learned = learnRobot(first, 160 / W, 250 / H)
  check('learns a robot from one click', !!learned)
  check('and measures its size rather than guessing',
    !!learned && learned.appearance.maxRadius < 90 && learned.appearance.minRadius >= 2,
    learned ? `${learned.appearance.minRadius}-${learned.appearance.maxRadius}` : '')
  // The bumpers are 84x34, so the minor half-axis is 17 — about 2.7% of the
  // frame width. A seed at a guessed size makes the first search window the
  // wrong shape and the shot catchment the wrong size.
  check('and reports that size for the follow to start from',
    !!learned && Math.abs(learned.radius - 17 / W) < 0.012,
    learned ? learned.radius.toFixed(4) : '')

  if (learned) {
    const look = learned.appearance
    const watcher = new RobotWatcher()
    watcher.setLock({ team: 6036, alliance: 'red', appearance: look })
    watcher.seed(160 / W, 250 / H, learned.radius, 0)

    // Mine drives right, the other drives left, and they pass each other.
    let followed = 0
    for (let i = 0; i < 24; i++) {
      const mineX = 160 + i * 8
      const s = watcher.update(frameAt(mineX, 470 - i * 8), W, H, i * 33)
      if (s && Math.abs(s.x * W - mineX) < 40) followed++
    }
    check('follows the robot it was pointed at, past an identical one',
      followed >= 20, `${followed}/24`)

    // A shot that left my robot at t=10 frames, judged where it started.
    const mineAt10 = (160 + 10 * 8) / W
    const mine = attributeShot(watcher, mineAt10, 250 / H, 10 * 33)
    check('credits a ball that set off from the tracked robot', !!mine?.matched,
      mine ? mine.distance.toFixed(3) : 'no verdict')

    // A shot that left the other robot at the same moment.
    const theirsAt10 = (470 - 10 * 8) / W
    const theirs = attributeShot(watcher, theirsAt10, 250 / H, 10 * 33)
    check('does not credit a ball that set off from the other robot',
      !!theirs && !theirs.matched, theirs ? theirs.distance.toFixed(3) : 'no verdict')

    // Nothing is known about a moment the lock was not running.
    check('says nothing about a moment it was not watching',
      attributeShot(watcher, 0.5, 0.5, 60_000) === null)
  }
}

console.log('\n7. End to end: a shot, found and credited, off one pass')
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
    const watcher = new RobotWatcher()
    const first = (() => { const f = blank(); slab(f, 150, 250, 42, 17); slab(f, 380, 250, 42, 17); return f })()
    const learned = learnRobot(first, 150 / W, 250 / H)!
    watcher.setLock({ team: 6036, alliance: 'red', appearance: learned.appearance })
    watcher.seed(150 / W, 250 / H, learned.radius, 0)

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
      watcher.update(f, W, H, at)
      for (const ev of engine.update(f, W, H, at)) credits.push(creditEvent(watcher, ev))
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

console.log('\n8. Looking without believing')
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
