/**
 * Which store a row runs from, and which executable that means.
 *
 * The two layouts are wildly different — GOG keeps the executables in the install
 * root, Steam keeps a complete copy of the game per localization in `english\`,
 * `japanese\` and so on — so these tests pin the two decisions that matter: GOG wins
 * when both are installed, and a row's executable name follows its *source*, not the
 * catalog's GOG-shaped default.
 *
 * The world these run against is a handful of injected paths and directories; the
 * detector's own reading of the registry and the VDF is covered in `steam.test.ts`,
 * including against the real Steam install on this machine.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { TITLES, findTitle, findVersion } from '@shared/catalog'
import type { GameTitleSeed, GameVersionSeed } from '@shared/catalog'
import { resolveTitleInstalls, resolveVersionInstall, retailExecutableFor } from './install'

/** The Steam world: only the folders named here exist. */
function steamWorld(apps: Record<string, { locale: string }[]>): {
  dirs: string[]
  files: Record<string, string>
  registry: Record<string, string>
} {
  const dirs = ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']
  const files: Record<string, string> = {
    [join('C:\\Program Files (x86)\\Steam', 'steamapps', 'libraryfolders.vdf')]: [
      '"libraryfolders"',
      '{',
      '\t"0"',
      '\t{',
      '\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"',
      '\t}',
      '\t"1"',
      '\t{',
      '\t\t"path"\t\t"D:\\\\SteamLibrary"',
      '\t\t"apps"',
      '\t\t{',
      ...Object.keys(apps).map((appId) => `\t\t\t"${appId}"\t\t"0"`),
      '\t\t}',
      '\t}',
      '}',
      ''
    ].join('\n')
  }

  for (const [appId, locales] of Object.entries(apps)) {
    const installdir = `${appId}_Biohazard`
    dirs.push(join('D:\\SteamLibrary', 'steamapps', 'common', installdir))
    files[join('D:\\SteamLibrary', 'steamapps', `appmanifest_${appId}.acf`)] = [
      '"AppState"',
      '{',
      `\t"appid"\t\t"${appId}"`,
      '\t"name"\t\t"Resident Evil"',
      '\t"StateFlags"\t\t"4"',
      `\t"installdir"\t\t"${installdir}"`,
      '}',
      ''
    ].join('\n')
    for (const { locale } of locales) {
      dirs.push(join('D:\\SteamLibrary', 'steamapps', 'common', installdir, locale))
    }
  }

  return { dirs, files, registry: { 'HKCU\\Software\\Valve\\Steam\\SteamPath': 'c:/program files (x86)/steam' } }
}

function steamOptions(world: ReturnType<typeof steamWorld>) {
  return {
    platform: 'win32' as NodeJS.Platform,
    runRegQuery: async (key: string, value: string) => world.registry[`${key}\\${value}`] ?? null,
    readTextFile: async (path: string) => {
      const key = Object.keys(world.files).find((k) => k.toLowerCase() === path.toLowerCase())
      return key === undefined ? null : (world.files[key] ?? null)
    },
    dirExists: async (path: string) =>
      world.dirs.some((known) => known.toLowerCase() === path.toLowerCase())
  }
}

const GOG_ROOT = 'C:\\GOG Games\\Resident Evil'

function gogOptions(installed: boolean) {
  return {
    appDir: 'C:\\launcher',
    gogPathOverride: '',
    platform: 'win32' as NodeJS.Platform,
    // No registry, so the only GOG hit is the path this returns true for.
    runRegQuery: async () => null,
    pathExists: async (candidate: string) => installed && candidate.toLowerCase() === GOG_ROOT.toLowerCase()
  }
}

function seed(titleId: 're1' | 're2' | 're3', versionId: string): {
  title: GameTitleSeed
  version: GameVersionSeed
} {
  const title = findTitle(titleId)
  const version = findVersion(versionId)
  if (title === undefined || version === undefined) throw new Error(`no catalog row ${versionId}`)
  return { title, version }
}

describe('resolveVersionInstall', () => {
  it('prefers GOG when both stores have the title', async () => {
    const { title, version } = seed('re1', 're1_us')
    const world = steamWorld({ '4249100': [{ locale: 'english' }] })

    const install = await resolveVersionInstall(title, version, {
      appDir: 'C:\\launcher',
      gogPathOverride: '',
      platform: 'win32',
      gog: gogOptions(true),
      steam: steamOptions(world)
    })

    expect(install?.source).toBe('gog')
    expect(install?.path).toBe(GOG_ROOT)
    expect(install?.execRelPath).toBe('ResidentEvil.exe')
  })

  it('falls back to Steam, and puts each row in its own locale folder', async () => {
    const world = steamWorld({ '4249100': [{ locale: 'english' }, { locale: 'japanese' }] })
    const options = {
      appDir: 'C:\\launcher',
      gogPathOverride: '',
      platform: 'win32' as NodeJS.Platform,
      gog: gogOptions(false),
      steam: steamOptions(world)
    }

    const usSeed = seed('re1', 're1_us')
    const jpSeed = seed('re1', 're1_jp')
    const us = await resolveVersionInstall(usSeed.title, usSeed.version, options)
    const jp = await resolveVersionInstall(jpSeed.title, jpSeed.version, options)

    expect(us?.source).toBe('steam')
    expect(us?.path.endsWith('english')).toBe(true)
    expect(us?.execRelPath).toBe('ResidentEvil.exe')

    expect(jp?.source).toBe('steam')
    expect(jp?.path.endsWith('japanese')).toBe(true)
    // Not `ResidentEvil.exe`: the Japanese build is a separate executable.
    expect(jp?.execRelPath).toBe('Biohazard.exe')
  })

  it('returns null when the app is installed but this row is not localized into it', async () => {
    // Steam ships one app with several localizations, so finding the app says nothing
    // about whether this row's copy is present. A German-only install has no Japanese.
    const world = steamWorld({ '4249100': [{ locale: 'german' }] })
    const { title, version } = seed('re1', 're1_jp')

    const install = await resolveVersionInstall(title, version, {
      appDir: 'C:\\launcher',
      gogPathOverride: '',
      platform: 'win32',
      gog: gogOptions(false),
      steam: steamOptions(world)
    })

    expect(install).toBeNull()
  })

  it('returns null for a row no store has', async () => {
    const { title, version } = seed('re1', 're1_dc')
    const world = steamWorld({ '4249100': [{ locale: 'english' }] })

    // The Steam app is the 1996 original, so it has no Director's Cut row at all.
    expect(version.steam).toBeNull()
    const install = await resolveVersionInstall(title, version, {
      appDir: 'C:\\launcher',
      gogPathOverride: '',
      platform: 'win32',
      gog: gogOptions(false),
      steam: steamOptions(world)
    })
    expect(install).toBeNull()
  })

  it('returns null when neither store has anything', async () => {
    const { title, version } = seed('re2', 're2_leon_us')
    const install = await resolveVersionInstall(title, version, {
      appDir: 'C:\\launcher',
      gogPathOverride: '',
      platform: 'win32',
      gog: gogOptions(false),
      steam: steamOptions(steamWorld({}))
    })
    expect(install).toBeNull()
  })
})

describe('resolveTitleInstalls', () => {
  it('keys the result by row, so two rows can come from two folders', async () => {
    const world = steamWorld({ '4249110': [{ locale: 'english' }, { locale: 'japanese' }] })
    const title = findTitle('re2')
    if (title === undefined) throw new Error('no re2 title')

    const resolved = await resolveTitleInstalls(title, {
      appDir: 'C:\\launcher',
      gogPathOverride: '',
      platform: 'win32',
      gog: gogOptions(false),
      steam: steamOptions(world)
    })

    expect(resolved.get('re2_leon_us')?.path.endsWith('english')).toBe(true)
    expect(resolved.get('re2_jp')?.path.endsWith('japanese')).toBe(true)
    // The concept row is in no store.
    expect(resolved.has('re2_proto')).toBe(false)
  })
})

describe('retailExecutableFor', () => {
  const re2Us = seed('re2', 're2_leon_us').version
  const re2Jp = seed('re2', 're2_jp').version
  const re1Us = seed('re1', 're1_us').version

  it('routes an RE2 scenario to its own executable on a GOG install', () => {
    expect(retailExecutableFor(re2Us, 'gog', 'leon')).toBe('LeonU.exe')
    expect(retailExecutableFor(re2Us, 'gog', 'claire')).toBe('ClaireU.exe')
  })

  it('routes the same scenario to the Japanese build on a Steam install', () => {
    // This is the trap: the Steam Japanese copy names its executables `LeonJ` and
    // `ClaireJ`, so a resolver that always answered `LeonU` would probe for a file
    // that is not there and report a perfectly good install as missing.
    expect(retailExecutableFor(re2Jp, 'steam', 'leon')).toBe('LeonJ.exe')
    expect(retailExecutableFor(re2Jp, 'steam', 'claire')).toBe('ClaireJ.exe')
  })

  it('uses the catalog name for a row with no scenario', () => {
    expect(retailExecutableFor(re1Us, 'gog', null)).toBe('ResidentEvil.exe')
    expect(retailExecutableFor(re1Us, 'steam', null)).toBe('ResidentEvil.exe')
  })

  it('never answers with an empty name for a row that can be launched', () => {
    for (const title of TITLES) {
      for (const version of title.versions) {
        // A concept row has no executable anywhere - BIOHAZARD 1.5 was never
        // released - so it is exempt from an invariant about launchable rows.
        if (!version.launchable) continue
        for (const source of ['gog', 'steam', 'none'] as const) {
          for (const scenario of ['leon', 'claire', null] as const) {
            expect(
              retailExecutableFor(version, source, scenario),
              `${version.id} ${source} ${String(scenario)}`
            ).not.toBe('')
          }
        }
      }
    }
  })
})

/**
 * The whole chain against the real machine, with only GOG suppressed.
 *
 * `steam` is left un-injected, so this reads the real registry, the real
 * `libraryfolders.vdf` and the real app manifests; GOG is switched off by hand, which
 * is the one thing a test cannot do by uninstalling it. Skipped where Steam is not
 * installed, because "no Steam here" is not a defect.
 */
describe.skipIf(!existsSync('C:\\Program Files (x86)\\Steam'))('against the real Steam install', () => {
  const noGog = {
    appDir: 'C:\\launcher',
    gogPathOverride: '',
    platform: process.platform,
    gog: {
      appDir: 'C:\\launcher',
      gogPathOverride: '',
      platform: process.platform,
      runRegQuery: async () => null,
      pathExists: async () => false
    }
  }

  it('resolves RE1 US and RE1 JP out of their real locale folders', async () => {
    const us = seed('re1', 're1_us')
    const jp = seed('re1', 're1_jp')

    const usInstall = await resolveVersionInstall(us.title, us.version, noGog)
    const jpInstall = await resolveVersionInstall(jp.title, jp.version, noGog)

    expect(usInstall?.source).toBe('steam')
    expect(usInstall?.path.toLowerCase().endsWith('english')).toBe(true)
    expect(existsSync(join(usInstall?.path ?? '', 'ResidentEvil.exe'))).toBe(true)

    expect(jpInstall?.source).toBe('steam')
    expect(jpInstall?.path.toLowerCase().endsWith('japanese')).toBe(true)
    // The point of the whole exercise: the resolved file is really there.
    expect(existsSync(join(jpInstall?.path ?? '', 'Biohazard.exe'))).toBe(true)
  })

  it('resolves RE3 JP to the Japanese executable that is actually on disk', async () => {
    const re3 = seed('re3', 're3_jp')
    const install = await resolveVersionInstall(re3.title, re3.version, noGog)
    expect(install?.source).toBe('steam')
    expect(existsSync(join(install?.path ?? '', install?.execRelPath ?? ''))).toBe(true)
  })
})
