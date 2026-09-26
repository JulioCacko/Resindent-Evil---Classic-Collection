/**
 * Steam detection: the parsers, the resolution order, and (when Steam is actually
 * installed) the three real app folders.
 *
 * The fixtures are trimmed copies of the files on the machine this was written on -
 * a real `libraryfolders.vdf` with two libraries and a real `appmanifest_4249100.acf`
 * - because the shapes are the point: VDF escapes its backslashes, an app manifest's
 * `installdir` is the only authority on the folder name, and a library's `apps` block
 * is what says which drive an app is on.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  appLibrariesFromVdf,
  findSteamAppDir,
  findSteamLibraries,
  findSteamRoot,
  libraryPathsFromVdf,
  parseAppManifest,
  parseVdf,
  unescapeVdfString
} from './steam'

/** A real `libraryfolders.vdf`, abridged to the parts this module reads. */
const LIBRARY_FOLDERS_VDF = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"label"		""
		"contentid"		"4243497553562849879"
		"apps"
		{
			"21690"		"9065005629"
			"228980"		"444177371"
		}
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
		"label"		""
		"contentid"		"6629311844766543266"
		"apps"
		{
			"4249100"		"9065005629"
			"4249110"		"444177371"
			"4249120"		"2145895956"
		}
	}
}
`

/** A real `appmanifest_4249100.acf`, abridged the same way. */
const APP_MANIFEST_4249100 = `"AppState"
{
	"appid"		"4249100"
	"Universe"		"1"
	"name"		"Resident Evil (1996)"
	"StateFlags"		"4"
	"installdir"		"4249100_Biohazard"
	"LastUpdated"		"1790357975"
}
`

describe('unescapeVdfString', () => {
  it('turns the doubled separators into real ones', () => {
    expect(unescapeVdfString('D:\\\\SteamLibrary')).toBe('D:\\SteamLibrary')
  })

  it('unescapes a quote', () => {
    expect(unescapeVdfString('a\\"b')).toBe('a"b')
  })

  it('leaves a lone backslash sequence alone', () => {
    expect(unescapeVdfString('C:\\Games')).toBe('C:\\Games')
  })
})

describe('parseVdf', () => {
  it('reads nested blocks and their keys', () => {
    const vdf = parseVdf(LIBRARY_FOLDERS_VDF)
    expect(vdf).not.toBeNull()
    const folders = vdf?.['libraryfolders']
    expect(typeof folders).toBe('object')
    if (folders === null || typeof folders !== 'object') return
    const slot = folders['1']
    expect(typeof slot).toBe('object')
    if (slot === null || typeof slot !== 'object') return
    expect(slot['path']).toBe('D:\\SteamLibrary')
    const apps = slot['apps']
    expect(typeof apps).toBe('object')
  })

  it('skips comments', () => {
    const vdf = parseVdf('// a comment\n"key" "value"\n')
    expect(vdf).toEqual({ key: 'value' })
  })

  it('returns null on an unbalanced block rather than an empty object', () => {
    // The distinction matters: `{}` is "no libraries", `null` is "this file is
    // broken", and only the second is worth telling the user about.
    expect(parseVdf('"libraryfolders" { "0" {')).toBeNull()
    expect(parseVdf('}')).toBeNull()
  })

  it('reads a key with no value as a block name and nothing else', () => {
    expect(parseVdf('"a" "1" "b" "2"')).toEqual({ a: '1', b: '2' })
  })
})

describe('libraryPathsFromVdf', () => {
  it('lists every library, normalised', () => {
    const paths = libraryPathsFromVdf(parseVdf(LIBRARY_FOLDERS_VDF) ?? {})
    expect(paths).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary'])
  })

  it('strips a trailing separator and normalises forward slashes', () => {
    const vdf = parseVdf('"libraryfolders" { "0" { "path" "E:/SteamLibrary/" } }')
    expect(libraryPathsFromVdf(vdf ?? {})).toEqual(['E:\\SteamLibrary'])
  })

  it('returns nothing for a file with no folders', () => {
    expect(libraryPathsFromVdf(parseVdf('"libraryfolders" { }') ?? {})).toEqual([])
  })
})

describe('appLibrariesFromVdf', () => {
  it('says which library holds which app', () => {
    const libraries = appLibrariesFromVdf(parseVdf(LIBRARY_FOLDERS_VDF) ?? {})
    expect(libraries.get('4249100')).toEqual(['D:\\SteamLibrary'])
    expect(libraries.get('4249120')).toEqual(['D:\\SteamLibrary'])
    expect(libraries.get('21690')).toEqual(['C:\\Program Files (x86)\\Steam'])
  })

  it('does not confuse two libraries', () => {
    // The bug a regex sweep would have: `"21690"` appears in library 0 and the app
    // ids in library 1, and a flat search would attribute them all to one drive.
    const libraries = appLibrariesFromVdf(parseVdf(LIBRARY_FOLDERS_VDF) ?? {})
    expect(libraries.get('228980')).toEqual(['C:\\Program Files (x86)\\Steam'])
    expect(libraries.get('4249110')).toEqual(['D:\\SteamLibrary'])
  })
})

describe('parseAppManifest', () => {
  it('reads the folder name, the name and the state flags', () => {
    expect(parseAppManifest(APP_MANIFEST_4249100)).toEqual({
      name: 'Resident Evil (1996)',
      installdir: '4249100_Biohazard',
      stateFlags: 4
    })
  })

  it('returns null when the manifest has no installdir', () => {
    expect(parseAppManifest('"AppState" { "appid" "4249100" }')).toBeNull()
  })

  it('returns null when the manifest is not an AppState', () => {
    expect(parseAppManifest('"Something" { "installdir" "x" }')).toBeNull()
  })

  it('returns null on a broken file', () => {
    expect(parseAppManifest('"AppState" {')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

interface World {
  dirs: string[]
  files: Record<string, string>
  registry: Record<string, string>
}

function makeOptions(world: World) {
  return {
    platform: 'win32' as NodeJS.Platform,
    runRegQuery: async (key: string, value: string) =>
      world.registry[`${key}\\${value}`] ?? null,
    // Case-insensitive reads and existence, like NTFS. This matters: the registry's
    // `SteamPath` is lowercased where the real folder is not, so a case-sensitive
    // fixture would fail to read `libraryfolders.vdf` through the root it just
    // resolved and would be testing the harness rather than the detector.
    readTextFile: async (path: string) => {
      const key = Object.keys(world.files).find(
        (known) => known.toLowerCase() === path.toLowerCase()
      )
      return key === undefined ? null : (world.files[key] ?? null)
    },
    dirExists: async (path: string) =>
      world.dirs.some((known) => known.toLowerCase() === path.toLowerCase())
  }
}

/** Compares two Windows paths the way the filesystem does. */
function expectPath(actual: string, expected: string): void {
  expect(actual.toLowerCase()).toBe(expected.toLowerCase())
}

const STEAM_ROOT = 'C:\\Program Files (x86)\\Steam'
const LIBRARY = 'D:\\SteamLibrary'
const APP_DIR = join(LIBRARY, 'steamapps', 'common', '4249100_Biohazard')

function world(): World {
  return {
    dirs: [STEAM_ROOT, LIBRARY, APP_DIR, join(APP_DIR, 'english'), join(APP_DIR, 'japanese')],
    files: {
      [join(STEAM_ROOT, 'steamapps', 'libraryfolders.vdf')]: LIBRARY_FOLDERS_VDF,
      [join(LIBRARY, 'steamapps', 'appmanifest_4249100.acf')]: APP_MANIFEST_4249100
    },
    registry: {
      [`HKCU\\Software\\Valve\\Steam\\SteamPath`]: 'c:/program files (x86)/steam'
    }
  }
}

describe('findSteamRoot', () => {
  it('uses HKCU SteamPath, which is written with forward slashes', async () => {
    const options = makeOptions(world())
    expectPath(await findSteamRoot(options), STEAM_ROOT)
  })

  it('falls back to the machine-wide InstallPath when HKCU has nothing', async () => {
    const state = world()
    state.registry = { 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam\\InstallPath': STEAM_ROOT }
    expectPath(await findSteamRoot(makeOptions(state)), STEAM_ROOT)
  })

  it('ignores a registry path that does not exist on disk', async () => {
    const state = world()
    state.dirs = []
    expect(await findSteamRoot(makeOptions(state))).toBe('')
  })

  it('uses the fallback roots when there is no registry at all', async () => {
    const state = world()
    state.registry = {}
    const options = { ...makeOptions(state), fallbackRoots: [STEAM_ROOT] }
    expectPath(await findSteamRoot(options), STEAM_ROOT)
  })
})

describe('findSteamLibraries', () => {
  it('puts the client root first and then the VDF libraries', async () => {
    const libraries = await findSteamLibraries(makeOptions(world()))
    expect(libraries).toHaveLength(2)
    expectPath(libraries[0] ?? '', STEAM_ROOT)
    expectPath(libraries[1] ?? '', LIBRARY)
  })

  it('does not list the same library twice when the two sources differ in case', async () => {
    // The registry lowercases `SteamPath`; the VDF writes the canonical spelling, and
    // the root library appears in both. One library, not two probes at the same drive.
    const libraries = await findSteamLibraries(makeOptions(world()))
    expect(libraries.filter((path) => path.toLowerCase().includes('program files'))).toHaveLength(1)
  })

  it('returns just the root when the VDF is missing', async () => {
    const state = world()
    state.files = {}
    const libraries = await findSteamLibraries(makeOptions(state))
    expect(libraries).toHaveLength(1)
    expectPath(libraries[0] ?? '', STEAM_ROOT)
  })
})

describe('findSteamAppDir', () => {
  it('resolves the app folder from the manifest, not from a guess at its name', async () => {
    const found = await findSteamAppDir('4249100', makeOptions(world()))
    expect(found).not.toBe('')
    expect(found.toLowerCase().endsWith('4249100_biohazard')).toBe(true)
    expectPath(found, APP_DIR)
  })

  it('finds an app that no library lists, by checking every known library', async () => {
    // A library rebuilt by hand, or an install Valve has not rewritten its `apps`
    // block for. Both libraries are known; neither claims the app, so the only way
    // to find it is to look in each one.
    const state = world()
    state.files[join(STEAM_ROOT, 'steamapps', 'libraryfolders.vdf')] =
      '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}\n'
    expectPath(await findSteamAppDir('4249100', makeOptions(state)), APP_DIR)
  })

  it('returns nothing when the app is in no known library', async () => {
    const state = world()
    state.dirs = [STEAM_ROOT, LIBRARY]
    expect(await findSteamAppDir('4249100', makeOptions(state))).toBe('')
  })

  it('returns nothing for an app that is not installed', async () => {
    expect(await findSteamAppDir('9999999', makeOptions(world()))).toBe('')
  })

  it('returns nothing for an empty app id', async () => {
    expect(await findSteamAppDir('', makeOptions(world()))).toBe('')
  })
})

// ---------------------------------------------------------------------------
// against the real machine
// ---------------------------------------------------------------------------

const REAL_STEAM = existsSync(STEAM_ROOT)

/**
 * The parsers above are tested against fixtures; these three run the *real* detector
 * over the real registry and the real library files, which is the only way to know
 * the whole chain works on an actual Steam install. They skip on a machine without
 * Steam rather than failing, because "no Steam here" is not a defect.
 */
describe.skipIf(!REAL_STEAM)('the installed Steam client', () => {
  it('finds all three Classic Collection apps', async () => {
    const options = { platform: process.platform }
    for (const [appId, folder] of [
      ['4249100', '4249100_Biohazard'],
      ['4249110', '4249110_Biohazard2'],
      ['4249120', '4249120_Biohazard3']
    ] as const) {
      const found = await findSteamAppDir(appId, options)
      expect(found, `Steam app ${appId}`).not.toBe('')
      expect(found.endsWith(folder), `${appId} resolved to ${found}`).toBe(true)
    }
  })

  it('finds the locale folders the catalog maps each row to', async () => {
    const options = { platform: process.platform }
    const app = await findSteamAppDir('4249100', options)
    expect(existsSync(join(app, 'english', 'ResidentEvil.exe'))).toBe(true)
    expect(existsSync(join(app, 'japanese', 'Biohazard.exe'))).toBe(true)
  })
})
