import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { getGame } from '@/games'
import type { CounterAction, Phase, SelectAction, ToggleAction } from '@/games/types'
import { db, saveMatch } from '@/lib/db'
import { matchId, SCHEMA_VERSION, type ScoutEvent, type Alliance } from '@/lib/schema'
import { loadSettings } from '@/lib/settings'
import { getCachedEvent, teamInfo } from '@/lib/tba'
import type { CachedEvent } from '@/lib/schema'
import { Card, Field, Pill, Toast } from '@/components/ui'
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
  const [station, setStation] = useState(settings.assignedStation || 1)

  // -- collected data -------------------------------------------------------
  const [events, setEvents] = useState<ScoutEvent[]>([])
  const [states, setStates] = useState<Record<string, string | boolean>>(() => initialStates(game))
  const [defenseRating, setDefenseRating] = useState(0)
  const [driverRating, setDriverRating] = useState(0)
  const [diedOnField, setDied] = useState(false)
  const [noShow, setNoShow] = useState(false)
  const [notes, setNotes] = useState('')

  useEffect(() => { getCachedEvent(settings.eventKey).then(setEvent) }, [settings.eventKey])

  // Pull the scheduled robot for this station straight from the TBA cache, so
  // the scout confirms a number instead of typing one under time pressure.
  useEffect(() => {
    const m = event?.matches.find((x) => x.matchLevel === matchLevel && x.matchNumber === matchNumber)
    const scheduled = m?.[alliance]?.[station - 1]
    if (scheduled) setTeamNumber(scheduled)
  }, [event, matchLevel, matchNumber, alliance, station])

  const counters = useMemo(
    () => game.actions.filter((a): a is CounterAction => a.kind === 'counter' && a.phase === phase),
    [game, phase],
  )

  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const ev of events) t[ev.actionId] = (t[ev.actionId] ?? 0) + ev.delta
    return t
  }, [events])

  function bump(actionId: string, delta: 1 | -1) {
    if (delta === -1 && (totals[actionId] ?? 0) <= 0) return
    setEvents((prev) => [...prev, { actionId, t: round1(clock.now()), delta }])
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
      if (idx >= 0 && counters[idx]) { e.preventDefault(); bump(counters[idx].id, 1) }
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

  const scheduled = event?.matches.find(
    (m) => m.matchLevel === matchLevel && m.matchNumber === matchNumber,
  )

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-28">
      {/* ---------------------------------------------------------- identity */}
      <Card className={clsx(
        'border-l-4',
        alliance === 'red' ? 'border-l-rose-500' : 'border-l-sky-500',
      )}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Level">
            <select className="input" value={matchLevel} onChange={(e) => setMatchLevel(e.target.value as any)}>
              <option value="qm">Quals</option>
              <option value="sf">Playoff</option>
              <option value="f">Finals</option>
              <option value="pr">Practice</option>
            </select>
          </Field>
          <Field label="Match">
            <input type="number" min={1} className="input tabular-nums" value={matchNumber}
              onChange={(e) => setMatchNumber(Math.max(1, Number(e.target.value)))} />
          </Field>
          <Field label="Alliance">
            <select className="input" value={alliance} onChange={(e) => setAlliance(e.target.value as Alliance)}>
              <option value="red">Red</option>
              <option value="blue">Blue</option>
            </select>
          </Field>
          <Field label="Station">
            <select className="input" value={station} onChange={(e) => setStation(Number(e.target.value))}>
              <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
            </select>
          </Field>
          <Field label="Team"
            hint={teamNumber !== '' && teamInfo(event, Number(teamNumber))?.nickname
              ? teamInfo(event, Number(teamNumber))!.nickname
              : scheduled ? 'from schedule' : undefined}>
            <input type="number" className="input font-bold tabular-nums" value={teamNumber}
              placeholder="6036"
              onChange={(e) => setTeamNumber(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          <div className="flex items-end">
            <div className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <div className="label">Scout</div>
              <div className="truncate text-sm font-semibold text-slate-300">
                {settings.scoutName || <span className="text-rose-400">unset</span>}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <MatchTimer game={game} elapsed={clock.elapsed} running={clock.running}
        onStart={clock.start} onStop={clock.stop} onReset={clock.reset} />

      {/* ------------------------------------------------------------ phases */}
      <div className="flex gap-1 rounded-xl border border-white/10 bg-surface-1/60 p-1">
        {PHASES.map((p) => (
          <button key={p.id} type="button"
            onClick={() => { setPhase(p.id); setManualPhase(true) }}
            className={clsx(
              'flex-1 rounded-lg px-4 py-2 text-sm font-bold transition',
              phase === p.id ? 'bg-peninsula-600 text-white' : 'text-slate-400 hover:bg-white/5',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------- counters */}
      {counters.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {counters.map((action, i) => (
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
        <Card>
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
                placeholder="Anything the numbers miss — mechanism failures, strategy, penalties…"
                onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </Card>
      )}

      {/* --------------------------------------------------------- action bar */}
      <div className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-surface-0/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <button type="button" onClick={undoLast} disabled={!events.length} className="btn-ghost">
            Undo{events.length > 0 && <span className="text-slate-600">({events.length})</span>}
          </button>
          <div className="flex-1 text-xs text-slate-600">
            {events.length} taps logged
            {scheduled && <span className="ml-2 hidden sm:inline">· schedule: {scheduled[alliance].join(', ')}</span>}
          </div>
          <button type="button" onClick={submit} className="btn-primary px-8">Save match</button>
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
    <Card className="space-y-4">
      {toggles.map((t) => (
        <Check key={t.id} label={t.label} checked={states[t.id] === true}
          onChange={(v) => onChange(t.id, v)} tone="emerald" />
      ))}

      {selects.map((s) => (
        <div key={s.id}>
          <div className="label mb-2">{s.label}</div>
          <div className="flex flex-wrap gap-2">
            {s.options.map((opt) => {
              const active = states[s.id] === opt.value
              return (
                <button key={opt.value} type="button" onClick={() => onChange(s.id, opt.value)}
                  className={clsx(
                    'tap-target rounded-lg border px-4 py-2.5 text-sm font-semibold transition active:scale-95',
                    active
                      ? 'border-peninsula-400 bg-peninsula-600 text-white'
                      : 'border-white/10 bg-surface-0/60 text-slate-400 hover:bg-white/5',
                  )}
                >
                  {opt.label}
                  {opt.points > 0 && (
                    <span className={clsx('ml-2 text-xs', active ? 'text-white/70' : 'text-slate-600')}>
                      {opt.points}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {s.hint && <p className="mt-1.5 text-xs text-slate-600">{s.hint}</p>}
        </div>
      ))}
    </Card>
  )
}

function Rating({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="label mb-2">{label}</div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(value === n ? 0 : n)}
            className={clsx(
              'tap-target h-11 flex-1 rounded-lg border text-sm font-bold transition active:scale-95',
              value >= n
                ? 'border-peninsula-400 bg-peninsula-600 text-white'
                : 'border-white/10 bg-surface-0/60 text-slate-500 hover:bg-white/5',
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
    amber: 'border-amber-500 bg-amber-600 text-white',
    rose: 'border-rose-500 bg-rose-600 text-white',
    emerald: 'border-emerald-500 bg-emerald-600 text-white',
  }
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={clsx(
        'tap-target rounded-lg border px-4 py-2.5 text-sm font-semibold transition active:scale-95',
        checked ? tones[tone] : 'border-white/10 bg-surface-0/60 text-slate-400 hover:bg-white/5',
      )}
    >
      {checked ? '✓ ' : ''}{label}
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
