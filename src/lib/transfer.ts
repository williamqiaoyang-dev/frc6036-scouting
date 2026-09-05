import { db } from './db'
import { scoreBreakdown, actionTotals } from './stats'
import type { GameConfig } from '@/games/types'
import type { MarkerRecord, MatchRecord, PitRecord, SuperRecord } from './schema'

/**
 * Getting data off a scouting device.
 *
 * Three paths, in order of how often they get used at an event:
 *   1. File export/import — a .json bundle on a USB stick or AirDrop.
 *   2. QR code — the scout's screen is scanned by the central laptop.
 *      No cables, no pairing, works when the venue wifi is saturated.
 *   3. CSV — for anyone who wants the numbers in a spreadsheet.
 */

export interface TransferBundle {
  format: 'orbit6036-scouting'
  version: number
  gameId: string
  eventKey: string
  exportedAt: number
  device: string
  matches: MatchRecord[]
  pits: PitRecord[]
  supers: SuperRecord[]
  markers: MarkerRecord[]
}

export async function buildBundle(
  eventKey: string,
  gameId: string,
  opts: { onlyUnsynced?: boolean } = {},
): Promise<TransferBundle> {
  const filter = <T extends { synced: boolean }>(rows: T[]) =>
    opts.onlyUnsynced ? rows.filter((r) => !r.synced) : rows

  const [matches, pits, supers, markers] = await Promise.all([
    db.matches.where('eventKey').equals(eventKey).toArray(),
    db.pits.where('eventKey').equals(eventKey).toArray(),
    db.supers.where('eventKey').equals(eventKey).toArray(),
    db.markers.where('eventKey').equals(eventKey).toArray(),
  ])

  return {
    format: 'orbit6036-scouting',
    version: 1,
    gameId,
    eventKey,
    exportedAt: Date.now(),
    device: localStorage.getItem('device_name') ?? 'unknown',
    matches: filter(matches),
    pits: filter(pits),
    supers: filter(supers),
    markers: filter(markers),
  }
}

export function downloadJson(bundle: TransferBundle) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  triggerDownload(blob, `${bundle.eventKey}_${bundle.device}_${stamp()}.json`)
}

export function parseBundle(text: string): TransferBundle {
  const parsed = JSON.parse(text)
  if (parsed?.format !== 'orbit6036-scouting') {
    throw new Error('Not a scouting export file.')
  }
  return parsed as TransferBundle
}

/** Mark everything currently in the bundle as transferred. */
export async function markSynced(bundle: TransferBundle) {
  await db.transaction('rw', db.matches, db.pits, db.supers, db.markers, async () => {
    for (const m of bundle.matches) await db.matches.update(m.id, { synced: true })
    for (const p of bundle.pits) await db.pits.update(p.id, { synced: true })
    for (const s of bundle.supers) await db.supers.update(s.id, { synced: true })
    for (const k of bundle.markers ?? []) await db.markers.update(k.id, { synced: true })
  })
}

// ------------------------------------------------------------------ QR path

/**
 * QR codes hold roughly 2-3 KB before a phone camera stops reading them
 * reliably, so a whole event has to be split across numbered chunks that the
 * scanner reassembles. Two things keep the chunk count sane:
 *
 *   1. The event log is rewritten as tuples against an action dictionary,
 *      turning {"actionId":"teleop_fuel_scored","t":45.3,"delta":1} into
 *      [3,45.3,1].
 *   2. The result is gzipped. A match is hundreds of near-identical taps,
 *      which is close to the best case for a compressor.
 *
 * Together these take a full 48-match event from ~150 KB to a few KB.
 */
export const QR_CHUNK_BYTES = 1200

export interface QrChunk {
  /** Bundle id, so the scanner doesn't interleave two different exports. */
  b: string
  /** Chunk index and total. */
  i: number
  n: number
  /** 1 when the payload is gzipped, 0 when it is plain JSON. */
  z: 0 | 1
  /** Payload slice. */
  d: string
}

/** Compact a bundle: tuple-encoded events plus an action dictionary. */
export function compactBundle(bundle: TransferBundle): string {
  const actionIds: string[] = []
  const indexOf = (id: string) => {
    const at = actionIds.indexOf(id)
    return at >= 0 ? at : actionIds.push(id) - 1
  }

  const matches = bundle.matches.map((m) => ({
    ...m,
    events: m.events.map((e) => [indexOf(e.actionId), e.t, e.delta] as [number, number, number]),
  }))

  return JSON.stringify({
    f: bundle.format, v: bundle.version, g: bundle.gameId, e: bundle.eventKey,
    t: bundle.exportedAt, dv: bundle.device,
    a: actionIds,
    m: matches, p: bundle.pits, s: bundle.supers,
  })
}

export function expandBundle(compact: string): TransferBundle {
  const c = JSON.parse(compact)
  const actionIds: string[] = c.a ?? []

  return {
    format: c.f, version: c.v, gameId: c.g, eventKey: c.e,
    exportedAt: c.t, device: c.dv,
    matches: (c.m ?? []).map((m: any) => ({
      ...m,
      events: (m.events ?? []).map((e: [number, number, number]) => ({
        actionId: actionIds[e[0]], t: e[1], delta: e[2],
      })),
    })),
    pits: c.p ?? [],
    supers: c.s ?? [],
    markers: c.k ?? [],
  }
}

/** gzip + base64, when the browser supports it. */
async function deflate(text: string): Promise<{ data: string; gzipped: boolean }> {
  if (typeof CompressionStream === 'undefined') {
    return { data: text, gzipped: false }
  }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return { data: bytesToBase64(bytes), gzipped: true }
}

async function inflate(data: string, gzipped: boolean): Promise<string> {
  if (!gzipped) return data
  const buffer = base64ToBytes(data).buffer as ArrayBuffer
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

// btoa on a long binary string blows the argument limit, so chunk it.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const STEP = 0x8000
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP))
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function chunkForQr(bundle: TransferBundle): Promise<QrChunk[]> {
  const { data, gzipped } = await deflate(compactBundle(bundle))
  const id = Math.random().toString(36).slice(2, 8)
  const total = Math.max(1, Math.ceil(data.length / QR_CHUNK_BYTES))

  return Array.from({ length: total }, (_, i) => ({
    b: id, i, n: total, z: gzipped ? 1 : 0,
    d: data.slice(i * QR_CHUNK_BYTES, (i + 1) * QR_CHUNK_BYTES),
  }))
}

/** Accumulates scanned chunks until a bundle is complete. */
export class QrAssembler {
  private bundleId: string | null = null
  private parts = new Map<number, string>()
  private total = 0
  private gzipped = false

  /** Returns the finished bundle once every chunk has been seen. */
  async accept(raw: string): Promise<TransferBundle | null> {
    let chunk: QrChunk
    try { chunk = JSON.parse(raw) } catch { throw new Error('Unreadable QR payload.') }
    if (typeof chunk?.b !== 'string' || typeof chunk?.i !== 'number') {
      throw new Error('QR code is not a scouting transfer.')
    }

    // A different export started scanning — reset and follow the new one.
    if (this.bundleId !== chunk.b) {
      this.bundleId = chunk.b
      this.parts.clear()
      this.total = chunk.n
      this.gzipped = chunk.z === 1
    }

    this.parts.set(chunk.i, chunk.d)
    if (this.parts.size < this.total) return null

    const joined = Array.from({ length: this.total }, (_, i) => this.parts.get(i) ?? '').join('')
    const bundle = expandBundle(await inflate(joined, this.gzipped))
    this.reset()
    return bundle
  }

  get progress() {
    return { have: this.parts.size, total: this.total }
  }

  reset() {
    this.bundleId = null
    this.parts.clear()
    this.total = 0
    this.gzipped = false
  }
}

// ----------------------------------------------------------------- CSV path

/** One row per scouted robot-match, with every action flattened to a column. */
export function matchesToCsv(game: GameConfig, matches: MatchRecord[]): string {
  const counterCols = game.actions.filter((a) => a.kind === 'counter').map((a) => a.id)
  const stateCols = game.actions.filter((a) => a.kind !== 'counter').map((a) => a.id)

  const header = [
    'event', 'level', 'match', 'team', 'alliance', 'station', 'scout',
    ...counterCols, ...stateCols,
    'est_points', 'tower_points', 'defense', 'driver', 'died', 'no_show', 'notes',
  ]

  const rows = matches.map((m) => {
    const totals = actionTotals(m)
    const score = scoreBreakdown(game, m)
    return [
      m.eventKey, m.matchLevel, m.matchNumber, m.teamNumber, m.alliance, m.station, m.scoutName,
      ...counterCols.map((c) => totals[c] ?? 0),
      ...stateCols.map((c) => String(m.states[c] ?? '')),
      score.total, score.towerPoints,
      m.defenseRating, m.driverRating,
      m.diedOnField ? 1 : 0, m.noShow ? 1 : 0,
      m.notes,
    ]
  })

  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

export function downloadCsv(name: string, csv: string) {
  triggerDownload(new Blob([csv], { type: 'text/csv' }), `${name}_${stamp()}.csv`)
}

function csvCell(value: unknown): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
