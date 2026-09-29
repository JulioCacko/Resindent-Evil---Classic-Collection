/**
 * RetroAchievements badge art, cached on the player's own machine.
 *
 * The achievements surface has drawn a letter slot for every row because the launcher ships no
 * achievement art: RA's badges are RA's assets, and this project does not redistribute other people's
 * artwork. So the list fetches them instead, on demand, and keeps them under the player's `userData` —
 * never in the repository, and never in a build.
 *
 * Three rules shape everything here, and each is a decision rather than a detail:
 *
 *  - **The name is the only input, and it is not trusted.** It arrives from RA's JSON and becomes a file
 *    name, so it is matched against `^[A-Za-z0-9_-]{1,64}$` *before* it can touch the filesystem. RA's own
 *    names are numeric, so anything else is a bug or an attack, and both get the same answer.
 *  - **Every failure is `null`.** No network, no disk, a rate limit, a body that is not a PNG — the row
 *    falls back to the letter slot it already draws. The same rule `retroachievements.ts` follows: a
 *    launcher that breaks because a website was unreachable is worse than one without badge art.
 *  - **The renderer receives bytes, not a path or a URL.** A `data:` URL keeps the launcher's "the
 *    renderer never talks to the network" promise intact (`index.html`'s CSP allows `data:` images and no
 *    remote origin), and it works in a packaged build where a `file:` image would not.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { log } from './logger'

/** Where RA serves badge PNGs. The name is RA's `BadgeName`, which is what `RaAchievement.badge` holds. */
const BADGE_ROOT = 'https://media.retroachievements.org/Badge'

/**
 * What a badge name may look like, and the guard that keeps it a file name rather than a path.
 *
 * `../` and an absolute path both fail this, which is the point: the name is interpolated into a path
 * below, so the pattern is the difference between a cache and a way to write anywhere on disk.
 */
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** A badge is a 48px-class PNG; anything this large is not one, and is refused rather than cached. */
const MAX_BADGE_BYTES = 256 * 1024

/** The eight bytes every PNG begins with, checked so a captive-portal HTML page is never cached as art. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface BadgeOptions {
  /** Where cached badges live. The launcher passes `<userData>/badges`. */
  cacheDir: string
  /** Injected in tests. Returns the body, or null for any failure. */
  fetchBytes?: (url: string) => Promise<Uint8Array | null>
}

/** Decoded badges, per process: a re-render of the list must not re-read the disk. */
const memory = new Map<string, string>()

/** In-flight fetches, so a list of 130 rows cannot ask for the same badge twice at once. */
const inFlight = new Map<string, Promise<string | null>>()

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

function toDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
}

async function defaultFetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 're-classic-collection' } })
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

/**
 * The badge for `name`, as a `data:` URL, or `null`.
 *
 * Read-through: memory, then the disk cache, then RA. A body that is not a PNG, or is absurdly large, is
 * refused *and not written*, so a bad response cannot poison the cache for every later run.
 */
export async function readBadge(name: string, options: BadgeOptions): Promise<string | null> {
  if (!NAME_PATTERN.test(name)) {
    // Logged rather than silent: a name that fails this is either RA changing its shape or something
    // interpolating into a path, and both are worth seeing in the log.
    log.warn(`refused a badge name that is not a badge name: "${name}"`)
    return null
  }

  const cached = memory.get(name)
  if (cached !== undefined) return cached

  const existing = inFlight.get(name)
  if (existing !== undefined) return await existing

  const work = load(name, options)
  inFlight.set(name, work)
  try {
    const result = await work
    if (result !== null) memory.set(name, result)
    return result
  } finally {
    inFlight.delete(name)
  }
}

async function load(name: string, options: BadgeOptions): Promise<string | null> {
  const path = join(options.cacheDir, `${name}.png`)

  // The disk cache first: a badge fetched once should never be fetched again, and the player may be
  // offline the next time they open the list.
  try {
    const bytes = await readFile(path)
    if (isPng(bytes)) return toDataUrl(bytes)
    log.warn(`cached badge ${name} is not a PNG; refetching`)
  } catch {
    // Not cached yet, which is the ordinary first-time case.
  }

  const fetchBytes = options.fetchBytes ?? defaultFetchBytes
  const bytes = await fetchBytes(`${BADGE_ROOT}/${name}.png`)
  if (bytes === null) return null
  if (!isPng(bytes)) {
    log.warn(`RA returned something that is not a PNG for badge ${name}`)
    return null
  }
  if (bytes.length > MAX_BADGE_BYTES) {
    log.warn(`RA returned ${String(bytes.length)} bytes for badge ${name}; refusing to cache it`)
    return null
  }

  try {
    await mkdir(options.cacheDir, { recursive: true })
    await writeFile(path, bytes)
  } catch (error) {
    // A cache that cannot be written is a slower launcher, not a broken one: the bytes are already in
    // hand, so the badge is still shown.
    log.warn(`could not cache badge ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }

  return toDataUrl(bytes)
}

/** Forgets the in-process copies. Tests only; the disk cache is the real one. */
export function forgetCachedBadges(): void {
  memory.clear()
  inFlight.clear()
}
