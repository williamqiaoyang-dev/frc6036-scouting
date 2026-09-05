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
    <div className="panel">
      <div className="flex items-stretch">
        {/* Clock reads like a driver-station display: big, tabular, no chrome. */}
        <div className="flex min-w-[128px] flex-col justify-center border-r border-deck-500 px-3 py-2">
          <span className={clsx('readout text-[38px] font-700',
            running ? 'text-signal' : 'text-chalk-dim')}>
            {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}
          </span>
          <span className="text-[12px] leading-none text-chalk-faint">
            {remaining > 0 ? `${Math.ceil(remaining)}s remaining` : 'match over'}
          </span>
        </div>

        <div className="flex flex-1 flex-col justify-center gap-1.5 px-3 py-2">
          <div className="font-display text-[16px] font-600 leading-none">
            {window ? (
              <>
                <span className={clsx(
                  window.phase === 'auto' ? 'text-signal'
                    : window.phase === 'endgame' ? 'text-alliance-blue' : 'text-chalk',
                )}>
                  {window.label}
                </span>
                {window.note && (
                  <span className="ml-2 text-[13px] font-400 text-chalk-faint">{window.note}</span>
                )}
              </>
            ) : (
              <span className="text-chalk-faint">Not started</span>
            )}
          </div>

          {/* The match really is a sequence, so a timeline is honest here. */}
          <div className="flex h-1.5 gap-px overflow-hidden rounded-panel">
            {game.windows.map((w) => {
              const width = ((w.endSec - w.startSec) / total) * 100
              const active = window?.id === w.id
              const past = elapsed >= w.endSec
              return (
                <div
                  key={w.id}
                  style={{ width: `${width}%` }}
                  title={`${w.label} · ${w.startSec}–${w.endSec}s`}
                  className={clsx(
                    'transition-colors',
                    active ? 'bg-signal'
                      : past ? 'bg-signal/35'
                      : 'bg-deck-600',
                  )}
                />
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-1.5 border-l border-deck-500 px-3">
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
      </div>
    </div>
  )
}
