import Dexie, { type Table } from 'dexie'
import type {
  MatchRecord, PitRecord, SuperRecord, Picklist, CachedEvent, MarkerRecord,
  EventDirectoryEntry,
} from './schema'

/**
 * Offline-first local store. Everything a scout does lands here first and
 * survives refreshes, crashes and dead wifi. Transfer to the central laptop
 * happens explicitly via `lib/transfer.ts` (file, clipboard or QR).
 */
class ScoutingDB extends Dexie {
  matches!: Table<MatchRecord, string>
  pits!: Table<PitRecord, string>
  supers!: Table<SuperRecord, string>
  picklists!: Table<Picklist, string>
  events!: Table<CachedEvent, string>
  markers!: Table<MarkerRecord, string>
  eventDirectory!: Table<EventDirectoryEntry, string>

  constructor() {
    super('orbit6036-scouting')
    this.version(1).stores({
      matches: 'id, eventKey, teamNumber, matchNumber, synced, updatedAt',
      pits: 'id, eventKey, teamNumber, synced, updatedAt',
      supers: 'id, eventKey, matchNumber, synced, updatedAt',
      picklists: 'id, eventKey, updatedAt',
      events: 'eventKey, fetchedAt',
    })

    // v2 adds video markers. Dexie migrates in place, so existing scouting
    // data on a device survives the upgrade untouched.
    this.version(2).stores({
      matches: 'id, eventKey, teamNumber, matchNumber, synced, updatedAt',
      pits: 'id, eventKey, teamNumber, synced, updatedAt',
      supers: 'id, eventKey, matchNumber, synced, updatedAt',
      picklists: 'id, eventKey, updatedAt',
      events: 'eventKey, fetchedAt',
      markers: 'id, eventKey, matchKey, teamNumber, synced, updatedAt',
    })

    // v3 adds the season event directory, so events can be found by name
    // and the list still works once the venue wifi dies.
    this.version(3).stores({
      matches: 'id, eventKey, teamNumber, matchNumber, synced, updatedAt',
      pits: 'id, eventKey, teamNumber, synced, updatedAt',
      supers: 'id, eventKey, matchNumber, synced, updatedAt',
      picklists: 'id, eventKey, updatedAt',
      events: 'eventKey, fetchedAt',
      markers: 'id, eventKey, matchKey, teamNumber, synced, updatedAt',
      eventDirectory: 'key, year, name',
    })
  }
}

export const db = new ScoutingDB()

/** Upsert helpers that stamp timestamps consistently. */
export async function saveMatch(record: Omit<MatchRecord, 'updatedAt'>) {
  return db.matches.put({ ...record, updatedAt: Date.now() })
}
export async function savePit(record: Omit<PitRecord, 'updatedAt'>) {
  return db.pits.put({ ...record, updatedAt: Date.now() })
}
export async function saveSuper(record: Omit<SuperRecord, 'updatedAt'>) {
  return db.supers.put({ ...record, updatedAt: Date.now() })
}
export async function saveMarker(record: Omit<MarkerRecord, 'updatedAt'>) {
  return db.markers.put({ ...record, updatedAt: Date.now() })
}

/** Merge imported records, keeping whichever copy was updated most recently. */
export async function mergeRecords(payload: {
  matches?: MatchRecord[]
  pits?: PitRecord[]
  supers?: SuperRecord[]
  markers?: MarkerRecord[]
}) {
  const stats = { matches: 0, pits: 0, supers: 0, markers: 0, skipped: 0 }

  await db.transaction('rw', db.matches, db.pits, db.supers, db.markers, async () => {
    for (const rec of payload.matches ?? []) {
      const existing = await db.matches.get(rec.id)
      if (existing && existing.updatedAt >= rec.updatedAt) { stats.skipped++; continue }
      await db.matches.put(rec); stats.matches++
    }
    for (const rec of payload.pits ?? []) {
      const existing = await db.pits.get(rec.id)
      if (existing && existing.updatedAt >= rec.updatedAt) { stats.skipped++; continue }
      await db.pits.put(rec); stats.pits++
    }
    for (const rec of payload.supers ?? []) {
      const existing = await db.supers.get(rec.id)
      if (existing && existing.updatedAt >= rec.updatedAt) { stats.skipped++; continue }
      await db.supers.put(rec); stats.supers++
    }
    for (const rec of payload.markers ?? []) {
      const existing = await db.markers.get(rec.id)
      if (existing && existing.updatedAt >= rec.updatedAt) { stats.skipped++; continue }
      await db.markers.put(rec); stats.markers++
    }
  })

  return stats
}
