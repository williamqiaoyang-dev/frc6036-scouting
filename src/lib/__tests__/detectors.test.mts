// Synthetic-frame tests for the detector rule engine. Each rule gets a
// scenario it must fire on and one it must stay quiet on — the second half
// matters more, because a detector that fires when nothing happened puts
// invented data into a picklist.
import { DetectorEngine, type Detector } from '../detectors.ts'
import { rgbToHsv } from '../vision.ts'

const W = 320, H = 240

function blank() {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < d.length; i += 4) { d[i]=25; d[i+1]=28; d[i+2]=30; d[i+3]=255 }
  return { data: d, width: W, height: H } as ImageData
}
function ball(frame: ImageData, cx: number, cy: number, r: number, rgb=[240,150,30]) {
  for (let y = Math.max(0,cy-r); y <= Math.min(H-1,cy+r); y++)
    for (let x = Math.max(0,cx-r); x <= Math.min(W-1,cx+r); x++)
      if ((x-cx)**2 + (y-cy)**2 <= r*r) {
        const i=(y*W+x)*4; frame.data[i]=rgb[0]; frame.data[i+1]=rgb[1]; frame.data[i+2]=rgb[2]
      }
  return frame
}
function slab(frame: ImageData, cx: number, cy: number, hw: number, hh: number, rgb=[220,40,50]) {
  for (let y=Math.max(0,cy-hh); y<=Math.min(H-1,cy+hh); y++)
    for (let x=Math.max(0,cx-hw); x<=Math.min(W-1,cx+hw); x++) {
      const i=(y*W+x)*4; frame.data[i]=rgb[0]; frame.data[i+1]=rgb[1]; frame.data[i+2]=rgb[2]
    }
  return frame
}

const orange = rgbToHsv(240,150,30)[0]
const red = rgbToHsv(220,40,50)[0]

const ballLook = {
  hue: orange, hueTolerance: 20, minSaturation: 0.35, minValue: 0.25,
  minRadius: 5, maxRadius: 30, minCircularity: 0.62, maxCircularity: 1, groundY: 0.80,
}
const robotLook = {
  hue: red, hueTolerance: 22, minSaturation: 0.4, minValue: 0.18,
  minRadius: 10, maxRadius: 90, minCircularity: 0.08, maxCircularity: 0.6, groundY: 0.99,
}

// upper-middle box
const goal = [{x:0.35,y:0.10},{x:0.65,y:0.10},{x:0.65,y:0.40},{x:0.35,y:0.40}]

const base = {
  enabled: true, step: 1, dwellSec: 2, stillPx: 6,
  cooldownMs: 200, maxMissedFrames: 6, minTravelPx: 18,
  confidence: 'high' as const, hint: '',
  target: { kind: 'counter' as const, byPhase: { teleop: 'x' } },
}
const det = (over: Partial<Detector>): Detector =>
  ({ ...base, id: 'd', label: 'd', zone: goal, rule: 'enter', appearance: ballLook, ...over } as Detector)

let pass = 0, fail = 0
const check = (name: string, cond: boolean, extra='') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}

/** Run frames through an engine, returning how many events fired. */
function run(d: Detector, frames: ImageData[], msPerFrame = 33) {
  const e = new DetectorEngine([d])
  let n = 0
  frames.forEach((f, i) => { n += e.update(f, W, H, i * msPerFrame).length })
  return n
}

console.log('\n1. enter — the thing arrived here')
{
  // ball flies up into the goal box and stays visible
  const frames = []
  for (let i=0;i<40;i++) frames.push(ball(blank(), 160, 200 - i*4, 10))
  check('a ball arriving in the area fires once', run(det({rule:'enter'}), frames) === 1)
}
{
  // ball travels along the bottom, never reaching the box
  const frames = []
  for (let i=0;i<40;i++) frames.push(ball(blank(), 20 + i*6, 150, 10))
  check('a ball that never arrives never fires', run(det({rule:'enter'}), frames) === 0)
}

console.log('\n2. exit — the thing left here')
{
  // robot starts inside the box, drives out to the right
  const frames = []
  for (let i=0;i<30;i++) frames.push(slab(blank(), 150 + i*6, 70, 22, 9))
  check('a robot leaving its area fires once', run(det({rule:'exit', appearance: robotLook}), frames) === 1)
}
{
  // robot sits still inside the box the whole time
  const frames = []
  for (let i=0;i<30;i++) frames.push(slab(blank(), 155, 70, 22, 9))
  check('a robot that never leaves never fires', run(det({rule:'exit', appearance: robotLook}), frames) === 0)
}

console.log('\n3. vanish-in — the thing arrived and went in')
{
  const frames = []
  for (let i=0;i<30;i++) frames.push(ball(blank(), 160, 200 - i*5, 10))   // into the box
  for (let i=0;i<12;i++) frames.push(blank())                              // gone
  check('a shot that disappears in the goal fires once', run(det({rule:'vanish-in'}), frames) === 1)
}
{
  // ball rolls across the floor and leaves the frame — never in the box
  const frames = []
  for (let i=0;i<30;i++) frames.push(ball(blank(), 10 + i*10, 150, 10))
  for (let i=0;i<12;i++) frames.push(blank())
  check('a ball leaving elsewhere never fires', run(det({rule:'vanish-in'}), frames) === 0)
}

console.log('\n4. dwell — the thing stayed here')
{
  // robot parks in the box for 3 seconds at 33ms/frame
  const frames = []
  for (let i=0;i<100;i++) frames.push(slab(blank(), 155, 70, 22, 9))
  const n = run(det({rule:'dwell', dwellSec: 2, appearance: robotLook, cooldownMs: 5000}), frames)
  check('a robot camping fires once', n === 1, `got ${n}`)
}
{
  // robot passes straight through, well under the dwell time
  const frames = []
  for (let i=0;i<20;i++) frames.push(slab(blank(), 120 + i*6, 70, 22, 9))
  check('a robot passing through never fires',
    run(det({rule:'dwell', dwellSec: 2, appearance: robotLook}), frames) === 0)
}

console.log('\n5. still — the thing stopped moving')
{
  const frames = []
  for (let i=0;i<20;i++) frames.push(slab(blank(), 100 + i*5, 70, 22, 9))  // driving
  for (let i=0;i<200;i++) frames.push(slab(blank(), 195, 70, 22, 9))       // dead
  const wide = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]
  const n = run(det({rule:'still', dwellSec: 3, zone: wide, appearance: robotLook, cooldownMs: 20000}), frames)
  check('a robot that stops fires once', n === 1, `got ${n}`)
}
{
  // never stops moving for long enough
  const frames = []
  for (let i=0;i<200;i++) frames.push(slab(blank(), 60 + (i%40)*4, 70, 22, 9))
  const wide = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]
  check('a robot that keeps driving never fires',
    run(det({rule:'still', dwellSec: 3, zone: wide, appearance: robotLook}), frames) === 0)
}

console.log('\n6. Safety rails')
{
  const frames = []
  for (let i=0;i<40;i++) frames.push(ball(blank(), 160, 200 - i*4, 10))
  check('an undrawn area fires nothing', run(det({rule:'enter', zone: []}), frames) === 0)
  check('a disabled detector fires nothing', run(det({rule:'enter', enabled: false}), frames) === 0)
}
{
  // a red robot and an orange ball in the same frame: the ball detector must
  // not latch onto the bumper, nor the robot detector onto the ball.
  const f = blank(); slab(f, 80, 150, 30, 10); ball(f, 160, 70, 10)
  const e1 = new DetectorEngine([det({ id: 'ball', rule: 'enter' })])
  e1.update(f, W, H, 0)
  const e2 = new DetectorEngine([det({ id: 'bot', rule: 'enter', appearance: robotLook,
    zone: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] })])
  e2.update(f, W, H, 0)
  check('ball detector sees only the ball', e1.detections()[0].detections.length === 1,
        `got ${e1.detections()[0].detections.length}`)
  check('robot detector sees only the robot', e2.detections()[0].detections.length === 1,
        `got ${e2.detections()[0].detections.length}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
