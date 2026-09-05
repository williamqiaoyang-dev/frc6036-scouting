import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { GameConfig } from '@/games/types'

/**
 * Match clock. It is the source of the timestamps on every tap, so it also
 * owns "what window are we in right now" and shows the scout which
 * ALLIANCE SHIFT is live — the thing that is genuinely hard to track by eye
 * in REBUILT.
 */
export function useMatchClock() {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef<number | null>(null)
  const raf = useRef<number>()

  useEffect(() => {
    if (!running) return
    const tick = () => {
      if (startedAt.current != null) {
        setElapsed((Date.now() - startedAt.current) / 1000)
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [running])

  return {
    running,
    elapsed,
    /** Timestamp to stamp on a tap right now. */
    now: () => (startedAt.current == null ? 0 : (Date.now() - startedAt.current) / 1000),
    start: () => { startedAt.current = Date.now(); setElapsed(0); setRunning(true) },
    stop: () => setRunning(false),
    reset: () => { startedAt.current = null; setElapsed(0); setRunning(false) },
  }
}

export function MatchTimer({
  game, elapsed, running, onStart, onStop, onReset,
}: {
  game: GameConfig
  elapsed: number
  running: boolean
  onStart: () => void
  onStop: () => void
  onReset: () => void
}) {
  const total = game.autoSec + game.teleopSec
  const window = game.windows.find((w) => elapsed >= w.startSec && elapsed < w.endSec)
  const remaining = Math.max(0, total - elapsed)

  return (
    <div className="card p-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-slate-100">
              {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}
            </span>
            <span className="text-xs text-slate-500">
              {remaining > 0 ? `${Math.ceil(remaining)}s left` : 'match over'}
            </span>
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-400">
            {window ? (
              <span className={clsx(
                window.phase === 'auto' && 'text-amber-300',
                window.phase === 'endgame' && 'text-violet-300',
              )}>
                {window.label}
                {window.note && <span className="ml-1.5 font-normal text-slate-600">· {window.note}</span>}
              </span>
            ) : (
              <span className="text-slate-600">Not started</span>
            )}
          </div>
        </div>

        {!running ? (
          <>
            <button type="button" onClick={onStart} className="btn-primary">
              {elapsed > 0 ? 'Resume' : 'Start match'}
            </button>
            {elapsed > 0 && (
              <button type="button" onClick={onReset} className="btn-ghost">Reset</button>
            )}
          </>
        ) : (
          <button type="button" onClick={onStop} className="btn-ghost">Pause</button>
        )}
      </div>

      {/* Window ribbon — shows the whole match shape and where we are in it. */}
      <div className="mt-3 flex h-2 gap-px overflow-hidden rounded-full bg-black/40">
        {game.windows.map((w) => {
          const width = ((w.endSec - w.startSec) / total) * 100
          const active = window?.id === w.id
          const past = elapsed >= w.endSec
          return (
            <div
              key={w.id}
              style={{ width: `${width}%` }}
              title={`${w.label} · ${w.startSec}-${w.endSec}s`}
              className={clsx(
                'transition-colors',
                active ? 'bg-peninsula-400'
                  : past ? 'bg-peninsula-800'
                  : w.phase === 'auto' ? 'bg-amber-500/25'
                  : w.phase === 'endgame' ? 'bg-violet-500/25'
                  : 'bg-white/10',
              )}
            />
          )
        })}
      </div>
    </div>
  )
}
