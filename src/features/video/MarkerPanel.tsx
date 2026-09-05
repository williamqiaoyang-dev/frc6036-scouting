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
        Markers {markers.length > 0 && <span className="text-chalk-faint">({markers.length})</span>}
      </SectionTitle>

      {draft && (
        <div className="mb-3 rounded-panel border border-signal/40 bg-signal/10 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-chalk">{formatTime(draft.t)}</span>
            <span className="text-xs text-chalk-dim">video paused</span>
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            {MARKER_TAGS.map((t) => (
              <button key={t.id} type="button" onClick={() => setDraft({ ...draft, tag: t.id })}
                className={clsx('rounded border px-2.5 py-1 text-xs font-semibold transition',
                  draft.tag === t.id
                    ? 'border-signal bg-signal/15 text-white'
                    : 'border-deck-500 text-chalk-dim hover:bg-deck-600')}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] text-chalk-dim">Robot:</span>
            {allTeams.map((t) => (
              <button key={t} type="button"
                onClick={() => setDraft({ ...draft, team: draft.team === t ? null : t })}
                className={clsx('rounded border px-2 py-0.5 font-mono text-xs transition',
                  draft.team === t ? 'border-signal bg-signal/15 text-white'
                    : match.red.includes(t) ? 'border-alliance-red/40 text-alliance-red hover:bg-deck-600'
                    : 'border-alliance-blue/40 text-alliance-blue hover:bg-deck-600')}>
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
            <span className="self-center text-[11px] text-chalk-faint">⌘↵ to save · esc to cancel</span>
          </div>
        </div>
      )}

      {sorted.length === 0 && !draft ? (
        <Empty title="No markers yet"
          hint="Pause on something worth remembering and press “Mark this moment”." />
      ) : (
        <div className="space-y-1">
          {sorted.map((m) => (
            <div key={m.id} className="group flex items-start gap-2 rounded-panel border border-deck-600 p-2 hover:bg-deck-600">
              <button type="button" onClick={() => player?.seekTo(m.t)}
                className="shrink-0 font-mono text-xs font-bold text-chalk hover:underline">
                {formatTime(m.t)}
              </button>
              <span className={clsx('mt-1 h-2 w-2 shrink-0 rounded-full', MARKER_COLORS[m.tag] ?? 'bg-slate-400')} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-chalk">
                    {MARKER_TAGS.find((t) => t.id === m.tag)?.label ?? m.tag}
                  </span>
                  {m.teamNumber && (
                    <span className={clsx('rounded px-1.5 font-mono text-[11px]',
                      match.red.includes(m.teamNumber) ? 'bg-alliance-red/15 text-alliance-red' : 'bg-alliance-blue/15 text-alliance-blue')}>
                      {m.teamNumber}
                    </span>
                  )}
                  <span className="text-[11px] text-chalk-faint">{m.author}</span>
                </div>
                {m.note && <p className="mt-0.5 text-xs text-chalk-dim">{m.note}</p>}
              </div>
              <button type="button" onClick={() => remove(m.id)}
                className="shrink-0 px-1 text-chalk-faint opacity-0 transition group-hover:opacity-100 hover:text-alliance-red">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
