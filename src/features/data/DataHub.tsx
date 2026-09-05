import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, mergeRecords } from '@/lib/db'
import { getGame } from '@/games'
import {
  buildBundle, downloadCsv, downloadJson, markSynced, matchesToCsv,
  parseBundle, type TransferBundle,
} from '@/lib/transfer'
import { loadSettings } from '@/lib/settings'
import { Card, Empty, SectionTitle, StatTile, Toast } from '@/components/ui'
import { QrExport } from './QrExport'
import { QrScanner } from './QrScanner'

type Mode = 'export' | 'import'

export default function DataHub() {
  const settings = loadSettings()
  const game = getGame(settings.gameId)
  const [mode, setMode] = useState<Mode>('export')
  const [bundle, setBundle] = useState<TransferBundle | null>(null)
  const [onlyUnsynced, setOnlyUnsynced] = useState(true)
  const [toast, setToast] = useState<{ msg: string; tone: 'green' | 'red' } | null>(null)

  const counts = useLiveQuery(async () => {
    const [matches, pits, supers] = await Promise.all([
      db.matches.where('eventKey').equals(settings.eventKey).toArray(),
      db.pits.where('eventKey').equals(settings.eventKey).toArray(),
      db.supers.where('eventKey').equals(settings.eventKey).toArray(),
    ])
    return {
      matches: matches.length,
      pits: pits.length,
      supers: supers.length,
      unsynced: [...matches, ...pits, ...supers].filter((r) => !r.synced).length,
    }
  }, [settings.eventKey])

  useEffect(() => {
    if (mode !== 'export' || !settings.eventKey) return
    buildBundle(settings.eventKey, game.id, { onlyUnsynced }).then(setBundle)
  }, [mode, onlyUnsynced, settings.eventKey, game.id, counts])

  function flash(msg: string, tone: 'green' | 'red') {
    setToast({ msg, tone }); setTimeout(() => setToast(null), 3200)
  }

  async function ingest(incoming: TransferBundle) {
    const stats = await mergeRecords(incoming)
    flash(
      `Imported ${stats.matches} matches, ${stats.pits} pits, ${stats.supers} super sheets` +
      (stats.skipped ? ` · ${stats.skipped} already current` : ''),
      'green',
    )
  }

  async function importFile(file: File) {
    try {
      await ingest(parseBundle(await file.text()))
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Import failed', 'red')
    }
  }

  async function exportCsv() {
    const matches = await db.matches.where('eventKey').equals(settings.eventKey).toArray()
    if (!matches.length) { flash('Nothing to export.', 'red'); return }
    downloadCsv(`${settings.eventKey}_matches`, matchesToCsv(game, matches))
  }

  if (!settings.eventKey) {
    return <div className="p-4"><Empty title="No event selected" hint="Pick an event in Settings first." /></div>
  }

  const size = bundle ? new Blob([JSON.stringify(bundle)]).size : 0

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Matches" value={counts?.matches ?? 0} />
        <StatTile label="Pit sheets" value={counts?.pits ?? 0} />
        <StatTile label="Super sheets" value={counts?.supers ?? 0} />
        <StatTile label="Not transferred" value={counts?.unsynced ?? 0}
          tone={(counts?.unsynced ?? 0) > 0 ? 'text-amber-300' : 'text-slate-100'} />
      </div>

      <div className="flex gap-1 rounded-xl border border-white/10 bg-surface-1/60 p-1">
        {(['export', 'import'] as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold capitalize transition ${
              mode === m ? 'bg-peninsula-600 text-white' : 'text-slate-400 hover:bg-white/5'}`}>
            {m === 'export' ? 'Send data' : 'Receive data'}
          </button>
        ))}
      </div>

      {mode === 'export' ? (
        <>
          <Card>
            <SectionTitle>What to send</SectionTitle>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setOnlyUnsynced(true)}
                className={onlyUnsynced ? 'btn-primary' : 'btn-ghost'}>New only</button>
              <button type="button" onClick={() => setOnlyUnsynced(false)}
                className={!onlyUnsynced ? 'btn-primary' : 'btn-ghost'}>Everything</button>
              {bundle && (
                <span className="text-xs text-slate-500">
                  {bundle.matches.length + bundle.pits.length + bundle.supers.length} records · {(size / 1024).toFixed(1)} KB
                </span>
              )}
            </div>
          </Card>

          <Card>
            <SectionTitle right={
              bundle && (bundle.matches.length + bundle.pits.length + bundle.supers.length) > 0 ? (
                <button type="button" onClick={async () => {
                  await markSynced(bundle); flash('Marked as transferred.', 'green')
                }} className="text-xs text-slate-500 hover:text-slate-300">
                  Mark transferred
                </button>
              ) : undefined
            }>
              QR transfer
            </SectionTitle>
            {bundle && (bundle.matches.length + bundle.pits.length + bundle.supers.length) > 0 ? (
              <QrExport bundle={bundle} />
            ) : (
              <Empty title="Nothing new to send" hint="Everything here has already been transferred." />
            )}
          </Card>

          <Card>
            <SectionTitle>File export</SectionTitle>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={!bundle} onClick={() => bundle && downloadJson(bundle)}
                className="btn-ghost">Download .json bundle</button>
              <button type="button" onClick={exportCsv} className="btn-ghost">Download matches .csv</button>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              The JSON bundle is the transfer format — it round-trips into another device.
              The CSV is a flat, one-row-per-robot-match view for spreadsheets.
            </p>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <SectionTitle>Scan a device</SectionTitle>
            <QrScanner onBundle={ingest} />
          </Card>

          <Card>
            <SectionTitle>Import a file</SectionTitle>
            <label className="btn-ghost cursor-pointer">
              Choose .json bundle
              <input type="file" accept="application/json,.json" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = '' }} />
            </label>
            <p className="mt-2 text-xs text-slate-600">
              Imports merge by record id, keeping whichever copy was edited most recently.
              Re-importing the same file is safe.
            </p>
          </Card>
        </>
      )}

      {toast && <Toast message={toast.msg} tone={toast.tone} />}
    </div>
  )
}
