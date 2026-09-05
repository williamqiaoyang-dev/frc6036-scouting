import type { GameConfig } from './types'
import { rebuilt2026 } from './rebuilt2026'

/**
 * Registry of every season the app knows about.
 * Add a season by importing its config and listing it here.
 */
export const GAMES: Record<string, GameConfig> = {
  [rebuilt2026.id]: rebuilt2026,
}

/** The season the app boots into. */
export const ACTIVE_GAME_ID = rebuilt2026.id

export function getGame(id: string = ACTIVE_GAME_ID): GameConfig {
  const game = GAMES[id]
  if (!game) throw new Error(`Unknown game "${id}". Register it in src/games/index.ts.`)
  return game
}

export type { GameConfig } from './types'
export * from './types'
