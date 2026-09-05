import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { saveMarker } from '@/lib/db'
import { markerId, SCHEMA_VERSION, type CachedMatch } from '@/lib/schema'
import { loadVisionConfig, saveVisionConfig } from '@/lib/settings'
import { DEFAULT_VISION, type VisionConfig } from '@/lib/vision'
import type { VisionMode } from '@/lib/ballTracker'
import { formatTime } from '@/lib/youtube'
import { videoWatchUrl } from '@/lib/tba'
import { Panel } from '@/components/ui'
import { VisionTuning } from '@/features/vision/VisionTuning'
import { drawVisionOverlay, type Point } from '@/features/vision/overlay'
import { useFrameVision, type FrameShot } from '@/features/vision/useFrameVision'

type Source =
  | { kind: 'none' }
  | { kind: 'file'; url: string; name: string }
  | { kind: 'screen'; stream: MediaStream }

type Tool = 'none' | 'zone' | 'sample' | 'floor'

interface Shot { id: number; t: number; x: number; y: number; team: number | null }

/**
 * Counts shots off match footage instead of off a live camera.
 *
 * The catch worth stating plainly: a YouTube embed is a cross-origin iframe,
 * so its pixels can never be read by this page — no detector of any kind can
 * run against the embed above. Two sources do work, and both are offered:
 *
 *   Video file  — a recording from the stands. Fully scrubbable, so a scan
 *                 can be replayed, re-tuned and re-run until the count is
 *                 right.
 *   Shared tab  — the browser hands over the pixels of a tab you choose, so
 *                 TBA footage can be analysed by playing it in its own tab.
 *                 Live only: this page cannot scrub someone else's tab.
 *
 * Detected shots land as timestamped markers on the same rail as hand-made
 * ones, attributed to whichever robot is being watched. They are proposals a
 * human confirms, never a silent edit to a scout's record.
 */
export function FilmAnalyzer({
  match, eventKey, author, scoutedFuel, onMarkersChanged,
}: {
  match: CachedMatch
  eventKey: string
  author: string
  /** What the scouts recorded for each robot, for the count comparison. */
  scoutedFuel: Record<number, number>
  onMarkersChanged: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const shotId = useRef(1)
  const scanRef = useRef(false)

  const [source, setSource] = useState<Source>({ kind: 'none' })
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [mode, setMode] = useState<VisionMode>('dynamic')
  const [running, setRunning] = useState(false)
  const [config, setConfig] = useState<VisionConfig>(() => loadVisionConfig(DEFAULT_VISION))
  const [tool, setTool] = useState<Tool>('none')
  const [draft, setDraft] = useState<Point[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [team, setTeam] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(0)
  const [progress, setProgress] = useState<number | null>(null)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRate] = useState(1)

  const teams = useMemo(() => [...match.red, ...match.blue], [match])
  const zoneReady = config.zone.length >= 3
  const live = source.kind !== 'none'

  function updateConfig(next: VisionConfig) {
    setConfig(next)
    saveVisionConfig(next)
  }

  // ---- detection ---------------------------------------------------------
  const onShot = useCallback((s: FrameShot) => {
    setShots((prev) => {
      // Re-scanning a stretch already covered should refine the list, not
      // pile duplicates onto it.
      if (prev.some((p) => Math.abs(p.t - s.t) < 0.35)) return prev
      return [...prev, { id: shotId.current++, t: s.t, x: s.x, y: s.y, team: null }]
        .sort((a, b) => a.t - b.t)
    })
  }, [])

  const { detections, blocked, sampleAt, reset, processFrame, procWidth, procHeight } =
    useFrameVision({
      video, mode, config,
      // Only a stream needs the presented-frame loop; a file is scanned by
      // seeking, which keeps working when the tab is in the background.
      liveLoop: running && source.kind === 'screen',
      track: source.kind === 'screen' ? source.stream.getVideoTracks()[0] : null,
      onShot,
    })

  // ---- sources -----------------------------------------------------------
  function openFile(file: File) {
    releaseSource()
    setShots([]); setError(''); setSaved(0)
    setSource({ kind: 'file', url: URL.createObjectURL(file), name: file.name })
  }

  async function shareTab() {
    releaseSource()
    setShots([]); setError(''); setSaved(0)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 }, audio: false,
      })
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setSource({ kind: 'none' }); setRunning(false)
      })
      setSource({ kind: 'screen', stream })
    } catch {
      setError('Nothing was shared. Pick the tab playing the match and allow sharing.')
    }
  }

  function releaseSource() {
    scanRef.current = false
    setRunning(false)
    setVideo(null)
    setSource((s) => {
      if (s.kind === 'file') URL.revokeObjectURL(s.url)
      if (s.kind === 'screen') s.stream.getTracks().forEach((t) => t.stop())
      return { kind: 'none' }
    })
  }

  useEffect(() => () => releaseSource(), [])

  // Attach whichever source we have to the single <video> element.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (source.kind === 'file') {
      v.srcObject = null
      v.src = source.url
      v.load()
    } else if (source.kind === 'screen') {
      v.removeAttribute('src')
      v.srcObject = source.stream
      v.play().catch(() => setError('The shared tab would not start playing.'))
    } else {
      v.removeAttribute('src')
      v.srcObject = null
    }
    setVideo(source.kind === 'none' ? null : v)
  }, [source])

  // ---- transport ---------------------------------------------------------
  const seekable = source.kind === 'file'

  function toggle() {
    const v = videoRef.current
    if (!v) return
    v.paused ? v.play().catch(() => {}) : v.pause()
  }
  function step(delta: number) {
    const v = videoRef.current
    if (!v || !seekable) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta))
  }
  function setSpeed(r: number) {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = r
    setRate(r)
  }

  /**
   * Scan a file from the playhead to the end.
   *
   * This seeks frame by frame rather than playing, for three reasons: every
   * frame is examined exactly once, it runs as fast as the file decodes
   * instead of in real time, and it does not stop when the scout switches
   * tabs — the browser presents no frames to a background tab, so a
   * play-and-watch scan would silently stall.
   */
  async function scan() {
    const v = videoRef.current
    if (!v) return
    reset()
    setRunning(true)

    if (!seekable) { v.play().catch(() => {}); return }

    v.pause()
    scanRef.current = true
    const total = v.duration || 0
    const stepSec = 1 / 30

    try {
      for (let t = v.currentTime; t < total && scanRef.current; t += stepSec) {
        v.currentTime = t
        await seeked(v)
        processFrame()
        setProgress(total ? t / total : 0)
      }
    } finally {
      scanRef.current = false
      setProgress(null)
      setRunning(false)
    }
  }

  function stop() {
    scanRef.current = false
    setRunning(false)
    videoRef.current?.pause()
  }

  // ---- overlay -----------------------------------------------------------
  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    drawVisionOverlay(canvas, { config, draft, detections, procWidth, procHeight })
  }, [detections, config, draft, procWidth, procHeight])

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }

    if (tool === 'zone') setDraft((d) => [...d, p])
    else if (tool === 'floor') {
      updateConfig({ ...config, groundY: Math.min(0.99, Math.max(0.05, p.y)) })
      setTool('none')
    } else if (tool === 'sample') {
      const s = sampleAt(p.x, p.y)
      if (s && s.value > 0.08) {
        updateConfig({
          ...config,
          hue: Math.round(s.hue),
          minSaturation: Math.max(0.15, s.saturation * 0.55),
          minValue: Math.max(0.12, s.value * 0.45),
        })
        setTool('none')
      } else setError('That spot is too dark to sample. Try a lit part of the ball.')
    }
  }

  function finishZone() {
    if (draft.length >= 3) updateConfig({ ...config, zone: draft })
    setDraft([])
    setTool('none')
    reset()
  }

  // Sampling needs a frame in hand, which only the detector produces — so
  // run it briefly while the calibration tools are open.
  useEffect(() => {
    if (tool === 'sample' && !running) setRunning(true)
  }, [tool])

  // ---- results -----------------------------------------------------------
  const assigned = shots.map((s) => ({ ...s, team: s.team ?? team }))
  const perTeam = useMemo(() => {
    const t: Record<number, number> = {}
    for (const s of assigned) if (s.team) t[s.team] = (t[s.team] ?? 0) + 1
    return t
  }, [assigned])

  async function saveAsMarkers() {
    const rows = assigned.filter((s) => s.team)
    for (const s of rows) {
      await saveMarker({
        id: markerId(match.key, s.t, `${author}-auto`),
        schemaVersion: SCHEMA_VERSION,
        eventKey,
        matchKey: match.key,
        matchNumber: match.matchNumber,
        matchLevel: match.matchLevel,
        t: s.t,
        teamNumber: s.team,
        tag: 'shot',
        note: `Detected by ${mode} film analysis`,
        author: author || 'anonymous',
        createdAt: Date.now(),
        synced: false,
      } as any)
    }
    setSaved(rows.length)
    onMarkersChanged()
  }

  const youtube = match.videos.find((v) => v.type === 'youtube')

  return (
    <Panel
      title="Shot detection from film"
      right={<span className="text-[12px] text-chalk-faint">
        {shots.length} detected
        {progress !== null && ` · scanning ${Math.round(progress * 100)}%`}
        {running && progress === null && ' · watching'}
      </span>}
    >
      {/* ---- source ------------------------------------------------------ */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <input ref={fileRef} type="file" accept="video/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f) }} />
        <button type="button" onClick={() => fileRef.current?.click()}
          className={clsx('h-8 rounded-panel border px-3 text-[13px] font-600 transition',
            source.kind === 'file'
              ? 'border-signal bg-signal/15 text-signal'
              : 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk')}>
          Open a video file
        </button>
        <button type="button" onClick={shareTab}
          className={clsx('h-8 rounded-panel border px-3 text-[13px] font-600 transition',
            source.kind === 'screen'
              ? 'border-signal bg-signal/15 text-signal'
              : 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk')}>
          Share a tab
        </button>
        {youtube && (
          <a href={videoWatchUrl(youtube)} target="_blank" rel="noreferrer"
            className="h-8 rounded-panel border border-deck-500 px-3 text-[13px] font-600
                       leading-8 text-chalk-dim transition hover:bg-deck-600 hover:text-chalk">
            Open this match on YouTube ↗
          </a>
        )}
        {live && (
          <button type="button" onClick={releaseSource}
            className="h-8 rounded-panel px-2 text-[13px] text-chalk-faint hover:text-alliance-red">
            Close
          </button>
        )}
      </div>

      {!live && (
        <div className="rounded-panel border border-deck-600 bg-deck-900 p-3">
          <p className="text-[13px] leading-relaxed text-chalk-dim">
            The player above is a YouTube iframe, and a page cannot read the pixels
            of another site's frame — so nothing can count shots off it directly.
            Two ways round that:
          </p>
          <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-chalk-dim">
            <li>
              <span className="font-600 text-chalk">Open a video file</span> — your own
              recording from the stands. Scrub, re-tune and re-scan until the count is right.
            </li>
            <li>
              <span className="font-600 text-chalk">Share a tab</span> — open this match on
              YouTube, come back, share that tab, and play it there. Detection runs on the
              shared picture. Live only: this page can't scrub someone else's tab.
            </li>
          </ul>
        </div>
      )}

      {live && (
        <>
          <div className="relative overflow-hidden rounded-panel border border-deck-500 bg-black">
            <video ref={videoRef} playsInline muted={source.kind === 'screen'}
              className="block max-h-[60vh] w-full"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => { setPlaying(false); setRunning(false) }} />
            <canvas ref={overlayRef} onClick={onCanvasClick}
              className={clsx('absolute inset-0 h-full w-full',
                tool !== 'none' ? 'cursor-crosshair' : 'cursor-default')} />
            {tool !== 'none' && (
              <div className="absolute inset-x-0 top-0 bg-signal px-2 py-1 text-[12px] font-600 text-deck-900">
                {tool === 'zone' && `Click the corners of the goal, then Finish. ${draft.length} placed.`}
                {tool === 'sample' && 'Click a FUEL ball to learn its colour.'}
                {tool === 'floor' && 'Click where the floor starts.'}
              </div>
            )}
          </div>

          {/* ---- transport ------------------------------------------------ */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={toggle} className="btn-ghost h-8 w-16 py-0 text-[13px]">
              {playing ? '❙❙ Pause' : '▶ Play'}
            </button>
            {seekable && (
              <>
                <button type="button" onClick={() => step(-5)} className="btn-ghost h-8 py-0 text-[13px]">−5s</button>
                <button type="button" onClick={() => step(-1 / 30)} className="btn-ghost h-8 py-0 text-[13px]" title="One frame back">◀|</button>
                <button type="button" onClick={() => step(1 / 30)} className="btn-ghost h-8 py-0 text-[13px]" title="One frame on">|▶</button>
                <button type="button" onClick={() => step(5)} className="btn-ghost h-8 py-0 text-[13px]">+5s</button>
                <span className="font-mono text-[12px] tabular-nums text-chalk-dim">
                  {formatTime(time)}<span className="text-chalk-faint"> / {formatTime(duration)}</span>
                </span>
              </>
            )}
            {!seekable && (
              <span className="text-[12px] text-chalk-faint">
                Mirroring the shared tab — play the video there. Counting keeps
                running while you watch it.
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              {[0.5, 1, 2, 4].map((r) => (
                <button key={r} type="button" onClick={() => setSpeed(r)}
                  className={clsx('h-8 rounded px-2 text-[13px] font-600 transition',
                    rate === r ? 'bg-signal/15 text-chalk' : 'text-chalk-dim hover:bg-deck-600')}>
                  {r}×
                </button>
              ))}
            </div>
          </div>

          {seekable && duration > 0 && (
            <div className="relative mt-1.5 h-5">
              <input type="range" min={0} max={duration} step={0.05} value={time}
                onChange={(e) => { const v = videoRef.current; if (v) v.currentTime = Number(e.target.value) }}
                className="absolute inset-x-0 top-1.5 w-full accent-signal" />
              {shots.map((s) => (
                <button key={s.id} type="button"
                  onClick={() => { const v = videoRef.current; if (v) v.currentTime = s.t }}
                  title={formatTime(s.t)}
                  style={{ left: `${Math.min(99, (s.t / duration) * 100)}%` }}
                  className="absolute top-0 h-2 w-0.5 -translate-x-1/2 bg-emerald-400" />
              ))}
            </div>
          )}

          {/* ---- calibration --------------------------------------------- */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tool === 'zone' ? (
              <>
                <button type="button" onClick={finishZone} disabled={draft.length < 3}
                  className="btn-primary h-8 py-0 text-[13px]">Finish goal area</button>
                <button type="button" onClick={() => { setDraft([]); setTool('none') }}
                  className="btn-ghost h-8 py-0 text-[13px]">Cancel</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setDraft([]); setTool('zone') }}
                  className="btn-ghost h-8 py-0 text-[13px]">
                  {zoneReady ? 'Redraw goal area' : 'Mark goal area'}
                </button>
                <button type="button" onClick={() => setTool('sample')}
                  className="btn-ghost h-8 py-0 text-[13px]">Sample ball colour</button>
                <button type="button" onClick={() => setTool('floor')}
                  className="btn-ghost h-8 py-0 text-[13px]">Set floor line</button>
              </>
            )}
          </div>

          {/* ---- run ------------------------------------------------------ */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-deck-600 pt-3">
            <div className="flex gap-px">
              {([['static', 'AI static'], ['dynamic', 'AI dynamic']] as [VisionMode, string][]).map(([id, label]) => (
                <button key={id} type="button" onClick={() => { setMode(id); reset() }}
                  className={clsx('h-8 rounded-panel border px-3 text-[13px] font-600 transition',
                    mode === id
                      ? 'border-signal bg-signal/15 text-signal'
                      : 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk')}>
                  {label}
                </button>
              ))}
            </div>
            {running ? (
              <button type="button" onClick={stop}
                className="btn-ghost h-8 py-0 text-[13px]">Stop</button>
            ) : (
              <button type="button" onClick={scan} disabled={!zoneReady}
                className="btn-primary h-8 py-0 text-[13px] disabled:opacity-30">
                {seekable ? 'Scan from here' : 'Start detecting'}
              </button>
            )}
            <button type="button" onClick={() => { setShots([]); setSaved(0); reset() }}
              className="btn-ghost h-8 py-0 text-[13px]">Clear results</button>

            <select className="input h-8 w-auto py-0 text-[13px]"
              value={team ?? ''} onChange={(e) => setTeam(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Watching which robot?</option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t} · {match.red.includes(t) ? 'red' : 'blue'}
                </option>
              ))}
            </select>
          </div>

          {progress !== null && (
            <div className="mt-2 h-1 overflow-hidden rounded bg-deck-600">
              <div className="h-full bg-signal transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}

          {!zoneReady && (
            <p className="mt-2 text-[12px] leading-snug text-signal">
              Mark the goal area before scanning. Nothing counts until you do — that
              is what keeps balls on the floor out of the tally.
            </p>
          )}
          {blocked && (
            <p className="mt-2 text-[12px] leading-snug text-alliance-red">
              This video's pixels can't be read — it comes from another site. Use a
              downloaded file, or share the tab that is playing it.
            </p>
          )}
          {error && <p className="mt-2 text-[12px] text-alliance-red">{error}</p>}

          {/* ---- results -------------------------------------------------- */}
          {shots.length > 0 && (
            <div className="mt-3 border-t border-deck-600 pt-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-display text-[15px] font-600 text-chalk">
                  {shots.length} shot{shots.length === 1 ? '' : 's'} detected
                </span>
                {team && (
                  <span className="text-[12px] text-chalk-dim">
                    scouts recorded <span className="font-600 text-chalk">{scoutedFuel[team] ?? 0}</span> FUEL for {team}
                  </span>
                )}
                <button type="button" onClick={saveAsMarkers} disabled={!team}
                  className="btn-primary ml-auto h-8 py-0 text-[13px] disabled:opacity-30">
                  Save as markers
                </button>
              </div>

              {saved > 0 && (
                <p className="mb-2 text-[12px] text-emerald-300">
                  {saved} marker{saved === 1 ? '' : 's'} written to this match.
                </p>
              )}

              <div className="max-h-56 space-y-1 overflow-y-auto">
                {assigned.map((s) => (
                  <div key={s.id} className="group flex items-center gap-2 rounded-panel border border-deck-600 px-2 py-1">
                    <button type="button"
                      onClick={() => { const v = videoRef.current; if (v && seekable) v.currentTime = s.t }}
                      className="font-mono text-[12px] font-600 text-chalk hover:underline">
                      {formatTime(s.t)}
                    </button>
                    <span className="text-[11px] text-chalk-faint">
                      {Math.round(s.x * 100)}%, {Math.round(s.y * 100)}%
                    </span>
                    <select className="ml-auto h-6 rounded border border-deck-500 bg-deck-900 px-1 text-[12px] text-chalk-dim"
                      value={s.team ?? ''}
                      onChange={(e) => setShots((prev) => prev.map((p) =>
                        p.id === s.id ? { ...p, team: e.target.value ? Number(e.target.value) : null } : p))}>
                      <option value="">unassigned</option>
                      {teams.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button type="button" onClick={() => setShots((prev) => prev.filter((p) => p.id !== s.id))}
                      className="px-1 text-chalk-faint opacity-0 transition group-hover:opacity-100 hover:text-alliance-red">
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {Object.keys(perTeam).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-chalk-dim">
                  {Object.entries(perTeam).map(([t, n]) => (
                    <span key={t} className={clsx('rounded px-1.5 font-mono',
                      match.red.includes(Number(t))
                        ? 'bg-alliance-red/15 text-alliance-red'
                        : 'bg-alliance-blue/15 text-alliance-blue')}>
                      {t}: {n}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <VisionTuning config={config} onChange={updateConfig} />
        </>
      )}
    </Panel>
  )
}

/**
 * Resolve when the video has finished seeking. Bounded, so one seek that
 * never lands cannot wedge a whole scan.
 */
function seeked(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      v.removeEventListener('seeked', finish)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, 500)
    v.addEventListener('seeked', finish)
  })
}
