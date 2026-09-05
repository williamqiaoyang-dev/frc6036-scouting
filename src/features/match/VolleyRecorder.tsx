import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { Volley } from '@/lib/schema'

const FILLS = [25, 50, 75, 100]

/** Longer than any real burst; past this the hold is assumed to be stuck. */
const MAX_VOLLEY_SEC = 45

/**
 * Records shooting as bursts instead of individual balls.
 *
 * A robot puts 100-300 FUEL downrange in a match. Nobody can tap that
 * accurately — the tapping itself takes longer than the shooting — so this
 * asks for the two things a person watching really can judge: when the
 * robot was firing, and roughly how much of its hopper went out. The ball
 * count is then derived from that and the magazine size the pit crew
 * measured, rather than guessed at live.
 *
 * Hold the bar while the robot is firing (space works too), let go, say how
 * much of the magazine emptied. That is the whole interaction.
 */
export function VolleyRecorder({
  volleys, magazine, onMagazineChange, onCommit, onRemove, now, running,
}: {
  volleys: Volley[]
  magazine: number
  onMagazineChange: (n: number) => void
  onCommit: (v: Volley) => void
  onRemove: (index: number) => void
  /** Seconds since the match clock started. */
  now: () => number
  running: boolean
}) {
  const [firing, setFiring] = useState<number | null>(null)
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null)
  const [, tick] = useState(0)
  const holdRef = useRef<number | null>(null)

  // Redraw the live duration while a volley is being held.
  useEffect(() => {
    if (firing === null) return
    const id = setInterval(() => tick((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [firing])

  // Both of these read and write the ref, never the state, and the state is
  // only along for the rendering. A release can arrive before React has
  // re-rendered from the press — the main thread need only be busy for a
  // moment — and a handler that consulted state would drop that release and
  // leave the volley running for the rest of the match.
  function start() {
    if (pending || holdRef.current != null) return
    holdRef.current = now()
    setFiring(holdRef.current)
  }
  function end() {
    const from = holdRef.current
    if (from == null) return
    holdRef.current = null
    setFiring(null)
    const to = now()
    // A stray tap is not a volley. Anything this short is a misclick.
    if (to - from < 0.4) return
    setPending({ start: from, end: to })
  }

  // A volley must end even when the release never reaches the button: the
  // pointer can leave the window, the browser can steal capture, the scout
  // can alt-tab mid-burst. Any of those used to strand the recorder
  // "firing" for the rest of the match, so the release is caught on the
  // window as well, and a burst longer than any real one gives up.
  // Attached always, not only while firing: gating them on state would mean
  // a release that lands before React has re-rendered from the press finds
  // no listener at all. `end` is a no-op when nothing is being held, so
  // there is nothing to gate.
  useEffect(() => {
    const stop = () => end()
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
    }
  }, [])

  // Backstop: a hold longer than any real burst is a stuck button.
  useEffect(() => {
    if (firing === null) return
    const bail = setTimeout(() => end(), MAX_VOLLEY_SEC * 1000)
    return () => clearTimeout(bail)
  }, [firing])

  // Space is the natural key for "hold while it shoots", and repeats must be
  // ignored or the browser's auto-repeat restarts the volley every frame.
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.code !== 'Space' || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault(); start()
    }
    function up(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      e.preventDefault(); end()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [firing, pending])

  function commit(fillPct: number) {
    if (!pending) return
    onCommit({
      ...pending,
      fillPct,
      magazine,
      balls: Math.round((magazine * fillPct) / 100),
    })
    setPending(null)
  }

  const held = firing !== null ? Math.max(0, now() - firing) : 0
  const totalBalls = volleys.reduce((s, v) => s + v.balls, 0)
  const fireTime = volleys.reduce((s, v) => s + (v.end - v.start), 0)

  return (
    <div>
      {pending ? (
        <div className="rounded-panel border border-signal bg-signal/10 p-3">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-display text-[16px] font-600 text-chalk">
              How much of the magazine went out?
            </span>
            <span className="font-mono text-[13px] text-chalk-dim">
              {(pending.end - pending.start).toFixed(1)}s of fire
            </span>
          </div>
          <div className="flex gap-1.5">
            {FILLS.map((f) => (
              <button key={f} type="button" onClick={() => commit(f)}
                className="tap-target flex-1 rounded-panel border border-signal/40 bg-deck-900 py-3
                           font-display text-[19px] font-700 text-signal transition
                           hover:bg-signal/20 active:translate-y-px">
                {f}%
                <span className="mt-0.5 block font-sans text-[12px] font-400 text-chalk-faint">
                  ≈{Math.round((magazine * f) / 100)} FUEL
                </span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setPending(null)}
            className="mt-2 text-[12px] text-chalk-faint underline hover:text-chalk">
            discard that volley
          </button>
        </div>
      ) : (
        <button
          type="button"
          onPointerDown={start}
          onPointerUp={end}
          onPointerLeave={end}
          onContextMenu={(e) => e.preventDefault()}
          className={clsx(
            'tap-target w-full select-none rounded-panel border py-6 text-center transition',
            firing !== null
              ? 'border-emerald-400 bg-emerald-400/20'
              : 'border-signal/35 bg-signal/10 hover:bg-signal/20',
          )}
        >
          <span className={clsx('block font-display text-[22px] font-700',
            firing !== null ? 'text-emerald-300' : 'text-signal')}>
            {firing !== null ? `Firing — ${held.toFixed(1)}s` : 'Hold while it fires'}
          </span>
          <span className="mt-0.5 block text-[12px] text-chalk-faint">
            {firing !== null ? 'let go when it stops' : 'or hold the space bar'}
          </span>
        </button>
      )}

      {!running && (
        <p className="mt-2 text-[12px] text-signal">
          Start the match clock first, or volleys will all be stamped at 0:00.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-deck-600 pt-2">
        <label className="flex items-center gap-2">
          <span className="label">Magazine</span>
          <input type="number" min={1} max={200} value={magazine}
            onChange={(e) => onMagazineChange(Math.max(1, Number(e.target.value)))}
            className="input h-8 w-20 py-0 text-[14px]" />
        </label>
        <span className="text-[12px] text-chalk-faint">
          from the pit survey — correct it here if it looks wrong
        </span>
        {volleys.length > 0 && (
          <span className="ml-auto text-[13px] text-chalk-dim">
            {volleys.length} volley{volleys.length === 1 ? '' : 's'} ·{' '}
            <span className="font-600 text-chalk">{fireTime.toFixed(1)}s</span> firing ·{' '}
            <span className="font-600 text-chalk">
              {fireTime > 0 ? (totalBalls / fireTime).toFixed(1) : '0'}
            </span> FUEL/s
          </span>
        )}
      </div>

      {volleys.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {volleys.map((v, i) => (
            <span key={i}
              className="group flex items-center gap-1.5 rounded-panel border border-deck-600 px-2 py-1">
              <span className="font-mono text-[12px] text-chalk-dim">
                {fmt(v.start)}–{fmt(v.end)}
              </span>
              <span className="font-mono text-[13px] font-600 text-chalk">{v.balls}</span>
              <span className="text-[11px] text-chalk-faint">{v.fillPct}%</span>
              <button type="button" onClick={() => onRemove(i)}
                className="text-chalk-faint opacity-0 transition group-hover:opacity-100 hover:text-alliance-red">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
