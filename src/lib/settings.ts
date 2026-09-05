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
export function loadDetectors<T extends { id: string }>(gameId: string, presets: T[]): T[] {
  try {
    const raw = localStorage.getItem(`detectors_${gameId}`)
    if (!raw) return presets
    const saved = JSON.parse(raw) as T[]
    const byId = new Map(saved.map((d) => [d.id, d]))
    // Presets are the source of truth for which detectors exist; storage
    // only supplies what the scout changed. A detector added in a new build
    // therefore appears, and one removed from the game config disappears.
    return presets.map((p) => ({ ...p, ...(byId.get(p.id) ?? {}) }))
  } catch {
    return presets
  }
}

export function saveDetectors(gameId: string, detectors: unknown) {
  try {
    localStorage.setItem(`detectors_${gameId}`, JSON.stringify(detectors))
  } catch { /* private mode or quota; setup simply will not persist */ }
}
