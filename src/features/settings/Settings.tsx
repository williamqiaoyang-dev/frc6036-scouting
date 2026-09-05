import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { GAMES } from '@/games'
import { getConfig } from '@/lib/config'
import { db } from '@/lib/db'
import { fetchEvent, fetchTeamEvents, getTbaKey, listCachedEvents, setTbaKey } from '@/lib/tba'
import type { CachedEvent } from '@/lib/schema'
import { loadSettings, saveSettings } from '@/lib/settings'
import { Card, Field, SectionTitle, Toast } from '@/components/ui'
import { EventPicker } from './EventPicker'



export default function Settings() {
  const config = getConfig()
  const TEAM = config.team
  const [settings, setLocal] = useState(loadSettings)
  // Search the season the active game belongs to, not today's calendar year.
  const seasonYear = GAMES[settings.gameId]?.year ?? new Date().getFullYear()
  const [key, setKey] = useState(getTbaKey())
  const [cached, setCached] = useState<CachedEvent[]>([])
  const [teamEvents, setTeamEvents] = useState<{ key: string; name: string; start: string }[]>([])
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState('')
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
    // Commit the choice before the network call. Picking an event should
    // stick even if the sync then fails — offline, or no key yet — so the
    // scout can retry rather than having to find the event again.
    set('eventKey', eventKey)
    setBusy(eventKey)
    setProgress('Starting…')
    try {
      const event = await fetchEvent(eventKey, setProgress)
      const photos = event.teamInfo.filter((t) => t.robotPhotoUrl).length
      flash(
        `Cached ${event.name}: ${event.teams.length} teams, ${event.matches.length} matches, ` +
        `${event.matches.filter((m) => m.videos.length).length} videos, ${photos} robot photos.`,
        'green',
      )
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Fetch failed', 'red')
    } finally { setBusy(''); setProgress('') }
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
          <Field label="Assigned seat"
            hint="Which robot on the alliance you usually watch. The match form
                  pre-selects that robot; you can always pick a different one.">
            <select className="input" value={settings.assignedStation}
              onChange={(e) => set('assignedStation', Number(e.target.value) as any)}>
              <option value={0}>Not assigned</option>
              <option value={1}>First robot listed</option>
              <option value={2}>Second robot listed</option>
              <option value={3}>Third robot listed</option>
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
          <span className="text-xs text-chalk-faint">or enter any event key below</span>
        </div>

        {teamEvents.length > 0 && (
          <div className="mt-3 space-y-1">
            {teamEvents.map((e) => (
              <button key={e.key} type="button" onClick={() => syncEvent(e.key)}
                className="flex w-full items-center gap-3 rounded-panel border border-deck-500 p-2.5 text-left transition hover:bg-deck-600">
                <span className="font-mono text-xs text-chalk">{e.key}</span>
                <span className="flex-1 truncate text-sm text-chalk">{e.name}</span>
                <span className="text-xs text-chalk-faint">{e.start}</span>
                {busy === e.key && <span className="text-xs text-chalk-dim">syncing…</span>}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Active event</SectionTitle>

        <EventPicker
          year={seasonYear}
          selectedKey={settings.eventKey}
          disabled={!!busy}
          onPick={(entry) => syncEvent(entry.key)}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => syncEvent(settings.eventKey)}
            disabled={!settings.eventKey || !!busy} className="btn-primary">
            {busy && busy === settings.eventKey ? 'Syncing…' : 'Re-sync this event'}
          </button>
          <span className="text-[12px] text-chalk-faint">
            Pulls the roster, schedule, results, videos and robot photos for offline use.
          </span>
        </div>

        {progress && (
          <p className="mt-2 text-[12px] text-signal">
            {progress}
            <span className="ml-1 text-chalk-faint">
              Robot photos are one request per team, so this takes a moment.
            </span>
          </p>
        )}

        {cached.length > 0 && (
          <div className="mt-4">
            <div className="label mb-1.5">Saved on this device</div>
            <div className="space-y-1">
              {cached.map((e) => (
                <button key={e.eventKey} type="button" onClick={() => set('eventKey', e.eventKey)}
                  className={clsx(
                    'flex w-full items-baseline gap-3 rounded-panel border p-2 text-left transition',
                    e.eventKey === settings.eventKey
                      ? 'border-signal/50 bg-signal/10'
                      : 'border-deck-500 hover:bg-deck-600',
                  )}>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-chalk">{e.name}</span>
                  <span className="shrink-0 text-[12px] text-chalk-faint">
                    {e.teams.length} teams, {e.matches.length} matches
                  </span>
                  <span className="shrink-0 text-[12px] text-chalk-faint">{e.eventKey}</span>
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
        <p className="mt-2 text-xs text-chalk-faint">
          Export anything you need first — this wipes matches, pit sheets, super sheets and picklists on this device.
        </p>
      </Card>

      {toast && <Toast message={toast.msg} tone={toast.tone} />}
    </div>
  )
}
