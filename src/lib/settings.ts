import { getConfig } from './config'

/**
 * Per-device settings. Deliberately localStorage rather than IndexedDB:
 * these are device identity, not scouting data, and must never travel in
 * an export bundle.
 */
export interface Settings {
  scoutName: string
  deviceName: string
  eventKey: string
  gameId: string
  /** Which driver station this device is assigned to, for auto-fill. */
  assignedAlliance: 'red' | 'blue' | ''
  assignedStation: number | 0
}

const KEYS: Record<keyof Settings, string> = {
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
