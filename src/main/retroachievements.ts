/**
 * Reading achievement lists from RetroAchievements.
 *
 * What this can and cannot do is worth stating once, here, because the difference decides
 * what the launcher may promise a player.
 *
 * **It cannot track anything automatically.** RetroAchievements works by reading an
 * emulator's memory (docs.retroachievements.org, "Emulator Support"), and the three games
 * whose lists are wanted - `29328` Resident Evil, `11245` Resident Evil 2: DualShock Ver.,
 * `11265` Resident Evil 3: Nemesis - are all **PlayStation** entries. The launcher starts the
 * native Windows builds from GOG and Steam, which no emulator is running, so there is no
 * memory for RA to watch and no unlock to receive. No amount of launcher work changes that.
 *
 * **It can show the lists.** The public API returns them, and the launcher can present them
 * with locally-tracked progress beside the 365 definitions it already bundles. That is a
 * reference and a checklist, not an unlock feed, and the surface that shows it says so.
 *
 * **The key is the user's.** It is a personal credential (retroachievements.org → Settings →
 * API keys), read from the launcher's own configuration and never from source: no key is
 * compiled in, committed, or sent anywhere except retroachievements.org.
 *
 * **Not wired yet.** Nothing calls this module: the IPC channel, the achievements surface and
 * the two settings rows that feed it are the change that follows. If you are reading this and
 * no caller exists, that is why.
 */
import { log } from './logger'

/** The user's RetroAchievements credentials, as the launcher's configuration holds them. */
export interface RaCredentials {
  /** The account name. Optional: the modern API answers with the key alone. */
  user: string
  /** The personal web API key. Required. */
  key: string
}

/** One achievement, reduced to what the launcher displays. */
export interface RaAchievement {
  /** RA's own numeric id, which is what a locally-tracked tick is stored against. */
  id: number
  title: string
  description: string
  points: number
  /** The badge image name; the URL is built from it by the renderer, not here. */
  badge: string
}

export interface RaGame {
  id: number
  title: string
  /** RA's console name - "PlayStation" for the three games this exists for. */
  console: string
  achievements: RaAchievement[]
}

/** Injected in tests. Resolves the parsed JSON body, or throws. */
export type FetchJson = (url: string) => Promise<unknown>

const API_ROOT = 'https://retroachievements.org/API'

/**
 * The achievement list for a game, or `null`.
 *
 * `null` for every failure - no key, no network, a rate limit, a shape this does not
 * recognise - because the caller's alternative is a launcher that will not open because a
 * website was unreachable. The same rule the rest of the OS-facing code follows.
 */
export async function fetchGameAchievements(
  gameId: number,
  credentials: RaCredentials,
  fetchJson: FetchJson = defaultFetchJson
): Promise<RaGame | null> {
  if (!Number.isInteger(gameId) || gameId <= 0) return null
  if (credentials.key === '') return null

  // `z` is only sent when there is a user name: the API answers with the key alone, and an
  // empty `z` is a differently-shaped request rather than a harmless one.
  const query = [`i=${String(gameId)}`, `y=${encodeURIComponent(credentials.key)}`]
  if (credentials.user !== '') query.push(`z=${encodeURIComponent(credentials.user)}`)

  let body: unknown
  try {
    body = await fetchJson(`${API_ROOT}/API_GetGameExtended.php?${query.join('&')}`)
  } catch (error) {
    log.warn(`could not reach RetroAchievements for game ${String(gameId)}: ${String(error)}`)
    return null
  }

  return parseGame(body)
}

/**
 * Reduces the API's payload to `RaGame`, or `null` when it is not that shape.
 *
 * Written against the real payload's quirks rather than an ideal one: `Achievements` is an
 * **object keyed by achievement id**, not an array, and every field arrives as a string.
 */
export function parseGame(body: unknown): RaGame | null {
  if (!isRecord(body)) return null
  const id = Number(body['ID'])
  const title = body['Title']
  if (!Number.isFinite(id) || typeof title !== 'string') return null

  const consoleName = body['ConsoleName']
  return {
    id,
    title,
    console: typeof consoleName === 'string' ? consoleName : '',
    achievements: parseAchievements(body['Achievements'])
  }
}

function parseAchievements(value: unknown): RaAchievement[] {
  if (!isRecord(value)) return []
  const achievements: RaAchievement[] = []
  for (const entry of Object.values(value)) {
    if (!isRecord(entry)) continue
    const id = Number(entry['ID'])
    if (!Number.isFinite(id)) continue
    achievements.push({
      id,
      title: text(entry['Title']),
      description: text(entry['Description']),
      points: Number(entry['Points']) || 0,
      badge: text(entry['BadgeName'])
    })
  }
  // Sorted by id, so the surface's order does not depend on the order JSON happened to
  // serialise the object in - which for integer-like keys is ascending anyway, but that is a
  // property of the encoder rather than a promise anyone made.
  return achievements.sort((left, right) => left.id - right.id)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { 'User-Agent': 're-classic-collection' } })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json()
}
