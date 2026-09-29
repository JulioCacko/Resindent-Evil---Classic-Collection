/**
 * The badge cache's rules, including the one that matters most: the name is not trusted.
 *
 * A badge name arrives from RetroAchievements' JSON and is interpolated into a file path, so the guard
 * against `../` and absolute paths is the difference between a cache directory and a way to write anywhere
 * on the player's disk. It is tested here rather than assumed, and so is every failure path — because the
 * contract is that a row falls back to its letter slot rather than the launcher breaking.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { forgetCachedBadges, readBadge } from './badges'

/** The eight bytes a PNG begins with, so a fixture can be a real PNG as far as this module is concerned. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03])

let cacheDir = ''
let fetches: string[] = []

/** A fetcher that answers with PNG bytes and records what it was asked for. */
function fetcher(bytes: Uint8Array | null = PNG): (url: string) => Promise<Uint8Array | null> {
  return async (url: string) => {
    fetches.push(url)
    return bytes
  }
}

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 're-badges-'))
  fetches = []
  forgetCachedBadges()
})

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true })
})

describe('readBadge', () => {
  it('fetches once, returns a data URL, and writes the bytes to the cache', async () => {
    const url = await readBadge('12345', { cacheDir, fetchBytes: fetcher() })

    expect(url).toMatch(/^data:image\/png;base64,/)
    expect(fetches).toEqual(['https://media.retroachievements.org/Badge/12345.png'])
    // The bytes are on disk, which is what makes the second view work offline.
    expect(await readFile(join(cacheDir, '12345.png'))).toEqual(Buffer.from(PNG))
  })

  it('serves a second call from memory without fetching again', async () => {
    await readBadge('12345', { cacheDir, fetchBytes: fetcher() })
    await readBadge('12345', { cacheDir, fetchBytes: fetcher() })

    expect(fetches).toHaveLength(1)
  })

  it('serves a fresh process from the disk cache, with no network at all', async () => {
    await readBadge('12345', { cacheDir, fetchBytes: fetcher() })
    // A new process has an empty memory map; the disk is the cache that survives.
    forgetCachedBadges()

    const url = await readBadge('12345', { cacheDir, fetchBytes: fetcher() })

    expect(url).toMatch(/^data:image\/png;base64,/)
    expect(fetches, 'nothing was fetched the second time').toHaveLength(1)
  })

  it('refuses a name that could reach outside the cache directory', async () => {
    /*
     * THE GUARD. Each of these becomes a path below if it is allowed through, and `../` in particular is
     * how a cache becomes an arbitrary write. RA's names are numeric, so refusing the rest costs nothing.
     */
    for (const name of ['../secret', '..\\secret', '/etc/passwd', 'C:\\Windows\\x', 'a b', '']) {
      expect(await readBadge(name, { cacheDir, fetchBytes: fetcher() }), name).toBeNull()
    }
    expect(fetches, 'nothing was fetched for a refused name').toEqual([])
  })

  it('refuses a long name, which is not a badge name either', async () => {
    expect(await readBadge('a'.repeat(65), { cacheDir, fetchBytes: fetcher() })).toBeNull()
    expect(await readBadge('a'.repeat(64), { cacheDir, fetchBytes: fetcher() })).toMatch(/^data:/)
  })

  it('returns null rather than breaking when the network fails', async () => {
    const url = await readBadge('12345', { cacheDir, fetchBytes: async () => null })
    expect(url).toBeNull()
  })

  it('refuses a body that is not a PNG, and does not cache it', async () => {
    // A captive portal, an error page, a proxy: all arrive as 200 with HTML, and caching one would leave a
    // broken image until someone cleared the folder by hand.
    const html = new TextEncoder().encode('<html>not a badge</html>')
    expect(await readBadge('12345', { cacheDir, fetchBytes: fetcher(html) })).toBeNull()

    await expect(readFile(join(cacheDir, '12345.png'))).rejects.toThrow()
  })

  it('refuses an absurdly large body, and does not cache it', async () => {
    const huge = new Uint8Array(256 * 1024 + 1)
    huge.set(PNG)
    expect(await readBadge('12345', { cacheDir, fetchBytes: fetcher(huge) })).toBeNull()
    await expect(readFile(join(cacheDir, '12345.png'))).rejects.toThrow()
  })

  it('ignores a poisoned cache file and refetches', async () => {
    // A truncated or non-PNG file on disk must not be served as art for the rest of time.
    await writeFile(join(cacheDir, '12345.png'), 'not a png', 'utf8')

    const url = await readBadge('12345', { cacheDir, fetchBytes: fetcher() })

    expect(url).toMatch(/^data:image\/png;base64,/)
    expect(fetches).toHaveLength(1)
  })

  it('asks for the same badge once when many rows want it at the same time', async () => {
    // A 130-row list renders in one pass; without single-flight it would ask RA 130 times for one badge.
    const slow = async (url: string): Promise<Uint8Array | null> => {
      fetches.push(url)
      await new Promise((resolve) => setTimeout(resolve, 10))
      return PNG
    }

    const all = await Promise.all([
      readBadge('999', { cacheDir, fetchBytes: slow }),
      readBadge('999', { cacheDir, fetchBytes: slow }),
      readBadge('999', { cacheDir, fetchBytes: slow })
    ])

    expect(all.every((url) => url !== null)).toBe(true)
    expect(fetches).toHaveLength(1)
  })
})
