import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { getGame } from '@/games'
import type { CounterAction, Phase, SelectAction, ToggleAction } from '@/games/types'
import { db, saveMatch } from '@/lib/db'
import { matchId, SCHEMA_VERSION, type ScoutEvent, type Alliance } from '@/lib/schema'
import { loadSettings, loadVisionConfig, saveVisionConfig } from '@/lib/settings'
import { DEFAULT_VISION, type VisionConfig } from '@/lib/vision'
import type { VisionMode } from '@/lib/ballTracker'
import { VisionCounter } from '@/features/vision/VisionCounter'
import { getCachedEvent, teamInfo } from '@/lib/tba'
import type { CachedEvent } from '@/lib/schema'
import { Card, Field, Panel, Pill, Toast } from '@/components/ui'
import { Counter } from './Counter'
import { MatchTimer, useMatchClock } from './MatchTimer'

const PHASES: { id: Phase; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'teleop', label: 'Teleop' },
  { id: 'endgame', label: 'Endgame' },
]

/** Number-row hotkeys, assigned to counters in form order, for laptop scouts. */
const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export default function MatchScout() {
  const settings = loadSettings()
  const game = getGame(settings.gameId)
  const clock = useMatchClock()

  const [event, setEvent] = useState<CachedEvent | null>(null)
  const [phase, setPhase] = useState<Phase>('auto')
  const [toast, setToast] = useState<{ msg: string; tone: 'green' | 'red' } | null>(null)

  // -- match identity -------------------------------------------------------
  const [matchLevel, setMatchLevel] = useState<'qm' | 'sf' | 'f' | 'pr'>('qm')
  const [matchNumber, setMatchNumber] = useState(1)
  const [teamNumber, setTeamNumber] = useState<number | ''>('')
  const [alliance, setAlliance] = useState<Alliance>(settings.assignedAlliance || 'red')
  // The scout picks a team, not a seat number — but which seat they picked is
  // remembered so the next match pre-fills the same position on the alliance.
  const [station, setStation] = useState(settings.assignedStation || 1)

  // -- collected data -------------------------------------------------------
  const [events, setEvents] = useState<ScoutEvent[]>([])
  const [states, setStates] = useState<Record<string, string | boolean>>(() => initialStates(game))
  const [defenseRating, setDefenseRating] = useState(0)
  const [driverRating, setDriverRating] = useState(0)
  const [diedOnField, setDied] = useState(false)
  const [noShow, setNoShow] = useState(false)
  const [notes, setNotes] = useState('')

  // Camera-assisted FUEL counting. The mode and tuning persist per device,
  // because they depend on that device's camera and where it is pointed.
  const [visionMode, setVisionMode] = useState<VisionMode>(
    (settings.visionMode as VisionMode) || 'manual')
  const [visionConfig, setVisionConfig] = useState<VisionConfig>(
    () => loadVisionConfig(DEFAULT_VISION))

  function updateVisionConfig(next: VisionConfig) {
    setVisionConfig(next)
    saveVisionConfig(next)
  }
  function updateVisionMode(next: VisionMode) {
    setVisionMode(next)
    localStorage.setItem('vision_mode', next)
  }

  // Which counter the camera drives, per phase.
  const visionActionId = phase === 'auto' ? 'auto_fuel_scored' : 'teleop_fuel_scored'
  const visionAction = useMemo(
    () => game.actions.find((a): a is CounterAction =>
      a.kind === 'counter' && a.id === visionActionId),
    [game, visionActionId],
  )

  useEffect(() => { getCachedEvent(settings.eventKey).then(setEvent) }, [settings.eventKey])

  const scheduled = useMemo(
    () => event?.matches.find(
      (m) => m.matchLevel === matchLevel && m.matchNumber === matchNumber) ?? null,
    [event, matchLevel, matchNumber],
  )

  /** The six robots on the field, flattened, in TBA's order. */
  const lineup = useMemo(() => {
    if (!scheduled) return [] as { team: number; alliance: Alliance; station: number }[]
    const out: { team: number; alliance: Alliance; station: number }[] = []
    for (const a of ['red', 'blue'] as Alliance[]) {
      scheduled[a]?.forEach((team, i) => out.push({ team, alliance: a, station: i + 1 }))
    }
    return out
  }, [scheduled])

  // Follow the schedule: when the match or alliance changes, jump to whoever
  // is sitting in the seat this scout was last watching.
  useEffect(() => {
    const seat = lineup.find((r) => r.alliance === alliance && r.station === station)
    if (seat) setTeamNumber(seat.team)
  }, [lineup, alliance, station])

  // Picking a robot is the primary act; the alliance and seat follow from it.
  function pickTeam(team: number) {
    setTeamNumber(team)
    const seat = lineup.find((r) => r.team === team)
    if (seat) { setAlliance(seat.alliance); setStation(seat.station) }
    else setStation(0)
  }
  const [typeTeam, setTypeTeam] = useState(false)

  const counters = useMemo(
    () => game.actions.filter((a): a is CounterAction => a.kind === 'counter' && a.phase === phase),
    [game, phase],
  )

  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const ev of events) t[ev.actionId] = (t[ev.actionId] ?? 0) + ev.delta
    return t
  }, [events])

  // Deltas are clamped at zero rather than rejected, so a −5 on a count of 3
  // lands on 0 instead of silently doing nothing.
  function bump(actionId: string, delta: number) {
    const current = totals[actionId] ?? 0
    const d = delta < 0 ? -Math.min(current, -delta) : delta
    if (d === 0) return
    setEvents((prev) => [...prev, { actionId, t: round1(clock.now()), delta: d }])
  }

  function undoLast() {
    setEvents((prev) => prev.slice(0, -1))
  }

  // Laptop scouts drive this with the number row; phone scouts tap.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undoLast(); return }
      const idx = HOTKEYS.indexOf(e.key)
      if (idx >= 0 && counters[idx]) { e.preventDefault(); bump(counters[idx].id, counters[idx].step ?? 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [counters, totals])

  // Auto-advance the phase tab as the match clock crosses period boundaries,
  // but never fight a scout who has tabbed somewhere deliberately.
  const [manualPhase, setManualPhase] = useState(false)
  useEffect(() => {
    if (!clock.running || manualPhase) return
    const w = game.windows.find((x) => clock.elapsed >= x.startSec && clock.elapsed < x.endSec)
    if (w && w.phase !== phase) setPhase(w.phase)
  }, [clock.elapsed, clock.running, manualPhase, game.windows, phase])

  async function submit() {
    if (teamNumber === '') { flash('Enter a team number first.', 'red'); return }
    if (!settings.eventKey) { flash('Set an event in Settings first.', 'red'); return }

    const now = Date.now()
    const id = matchId(settings.eventKey, matchLevel, matchNumber, Number(teamNumber))
    const existing = await db.matches.get(id)

    await saveMatch({
      id,
      schemaVersion: SCHEMA_VERSION,
      gameId: game.id,
      eventKey: settings.eventKey,
      matchNumber,
      matchLevel,
      teamNumber: Number(teamNumber),
      alliance,
      station,
      scoutName: settings.scoutName || 'anonymous',
      events,
      states,
      diedOnField,
      noShow,
      defenseRating,
      driverRating,
      notes,
      createdAt: existing?.createdAt ?? now,
      synced: false,
    })

    flash(existing ? `Overwrote ${teamNumber} in match ${matchNumber}.` : `Saved ${teamNumber}, match ${matchNumber}.`, 'green')
    resetForNextMatch()
  }

  function resetForNextMatch() {
    setEvents([])
    setStates(initialStates(game))
    setDefenseRating(0); setDriverRating(0)
    setDied(false); setNoShow(false); setNotes('')
    setPhase('auto'); setManualPhase(false)
    clock.reset()
    setMatchNumber((n) => n + 1)
  }

  function flash(msg: string, tone: 'green' | 'red') {
    setToast({ msg, tone })
    setTimeout(() => setToast(null), 2600)
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 pb-28">
      {/* ---------------------------------------------------------- identity */}
      {/* The alliance spine is the signature of this screen. Which alliance
          you are watching is the single costliest thing to get wrong, so the
          interface wears that colour rather than mentioning it in a label. */}
      <div className="flex items-stretch gap-0">
        <div className={clsx('w-1.5 shrink-0 rounded-l-panel',
          alliance === 'red' ? 'bg-alliance-red' : 'bg-alliance-blue')} />

        <div className="panel flex-1 rounded-l-none border-l-0">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 p-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Level">
              <select className="input" value={matchLevel} onChange={(e) => setMatchLevel(e.target.value as any)}>
                <option value="qm">Quals</option>
                <option value="sf">Playoff</option>
                <option value="f">Finals</option>
                <option value="pr">Practice</option>
              </select>
            </Field>
            <Field label="Match">
              <input type="number" min={1} className="input" value={matchNumber}
                onChange={(e) => setMatchNumber(Math.max(1, Number(e.target.value)))} />
            </Field>
            <Field label="Alliance">
              <select className={clsx('input font-600',
                alliance === 'red' ? 'text-alliance-red' : 'text-alliance-blue')}
                value={alliance} onChange={(e) => setAlliance(e.target.value as Alliance)}>
                <option value="red">Red</option>
                <option value="blue">Blue</option>
              </select>
            </Field>
            {/* Scouts are assigned a robot, not a seat number, so the form asks
                for the robot. Everything positional is derived from it. */}
            <div className="sm:col-span-2 lg:col-span-2">
              {/* The dropdown already carries the nickname; only the typed
                  fallback needs it spelled out underneath. */}
              <Field label="Robot"
                hint={lineup.length > 0 && !typeTeam
                  ? undefined
                  : teamInfo(event, Number(teamNumber))?.nickname}>
                {lineup.length > 0 && !typeTeam ? (
                  <select
                    className={clsx('input font-display text-[17px] font-700',
                      alliance === 'red' ? 'text-alliance-red' : 'text-alliance-blue')}
                    value={teamNumber}
                    onChange={(e) => {
                      if (e.target.value === 'type') { setTypeTeam(true); return }
                      pickTeam(Number(e.target.value))
                    }}>
                    {teamNumber !== '' && !lineup.some((r) => r.team === teamNumber) && (
                      <option value={teamNumber}>{teamNumber}</option>
                    )}
                    {(['red', 'blue'] as Alliance[]).map((a) => (
                      <optgroup key={a} label={a === 'red' ? 'Red alliance' : 'Blue alliance'}>
                        {lineup.filter((r) => r.alliance === a).map((r) => (
                          <option key={r.team} value={r.team}>
                            {r.team}
                            {teamInfo(event, r.team)?.nickname
                              ? ` — ${teamInfo(event, r.team)!.nickname}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="type">Not on this list — type a number</option>
                  </select>
                ) : (
                  <div className="flex gap-1">
                    <input type="number" className="input font-display text-[19px] font-700"
                      value={teamNumber} placeholder="6036"
                      onChange={(e) => {
                        const v = e.target.value === '' ? '' : Number(e.target.value)
                        setTeamNumber(v)
                        if (v !== '') pickTeam(Number(v))
                      }} />
                    {lineup.length > 0 && (
                      <button type="button" onClick={() => setTypeTeam(false)}
                        className="shrink-0 rounded-panel border border-deck-500 px-2 text-[12px]
                                   font-600 text-chalk-faint hover:bg-deck-600 hover:text-chalk">
                        Schedule
                      </button>
                    )}
                  </div>
                )}
              </Field>
            </div>
            <div className="flex items-end">
              <div className="w-full rounded-panel border border-deck-500 bg-deck-900 px-2.5 py-1.5">
                <div className="label">Scout</div>
                <div className="truncate text-[15px] font-600 text-chalk">
                  {settings.scoutName || <span className="text-signal">not set</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <MatchTimer game={game} elapsed={clock.elapsed} running={clock.running}
        onStart={clock.start} onStop={clock.stop} onReset={clock.reset} />

      {/* ------------------------------------------------------------ phases */}
      <div className="flex gap-px border-b border-deck-500">
        {PHASES.map((p) => (
          <button key={p.id} type="button"
            onClick={() => { setPhase(p.id); setManualPhase(true) }}
            className={clsx(
              'flex-1 border-b-2 px-4 py-2 font-display text-[17px] font-600 leading-none transition',
              phase === p.id
                ? 'border-signal text-chalk'
                : 'border-transparent text-chalk-faint hover:text-chalk-dim',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ----------------------------------------------------- FUEL counter */}
      {phase !== 'endgame' && (
        <VisionCounter
          mode={visionMode}
          onModeChange={updateVisionMode}
          config={visionConfig}
          onConfigChange={updateVisionConfig}
          counted={Math.max(0, totals[visionActionId] ?? 0)}
          label={visionAction?.label ?? 'FUEL scored'}
          step={visionAction?.step ?? 1}
          onScore={() => bump(visionActionId, 1)}
          onManualAdjust={(d) => bump(visionActionId, d)}
        />
      )}

      {/* ---------------------------------------------------------- counters */}
      {counters.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {counters
            // The FUEL counter always lives in the panel above — in every
            // mode, including manual — so a second copy here would invite
            // double-tapping the same score.
            .filter((a) => a.id !== visionActionId)
            .map((action, i) => (
              <Counter key={action.id} action={action} value={Math.max(0, totals[action.id] ?? 0)}
                hotkey={HOTKEYS[i]} onChange={(d) => bump(action.id, d)} />
            ))}
        </div>
      )}

      {/* ------------------------------------------------- selects & toggles */}
      <StateControls game={game} phase={phase} states={states} onChange={(id, v) =>
        setStates((s) => ({ ...s, [id]: v }))} />

      {/* ------------------------------------------------------ subjective */}
      {phase === 'endgame' && (
        <Panel title="How it played">
          <div className="grid gap-4 sm:grid-cols-2">
            <Rating label="Defense played" value={defenseRating} onChange={setDefenseRating} />
            <Rating label="Driver skill" value={driverRating} onChange={setDriverRating} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Check label="Died / stopped moving" checked={diedOnField} onChange={setDied} tone="amber" />
            <Check label="No-show" checked={noShow} onChange={setNoShow} tone="rose" />
          </div>
          <div className="mt-4">
            <Field label="Notes">
              <textarea rows={3} className="input resize-none" value={notes}
                placeholder="What the counters miss: mechanism failures, strategy, penalties."
                onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </Panel>
      )}

      {/* --------------------------------------------------------- action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-deck-500 bg-deck-900/95 backdrop-blur">
        <div className={clsx('h-0.5', alliance === 'red' ? 'bg-alliance-red' : 'bg-alliance-blue')} />
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-2">
          <button type="button" onClick={undoLast} disabled={!events.length} className="btn-ghost">
            Undo{events.length > 0 && <span className="text-chalk-faint">{events.length}</span>}
          </button>
          <div className="flex-1 text-[12px] text-chalk-faint">
            {events.length} taps recorded
            {scheduled && (
              <span className="ml-3 hidden sm:inline">
                scheduled: {scheduled[alliance].join(', ')}
              </span>
            )}
          </div>
          <button type="button" onClick={submit} className="btn-primary px-6">Save match</button>
        </div>
      </div>

      {toast && <Toast message={toast.msg} tone={toast.tone} />}
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */

function StateControls({
  game, phase, states, onChange,
}: {
  game: ReturnType<typeof getGame>
  phase: Phase
  states: Record<string, string | boolean>
  onChange: (id: string, value: string | boolean) => void
}) {
  const selects = game.actions.filter((a): a is SelectAction => a.kind === 'select' && a.phase === phase)
  const toggles = game.actions.filter((a): a is ToggleAction => a.kind === 'toggle' && a.phase === phase)
  if (!selects.length && !toggles.length) return null

  return (
    <Panel title={phase === 'endgame' ? 'Final state' : 'Match events'} bodyClass="space-y-4 p-3">
      {toggles.map((t) => (
        <Check key={t.id} label={t.label} checked={states[t.id] === true}
          onChange={(v) => onChange(t.id, v)} tone="emerald" />
      ))}

      {selects.map((s) => (
        <div key={s.id}>
          <div className="label mb-1.5">{s.label}</div>
          <div className="flex flex-wrap gap-2">
            {s.options.map((opt) => {
              const active = states[s.id] === opt.value
              return (
                <button key={opt.value} type="button" onClick={() => onChange(s.id, opt.value)}
                  className={clsx(
                    'tap-target rounded-panel border px-3.5 py-2 font-display text-[16px] font-600 transition active:translate-y-px',
                    active
                      ? 'border-signal bg-signal/15 text-signal'
                      : 'border-deck-500 bg-deck-900 text-chalk-dim hover:bg-deck-600 hover:text-chalk',
                  )}
                >
                  {opt.label}
                  {opt.points > 0 && (
                    <span className={clsx('ml-1.5 text-[12px] font-400',
                      active ? 'text-signal/70' : 'text-chalk-faint')}>
                      {opt.points}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {s.hint && <p className="mt-1.5 text-[12px] leading-tight text-chalk-faint">{s.hint}</p>}
        </div>
      ))}
    </Panel>
  )
}

function Rating({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(value === n ? 0 : n)}
            className={clsx(
              'tap-target h-10 flex-1 rounded-panel border font-display text-[16px] font-700 transition active:translate-y-px',
              value >= n
                ? 'border-signal bg-signal/15 text-signal'
                : 'border-deck-500 bg-deck-900 text-chalk-faint hover:bg-deck-600',
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

function Check({
  label, checked, onChange, tone,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; tone: string }) {
  const tones: Record<string, string> = {
    amber: 'border-signal bg-signal/15 text-signal',
    rose: 'border-alliance-red bg-alliance-red/15 text-alliance-red',
    emerald: 'border-emerald-400 bg-emerald-400/15 text-emerald-300',
  }
  return (
    <button type="button" onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={clsx(
        'tap-target rounded-panel border px-3.5 py-2 font-display text-[16px] font-600 transition active:translate-y-px',
        checked ? tones[tone] : 'border-deck-500 bg-deck-900 text-chalk-dim hover:bg-deck-600 hover:text-chalk',
      )}
    >
      {label}
    </button>
  )
}

function initialStates(game: ReturnType<typeof getGame>): Record<string, string | boolean> {
  const s: Record<string, string | boolean> = {}
  for (const a of game.actions) {
    if (a.kind === 'select') s[a.id] = a.defaultValue
    if (a.kind === 'toggle') s[a.id] = a.defaultValue ?? false
  }
  return s
}

const round1 = (n: number) => Math.round(n * 10) / 10
