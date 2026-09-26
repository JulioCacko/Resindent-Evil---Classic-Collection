/**
 * Unit tests for GOG install detection.
 *
 * The stdout fixtures are the real output of `reg query <key> /v path` as
 * recorded on a Windows machine with the GOG releases installed (CRLF endings,
 * four-space columns), so `parseRegQueryOutput` is pinned to the format `reg`
 * actually writes rather than to a regex author's idea of it.
 *
 * No test touches a real registry or a real install: `pathExists` and
 * `runRegQuery` are injected, which is the whole reason the contract exposes
 * them. The only filesystem access is a temporary directory for
 * `listGalaxyGameDirs`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { GogDetectionOptions, GogTitleRef } from '../contracts'
import {
  detectAllInstallPaths,
  detectInstallPath,
  listGalaxyGameDirs,
  parseRegQueryOutput
} from './gog'

// ---------------------------------------------------------------------------
// recorded `reg query` fixtures
// ---------------------------------------------------------------------------

const REG_KEY = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1580232252'

/** The key path `runRegQuery` is handed, i.e. the literal `reg query` argument. */
const SUBKEY_WOW = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1580232252'
const SUBKEY_PLAIN = 'HKLM\\SOFTWARE\\GOG.com\\Games\\1580232252'
const subkeyFor = (gogGameId: string): string =>
  `HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\${gogGameId}`

/** What `reg query` prints when the key or the value does not exist. */
const REG_KEY_NOT_FOUND = 'ERROR: The system was unable to find the specified registry key or value.\r\n'

/** A successful `reg query <key> /v path` run. */
function stdoutFor(value: string): string {
  return [REG_KEY, `    path    REG_SZ    ${value}`, ''].join('\r\n')
}

interface ParseCase {
  name: string
  stdout: string
  expected: string | null
}

const PARSE_CASES: readonly ParseCase[] = [
  {
    name: 'a found REG_SZ path',
    stdout: stdoutFor('D:\\Games\\Resident Evil'),
    expected: 'D:\\Games\\Resident Evil'
  },
  {
    name: 'a leading blank line before the key',
    stdout: ['', REG_KEY, '    path    REG_SZ    D:\\Games\\Resident Evil', ''].join('\r\n'),
    expected: 'D:\\Games\\Resident Evil'
  },
  {
    name: 'a REG_EXPAND_SZ path, returned verbatim',
    // The legacy detector used RegQueryValueExA without RRF_*, which returns the
    // unexpanded string, so `%SystemDrive%` must survive parsing untouched.
    stdout: ['', REG_KEY, '    path    REG_EXPAND_SZ    %SystemDrive%\\GOG Games\\Resident Evil 2'].join(
      '\r\n'
    ),
    expected: '%SystemDrive%\\GOG Games\\Resident Evil 2'
  },
  {
    name: 'a value containing spaces, kept whole',
    stdout: stdoutFor('C:\\Program Files (x86)\\GOG Games\\Resident Evil 3'),
    expected: 'C:\\Program Files (x86)\\GOG Games\\Resident Evil 3'
  },
  {
    name: 'surrounding whitespace trimmed off the value',
    stdout: ['', REG_KEY, '    path    REG_SZ    D:\\Games\\Resident Evil   ', ''].join('\r\n'),
    expected: 'D:\\Games\\Resident Evil'
  },
  {
    name: 'loosely spaced columns',
    stdout: ['', REG_KEY, 'path REG_SZ    D:\\Games\\Resident Evil', ''].join('\r\n'),
    expected: 'D:\\Games\\Resident Evil'
  },
  {
    name: 'the path value even when other values are listed first',
    stdout: [
      '',
      REG_KEY,
      '    gameID    REG_SZ    1580232252',
      '    path    REG_SZ    D:\\Games\\Resident Evil',
      ''
    ].join('\r\n'),
    expected: 'D:\\Games\\Resident Evil'
  },
  {
    name: 'a key that exists but has no path value',
    stdout: [REG_KEY, ''].join('\r\n'),
    expected: null
  },
  {
    name: 'an empty value (no data column at all)',
    stdout: [REG_KEY, '    path    REG_SZ'].join('\r\n'),
    expected: null
  },
  {
    name: 'a whitespace-only value',
    stdout: [REG_KEY, '    path    REG_SZ    '].join('\r\n'),
    expected: null
  },
  {
    name: 'the key-not-found message',
    stdout: REG_KEY_NOT_FOUND,
    expected: null
  },
  {
    name: 'the older key-not-found wording',
    stdout: 'ERROR: The system was unable to find the specified registry key\r\n',
    expected: null
  },
  {
    name: 'an error line printed before the header',
    stdout: `ERROR: Access is denied.\r\n${stdoutFor('D:\\Games\\Resident Evil')}`,
    expected: null
  },
  {
    name: 'empty stdout',
    stdout: '',
    expected: null
  },
  {
    name: 'a non-string value type',
    stdout: '    path    REG_DWORD    0x1\r\n',
    expected: null
  },
  {
    name: 'a different value name',
    stdout: '    DisplayName    REG_SZ    Resident Evil\r\n',
    expected: null
  },
  {
    name: 'only a header line',
    stdout: `${REG_KEY}\r\n`,
    expected: null
  }
]

describe('parseRegQueryOutput', () => {
  for (const testCase of PARSE_CASES) {
    it(`maps ${testCase.name} to ${JSON.stringify(testCase.expected)}`, () => {
      expect(parseRegQueryOutput(testCase.stdout)).toBe(testCase.expected)
    })
  }
})

// ---------------------------------------------------------------------------
// detection doubles
// ---------------------------------------------------------------------------

const RE1: GogTitleRef = { id: 're1', gogGameId: '1580232252', gogFolderName: 'Resident Evil' }
const RE2: GogTitleRef = { id: 're2', gogGameId: '1534123252', gogFolderName: 'Resident Evil 2' }
const RE3: GogTitleRef = { id: 're3', gogGameId: '1266089300', gogFolderName: 'Resident Evil 3' }

const APP_DIR = join('C:', 'Launcher')
const OVERRIDE_ROOT = join('E:', 'GOG Library')
const LOCAL_RE1 = join(APP_DIR, 'GOG Games', 'Resident Evil')
const LOCAL_RE2 = join(APP_DIR, 'GOG Games', 'Resident Evil 2')
const OVERRIDE_RE1 = join(OVERRIDE_ROOT, 'Resident Evil')
const COMMON_ROOTS_RE1 = [
  join('C:\\GOG Games', 'Resident Evil'),
  join('C:\\Program Files (x86)\\GOG Games', 'Resident Evil'),
  join('D:\\GOG Games', 'Resident Evil')
] as const
/** The relative path an empty `appDir` would produce; it must never be probed. */
const RELATIVE_RE1 = join('GOG Games', 'Resident Evil')

const REG_RE1 = 'D:\\Games\\Resident Evil'
const REG_RE3 = 'D:\\Games\\Resident Evil 3'

interface FakeDisk {
  pathExists: NonNullable<GogDetectionOptions['pathExists']>
  probes: string[]
}

/** A disk on which exactly `existing` exists, recording every probe. */
function fakeDisk(existing: readonly string[]): FakeDisk {
  const present = new Set(existing)
  const probes: string[] = []
  return {
    probes,
    pathExists: (candidate: string) => {
      probes.push(candidate)
      return Promise.resolve(present.has(candidate))
    }
  }
}

interface FakeRegistry {
  runRegQuery: NonNullable<GogDetectionOptions['runRegQuery']>
  subkeys: string[]
}

/** A registry that answers `responses` per subkey (null = key not found). */
function fakeRegistry(responses: Readonly<Record<string, string | null>>): FakeRegistry {
  const subkeys: string[] = []
  return {
    subkeys,
    runRegQuery: (subkey: string) => {
      subkeys.push(subkey)
      return Promise.resolve(responses[subkey] ?? null)
    }
  }
}

function makeOptions(overrides: Partial<GogDetectionOptions>): GogDetectionOptions {
  return { appDir: APP_DIR, gogPathOverride: '', platform: 'win32', ...overrides }
}

// ---------------------------------------------------------------------------
// stage 1: explicit override
// ---------------------------------------------------------------------------

describe('detectInstallPath: gogPathOverride', () => {
  it('prefers the per-title folder under the override root and never probes the registry', async () => {
    const disk = fakeDisk([OVERRIDE_RE1, LOCAL_RE1])
    const registry = fakeRegistry({ [SUBKEY_WOW]: stdoutFor(REG_RE1) })

    const result = await detectInstallPath(
      RE1,
      makeOptions({
        gogPathOverride: OVERRIDE_ROOT,
        pathExists: disk.pathExists,
        runRegQuery: registry.runRegQuery
      })
    )

    expect(result).toBe(OVERRIDE_RE1)
    expect(disk.probes[0]).toBe(OVERRIDE_RE1)
    expect(registry.subkeys).toEqual([])
  })

  it('falls through when the override exists but holds no folder for this title', async () => {
    // The override root is real (it holds the other titles) but this title is
    // missing from it, so the override root must not be reported.
    const disk = fakeDisk([OVERRIDE_ROOT, LOCAL_RE1])
    const registry = fakeRegistry({ [SUBKEY_WOW]: stdoutFor(REG_RE1) })

    const result = await detectInstallPath(
      RE1,
      makeOptions({
        gogPathOverride: OVERRIDE_ROOT,
        pathExists: disk.pathExists,
        runRegQuery: registry.runRegQuery
      })
    )

    expect(disk.probes[0]).toBe(OVERRIDE_RE1)
    expect(result).toBe(LOCAL_RE1)
    expect(result).not.toBe(OVERRIDE_ROOT)
  })

  it('falls through all the way to the registry when neither the override nor the local folder has the title', async () => {
    const disk = fakeDisk([OVERRIDE_ROOT, REG_RE1])
    const registry = fakeRegistry({ [SUBKEY_WOW]: stdoutFor(REG_RE1) })

    const result = await detectInstallPath(
      RE1,
      makeOptions({
        gogPathOverride: OVERRIDE_ROOT,
        pathExists: disk.pathExists,
        runRegQuery: registry.runRegQuery
      })
    )

    expect(result).toBe(REG_RE1)
  })

  it('ignores an override whose base directory is gone', async () => {
    // Legacy gated the whole override branch on DirExists(base), so a deleted
    // override root means normal detection, not a dead path.
    const disk = fakeDisk([LOCAL_RE1])

    const result = await detectInstallPath(
      RE1,
      makeOptions({ gogPathOverride: OVERRIDE_ROOT, pathExists: disk.pathExists })
    )

    expect(result).toBe(LOCAL_RE1)
    // The joined candidate is probed, the bare override root never is: only a
    // folder for this title can be an install root.
    expect(disk.probes).toEqual([OVERRIDE_RE1, LOCAL_RE1])
    expect(disk.probes).not.toContain(OVERRIDE_ROOT)
  })

  it('trims a whitespace-only override and treats it as unset', async () => {
    const disk = fakeDisk([LOCAL_RE1])

    const result = await detectInstallPath(
      RE1,
      makeOptions({ gogPathOverride: '   ', pathExists: disk.pathExists })
    )

    expect(result).toBe(LOCAL_RE1)
    expect(disk.probes).not.toContain(join('   ', 'Resident Evil'))
  })
})

// ---------------------------------------------------------------------------
// stage 2: the launcher-local `GOG Games/` folder
// ---------------------------------------------------------------------------

describe('detectInstallPath: appDir/GOG Games', () => {
  it('uses <appDir>/GOG Games/<folder> and stops before the registry', async () => {
    const disk = fakeDisk([LOCAL_RE1])
    const registry = fakeRegistry({ [SUBKEY_WOW]: stdoutFor(REG_RE1) })

    const result = await detectInstallPath(
      RE1,
      makeOptions({ pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe(LOCAL_RE1)
    expect(registry.subkeys).toEqual([])
  })

  it('never builds a relative GOG Games candidate from an empty appDir', async () => {
    // With appDir '' a naive join would produce `GOG Games/Resident Evil`, and a
    // working-directory hit would be reported as an install.
    const disk = fakeDisk([RELATIVE_RE1])
    const registry = fakeRegistry({})

    const result = await detectInstallPath(
      RE1,
      makeOptions({ appDir: '', pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe('')
    expect(disk.probes).not.toContain(RELATIVE_RE1)
  })
})

// ---------------------------------------------------------------------------
// stage 3: registry
// ---------------------------------------------------------------------------

describe('detectInstallPath: registry', () => {
  it('queries the WOW6432Node key first and only that one when it resolves', async () => {
    const disk = fakeDisk([REG_RE1])
    const registry = fakeRegistry({
      [SUBKEY_WOW]: stdoutFor(REG_RE1),
      [SUBKEY_PLAIN]: stdoutFor('E:\\Should not be read')
    })

    const result = await detectInstallPath(
      RE1,
      makeOptions({ appDir: '', pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe(REG_RE1)
    expect(registry.subkeys).toEqual([SUBKEY_WOW])
  })

  it('falls back to the plain GOG.com key when WOW6432Node is absent', async () => {
    const disk = fakeDisk([REG_RE1])
    const registry = fakeRegistry({
      [SUBKEY_WOW]: REG_KEY_NOT_FOUND,
      [SUBKEY_PLAIN]: stdoutFor(REG_RE1)
    })

    const result = await detectInstallPath(
      RE1,
      makeOptions({ appDir: '', pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe(REG_RE1)
    expect(registry.subkeys).toEqual([SUBKEY_WOW, SUBKEY_PLAIN])
  })

  it('ignores a recorded path that no longer exists and keeps looking', async () => {
    // A stale GOG record must not win: legacy required DirExists on the value.
    const disk = fakeDisk([REG_RE1])
    const registry = fakeRegistry({
      [SUBKEY_WOW]: stdoutFor('E:\\Uninstalled\\Resident Evil'),
      [SUBKEY_PLAIN]: stdoutFor(REG_RE1)
    })

    const result = await detectInstallPath(
      RE1,
      makeOptions({ appDir: '', pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe(REG_RE1)
    expect(registry.subkeys).toEqual([SUBKEY_WOW, SUBKEY_PLAIN])
  })

  it('reports nothing when the registry has no path and no common root exists', async () => {
    const disk = fakeDisk([])
    const registry = fakeRegistry({ [SUBKEY_WOW]: REG_KEY_NOT_FOUND, [SUBKEY_PLAIN]: null })

    const result = await detectInstallPath(
      RE1,
      makeOptions({ appDir: '', pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe('')
  })

  it('skips the registry entirely when the title has no GOG id', async () => {
    // Legacy returned early for an empty id, which also means the id-keyed
    // registry branch must not run for this title.
    const noId: GogTitleRef = { id: 're2', gogGameId: '', gogFolderName: 'Resident Evil 2' }
    const disk = fakeDisk([])
    const registry = fakeRegistry({})

    const result = await detectInstallPath(
      noId,
      makeOptions({ appDir: '', pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe('')
    expect(registry.subkeys).toEqual([])
  })

  it('still finds the launcher-local copy when the title has no GOG id', async () => {
    const noId: GogTitleRef = { id: 're2', gogGameId: '', gogFolderName: 'Resident Evil 2' }
    const disk = fakeDisk([LOCAL_RE2])

    const result = await detectInstallPath(noId, makeOptions({ pathExists: disk.pathExists }))

    expect(result).toBe(LOCAL_RE2)
  })

  it('derives the folder name from the GOG id when the ref has none', async () => {
    // Legacy GogIdToFolderName: the catalog normally supplies the folder name,
    // but a ref that only knows the id must still detect.
    const bare: GogTitleRef = { id: 're3', gogGameId: '1266089300', gogFolderName: '' }
    const disk = fakeDisk([REG_RE3])
    const registry = fakeRegistry({ [subkeyFor('1266089300')]: stdoutFor(REG_RE3) })

    const result = await detectInstallPath(
      bare,
      makeOptions({ appDir: '', pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe(REG_RE3)
  })

  it('probes no candidate at all when neither a folder name nor a GOG id is known', async () => {
    const unknown: GogTitleRef = { id: 're1', gogGameId: '', gogFolderName: '' }
    const disk = fakeDisk([OVERRIDE_ROOT])

    const result = await detectInstallPath(
      unknown,
      makeOptions({ gogPathOverride: OVERRIDE_ROOT, pathExists: disk.pathExists })
    )

    expect(result).toBe('')
    expect(disk.probes).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// stage 4: common roots
// ---------------------------------------------------------------------------

describe('detectInstallPath: common roots', () => {
  it('probes C:\\GOG Games, then Program Files (x86), then D:\\GOG Games in that order', async () => {
    const disk = fakeDisk([COMMON_ROOTS_RE1[2]])
    const registry = fakeRegistry({})

    const result = await detectInstallPath(
      RE1,
      makeOptions({ appDir: '', pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe(COMMON_ROOTS_RE1[2])
    // The registry is the stage before the roots, and nothing else is probed.
    expect(registry.subkeys).toEqual([SUBKEY_WOW, SUBKEY_PLAIN])
    expect(disk.probes).toEqual([...COMMON_ROOTS_RE1])
  })

  it('takes the first common root that exists', async () => {
    const disk = fakeDisk([COMMON_ROOTS_RE1[0]])
    const registry = fakeRegistry({})

    const result = await detectInstallPath(
      RE1,
      makeOptions({ appDir: '', pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe(COMMON_ROOTS_RE1[0])
    expect(disk.probes).toEqual([COMMON_ROOTS_RE1[0]])
  })
})

// ---------------------------------------------------------------------------
// non-Windows platforms
// ---------------------------------------------------------------------------

const GALAXY_ROOT = join(homedir(), '.local', 'share', 'GOG.com')
const galaxyDir = (folder: string): string => join(GALAXY_ROOT, folder)

describe('detectInstallPath: non-Windows', () => {
  it('uses the Galaxy data directory and never shells out to reg', async () => {
    const disk = fakeDisk([galaxyDir('Resident Evil')])
    const registry = fakeRegistry({ [SUBKEY_WOW]: stdoutFor(REG_RE1) })

    const result = await detectInstallPath(
      RE1,
      makeOptions({ platform: 'linux', pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe(galaxyDir('Resident Evil'))
    expect(registry.subkeys).toEqual([])
  })

  it('reports nothing when the local folder and the Galaxy directory are both absent', async () => {
    const disk = fakeDisk([])
    const registry = fakeRegistry({ [SUBKEY_WOW]: stdoutFor(REG_RE1) })

    const result = await detectInstallPath(
      RE1,
      makeOptions({ platform: 'darwin', pathExists: disk.pathExists, runRegQuery: registry.runRegQuery })
    )

    expect(result).toBe('')
    // Local folder first, then the Galaxy root; the registry is never touched.
    expect(disk.probes).toEqual([LOCAL_RE1, galaxyDir('Resident Evil'), GALAXY_ROOT])
    expect(registry.subkeys).toEqual([])
  })
})

describe('listGalaxyGameDirs', () => {
  it('returns the directories of a Galaxy root and skips files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gog-galaxy-'))
    try {
      await mkdir(join(root, 'Resident Evil'))
      await mkdir(join(root, 'resident evil 2'))
      await writeFile(join(root, 'galaxy.txt'), 'not a game')

      const names = (await listGalaxyGameDirs(root)).map((dir) => basename(dir)).sort()

      expect(names).toEqual(['Resident Evil', 'resident evil 2'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns an empty list for a root that does not exist', async () => {
    expect(await listGalaxyGameDirs(join(tmpdir(), 'gog-galaxy-does-not-exist'))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// detectAllInstallPaths
// ---------------------------------------------------------------------------

describe('detectAllInstallPaths', () => {
  it('reports one entry per title, empty for the titles that are not installed', async () => {
    const disk = fakeDisk([LOCAL_RE1, REG_RE3])
    const registry = fakeRegistry({
      [subkeyFor('1580232252')]: REG_KEY_NOT_FOUND,
      [subkeyFor('1534123252')]: null,
      [subkeyFor('1266089300')]: stdoutFor(REG_RE3)
    })

    const result = await detectAllInstallPaths([RE1, RE2, RE3], makeOptions({
      pathExists: disk.pathExists,
      runRegQuery: registry.runRegQuery
    }))

    expect(result).toEqual({ re1: LOCAL_RE1, re2: '', re3: REG_RE3 })
    expect(Object.keys(result).sort()).toEqual(['re1', 're2', 're3'])
  })

  it('returns an empty record for an empty title list', async () => {
    const disk = fakeDisk([])

    expect(await detectAllInstallPaths([], makeOptions({ pathExists: disk.pathExists }))).toEqual({})
    expect(disk.probes).toEqual([])
  })
})
