import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { formatTime, loadYouTubeApi } from '@/lib/youtube'
import type { MarkerRecord } from '@/lib/schema'

export interface PlayerHandle {
  pause: () => void
  play: () => void
  seekTo: (seconds: number) => void
  currentTime: () => number
}

/**
 * A YouTube player the page can actually drive: pause, scrub, step frame by
 * frame, slow down, and read the current timestamp so a moment can be marked.
 *
 * Scouting review is mostly "stop, back up five seconds, watch that again",
 * so those are real buttons and keyboard shortcuts rather than something you
 * fish for in YouTube's own chrome.
 */
export function VideoPlayer({
  videoId, markers = [], onReady, onMarkerClick,
}: {
  videoId: string
  markers?: MarkerRecord[]
  onReady?: (handle: PlayerHandle) => void
  onMarkerClick?: (marker: MarkerRecord) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRate] = useState(1)
  const [error, setError] = useState('')

  // Build the player. Recreated when the video changes.
  useEffect(() => {
    let cancelled = false
    let poll: number | undefined
    setReady(false); setError(''); setTime(0); setPlaying(false)

    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return

      playerRef.current = new YT.Player(hostRef.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1, controls: 1, playsinline: 1 },
        events: {
          onReady: (e: any) => {
            if (cancelled) return
            setReady(true)
            setDuration(e.target.getDuration() ?? 0)
            const handle: PlayerHandle = {
              pause: () => e.target.pauseVideo(),
              play: () => e.target.playVideo(),
              seekTo: (s: number) => e.target.seekTo(s, true),
              currentTime: () => e.target.getCurrentTime() ?? 0,
            }
            onReady?.(handle)
            // Poll rather than rely on events: YouTube emits no continuous
            // time update, and the marker bar needs a live playhead.
            poll = window.setInterval(() => {
              if (!playerRef.current?.getCurrentTime) return
              setTime(playerRef.current.getCurrentTime() ?? 0)
            }, 200)
          },
          onStateChange: (e: any) => setPlaying(e.data === YT.PlayerState.PLAYING),
          onError: () => setError('This video could not be played.'),
        },
      })
    }).catch((e) => setError(e.message))

    return () => {
      cancelled = true
      if (poll) clearInterval(poll)
      try { playerRef.current?.destroy?.() } catch { /* already gone */ }
      playerRef.current = null
    }
  }, [videoId])

  function step(delta: number) {
    const p = playerRef.current
    if (!p?.seekTo) return
    p.seekTo(Math.max(0, (p.getCurrentTime() ?? 0) + delta), true)
  }
  function toggle() {
    const p = playerRef.current
    if (!p) return
    playing ? p.pauseVideo() : p.playVideo()
  }
  function setSpeed(r: number) {
    playerRef.current?.setPlaybackRate?.(r)
    setRate(r)
  }

  // Keyboard shortcuts — space to pause, arrows to scrub. Skipped while
  // typing so they never eat a keystroke in the note field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === ' ') { e.preventDefault(); toggle() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -1 : -5) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 1 : 5) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing])

  if (error) {
    return (
      <div className="rounded-panel border border-alliance-red/40 bg-alliance-red/10 p-6 text-center">
        <p className="text-sm text-alliance-red">{error}</p>
        <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer"
          className="mt-2 inline-block text-xs text-chalk-dim hover:text-chalk">
          Watch on YouTube ↗
        </a>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-panel border border-deck-500 bg-black">
      <div className="relative aspect-video">
        <div ref={hostRef} className="absolute inset-0 h-full w-full" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <span className="text-sm text-chalk-faint">Loading player…</span>
          </div>
        )}
      </div>

      {/* Marker rail — every pinned moment on the timeline, click to jump. */}
      {duration > 0 && (
        <div className="relative h-6 border-t border-deck-500 bg-deck-800">
          <div className="absolute inset-y-0 left-0 bg-signal/15"
            style={{ width: `${Math.min(100, (time / duration) * 100)}%` }} />
          {markers.map((m) => (
            <button key={m.id} type="button"
              onClick={() => { playerRef.current?.seekTo?.(m.t, true); onMarkerClick?.(m) }}
              title={`${formatTime(m.t)} · ${m.tag}${m.note ? ` — ${m.note}` : ''}`}
              style={{ left: `${Math.min(99, (m.t / duration) * 100)}%` }}
              className={clsx('absolute top-0 h-full w-1 -translate-x-1/2 transition hover:w-1.5',
                MARKER_COLORS[m.tag] ?? 'bg-slate-400')} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" onClick={toggle} disabled={!ready}
          className="btn-ghost h-8 w-16 py-0 text-xs disabled:opacity-30">
          {playing ? '❙❙ Pause' : '▶ Play'}
        </button>
        <button type="button" onClick={() => step(-5)} disabled={!ready}
          className="btn-ghost h-8 py-0 text-xs disabled:opacity-30" title="Back 5s (←)">−5s</button>
        <button type="button" onClick={() => step(-1)} disabled={!ready}
          className="btn-ghost h-8 py-0 text-xs disabled:opacity-30" title="Back 1s (shift+←)">−1s</button>
        <button type="button" onClick={() => step(1)} disabled={!ready}
          className="btn-ghost h-8 py-0 text-xs disabled:opacity-30" title="Forward 1s (shift+→)">+1s</button>
        <button type="button" onClick={() => step(5)} disabled={!ready}
          className="btn-ghost h-8 py-0 text-xs disabled:opacity-30" title="Forward 5s (→)">+5s</button>

        <span className="ml-1 font-mono text-xs tabular-nums text-chalk-dim">
          {formatTime(time)}{duration > 0 && <span className="text-chalk-faint"> / {formatTime(duration)}</span>}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {[0.25, 0.5, 1].map((r) => (
            <button key={r} type="button" onClick={() => setSpeed(r)} disabled={!ready}
              className={clsx('h-8 rounded px-2 text-xs font-semibold transition disabled:opacity-30',
                rate === r ? 'bg-signal/15 text-white' : 'text-chalk-dim hover:bg-deck-600')}>
              {r}×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export const MARKER_COLORS: Record<string, string> = {
  good: 'bg-emerald-400',
  shot: 'bg-lime-300',
  cycle: 'bg-alliance-blue',
  defense: 'bg-violet-400',
  breakdown: 'bg-alliance-red',
  penalty: 'bg-signal',
  note: 'bg-slate-400',
}
