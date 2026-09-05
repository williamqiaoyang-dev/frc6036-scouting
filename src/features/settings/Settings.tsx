import { useEffect, useState } from 'react'
import { GAMES } from '@/games'
import { getConfig } from '@/lib/config'
import { db } from '@/lib/db'
import { fetchEvent, fetchTeamEvents, getTbaKey, listCachedEvents, setTbaKey } from '@/lib/tba'
import type { CachedEvent } from '@/lib/schema'
import { loadSettings, saveSettings } from '@/lib/settings'
import { Card, Field, SectionTitle, Toast } from '@/components/ui'



export default function Settings() {
  const config = getConfig()
  const TEAM = config.team
  const [settings, setLocal] = useState(loadSettings)
  const [key, setKey] = useState(getTbaKey())
  const [cached, setCached] = useState<CachedEvent[]>([])
  const [teamEvents, setTeamEvents] = useState<{ key: string; name: string; start: string }[]>([])
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState<{ msg: string; tone: 'green' | 'red' } | null>(null)

  useEffect(() => { listCachedEvents().then(setCached) }, [busy])

  function flash(msg: string, tone: 'green' | 'red') {
    setToast({ msg, tone }); setTimeout(() => setToast(null), 3200)
  }

  function set<K extends keyof typeof settings>(patchKey: K, value: (typeof settings)[K]) {
    setLocal((s) => ({ ...s, [patchKey]: value }))
    saveSettings({ [patchKey]: value } as any)
  }

  async function loadTeamEvents() {
    setBusy('team-events')
    try {
      setTeamEvents(await fetchTeamEvents(TEAM, new Date().getFullYear()))
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Lookup failed', 'red')
    } finally { setBusy('') }
  }

  async function syncEvent(eventKey: string) {
    if (!eventKey) return
    setBusy(eventKey)
    try {
      const event = await fetchEvent(eventKey)
      set('eventKey', eventKey)
      flash(`Cached ${event.name}: ${event.teams.length} teams, ${event.matches.length} matches.`, 'green')
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Fetch failed', 'red')
    } finally { setBusy('') }
  }

  async function wipe() {
    if (!confirm('Delete ALL scouting data on this device? This cannot be undone.')) return
    await db.delete()
    location.reload()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <Card>
        <SectionTitle>This device</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Scout name" hint="Stamped on every record you submit.">
            <input className="input" value={settings.scoutName} placeholder="Your name"
              onChange={(e) => set('scoutName', e.target.value)} />
          </Field>
          <Field label="Device name" hint="Shows up in exports, e.g. 'red-1' or 'laptop-a'.">
            <input className="input" value={settings.deviceName} placeholder="red-1"
              onChange={(e) => set('deviceName', e.target.value)} />
          </Field>
          <Field label="Assigned alliance" hint="Pre-fills the match form.">
            <select className="input" value={settings.assignedAlliance}
              onChange={(e) => set('assignedAlliance', e.target.value as any)}>
              <option value="">Not assigned</option>
              <option value="red">Red</option>
              <option value="blue">Blue</option>
            </select>
          </Field>
          <Field label="Assigned station">
            <select className="input" value={settings.assignedStation}
              onChange={(e) => set('assignedStation', Number(e.target.value) as any)}>
              <option value={0}>Not assigned</option>
              <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle>The Blue Alliance</SectionTitle>
        <Field label="Read API key"
          hint={config.tbaApiKey && !localStorage.getItem('tba_key')
            ? 'Using the key from config.json. Enter one here to override it on this device.'
            : 'Get one at thebluealliance.com/account. Stored on this device only.'}>
          <div className="flex gap-2">
            <input type="password" className="input font-mono" value={key} placeholder="Paste your read key"
              onChange={(e) => setKey(e.target.value)} />
            <button type="button" onClick={() => { setTbaKey(key); flash('Key saved.', 'green') }}
              className="btn-primary shrink-0">Save</button>
          </div>
        </Field>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={loadTeamEvents} disabled={!key || busy === 'team-events'}
            className="btn-ghost">
            {busy === 'team-events' ? 'Loading…' : `Find ${TEAM}'s events`}
          </button>
          <span className="text-xs text-slate-600">or enter any event key below</span>
        </div>

        {teamEvents.length > 0 && (
          <div className="mt-3 space-y-1">
            {teamEvents.map((e) => (
              <button key={e.key} type="button" onClick={() => syncEvent(e.key)}
                className="flex w-full items-center gap-3 rounded-lg border border-white/10 p-2.5 text-left transition hover:bg-white/5">
                <span className="font-mono text-xs text-peninsula-300">{e.key}</span>
                <span className="flex-1 truncate text-sm text-slate-300">{e.name}</span>
                <span className="text-xs text-slate-600">{e.start}</span>
                {busy === e.key && <span className="text-xs text-slate-500">syncing…</span>}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Active event</SectionTitle>
        <Field label="Event key" hint="e.g. 2026cabe. Sync pulls the team list and schedule for offline use.">
          <div className="flex gap-2">
            <input className="input font-mono" value={settings.eventKey} placeholder="2026cabe"
              onChange={(e) => set('eventKey', e.target.value.trim().toLowerCase())} />
            <button type="button" onClick={() => syncEvent(settings.eventKey)}
              disabled={!settings.eventKey || !!busy} className="btn-primary shrink-0">
              {busy === settings.eventKey ? 'Syncing…' : 'Sync'}
            </button>
          </div>
        </Field>

        {cached.length > 0 && (
          <div className="mt-4">
            <div className="label mb-2">Cached offline</div>
            <div className="space-y-1">
              {cached.map((e) => (
                <button key={e.eventKey} type="button" onClick={() => set('eventKey', e.eventKey)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition ${
                    e.eventKey === settings.eventKey
                      ? 'border-peninsula-500/50 bg-peninsula-600/10'
                      : 'border-white/10 hover:bg-white/5'}`}>
                  <span className="font-mono text-xs text-peninsula-300">{e.eventKey}</span>
                  <span className="flex-1 truncate text-sm text-slate-300">{e.name}</span>
                  <span className="text-xs text-slate-600">
                    {e.teams.length} teams · {e.matches.length} matches
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Season</SectionTitle>
        <Field label="Game" hint="New seasons are added as a file in src/games/ and registered in index.ts.">
          <select className="input" value={settings.gameId} onChange={(e) => set('gameId', e.target.value)}>
            {Object.values(GAMES).map((g) => (
              <option key={g.id} value={g.id}>{g.year} — {g.name}</option>
            ))}
          </select>
        </Field>
      </Card>

      <Card>
        <SectionTitle>Danger zone</SectionTitle>
        <button type="button" onClick={wipe} className="btn-danger">Erase all local data</button>
        <p className="mt-2 text-xs text-slate-600">
          Export anything you need first — this wipes matches, pit sheets, super sheets and picklists on this device.
        </p>
      </Card>

      {toast && <Toast message={toast.msg} tone={toast.tone} />}
    </div>
  )
}
