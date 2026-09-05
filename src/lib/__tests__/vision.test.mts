// Synthetic-frame tests for the vision pipeline. No camera needed: we render
// ImageData by hand so every case is exactly reproducible.
import { detectBalls, pointInZone, rgbToHsv, hueDistance, DEFAULT_VISION } from '../vision.ts'
import { BallTracker } from '../ballTracker.ts'

const W = 320, H = 240

function blank() {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < d.length; i += 4) { d[0+i]=25; d[1+i]=28; d[2+i]=30; d[3+i]=255 }
  return { data: d, width: W, height: H }
}
function drawBall(frame, cx, cy, r, rgb=[240,150,30]) {
  for (let y = Math.max(0,cy-r); y <= Math.min(H-1,cy+r); y++)
    for (let x = Math.max(0,cx-r); x <= Math.min(W-1,cx+r); x++)
      if ((x-cx)**2 + (y-cy)**2 <= r*r) {
        const i = (y*W+x)*4
        frame.data[i]=rgb[0]; frame.data[i+1]=rgb[1]; frame.data[i+2]=rgb[2]
      }
  return frame
}
function drawBar(frame, x0,y0,x1,y1, rgb=[240,150,30]) {
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
    const i=(y*W+x)*4; frame.data[i]=rgb[0];frame.data[i+1]=rgb[1];frame.data[i+2]=rgb[2]
  }
  return frame
}

const orangeHue = rgbToHsv(240,150,30)[0]
const cfg = { ...DEFAULT_VISION, hue: orangeHue, hueTolerance: 20,
  minRadius: 5, maxRadius: 30, groundY: 0.80,
  // goal zone: upper-middle box
  zone: [{x:0.35,y:0.10},{x:0.65,y:0.10},{x:0.65,y:0.40},{x:0.35,y:0.40}] }

let pass = 0, fail = 0
const check = (name, cond, extra='') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}

console.log('\n1. Detection')
{
  const f = drawBall(blank(), 160, 60, 12)
  const d = detectBalls(f, cfg)
  check('finds one ball', d.length === 1, `got ${d.length}`)
  check('centre is right', d[0] && Math.abs(d[0].x-160)<3 && Math.abs(d[0].y-60)<3,
        d[0] ? `(${d[0].x.toFixed(1)},${d[0].y.toFixed(1)})` : '')
  check('radius is right', d[0] && Math.abs(d[0].radius-12)<3, d[0]?`r=${d[0].radius.toFixed(1)}`:'')
}
{
  const f = blank(); drawBall(f,80,60,10); drawBall(f,200,80,10); drawBall(f,150,150,10)
  check('finds three balls', detectBalls(f,cfg).length === 3)
}
{
  // A long orange bar (bumper edge / sleeve) must not read as a ball.
  const f = drawBar(blank(), 40, 50, 200, 62)
  check('rejects non-round shape', detectBalls(f,cfg).length === 0,
        `got ${detectBalls(f,cfg).length}`)
}
{
  // Wrong colour entirely.
  const f = drawBall(blank(), 160, 60, 12, [40,90,220])
  check('rejects wrong colour', detectBalls(f,cfg).length === 0)
}

console.log('\n2. Floor rejection (the requirement)')
{
  // y=220 is below groundY*240 = 192
  const f = drawBall(blank(), 160, 220, 12)
  check('ball on the floor is ignored', detectBalls(f,cfg).length === 0,
        `got ${detectBalls(f,cfg).length}`)
}
{
  const f = blank(); drawBall(f,160,60,12); drawBall(f,100,215,12); drawBall(f,240,225,12)
  const d = detectBalls(f,cfg)
  check('only the airborne ball survives', d.length === 1 && d[0].y < 100,
        `got ${d.length}`)
}

console.log('\n3. Zone geometry')
{
  check('inside zone', pointInZone(0.5,0.25,cfg.zone))
  check('outside zone (left)', !pointInZone(0.10,0.25,cfg.zone))
  check('outside zone (below)', !pointInZone(0.5,0.70,cfg.zone))
  check('empty zone counts nothing', !pointInZone(0.5,0.25,[]))
}

console.log('\n4. Static mode counting')
{
  const t = new BallTracker('static', cfg)
  let total = 0, now = 0
  // A ball that comes to rest in the goal must score exactly once, however
  // long it stays visible.
  for (let i=0;i<60;i++){ now += 33
    total += t.update(detectBalls(drawBall(blank(),160,60,12),cfg), W,H, now).length }
  check('ball in zone counts once across 60 frames', total === 1, `got ${total}`)
}
{
  const t = new BallTracker('static', cfg)
  let total = 0, now = 0
  // Enters the zone from outside: one count on entry.
  for (const y of [130,110,90,70,60]) { now += 33
    total += t.update(detectBalls(drawBall(blank(),160,y,11),cfg), W,H, now).length }
  for (let i=0;i<10;i++){ now += 33; total += t.update([], W,H, now).length }
  check('ball entering the zone counts once', total === 1, `got ${total}`)
}
{
  const t = new BallTracker('static', cfg)
  // Ball well outside the zone, in play but not scored.
  let total = 0, now = 0
  for (let i=0;i<5;i++){ now += 33
    total += t.update(detectBalls(drawBall(blank(),40,60,12),cfg), W,H, now).length }
  check('ball outside the zone never counts', total === 0, `got ${total}`)
}

console.log('\n5. Dynamic mode: a shot vs a ball just lying around')
{
  const t = new BallTracker('dynamic', cfg)
  let total = 0, now = 0
  // A shot: travels up into the goal, then disappears (went in).
  const path = [[160,200],[160,170],[160,140],[160,110],[160,80],[160,60]]
  for (const [x,y] of path) { now += 33
    total += t.update(detectBalls(drawBall(blank(),x,y,11),cfg), W,H, now).length }
  // Now it is gone from view.
  for (let i=0;i<10;i++){ now += 33; total += t.update([], W,H, now).length }
  check('a shot that vanishes in the goal counts', total === 1, `got ${total}`)
}
{
  const t = new BallTracker('dynamic', cfg)
  let total = 0, now = 0
  // A ball parked inside the zone, visible the whole time: never scores.
  for (let i=0;i<30;i++){ now += 33
    total += t.update(detectBalls(drawBall(blank(),160,60,12),cfg), W,H, now).length }
  check('a ball resting in view never counts', total === 0, `got ${total}`)
}
{
  const t = new BallTracker('dynamic', cfg)
  let total = 0, now = 0
  // Rolls across the floor and out of frame: below the floor line, invisible.
  for (let x=20;x<300;x+=12){ now += 33
    total += t.update(detectBalls(drawBall(blank(),x,215,12),cfg), W,H, now).length }
  for (let i=0;i<10;i++){ now += 33; total += t.update([], W,H, now).length }
  check('a ball rolling on the floor never counts', total === 0, `got ${total}`)
}
{
  const t = new BallTracker('dynamic', cfg)
  let total = 0, now = 0
  // Two separate shots.
  for (let s=0;s<2;s++){
    for (const y of [200,170,140,110,80,60]) { now += 33
      total += t.update(detectBalls(drawBall(blank(),160,y,11),cfg), W,H, now).length }
    for (let i=0;i<10;i++){ now += 33; total += t.update([], W,H, now).length }
  }
  check('two shots count as two', total === 2, `got ${total}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
