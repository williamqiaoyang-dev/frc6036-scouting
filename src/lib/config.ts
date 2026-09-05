/**
 * Deployment config, loaded once from `public/config.json` before the app
 * renders.
 *
 * The point is that a team can set the TBA key, event and season in one file
 * and hand the same build to every scouting device, instead of walking each
 * one through Settings. Per-device settings still win — see `settings.ts`.
 */
export interface AppConfig {
  team: number
  teamName: string
  /** Optional fallback TBA read key. See the warning in config.json. */
  tbaApiKey: string
  defaultEventKey: string
  gameId: string
  /** Refresh the cached event from TBA on launch when online. */
  autoSyncOnLaunch: boolean
}

const FALLBACK: AppConfig = {
  team: 6036,
  teamName: 'Peninsula Robotics',
  tbaApiKey: '',
  defaultEventKey: '',
  gameId: 'rebuilt2026',
  autoSyncOnLaunch: true,
}

let config: AppConfig = FALLBACK

/** Read the already-loaded config. Safe to call anywhere after boot. */
export function getConfig(): AppConfig {
  return config
}

/**
 * Fetch config.json. Called once from main.tsx before render.
 * A missing or malformed file is not fatal — the app falls back to defaults
 * and Settings still works, because a scout at an event should never be
 * blocked by a deployment file.
 */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-cache' })
    if (!res.ok) throw new Error(String(res.status))
    const parsed = await res.json()
    config = {
      team: num(parsed.team, FALLBACK.team),
      teamName: str(parsed.teamName, FALLBACK.teamName),
      tbaApiKey: str(parsed.tbaApiKey, ''),
      defaultEventKey: str(parsed.defaultEventKey, '').trim().toLowerCase(),
      gameId: str(parsed.gameId, FALLBACK.gameId),
      autoSyncOnLaunch: parsed.autoSyncOnLaunch !== false,
    }
  } catch {
    config = FALLBACK
  }
  return config
}

const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
