import { getConfig } from './config'

/**
 * Per-device settings. Deliberately localStorage rather than IndexedDB:
 * these are device identity, not scouting data, and must never travel in
 * an export bundle.
 */
export interface Settings {
  /** Which FUEL counting mode this device uses: manual, static, dynamic. */
  visionMode: string
  scoutName: string
  deviceName: string
  eventKey: string
  gameId: string
  /** Which driver station this device is assigned to, for auto-fill. */
  assignedAlliance: 'red' | 'blue' | ''
  assignedStation: number | 0
}

const KEYS: Record<keyof Settings, string> = {
  visionMode: 'vision_mode',
  scoutName: 'scout_name',
  deviceName: 'device_name',
  eventKey: 'event_key',
  gameId: 'game_id',
  assignedAlliance: 'assigned_alliance',
  assignedStation: 'assigned_station',
}

export function loadSettings(): Settings {
  // A per-device choice always wins; config.json supplies the fallback so a
  // pre-configured build works without anyone touching Settings.
  const config = getConfig()
  return {
    visionMode: localStorage.getItem(KEYS.visionMode) ?? 'manual',
    scoutName: localStorage.getItem(KEYS.scoutName) ?? '',
    deviceName: localStorage.getItem(KEYS.deviceName) ?? '',
    eventKey: localStorage.getItem(KEYS.eventKey) || config.defaultEventKey,
    gameId: localStorage.getItem(KEYS.gameId) || config.gameId,
    assignedAlliance: (localStorage.getItem(KEYS.assignedAlliance) as 'red' | 'blue') ?? '',
    assignedStation: Number(localStorage.getItem(KEYS.assignedStation) ?? 0),
  }
}

export function saveSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    localStorage.setItem(KEYS[key as keyof Settings], String(value))
  }
  window.dispatchEvent(new Event('settings-changed'))
}

/**
 * Vision tuning lives beside settings rather than in the database: it
 * describes this device's camera and where it is pointed, so it must never
 * travel in an export bundle to another device.
 */
export function loadVisionConfig<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem('vision_config')
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    // Corrupt or unreadable storage should never stop a scout from working.
    return fallback
  }
}

export function saveVisionConfig(config: unknown) {
  try {
    localStorage.setItem('vision_config', JSON.stringify(config))
  } catch { /* private mode or quota; tuning simply will not persist */ }
}

/**
 * Detector setup is per-device: the zones depend on where this camera is
 * pointed, so they cannot be shared between scouts. Stored per game so a
 * new season starts from its own presets rather than last year's polygons.
 */

/**
 * Bumped whenever the shipped tuning changes in a way that makes a saved
 * setup wrong rather than merely different.
 *
 * This exists because of a real failure: the thresholds shipped with the
 * first build could not detect a FUEL ball at all — the minimum blob size
 * was larger than a ball at the far end of the field — and a saved setup
 * would have carried those numbers forward forever, so the fix would have
 * reached nobody who had already opened the page. On a version bump the
 * work a scout actually did by hand is kept and every threshold is re-seeded
 * from the presets.
 */
const TUNING_VERSION = 2

/** What survives a re-seed: the things a person drew or chose, not numbers. */
const HAND_MADE = ['zone', 'enabled', 'rule'] as const

export function loadDetectors<T extends { id: string }>(gameId: string, presets: T[]): T[] {
  try {
    const raw = localStorage.getItem(`detectors_${gameId}`)
    if (!raw) return presets
    const stored = JSON.parse(raw) as { version?: number; detectors?: T[] } | T[]

    // Before versioning, the array was stored bare. Treat that as version 1.
    const version = Array.isArray(stored) ? 1 : stored.version ?? 1
    const saved = (Array.isArray(stored) ? stored : stored.detectors ?? []) as T[]
    const byId = new Map(saved.map((d) => [d.id, d]))

    // Presets are the source of truth for which detectors exist; storage
    // only supplies what the scout changed. A detector added in a new build
    // therefore appears, and one removed from the game config disappears.
    return presets.map((p) => {
      const mine = byId.get(p.id)
      if (!mine) return p
      if (version < TUNING_VERSION) {
        const kept: Record<string, unknown> = {}
        for (const key of HAND_MADE) {
          if (key in (mine as object)) kept[key] = (mine as Record<string, unknown>)[key]
        }
        return { ...p, ...kept } as T
      }
      // `appearance` is merged rather than replaced, so a threshold added in
      // a new build reaches a scout who had already saved a setup.
      const preset = p as unknown as { appearance?: object }
      const theirs = mine as unknown as { appearance?: object }
      return {
        ...p, ...mine,
        ...(preset.appearance
          ? { appearance: { ...preset.appearance, ...(theirs.appearance ?? {}) } }
          : {}),
      } as T
    })
  } catch {
    return presets
  }
}

export function saveDetectors(gameId: string, detectors: unknown) {
  try {
    localStorage.setItem(`detectors_${gameId}`,
      JSON.stringify({ version: TUNING_VERSION, detectors }))
  } catch { /* private mode or quota; setup simply will not persist */ }
}
