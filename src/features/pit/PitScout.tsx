import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { getGame } from '@/games'
import { db, savePit } from '@/lib/db'
import { pitId, SCHEMA_VERSION } from '@/lib/schema'
import { loadSettings } from '@/lib/settings'
import { getCachedEvent } from '@/lib/tba'
import type { CachedEvent } from '@/lib/schema'
import { Card, Field, SectionTitle, Toast } from '@/components/ui'

type Value = string | number | boolean | string[]

export default function PitScout() {
  const settings = loadSettings()
  const game = getGame(settings.gameId)

  const [event, setEvent] = useState<CachedEvent | null>(null)
  const [team, setTeam] = useState<number | ''>('')
  const [fields, setFields] = useState<Record<string, Value>>({})
  const [photos, setPhotos] = useState<string[]>([])
  const [toast, setToast] = useState<{ msg: string; tone: 'green' | 'red' } | null>(null)
  const [scouted, setScouted] = useState<Set<number>>(new Set())

  useEffect(() => { getCachedEvent(settings.eventKey).then(setEvent) }, [settings.eventKey])

  // Which teams already have a pit sheet — the "who's left" list is the
  // thing pit scouts actually need at an event.
  useEffect(() => {
    db.pits.where('eventKey').equals(settings.eventKey).toArray()
      .then((rows) => setScouted(new Set(rows.map((r) => r.teamNumber))))
  }, [settings.eventKey, toast])

  // Loading an already-scouted team edits it rather than starting a duplicate.
  useEffect(() => {
    if (team === '') return
    db.pits.get(pitId(settings.eventKey, Number(team))).then((existing) => {
      setFields(existing?.fields ?? {})
      setPhotos(existing?.photos ?? [])
    })
  }, [team, settings.eventKey])

  const groups = [...new Set(game.pitFields.map((f) => f.group))]

  async function addPhoto(file: File) {
    // Downscale before storing: a raw phone photo is ~4 MB and would blow
    // out both IndexedDB and any hope of a QR transfer.
    const dataUrl = await downscale(file, 1000, 0.7)
    setPhotos((p) => [...p, dataUrl])
  }

  async function submit() {
    if (team === '') { flash('Enter a team number.', 'red'); return }
    if (!settings.eventKey) { flash('Set an event in Settings first.', 'red'); return }

    const id = pitId(settings.eventKey, Number(team))
    const existing = await db.pits.get(id)
    await savePit({
      id,
      schemaVersion: SCHEMA_VERSION,
      gameId: game.id,
      eventKey: settings.eventKey,
      teamNumber: Number(team),
      scoutName: settings.scoutName || 'anonymous',
      fields,
      photos,
      createdAt: existing?.createdAt ?? Date.now(),
      synced: false,
    })
    flash(`Saved pit sheet for ${team}.`, 'green')
    setTeam(''); setFields({}); setPhotos([])
  }

  function flash(msg: string, tone: 'green' | 'red') {
    setToast({ msg, tone }); setTimeout(() => setToast(null), 2600)
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 pb-28">
      <Card>
        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <Field label="Team number">
            <input type="number" className="input text-lg font-bold tabular-nums" value={team}
              placeholder="6036"
              onChange={(e) => setTeam(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          {event && (
            <div>
              <div className="label mb-1">
                Teams at {event.name} — {scouted.size}/{event.teams.length} scouted
              </div>
              <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-panel border border-deck-500 bg-deck-900 p-2">
                {event.teams.map((t) => (
                  <button key={t} type="button" onClick={() => setTeam(t)}
                    className={clsx(
                      'rounded px-1.5 py-0.5 font-mono text-xs transition',
                      t === team ? 'bg-signal/15 text-white'
                        : scouted.has(t) ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                        : 'bg-deck-700 text-chalk-dim hover:bg-deck-600',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {groups.map((group) => (
        <Card key={group}>
          <SectionTitle>{group}</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            {game.pitFields.filter((f) => f.group === group).map((f) => (
              <Field key={f.id} label={f.label} hint={f.hint}>
                <PitInput field={f} value={fields[f.id]}
                  onChange={(v) => setFields((s) => ({ ...s, [f.id]: v }))} />
              </Field>
            ))}
          </div>
        </Card>
      ))}

      <Card>
        <SectionTitle>Photos</SectionTitle>
        <div className="flex flex-wrap gap-3">
          {photos.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt={`Robot ${i + 1}`} className="h-28 w-28 rounded-panel border border-deck-500 object-cover" />
              <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-rose-600 text-xs font-bold text-white">
                ×
              </button>
            </div>
          ))}
          <label className="flex h-28 w-28 cursor-pointer items-center justify-center rounded-panel border border-dashed border-deck-500 text-3xl text-chalk-faint hover:bg-deck-600">
            +
            <input type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) addPhoto(f); e.target.value = '' }} />
          </label>
        </div>
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t border-deck-500 bg-deck-900/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3">
          <div className="flex-1 text-xs text-chalk-faint">
            {team !== '' && scouted.has(Number(team)) && 'Editing an existing sheet — saving overwrites it.'}
          </div>
          <button type="button" onClick={submit} className="btn-primary px-8">Save pit sheet</button>
        </div>
      </div>

      {toast && <Toast message={toast.msg} tone={toast.tone} />}
    </div>
  )
}

function PitInput({
  field, value, onChange,
}: { field: any; value: Value | undefined; onChange: (v: Value) => void }) {
  switch (field.type) {
    case 'longtext':
      return <textarea rows={3} className="input resize-none" value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return <input type="number" className="input tabular-nums" value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    case 'boolean':
      return (
        <button type="button" onClick={() => onChange(!value)}
          className={clsx('tap-target w-full rounded-panel border px-4 py-2 text-sm font-semibold transition',
            value ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-deck-500 bg-deck-900 text-chalk-dim')}>
          {value ? 'Yes' : 'No'}
        </button>
      )
    case 'select':
      return (
        <select className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options?.map((o: string) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    case 'multiselect': {
      const selected = Array.isArray(value) ? value : []
      return (
        <div className="flex flex-wrap gap-1.5">
          {field.options?.map((o: string) => {
            const on = selected.includes(o)
            return (
              <button key={o} type="button"
                onClick={() => onChange(on ? selected.filter((x) => x !== o) : [...selected, o])}
                className={clsx('tap-target rounded-panel border px-3 py-1.5 text-xs font-semibold transition',
                  on ? 'border-signal bg-signal/15 text-white'
                     : 'border-deck-500 bg-deck-900 text-chalk-dim hover:bg-deck-600')}>
                {o}
              </button>
            )
          })}
        </div>
      )
    }
    default:
      return <input type="text" className="input" value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)} />
  }
}

/** Resize an image file down to a storable, QR-transferable data URL. */
function downscale(file: File, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas unavailable'))
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = URL.createObjectURL(file)
  })
}
