import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { getGame } from '@/games'
import { saveMarker } from '@/lib/db'
import { markerId, SCHEMA_VERSION, type CachedMatch, type MarkerRecord } from '@/lib/schema'
import { loadDetectors, loadSettings, saveDetectors } from '@/lib/settings'
import type { Detector, DetectorEvent } from '@/lib/detectors'
import { videoWatchUrl } from '@/lib/tba'
import { formatTime } from '@/lib/youtube'
import { Panel } from '@/components/ui'
import { MARKER_COLORS, type PlayerHandle } from './VideoPlayer'
import { DetectorList, detectorColor } from '@/features/vision/DetectorList'
import { DetectorTuning } from '@/features/vision/DetectorTuning'
import { drawDetectorOverlay, type Point } from '@/features/vision/overlay'
import {
  useDetectors, DEFAULT_PROC_WIDTH, PROC_WIDTHS, type ShotCredit,
} from '@/features/vision/useDetectors'
import { allianceLook, type RobotLock } from '@/lib/robotLock'

type Source =
  | { kind: 'none' }
  | { kind: 'file'; url: string; name: string }
  | { kind: 'url'; url: string }
  | { kind: 'screen'; stream: MediaStream }

interface Hit extends DetectorEvent {
  key: number
  team: number | null
  /** How the tracked robot was credited, when one was locked. */
  credit: ShotCredit
}

/**
 * Reads a match off film instead of off a live camera.
 *
 * The catch worth stating plainly: a YouTube embed is a cross-origin
 * iframe, so its pixels can never be read by this page — no detector of any
 * kind can run against the embed above, in any season. Two sources do work,
 * and both are offered:
 *
 *   Video file  — a recording from the stands. Fully scrubbable, so a scan
 *                 can be replayed, re-tuned and re-run until it is right.
 *   Shared tab  — the browser hands over the pixels of a tab you choose, so
 *                 TBA footage can be read by playing it in its own tab.
 *
 * Every detector the game defines runs at once, so one pass over a video
 * fills in more than shots. What comes out are proposals a human confirms —
 * they land as markers, never as a silent edit to a scout's record.
 */
export function FilmAnalyzer({
  match, eventKey, author, scoutedFuel, onMarkersChanged,
  markers = [], onSourceChange, onPlayerReady,
}: {
  match: CachedMatch
  eventKey: string
  author: string
  scoutedFuel: Record<number, number>
  onMarkersChanged: () => void
  /** Hand-made markers, drawn on the same rail as detections. */
  markers?: MarkerRecord[]
  /** Tells the page a readable source is open, so it can retire the iframe. */
  onSourceChange?: (active: boolean) => void
  /** Lets the marker panel drive this player like the YouTube one. */
  onPlayerReady?: (handle: PlayerHandle | null) => void
}) {
  const settings = loadSettings()
  const game = getGame(settings.gameId)

  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scanRef = useRef(false)
  const hitKey = useRef(1)
  /** The video tab this page opened, so it can be focused again later. */
  const videoTab = useRef<Window | null>(null)

  const [source, setSource] = useState<Source>({ kind: 'none' })
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [detectors, setDetectorState] = useState<Detector[]>(
    () => loadDetectors(game.id, game.detectors))
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [hits, setHits] = useState<Hit[]>([])
  const [team, setTeam] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(0)
  const [tabOpened, setTabOpened] = useState(false)
  const [cameBack, setCameBack] = useState(false)
  const [surfaceNote, setSurfaceNote] = useState('')

  const [procWidth, setProcWidth] = useState<number>(DEFAULT_PROC_WIDTH)
  const [lock, setLock] = useState<RobotLock | null>(null)
  const [locking, setLocking] = useState(false)
  const [onlyTracked, setOnlyTracked] = useState(false)

  const [drawing, setDrawing] = useState<string | null>(null)
  /**
   * Two clicks for a box, or a traced polygon.
   *
   * Box is the default because a goal opening is a rectangle and because
   * the polygon path needed three clicks plus a separate Finish, in a
   * column beside the video — enough friction that people never got an area
   * drawn at all, and every scan stayed disabled.
   */
  const [drawMode, setDrawMode] = useState<'box' | 'poly'>('box')
  /** Drawing an area to *exclude* rather than to count in. */
  const [masking, setMasking] = useState<string | null>(null)
  const [finding, setFinding] = useState('')
  const photoRef = useRef<HTMLInputElement>(null)
  const [photoNote, setPhotoNote] = useState('')
  /** Pointer position while drawing a box, for a rubber-band preview. */
  const [hover, setHover] = useState<Point | null>(null)
  const [sampling, setSampling] = useState<string | null>(null)
  const [draft, setDraft] = useState<Point[]>([])
  const [tuned, setTuned] = useState(game.detectors[0]?.id ?? '')

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRate] = useState(1)

  const teams = useMemo(() => [...match.red, ...match.blue], [match])
  const live = source.kind !== 'none'
  const seekable = source.kind === 'file' || source.kind === 'url'
  const armed = detectors.filter((d) => d.enabled && d.zone.length >= 3)
  const ignoreCount = detectors.reduce((n, d) => n + (d.ignore?.length ?? 0), 0)

  function setDetectors(next: Detector[]) {
    setDetectorState(next)
    saveDetectors(game.id, next)
    // Re-read the frame on screen so a threshold change shows immediately.
    // Tuning against a frozen overlay is guesswork.
    if (!running) queueMicrotask(() => previewFrame())
  }

  const onEvent = useCallback((e: DetectorEvent, credit: ShotCredit) => {
    setHits((prev) => {
      // Re-scanning a stretch should refine the list, not pile duplicates on.
      if (prev.some((p) => p.detectorId === e.detectorId && Math.abs(p.t - e.t) < 0.35)) return prev
      // The team comes from where the ball *started*, not from the dropdown:
      // a shot that did not leave the followed robot stays unassigned rather
      // than being credited to whoever happened to be selected.
      const hit: Hit = { ...e, key: hitKey.current++, team: credit.team, credit }
      return [...prev, hit].sort((a, b) => a.t - b.t)
    })
  }, [])

  const {
    detections, paths, scenery, tints, robot, robots, trail, blocked, sampleAt,
    pickRobotAt, findZone, learnFromPhoto,
    reset, resetAll, processFrame, previewFrame, procHeight,
  } = useDetectors({
    video, detectors, procWidth, robotLock: lock,
    // Only a stream needs the live loop; a file is scanned by seeking,
    // which keeps working when the tab is in the background.
    liveLoop: running && source.kind === 'screen',
    track: source.kind === 'screen' ? source.stream.getVideoTracks()[0] : null,
    onEvent,
  })

  /** How many blobs each detector can see right now, zone or no zone. */
  const seeing = useMemo(() => {
    const out: Record<string, number> = {}
    for (const g of detections) out[g.detectorId] = g.detections.length
    return out
  }, [detections])

  // ---- sources -----------------------------------------------------------
  function openFile(file: File) {
    releaseSource()
    setHits([]); setError(''); setSaved(0)
    setSource({ kind: 'file', url: URL.createObjectURL(file), name: file.name })
  }

  function openUrl() {
    const url = window.prompt(
      'Direct link to a video file (.mp4 / .webm).\n\n'
      + 'This must be the file itself, not a YouTube or Drive viewer page, and the '
      + 'host has to allow other sites to read it (CORS). Your team\'s own uploads '
      + 'usually work; YouTube links never will.')
    if (!url) return
    releaseSource()
    setHits([]); setError(''); setSaved(0)
    setSource({ kind: 'url', url: url.trim() })
  }

  /**
   * Open the match on YouTube in its own tab.
   *
   * The share picker only lists tabs that already exist, so telling someone
   * to "share the tab playing the match" is useless until that tab is open.
   * This opens it, under a name tied to the match so clicking again returns
   * to the same tab instead of piling up duplicates.
   */
  function openVideoTab() {
    if (!youtube) return
    setError('')
    const win = window.open(videoWatchUrl(youtube), `film-${match.key}`)
    if (!win) {
      setError('The browser blocked that pop-up. Allow pop-ups for this site, or open the match on YouTube yourself in another tab.')
      return
    }
    videoTab.current = win
    setTabOpened(true)
    setCameBack(false)
  }

  function focusVideoTab() {
    if (videoTab.current && !videoTab.current.closed) videoTab.current.focus()
    else openVideoTab()
  }

  // Coming back from the video tab is the cue that step 2 is ready.
  useEffect(() => {
    if (!tabOpened) return
    const onVisible = () => { if (!document.hidden) setCameBack(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [tabOpened])

  async function shareTab() {
    releaseSource()
    setHits([]); setError(''); setSaved(0); setSurfaceNote('')
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        // Ask for a tab specifically: Chrome opens the picker on the tab
        // list rather than the whole-screen one, and excludes this page so
        // nobody accidentally points the camera at itself.
        video: { frameRate: 30, displaySurface: 'browser' },
        audio: false,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        systemAudio: 'exclude',
      } as MediaStreamConstraints)

      const track = stream.getVideoTracks()[0]
      track?.addEventListener('ended', () => {
        setSource({ kind: 'none' }); setRunning(false)
      })

      const surface = (track?.getSettings() as { displaySurface?: string })?.displaySurface
      if (surface && surface !== 'browser') {
        setSurfaceNote('You shared a whole window or screen. That works, but sharing the single tab is sharper and smoother.')
      }

      setSource({ kind: 'screen', stream })
    } catch {
      setError('Nothing was shared. Choose the tab playing the match, then Share.')
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

  useEffect(() => { onSourceChange?.(source.kind !== 'none') }, [source.kind])

  // The marker panel drives whichever player is on screen, so pinning a
  // moment works the same whether you are on TBA footage or your own.
  useEffect(() => {
    const v = videoRef.current
    if (!v || source.kind === 'none') { onPlayerReady?.(null); return }
    onPlayerReady?.({
      play: () => { v.play().catch(() => {}) },
      pause: () => v.pause(),
      seekTo: (secs: number) => { if (seekable) v.currentTime = secs },
      currentTime: () => v.currentTime,
    })
    return () => onPlayerReady?.(null)
  }, [source.kind, seekable])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (source.kind === 'file' || source.kind === 'url') {
      v.srcObject = null
      // Needed for a remote file: without it the canvas is tainted and the
      // detectors get nothing, which is the whole reason we are here.
      if (source.kind === 'url') v.crossOrigin = 'anonymous'
      else v.removeAttribute('crossorigin')
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
      let frames = 0
      for (let t = v.currentTime; t < total && scanRef.current; t += stepSec) {
        v.currentTime = t
        await seeked(v)
        processFrame()
        // Re-rendering the whole panel for every frame of a two-minute match
        // costs more than reading the frames does.
        if (frames++ % 12 === 0) setProgress(total ? t / total : 0)
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
  /**
   * What to draw as the in-progress area. For a box that is the rectangle
   * the second click would commit, so the area is visible before it exists
   * rather than after.
   */
  const preview = useMemo<Point[]>(() => {
    if ((!masking && drawMode !== 'box') || draft.length !== 1 || !hover) return draft
    const a = draft[0]
    return [
      { x: a.x, y: a.y }, { x: hover.x, y: a.y },
      { x: hover.x, y: hover.y }, { x: a.x, y: hover.y },
      { x: a.x, y: a.y },
    ]
  }, [draft, hover, drawMode, masking])

  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    drawDetectorOverlay(canvas, {
      detectors, colorOf: (id) => detectorColor(detectors, id),
      seen: detections, paths, scenery, tints, robot, robots, trail,
      robotTeam: lock?.team ?? null,
      draft: preview, drawingId: drawing, procWidth, procHeight,
    })
  }, [detections, paths, scenery, tints, robot, robots, trail, lock, detectors,
      preview, drawing, procWidth, procHeight])

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }

    if (masking) {
      if (!draft.length) { setDraft([p]); return }
      const a = draft[0]
      const box = [
        { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y) },
        { x: Math.max(a.x, p.x), y: Math.min(a.y, p.y) },
        { x: Math.max(a.x, p.x), y: Math.max(a.y, p.y) },
        { x: Math.min(a.x, p.x), y: Math.max(a.y, p.y) },
      ]
      setDetectors(detectors.map((d) => d.id === masking
        ? { ...d, ignore: [...(d.ignore ?? []), box] } : d))
      setDraft([]); setMasking(null); setHover(null); reset()
      return
    }

    if (drawing) {
      if (drawMode === 'poly') { setDraft((d) => [...d, p]); return }
      // Box: first click sets a corner, second closes it.
      if (!draft.length) { setDraft([p]); return }
      const a = draft[0]
      applyZone(drawing, [
        { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y) },
        { x: Math.max(a.x, p.x), y: Math.min(a.y, p.y) },
        { x: Math.max(a.x, p.x), y: Math.max(a.y, p.y) },
        { x: Math.min(a.x, p.x), y: Math.max(a.y, p.y) },
      ])
      return
    }

    if (locking) {
      const result = pickRobotAt(p.x, p.y)
      if (!result.picked) {
        setError('Could not pick a robot out there. Click the middle of its bumper, on a frame where you can see it clearly.')
        return
      }
      // Clicking one of the robots already being tracked just designates it.
      // Clicking a robot the fleet has not found teaches it a better colour.
      if (result.appearance && lock) {
        setLock({ ...lock, appearance: result.appearance })
      }
      setLocking(false)
      setError('')
      return
    }

    if (sampling) {
      const s = sampleAt(p.x, p.y)
      if (s && s.value > 0.08) {
        setDetectors(detectors.map((d) => d.id === sampling ? {
          ...d,
          appearance: {
            ...d.appearance,
            hue: Math.round(s.hue),
            // The tolerance comes from how much the colour actually varied
            // across the thing, not from a constant: a matte ball under flat
            // light and the same ball under arena spotlights need very
            // different windows, and a scout cannot tell which they have.
            hueTolerance: Math.round(Math.max(10, Math.min(48, s.hueSpread * 1.5 + 8))),
            minSaturation: Math.max(0.14, s.saturation * 0.5),
            minValue: Math.max(0.1, s.value * 0.4),
          },
        } : d))
        setSampling(null)
      } else setError('That spot is too dark to sample. Try a lit part of it.')
    }
  }

  /** Commit an area to a detector and switch it on. */
  function applyZone(id: string, zone: Point[]) {
    setDetectors(detectors.map((d) => d.id === id ? { ...d, zone, enabled: true } : d))
    setDraft([])
    setHover(null)
    setDrawing(null)
    reset()
  }

  function finishZone() {
    if (drawing && draft.length >= 3) applyZone(drawing, draft)
    else { setDraft([]); setDrawing(null) }
  }

  /**
   * Give a detector the whole picture to work in.
   *
   * Not a scoring setup — with the whole frame as its area, "went in" fires
   * wherever a ball leaves the picture, so it over-counts. It is the fastest
   * way to prove the detector can see the game piece at all, which is the
   * question anyone staring at a disabled Scan button actually has. The
   * warning that offers it says so.
   */
  function coverFrame(id: string) {
    applyZone(id, [{ x: 0.01, y: 0.01 }, { x: 0.99, y: 0.01 },
                   { x: 0.99, y: 0.99 }, { x: 0.01, y: 0.99 }])
  }

  /**
   * Work out the scoring area from the video instead of asking for it.
   *
   * Runs a pass with the detector unarmed — it tracks, but cannot count —
   * and collects where moving balls stopped being visible. Balls stop being
   * visible because they went into something, so the densest cluster of
   * endings is the goal. The scout still confirms it; this only removes the
   * step where they had to know where to draw before anything would run.
   */
  async function findGoal(id: string) {
    const v = videoRef.current
    if (!v) return
    setFinding('Watching where the balls end up…')
    setError('')
    resetAll()

    if (seekable) {
      scanRef.current = true
      setRunning(true)
      const total = v.duration || 0
      const stepSec = 1 / 30
      let frames = 0
      try {
        for (let t = 0; t < total && scanRef.current; t += stepSec) {
          v.currentTime = t
          await seeked(v)
          processFrame()
          if (frames++ % 12 === 0) setProgress(total ? t / total : 0)
        }
      } finally {
        scanRef.current = false
        setProgress(null)
        setRunning(false)
      }
    }

    const { proposal, why } = findZone(id)
    setFinding('')
    if (!proposal) { setError(why); return }
    applyZone(id, proposal.zone)
    setError('')
    setFinding(`Proposed from ${proposal.support} balls that ended there `
      + `(${Math.round(proposal.share * 100)}% of everything tracked). `
      + 'Redraw it by hand if it looks wrong.')
  }

  /**
   * Build the robot's appearance model from a photograph of it.
   *
   * A colour threshold cannot tell one red robot from another red robot —
   * they are the same colour, and no amount of tuning changes that. A photo
   * carries everything that is *not* bumper, and comparing that is what
   * separates three machines on the same alliance.
   *
   * The photo should be mostly robot, roughly centred, taken anywhere: the
   * pit, a match, the queue. The middle is read as the robot and the outer
   * border as its surroundings, so a tight shot works far better than one
   * with the whole field in it.
   */
  async function usePhoto(file: File) {
    setPhotoNote('Reading the photo…')
    setError('')
    try {
      const bitmap = await createImageBitmap(file)
      // Downscaled: the fit needs colour, not detail, and a 12-megapixel
      // phone photo would cost seconds for no gain whatsoever.
      const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height))
      const cw = Math.max(32, Math.round(bitmap.width * scale))
      const ch = Math.max(32, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = cw; canvas.height = ch
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('no canvas')
      ctx.drawImage(bitmap, 0, 0, cw, ch)
      bitmap.close?.()

      const signature = learnFromPhoto(ctx.getImageData(0, 0, cw, ch))
      const alliance: 'red' | 'blue' = team && match.red.includes(team) ? 'red' : 'blue'
      setLock({ team, alliance, appearance: signature.appearance, signature })
      reset()

      const pct = Math.round(signature.quality * 100)
      setPhotoNote(
        `Fitted in ${signature.iterations} steps`
        + `${signature.improvements ? ` (${signature.improvements} improved it)` : ' — the first guess was already right'}`
        + `. Separation ${pct}%. `
        + (signature.quality >= 0.45
            ? 'Good enough to tell this robot from its partners.'
            : 'Low — the robot is too close in colour to its background in that photo. '
              + 'Try one where it stands out, or fill more of the frame with it.'))
    } catch {
      setPhotoNote('')
      setError('That image could not be read. A JPEG or PNG of the robot works best.')
    }
  }

  function startDrawing(id: string, mode: 'box' | 'poly') {
    setSampling(null); setLocking(false); setDraft([]); setHover(null)
    setDrawMode(mode); setDrawing(id)
  }

  // Sampling needs a frame in hand; pull one so a paused video can be used.
  useEffect(() => { if (sampling || locking) previewFrame() }, [sampling, locking, previewFrame])

  // ---- results -----------------------------------------------------------
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const h of hits) {
      if (onlyTracked && lock && h.team !== lock.team) continue
      c[h.detectorId] = (c[h.detectorId] ?? 0) + 1
    }
    return c
  }, [hits, onlyTracked, lock])

  // Without a lock the dropdown supplies the attribution, as before. With
  // one, a hit already carries whatever the geometry could prove, and the
  // dropdown is not allowed to overwrite a rejection with a guess.
  const assigned = hits.map((h) => ({ ...h, team: h.team ?? (lock ? null : team) }))
  const shown = onlyTracked && lock
    ? assigned.filter((h) => h.team === lock.team)
    : assigned
  const rejected = hits.filter((h) => h.credit.rejected).length

  function targetLabel(d: Detector): string {
    if (d.target.kind === 'flag') return 'died on field'
    if (d.target.kind === 'state') {
      const action = game.actions.find((a) => a.id === (d.target as any).id)
      return action?.label ?? (d.target as any).id
    }
    const id = d.target.byPhase.teleop ?? d.target.byPhase.auto ?? ''
    const action = game.actions.find((a) => a.id === id)
    return action?.label ?? id
  }

  async function saveAsMarkers() {
    const rows = shown.filter((h) => h.team)
    for (const h of rows) {
      const d = detectors.find((x) => x.id === h.detectorId)
      await saveMarker({
        id: markerId(match.key, h.t, `${author}-${h.detectorId}`),
        schemaVersion: SCHEMA_VERSION,
        eventKey,
        matchKey: match.key,
        matchNumber: match.matchNumber,
        matchLevel: match.matchLevel,
        t: h.t,
        teamNumber: h.team,
        tag: 'shot',
        // The note carries how sure the detector was and how the team was
        // arrived at, because a marker a human later disagrees with is far
        // easier to judge when it says what it was built on.
        note: `${d?.label ?? h.detectorId} — detected from film`
          + ` (${Math.round(h.confidence * 100)}% sure`
          + `${h.credit.team ? `, from the tracked robot` : ''})`,
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
      title="Detection from film"
      right={<span className="text-[12px] text-chalk-faint">
        {shown.length} found
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
            source.kind === 'file' ? 'border-signal bg-signal/15 text-signal'
              : 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk')}>
          Open a video file
        </button>
        <button type="button" onClick={openUrl}
          className={clsx('h-8 rounded-panel border px-3 text-[13px] font-600 transition',
            source.kind === 'url' ? 'border-signal bg-signal/15 text-signal'
              : 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk')}>
          Video URL
        </button>
        <button type="button" onClick={shareTab}
          className={clsx('h-8 rounded-panel border px-3 text-[13px] font-600 transition',
            source.kind === 'screen' ? 'border-signal bg-signal/15 text-signal'
              : 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk')}>
          Share a tab
        </button>
        {source.kind === 'screen' && youtube && (
          <button type="button" onClick={focusVideoTab}
            className="h-8 rounded-panel border border-signal/50 px-3 text-[13px] font-600
                       text-signal transition hover:bg-signal/10">
            Back to the video ↗
          </button>
        )}
        {live && (
          <button type="button" onClick={releaseSource}
            className="h-8 rounded-panel px-2 text-[13px] text-chalk-faint hover:text-alliance-red">
            Close
          </button>
        )}
      </div>

      {surfaceNote && (
        <p className="mb-2 text-[12px] leading-snug text-signal">{surfaceNote}</p>
      )}

      {!live && (
        <div className="rounded-panel border border-deck-600 bg-deck-900 p-3">
          <p className="text-[13px] leading-relaxed text-chalk-dim">
            Pick a source and this replaces the embed above with a real player —
            frame-stepping, an overlay, and detectors reading the picture. TBA footage
            can only be embedded, never read: a page cannot touch the pixels inside
            another site's frame, in any season. So the readable sources are:
          </p>
          <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-chalk-dim">
            <li>
              <span className="font-600 text-chalk">Open a video file</span> — your own
              recording from the stands. Best option: fully scrubbable, nothing to configure.
            </li>
            <li>
              <span className="font-600 text-chalk">Video URL</span> — a direct link to an
              .mp4 or .webm your team hosts. The host must allow other sites to read it.
            </li>
          </ul>

          {youtube && (
            <div className="mt-3 border-t border-deck-600 pt-3">
              <div className="label mb-2">Or read this match's TBA footage</div>
              <ol className="space-y-2">
                <li className="flex items-center gap-2">
                  <Step n={1} done={tabOpened} />
                  <button type="button" onClick={openVideoTab}
                    className={clsx('h-8 rounded-panel border px-3 text-[13px] font-600 transition',
                      tabOpened
                        ? 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk'
                        : 'border-signal bg-signal/15 text-signal hover:bg-signal/25')}>
                    {tabOpened ? 'Reopen the match on YouTube ↗' : 'Open the match on YouTube ↗'}
                  </button>
                  <span className="text-[12px] text-chalk-faint">
                    the share picker can only offer tabs that are already open
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Step n={2} done={false} />
                  <button type="button" onClick={shareTab}
                    className={clsx('h-8 rounded-panel border px-3 text-[13px] font-600 transition',
                      cameBack
                        ? 'border-signal bg-signal/15 text-signal hover:bg-signal/25'
                        : 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk')}>
                    Share that tab
                  </button>
                  <span className="text-[12px] text-chalk-faint">
                    pick the YouTube tab in the picker Chrome shows
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Step n={3} done={false} />
                  <span className="text-[13px] text-chalk-dim">
                    Play it over there. Counting keeps running while you watch.
                  </span>
                </li>
              </ol>
            </div>
          )}
        </div>
      )}

      {live && (
        <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
          <div>
            <div className="relative overflow-hidden rounded-panel border border-deck-500 bg-black">
              <video ref={videoRef} playsInline muted={source.kind === 'screen'}
                className="block max-h-[60vh] w-full"
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                onLoadedData={() => previewFrame()}
                onSeeked={() => { if (!running) previewFrame() }}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => { setPlaying(false); setRunning(false) }} />
              <canvas ref={overlayRef} onClick={onCanvasClick}
                onMouseMove={(e) => {
                  if ((!drawing && !masking) || (drawing && drawMode !== 'box') || !draft.length) return
                  const r = e.currentTarget.getBoundingClientRect()
                  setHover({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })
                }}
                onMouseLeave={() => setHover(null)}
                className={clsx('absolute inset-0 h-full w-full',
                  drawing || sampling || locking || masking ? 'cursor-crosshair' : 'cursor-default')} />
              {(drawing || sampling || locking || masking) && (
                <div className="absolute inset-x-0 top-0 bg-signal px-2 py-1 text-[12px] font-600 text-deck-900">
                  {masking
                    ? (draft.length
                        ? 'Now click the opposite corner of the area to ignore.'
                        : 'Click one corner of an area to ignore — the far hopper, the crowd, the other end of the field.')
                    : drawing
                    ? drawMode === 'box'
                      ? (draft.length
                          ? `Now click the opposite corner of the area for “${detectors.find((d) => d.id === drawing)?.label}”.`
                          : `Click one corner of the area for “${detectors.find((d) => d.id === drawing)?.label}”, then the opposite one.`)
                      : `Click the corners of the area for “${detectors.find((d) => d.id === drawing)?.label}”, then Finish. ${draft.length} placed.`
                    : sampling
                      ? `Click the thing “${detectors.find((d) => d.id === sampling)?.label}” should look for.`
                      : `Click the middle of ${team}'s bumper. Pick a frame where you can see it clearly.`}
                </div>
              )}
            </div>

            {/* ---- transport ---------------------------------------------- */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={toggle} className="btn-ghost h-8 w-16 py-0 text-[13px]">
                {playing ? '❙❙ Pause' : '▶ Play'}
              </button>
              {seekable ? (
                <>
                  <button type="button" onClick={() => step(-5)} className="btn-ghost h-8 py-0 text-[13px]">−5s</button>
                  <button type="button" onClick={() => step(-1 / 30)} className="btn-ghost h-8 py-0 text-[13px]" title="One frame back">◀|</button>
                  <button type="button" onClick={() => step(1 / 30)} className="btn-ghost h-8 py-0 text-[13px]" title="One frame on">|▶</button>
                  <button type="button" onClick={() => step(5)} className="btn-ghost h-8 py-0 text-[13px]">+5s</button>
                  <span className="font-mono text-[12px] tabular-nums text-chalk-dim">
                    {formatTime(time)}<span className="text-chalk-faint"> / {formatTime(duration)}</span>
                  </span>
                </>
              ) : (
                <span className="text-[12px] text-chalk-faint">
                  Mirroring the shared tab — play the video there. Detection keeps
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
                {markers.map((m) => (
                  <button key={m.id} type="button"
                    onClick={() => { const v = videoRef.current; if (v) v.currentTime = m.t }}
                    title={`${formatTime(m.t)} · ${m.tag}${m.note ? ` — ${m.note}` : ''}`}
                    style={{ left: `${Math.min(99, (m.t / duration) * 100)}%` }}
                    className={clsx('absolute bottom-0 h-2 w-1 -translate-x-1/2',
                      MARKER_COLORS[m.tag] ?? 'bg-slate-400')} />
                ))}
                {hits.map((h) => (
                  <button key={h.key} type="button"
                    onClick={() => { const v = videoRef.current; if (v) v.currentTime = h.t }}
                    title={`${formatTime(h.t)} · ${detectors.find((d) => d.id === h.detectorId)?.label}`}
                    style={{ left: `${Math.min(99, (h.t / duration) * 100)}%`,
                             background: detectorColor(detectors, h.detectorId) }}
                    className="absolute top-0 h-2 w-0.5 -translate-x-1/2" />
                ))}
              </div>
            )}

            {/* ---- run ----------------------------------------------------- */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-deck-600 pt-3">
              {drawing ? (
                <>
                  {drawMode === 'poly' && (
                    <button type="button" onClick={finishZone} disabled={draft.length < 3}
                      className="btn-primary h-8 py-0 text-[13px] disabled:opacity-30">Finish area</button>
                  )}
                  {drawMode === 'box' && (
                    <span className="text-[13px] text-signal">
                      {draft.length ? 'Click the opposite corner.' : 'Click one corner of the goal.'}
                    </span>
                  )}
                  <button type="button" onClick={() => { setDraft([]); setDrawing(null) }}
                    className="btn-ghost h-8 py-0 text-[13px]">Cancel</button>
                </>
              ) : running ? (
                <button type="button" onClick={stop} className="btn-ghost h-8 py-0 text-[13px]">Stop</button>
              ) : (
                <button type="button" onClick={scan} disabled={!armed.length}
                  className="btn-primary h-8 py-0 text-[13px] disabled:opacity-30">
                  {seekable ? `Scan with ${armed.length} detector${armed.length === 1 ? '' : 's'}` : 'Start detecting'}
                </button>
              )}
              <button type="button" onClick={() => { setHits([]); setSaved(0); reset() }}
                className="btn-ghost h-8 py-0 text-[13px]">Clear results</button>

              <select className="input h-8 w-auto py-0 text-[13px]"
                value={team ?? ''}
                onChange={(e) => {
                  const next = e.target.value ? Number(e.target.value) : null
                  setTeam(next)
                  // Changing who you are watching invalidates a lock learned
                  // from a different robot's bumper — but the alliance colour
                  // is known from the match, so the fleet can start tracking
                  // every robot of that colour straight away. Pointing at one
                  // then becomes "pick this one", not "teach me what red is".
                  setLocking(false)
                  setLock(next
                    ? { team: next, alliance: match.red.includes(next) ? 'red' : 'blue',
                        appearance: allianceLook(match.red.includes(next) ? 'red' : 'blue') }
                    : null)
                }}>
                <option value="">Watching which robot?</option>
                {teams.map((t) => (
                  <option key={t} value={t}>{t} · {match.red.includes(t) ? 'red' : 'blue'}</option>
                ))}
              </select>

              {/*
                The direct answer to game pieces at the back of the field:
                colour and shape cannot tell a ball in the far hopper from a
                ball in play, because there is nothing to tell apart — it is
                the same object somewhere that does not matter. Where to look
                is the scout's knowledge, so it is a tool, not a threshold.
              */}
              <button type="button"
                onClick={() => {
                  const id = armed[0]?.id ?? detectors.find((d) => d.enabled)?.id
                  if (!id) return
                  setDrawing(null); setSampling(null); setLocking(false)
                  setDraft([]); setHover(null); setMasking(id)
                }}
                className={clsx('h-8 rounded-panel border px-3 text-[13px] font-600 transition',
                  masking ? 'border-signal bg-signal/20 text-signal'
                    : 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk')}>
                {masking ? 'Click the area to ignore…' : 'Ignore an area'}
              </button>
              {ignoreCount > 0 && (
                <button type="button"
                  onClick={() => {
                    setDetectors(detectors.map((d) => ({ ...d, ignore: [] })))
                    reset()
                  }}
                  className="h-8 rounded-panel px-2 text-[12px] text-chalk-faint hover:text-alliance-red">
                  clear {ignoreCount} ignored
                </button>
              )}

              <label className="flex items-center gap-1 text-[12px] text-chalk-faint"
                title="Higher finds smaller things — a ball at the far end of the field — and costs more time per frame.">
                Detail
                <select className="input h-8 w-auto py-0 text-[13px]" value={procWidth}
                  onChange={(e) => { setProcWidth(Number(e.target.value)); reset() }}>
                  {PROC_WIDTHS.map((px) => (
                    <option key={px} value={px}>{px}px</option>
                  ))}
                </select>
              </label>
            </div>

            {/* ---- following one robot -------------------------------------- */}
            {/*
              Nothing here reads a bumper number, so "which robot scored" can
              only ever be answered geometrically: point at the robot once,
              and a ball whose flight *began* at it is its shot. That is a
              real claim rather than an assumption, which is why a ball that
              set off from somewhere else is left unassigned instead of being
              credited to whoever is selected in the dropdown.
            */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-panel
                            border border-deck-600 bg-deck-900 px-2 py-1.5">
              <span className="label">Track a robot's shooting</span>
              <button type="button"
                disabled={!team}
                onClick={() => { setLocking((v) => !v); setDrawing(null); setSampling(null); setDraft([]) }}
                className={clsx('h-7 rounded-panel border px-2 text-[12px] font-600 transition disabled:opacity-30',
                  locking ? 'border-signal bg-signal/20 text-signal'
                    : lock ? 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk'
                      : 'border-signal/60 text-signal hover:bg-signal/10')}>
                {locking ? 'Click the robot…' : lock ? `Re-point at ${lock.team}` : 'Point at it on the video'}
              </button>

              <input ref={photoRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) usePhoto(f); e.target.value = '' }} />
              <button type="button" disabled={!team} onClick={() => photoRef.current?.click()}
                title="A photo of the robot — mostly robot, roughly centred. Its colours are what tell it apart from partners wearing the same bumpers."
                className={clsx('h-7 rounded-panel border px-2 text-[12px] font-600 transition disabled:opacity-30',
                  lock?.signature ? 'border-emerald-400/50 text-emerald-300'
                    : 'border-deck-500 text-chalk-dim hover:bg-deck-600 hover:text-chalk')}>
                {lock?.signature ? 'Photo loaded ✓' : 'Use a photo of the robot'}
              </button>

              {!team && (
                <span className="text-[12px] text-chalk-faint">
                  pick the team above first
                </span>
              )}
              {team && !lock && !locking && (
                <span className="text-[12px] text-chalk-faint">
                  optional — without it every hit is credited to {team}
                </span>
              )}
              {photoNote && (
                <span className="basis-full text-[12px] leading-snug text-chalk-dim">{photoNote}</span>
              )}

              {lock && (
                <>
                  <span className={clsx('rounded px-1.5 text-[11px] font-600',
                    robot && robot.confidence >= 0.45 && !robot.merged
                      ? 'bg-emerald-400/15 text-emerald-300'
                      : 'bg-alliance-red/15 text-alliance-red')}>
                    {robot && robot.confidence >= 0.45 && !robot.merged
                      ? `following ${lock.team}`
                      : robot?.merged ? "can't tell it from a partner" : 'lost it'}
                  </span>
                  <span className="text-[12px] text-chalk-faint">
                    {robots.length} robot{robots.length === 1 ? '' : 's'} of that colour in view
                  </span>
                  <label className="flex items-center gap-1 text-[12px] text-chalk-dim">
                    <input type="checkbox" checked={onlyTracked} className="accent-signal"
                      onChange={(e) => setOnlyTracked(e.target.checked)} />
                    only this robot's shots
                  </label>
                  {rejected > 0 && (
                    <span className="text-[12px] text-chalk-faint">
                      {rejected} came from somewhere else
                    </span>
                  )}
                  <button type="button" onClick={() => { setLock(null); setOnlyTracked(false) }}
                    className="ml-auto px-1 text-[12px] text-chalk-faint hover:text-alliance-red">
                    stop following
                  </button>
                </>
              )}
            </div>

            {progress !== null && (
              <div className="mt-2 h-1 overflow-hidden rounded bg-deck-600">
                <div className="h-full bg-signal transition-[width]"
                  style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}

            {!armed.length && (() => {
              // The message used to explain the rule and stop there, with the
              // controls that satisfy it in a column beside the video. An
              // explanation of why you are blocked is not much use without
              // the button that unblocks you, so it is here.
              const target = detectors.find((d) => d.enabled) ?? detectors[0]
              const totalSeen = Object.values(seeing).reduce((a, b) => a + b, 0)
              if (!target) return null
              return (
                <div className="mt-2 rounded-panel border border-signal/40 bg-signal/5 p-2">
                  <p className="text-[12px] leading-snug text-signal">
                    Nothing can fire until “{target.label}” has an area — that is what
                    stops the camera inventing data about a field it has never seen.
                    Give it one:
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => findGoal(target.id)}
                      disabled={!seekable || running}
                      title={seekable
                        ? 'Watches the whole video, then puts the area where balls actually ended up.'
                        : 'Needs a scrubbable video — a file or a direct URL, not a shared tab.'}
                      className="btn-primary h-7 py-0 text-[12px] disabled:opacity-30">
                      Find the goal for me
                    </button>
                    <button type="button" onClick={() => startDrawing(target.id, 'box')}
                      className="btn-ghost h-7 py-0 text-[12px]">
                      Draw a box over the goal
                    </button>
                    <button type="button" onClick={() => startDrawing(target.id, 'poly')}
                      className="btn-ghost h-7 py-0 text-[12px]">
                      Trace a shape instead
                    </button>
                    <button type="button" onClick={() => coverFrame(target.id)}
                      className="btn-ghost h-7 py-0 text-[12px]"
                      title="Counts a ball leaving the picture anywhere, so it over-counts. Use it to check the colour is right, then draw the real area.">
                      Use the whole frame
                    </button>
                  </div>
                  {finding && (
                    <p className="mt-1.5 text-[12px] leading-snug text-signal">{finding}</p>
                  )}
                  <p className="mt-1.5 text-[12px] leading-snug text-chalk-faint">
                    {totalSeen > 0
                      ? `The colour is already working — ${totalSeen} thing${totalSeen === 1 ? '' : 's'} `
                        + 'picked out of this frame. Only the area is missing.'
                      : 'Nothing is being picked out of this frame yet either. Use '
                        + '“Sample colour” on a detector and click the game piece, '
                        + 'or raise Detail, before worrying about the area.'}
                  </p>
                </div>
              )
            })()}
            {blocked && (
              <p className="mt-2 text-[12px] leading-snug text-alliance-red">
                This video's pixels can't be read — it comes from another site. Use a
                downloaded file, or share the tab that is playing it.
              </p>
            )}
            {error && <p className="mt-2 text-[12px] text-alliance-red">{error}</p>}

            {/* ---- results -------------------------------------------------- */}
            {hits.length > 0 && (
              <div className="mt-3 border-t border-deck-600 pt-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-display text-[15px] font-600 text-chalk">
                    {hits.length} event{hits.length === 1 ? '' : 's'}
                  </span>
                  {team && counts.fuel_scored > 0 && (
                    <span className="text-[12px] text-chalk-dim">
                      scouts recorded{' '}
                      <span className="font-600 text-chalk">{scoutedFuel[team] ?? 0}</span> FUEL for {team}
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
                  {shown.map((h) => (
                    <div key={h.key} className="group flex items-center gap-2 rounded-panel border border-deck-600 px-2 py-1">
                      <button type="button"
                        onClick={() => { const v = videoRef.current; if (v && seekable) v.currentTime = h.t }}
                        className="font-mono text-[12px] font-600 text-chalk hover:underline">
                        {formatTime(h.t)}
                      </button>
                      <span className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: detectorColor(detectors, h.detectorId) }} />
                      <span className="truncate text-[12px] text-chalk-dim">
                        {detectors.find((d) => d.id === h.detectorId)?.label ?? h.detectorId}
                      </span>
                      <select className="ml-auto h-6 rounded border border-deck-500 bg-deck-900 px-1 text-[12px] text-chalk-dim"
                        value={h.team ?? ''}
                        onChange={(e) => setHits((prev) => prev.map((p) =>
                          p.key === h.key ? { ...p, team: e.target.value ? Number(e.target.value) : null } : p))}>
                        <option value="">unassigned</option>
                        {teams.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button type="button" onClick={() => setHits((prev) => prev.filter((p) => p.key !== h.key))}
                        className="px-1 text-chalk-faint opacity-0 transition group-hover:opacity-100 hover:text-alliance-red">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ---- detectors ------------------------------------------------- */}
          <div>
            <DetectorList
              detectors={detectors}
              onChange={setDetectors}
              counts={counts}
              seeing={seeing}
              drawing={drawing}
              onDraw={(id, mode) => startDrawing(id, mode)}
              onCover={coverFrame}
              onSample={(id) => { setDrawing(null); setLocking(false); setDraft([]); setSampling(id) }}
              targetLabel={targetLabel}
            />
            <DetectorTuning detectors={detectors} selectedId={tuned} onSelect={setTuned}
              onChange={(next) => setDetectors(detectors.map((d) => d.id === next.id ? next : d))} />
          </div>
        </div>
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

/** Step number for the tab-sharing walkthrough. */
function Step({ n, done }: { n: number; done: boolean }) {
  return (
    <span className={clsx(
      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-700',
      done ? 'bg-emerald-400/20 text-emerald-300' : 'bg-deck-600 text-chalk-dim',
    )}>
      {done ? '✓' : n}
    </span>
  )
}
