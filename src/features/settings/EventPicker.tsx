import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { EventDirectoryEntry } from '@/lib/schema'
import {
  eventDirectoryAge, eventTypeLabel, fetchEventDirectory,
  getEventDirectory, searchEvents,
} from '@/lib/tba'

/**
 * Find a competition by typing its name.
 *
 * TBA identifies events by codes like `2026casj`, which nobody memorises.
 * Scouts know their competition as "Silicon Valley" or "Chezy Champs", so
 * that is what they type; the code is resolved for them and shown only as
 * confirmation. Typing a code directly still works for anyone who knows it.
 */
export function EventPicker({
  year, selectedKey, onPick, disabled,
}: {
  year: number
  selectedKey: string
  onPick: (entry: EventDirectoryEntry) => void
  disabled?: boolean
}) {
  const [directory, setDirectory] = useState<EventDirectoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // Load from cache first so this works with the wifi off, then refresh in
  // the background if the cached copy is stale or missing.
  useEffect(() => {
    let stale = false
    getEventDirectory(year).then(async (cached) => {
      if (stale) return
      setDirectory(cached)

      const age = eventDirectoryAge(year)
      const needsRefresh = cached.length === 0 || age === null || age > 7 * 864e5
      if (!needsRefresh || !navigator.onLine) return

      setLoading(true)
      try {
        const fresh = await fetchEventDirectory(year)
        if (!stale) setDirectory(fresh)
      } catch (e) {
        // A failed refresh is fine when there is a cached copy to fall back on.
        if (!stale && cached.length === 0) {
          setError(e instanceof Error ? e.message : 'Could not load the event list.')
        }
      } finally {
        if (!stale) setLoading(false)
      }
    })
    return () => { stale = true }
  }, [year])

  const results = useMemo(
    () => searchEvents(directory, query),
    [directory, query],
  )

  useEffect(() => setHighlight(0), [query])

  // Close when focus leaves the whole control.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const selected = directory.find((e) => e.key === selectedKey)

  function choose(entry: EventDirectoryEntry) {
    onPick(entry)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || !results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[highlight]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div ref={boxRef} className="relative">
      <span className="label mb-1 block">Competition</span>

      <input
        type="text"
        className="input"
        disabled={disabled}
        placeholder={directory.length ? 'Type an event name, city, or code' : 'Loading events…'}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls="event-results"
      />

      <p className="mt-1 text-[12px] leading-tight text-chalk-faint">
        {error ? <span className="text-alliance-red">{error}</span>
          : loading ? `Loading the ${year} event list…`
          : selected ? <>Selected <span className="text-chalk-dim">{selected.name}</span> — {selected.key}</>
          : selectedKey ? <>Using event code {selectedKey}</>
          : `${directory.length} events in ${year}. Search by name, city, or code.`}
      </p>

      {open && query.trim() !== '' && (
        <ul id="event-results" role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-panel
                     border border-deck-500 bg-deck-800 shadow-xl">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-[13px] text-chalk-faint">
              No {year} event matches “{query.trim()}”.
            </li>
          ) : results.map((e, i) => (
            <li key={e.key} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(e)}
                className={clsx(
                  'flex w-full items-baseline gap-2 px-3 py-2 text-left transition',
                  i === highlight ? 'bg-deck-600' : 'hover:bg-deck-700',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[16px] font-600 text-chalk">
                    {e.name}
                  </span>
                  <span className="block truncate text-[12px] text-chalk-faint">
                    {[e.city, e.stateProv].filter(Boolean).join(', ')}
                    {e.startDate && <>  ·  {formatRange(e.startDate, e.endDate)}</>}
                    {'  ·  '}{eventTypeLabel(e.eventType)}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-chalk-faint">{e.key}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`)
    return Number.isNaN(d.getTime()) ? iso
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  if (!end || end === start) return fmt(start)
  return `${fmt(start)}–${fmt(end)}`
}
