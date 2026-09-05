import { useState } from 'react'
import clsx from 'clsx'
import { db, saveMarker } from '@/lib/db'
import { MARKER_TAGS, markerId, SCHEMA_VERSION } from '@/lib/schema'
import type { CachedMatch, MarkerRecord } from '@/lib/schema'
import { formatTime } from '@/lib/youtube'
import { Empty, SectionTitle } from '@/components/ui'
import { MARKER_COLORS, type PlayerHandle } from './VideoPlayer'

/**
 * Pin a timestamped note to the video.
 *
 * Marking pauses the video first — you noticed something, you want it held
 * still while you write it down, not running on while you type.
 */
export function MarkerPanel({
  match, eventKey, author, player, markers, onChange,
}: {
  match: CachedMatch
  eventKey: string
  author: string
  player: PlayerHandle | null
  markers: MarkerRecord[]
  onChange: () => void
}) {
  const [draft, setDraft] = useState<{ t: number; tag: string; team: number | null; note: string } | null>(null)

  function beginMark() {
    if (!player) return
    player.pause()
    setDraft({ t: player.currentTime(), tag: 'note', team: null, note: '' })
  }

  async function commit() {
    if (!draft) return
    await saveMarker({
      id: markerId(match.key, draft.t, author),
      schemaVersion: SCHEMA_VERSION,
      eventKey,
      matchKey: match.key,
      matchNumber: match.matchNumber,
      matchLevel: match.matchLevel,
      t: draft.t,
      teamNumber: draft.team,
      tag: draft.tag,
      note: draft.note.trim(),
      author: author || 'anonymous',
      createdAt: Date.now(),
      synced: false,
    })
    setDraft(null)
    onChange()
  }

  async function remove(id: string) {
    await db.markers.delete(id)
    onChange()
  }

  const allTeams = [...match.red, ...match.blue]
  const sorted = [...markers].sort((a, b) => a.t - b.t)

  return (
    <div>
      <SectionTitle right={
        <button type="button" onClick={beginMark} disabled={!player || !!draft}
          className="btn-primary h-8 py-0 text-xs disabled:opacity-30">
          + Mark this moment
        </button>
      }>
        Markers {markers.length > 0 && <span className="text-slate-600">({markers.length})</span>}
      </SectionTitle>

      {draft && (
        <div className="mb-3 rounded-lg border border-peninsula-500/40 bg-peninsula-600/10 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-peninsula-300">{formatTime(draft.t)}</span>
            <span className="text-xs text-slate-500">video paused</span>
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            {MARKER_TAGS.map((t) => (
              <button key={t.id} type="button" onClick={() => setDraft({ ...draft, tag: t.id })}
                className={clsx('rounded border px-2.5 py-1 text-xs font-semibold transition',
                  draft.tag === t.id
                    ? 'border-peninsula-400 bg-peninsula-600 text-white'
                    : 'border-white/10 text-slate-400 hover:bg-white/5')}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] text-slate-500">Robot:</span>
            {allTeams.map((t) => (
              <button key={t} type="button"
                onClick={() => setDraft({ ...draft, team: draft.team === t ? null : t })}
                className={clsx('rounded border px-2 py-0.5 font-mono text-xs transition',
                  draft.team === t ? 'border-peninsula-400 bg-peninsula-600 text-white'
                    : match.red.includes(t) ? 'border-rose-500/30 text-rose-300 hover:bg-white/5'
                    : 'border-sky-500/30 text-sky-300 hover:bg-white/5')}>
                {t}
              </button>
            ))}
          </div>

          <textarea rows={2} autoFocus className="input resize-none text-sm"
            placeholder="What happened here?"
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
              if (e.key === 'Escape') setDraft(null)
            }} />

          <div className="mt-2 flex gap-2">
            <button type="button" onClick={commit} className="btn-primary h-8 py-0 text-xs">
              Save marker
            </button>
            <button type="button" onClick={() => setDraft(null)} className="btn-ghost h-8 py-0 text-xs">
              Cancel
            </button>
            <span className="self-center text-[11px] text-slate-600">⌘↵ to save · esc to cancel</span>
          </div>
        </div>
      )}

      {sorted.length === 0 && !draft ? (
        <Empty title="No markers yet"
          hint="Pause on something worth remembering and press “Mark this moment”." />
      ) : (
        <div className="space-y-1">
          {sorted.map((m) => (
            <div key={m.id} className="group flex items-start gap-2 rounded-lg border border-white/5 p-2 hover:bg-white/5">
              <button type="button" onClick={() => player?.seekTo(m.t)}
                className="shrink-0 font-mono text-xs font-bold text-peninsula-300 hover:underline">
                {formatTime(m.t)}
              </button>
              <span className={clsx('mt-1 h-2 w-2 shrink-0 rounded-full', MARKER_COLORS[m.tag] ?? 'bg-slate-400')} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-300">
                    {MARKER_TAGS.find((t) => t.id === m.tag)?.label ?? m.tag}
                  </span>
                  {m.teamNumber && (
                    <span className={clsx('rounded px-1.5 font-mono text-[11px]',
                      match.red.includes(m.teamNumber) ? 'bg-rose-500/15 text-rose-300' : 'bg-sky-500/15 text-sky-300')}>
                      {m.teamNumber}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-600">{m.author}</span>
                </div>
                {m.note && <p className="mt-0.5 text-xs text-slate-400">{m.note}</p>}
              </div>
              <button type="button" onClick={() => remove(m.id)}
                className="shrink-0 px-1 text-slate-700 opacity-0 transition group-hover:opacity-100 hover:text-rose-400">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
