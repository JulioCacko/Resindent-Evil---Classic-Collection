import { DEFAULT_BINDINGS } from '@shared/controls'
/**
 * config-store tests.
 *
 * Every test runs against a real temp directory rather than a mocked `node:fs`:
 * the store's whole job is deciding what to do with files that are missing,
 * truncated, hand-edited or unwritable, and a mocked filesystem would only prove
 * that the mock agrees with itself.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_TITLE_ID } from '@shared/catalog'
import type { LauncherConfig } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConfigStore, ConfigStoreOptions } from './contracts'
import { createConfigStore, defaultConfig, migrateLegacyConfig } from './config-store'

let dir = ''
let configPath = ''
let legacyConfigPath = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 're-config-store-'))
  configPath = join(dir, 'config.json')
  legacyConfigPath = join(dir, 'config.ini')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

/** Annotated so the contract itself is checked, not just the implementation. */
function makeStore(overrides: Partial<ConfigStoreOptions> = {}): ConfigStore {
  return createConfigStore({ configPath, legacyConfigPath, ...overrides })
}

async function writeLegacyIni(contents: string): Promise<void> {
  await writeFile(legacyConfigPath, contents, 'utf8')
}

/** The persisted document, deliberately typed `unknown` to assert on it raw. */
async function readStoredConfig(): Promise<unknown> {
  return JSON.parse(await readFile(configPath, 'utf8'))
}

async function writeStoredConfig(value: unknown): Promise<void> {
  await writeFile(configPath, JSON.stringify(value), 'utf8')
}

describe('defaultConfig', () => {
  it('returns the defaults the README documents for the legacy config.ini', () => {
    expect(defaultConfig()).toEqual({
      crtEnabled: false,
      scanlineIntensity: 0.3,
      curvature: 0.08,
      crtVignette: 0.35,
      crtGrain: 0.04,
      masterVolume: 1,
      sfxVolume: 1,
      musicVolume: 1,
      lastSelectedTitle: 're1',
      modes: {},
      scenarios: {},
      launchWindowMode: 'minimise',
      inGameCrt: false,
      inGameOverlay: true,
    raUser: '',
    raConfigured: false,
    keyBindings: structuredClone(DEFAULT_BINDINGS),
    onboardingComplete: false,
    launchThroughSteam: false,
    raTicked: [],
      gogPathOverride: '',
      keepLauncherVisible: true
    })
  })

  it('takes the default title from the catalog', () => {
    expect(defaultConfig().lastSelectedTitle).toBe(DEFAULT_TITLE_ID)
  })

  it('hands out an independent object (and independent maps) every call', () => {
    const first = defaultConfig()
    first.modes.re1_us = 'enhanced'
    first.masterVolume = 0.1
    expect(defaultConfig().modes).toEqual({})
    expect(defaultConfig().masterVolume).toBe(1)
  })
})

describe('load', () => {
  it('returns the defaults before the first load', () => {
    expect(makeStore().get()).toEqual(defaultConfig())
  })

  it('writes the defaults as JSON on a first run with no legacy config', async () => {
    const store = makeStore()
    expect(await store.load()).toEqual(defaultConfig())
    expect(existsSync(configPath)).toBe(true)
    expect(await readStoredConfig()).toEqual(defaultConfig())
  })

  it('fills missing keys from the defaults and drops malformed values', async () => {
    await writeStoredConfig({
      masterVolume: 0.5,
      lastSelectedTitle: 're3',
      // A valid entry survives a bogus sibling instead of discarding the map.
      modes: { re2_leon: 'enhanced', re3_us: 'turbo' },
      scenarios: 'not a map',
      crtEnabled: 'yes',
      scanlineIntensity: null,
      keepLauncherVisible: false
    })

    expect(await makeStore().load()).toEqual({
      ...defaultConfig(),
      masterVolume: 0.5,
      lastSelectedTitle: 're3',
      modes: { re2_leon: 'enhanced' },
      keepLauncherVisible: false
    })
  })

  it('falls back to the defaults for a truncated file, and repairs it', async () => {
    await writeFile(configPath, '{"crtEnabled": tru', 'utf8')
    const store = makeStore()
    expect(await store.load()).toEqual(defaultConfig())
    // The unusable file is replaced, which is also what makes the legacy
    // migration below happen exactly once.
    expect(await readStoredConfig()).toEqual(defaultConfig())
  })

  it('falls back to the defaults when the JSON is not an object', async () => {
    await writeFile(configPath, '[]', 'utf8')
    expect(await makeStore().load()).toEqual(defaultConfig())

    await writeFile(configPath, '"a string"', 'utf8')
    expect(await makeStore().load()).toEqual(defaultConfig())
  })

  it('rejects a title id the catalog does not know', async () => {
    await writeStoredConfig({ lastSelectedTitle: 're4' })
    expect((await makeStore().load()).lastSelectedTitle).toBe(DEFAULT_TITLE_ID)
  })

  it('reads the file once: later loads return the same config', async () => {
    await writeStoredConfig({ ...defaultConfig(), masterVolume: 0.4 })
    const store = makeStore()
    const first = await store.load()
    expect(first.masterVolume).toBe(0.4)

    // An external edit after the first load must not change the live config.
    await writeStoredConfig({ ...defaultConfig(), masterVolume: 0.9 })
    expect(await store.load()).toEqual(first)
  })
})

describe('legacy migration', () => {
  it('migrates a hand-written ini with section headers (the README layout)', async () => {
    await writeLegacyIni(
      [
        '# Resident Evil - Classic Collection',
        '',
        '[display]',
        'crt_enabled=1',
        'scanline_intensity=0.55',
        'curvature = 0.02',
        '',
        '[audio]',
        'master_volume=0.8',
        // `on` is not a number, so this volume keeps its default.
        'sfx_volume=on',
        '',
        '[game]',
        'last_selected=re2'
      ].join('\r\n')
    )

    const store = makeStore()
    const config = await store.load()
    expect(config).toEqual({
      ...defaultConfig(),
      crtEnabled: true,
      scanlineIntensity: 0.55,
      curvature: 0.02,
      masterVolume: 0.8,
      lastSelectedTitle: 're2'
    })
    expect(await readStoredConfig()).toEqual(config)
  })

  it('migrates a file written by the legacy Config::Save (dotted keys, no sections)', async () => {
    await writeLegacyIni(
      [
        'display.crt_enabled = false',
        'display.crt_vignette = 0.6',
        'audio.master_volume = 0.25',
        'game.last_selected = re3',
        // The one legacy key that has no section prefix (gog_detector.cpp).
        'gog_path_override = C:/GOG Games'
      ].join('\n')
    )

    const store = makeStore()
    const config = await store.load()
    expect(config.crtEnabled).toBe(false)
    expect(config.crtVignette).toBe(0.6)
    expect(config.masterVolume).toBe(0.25)
    expect(config.lastSelectedTitle).toBe('re3')
    expect(config.gogPathOverride).toBe('C:/GOG Games')
  })

  it('keeps the defaults when every legacy key is unknown', async () => {
    await writeLegacyIni('[nonsense]\nsomething_else=42\n')
    const store = makeStore()
    expect(await store.load()).toEqual(defaultConfig())
    expect(await readStoredConfig()).toEqual(defaultConfig())
  })

  it('runs the migration only once', async () => {
    await writeLegacyIni('[display]\ncrt_enabled=1\n')

    const firstReader = vi.fn(async () => ({ 'display.crt_enabled': '1' }))
    const storeA = makeStore({ readLegacy: firstReader })
    expect((await storeA.load()).crtEnabled).toBe(true)
    expect(firstReader).toHaveBeenCalledTimes(1)
    // A second load on the same store must not read the legacy file again.
    await storeA.load()
    expect(firstReader).toHaveBeenCalledTimes(1)

    // The ini is rewritten with different settings, but the JSON now exists, so a
    // fresh store reads the JSON and the legacy reader is never consulted.
    await writeLegacyIni('[display]\ncrt_enabled=0\n')
    const secondReader = vi.fn(async () => ({ 'display.crt_enabled': '0' }))
    const storeB = makeStore({ readLegacy: secondReader })
    expect((await storeB.load()).crtEnabled).toBe(true)
    expect(secondReader).not.toHaveBeenCalled()
  })

  it('survives a legacy reader that throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = makeStore({
      readLegacy: async () => {
        throw new Error('locked')
      }
    })
    expect(await store.load()).toEqual(defaultConfig())
    expect(warn).toHaveBeenCalled()
  })
})

describe('migrateLegacyConfig', () => {
  it('accepts dotted and bare spellings, coerces values and ignores unknown keys', () => {
    const migrated = migrateLegacyConfig(
      {
        'DISPLAY.CRT_ENABLED': 'ON',
        'display.crt_vignette': '0.5',
        // `strtof` accepted a numeric prefix, so this is 2.5 (GetFloat).
        crt_grain: '2.5%',
        'audio.master_volume': ' 0.4 ',
        // Not a key the store reads: bare keys are matched exactly, not by prefix.
        master_volume_extra: '0.9',
        last_selected: 'RE2',
        gog_path_override: '"D:/GOG Games"',
        keep_launcher_visible: '0',
        mystery_key: 'true'
      },
      defaultConfig()
    )

    expect(migrated).toEqual({
      ...defaultConfig(),
      crtEnabled: true,
      crtVignette: 0.5,
      crtGrain: 2.5,
      masterVolume: 0.4,
      lastSelectedTitle: 're2',
      gogPathOverride: 'D:/GOG Games',
      keepLauncherVisible: false
    })
  })

  it('keeps the base value when a recognised key cannot be parsed', () => {
    const base: LauncherConfig = {
      ...defaultConfig(),
      crtEnabled: true,
      masterVolume: 0.7,
      lastSelectedTitle: 're2'
    }
    const migrated = migrateLegacyConfig(
      {
        crt_enabled: 'maybe',
        master_volume: 'loud',
        sfx_volume: '',
        last_selected: 're4',
        last_selected_title: 're-none'
      },
      base
    )
    expect(migrated).toEqual(base)
  })

  it('does not alias or mutate the base config', () => {
    const base = defaultConfig()
    const snapshot: LauncherConfig = { ...base, modes: { ...base.modes } }
    const migrated = migrateLegacyConfig({ crt_enabled: '1' }, base)

    expect(base).toEqual(snapshot)
    expect(migrated.crtEnabled).toBe(true)
    expect(migrated.modes).not.toBe(base.modes)
    expect(migrated.scenarios).not.toBe(base.scenarios)
  })
})

describe('patch', () => {
  it('shallow-merges a patch and persists it', async () => {
    const store = makeStore()
    const after = await store.patch({ masterVolume: 0.25, crtEnabled: true })

    expect(after).toEqual({ ...defaultConfig(), masterVolume: 0.25, crtEnabled: true })
    expect(store.get()).toEqual(after)
    expect(await readStoredConfig()).toEqual(after)
  })

  it('round-trips through a new store reading the same file', async () => {
    const store = makeStore()
    await store.patch({ musicVolume: 0.5, modes: { re1_us: 'enhanced' } })

    expect(await makeStore().load()).toEqual(store.get())
  })

  it('replaces the whole map when the patch carries one (shallow merge)', async () => {
    const store = makeStore()
    await store.setMode('re1_us', 'enhanced')
    const after = await store.patch({ modes: { re1_jp: 'original' } })

    expect(after.modes).toEqual({ re1_jp: 'original' })
  })

  it('ignores a malformed value instead of writing it', async () => {
    const store = makeStore()
    await store.patch({ scanlineIntensity: 0.6 })
    const after = await store.patch({ scanlineIntensity: Number.NaN })

    expect(after.scanlineIntensity).toBe(0.6)
    expect(await readStoredConfig()).toEqual(after)
  })
})

describe('setMode / setScenario', () => {
  it('records one entry per version and keeps the others', async () => {
    const store = makeStore()
    await store.setMode('re1_us', 'enhanced')
    const afterMode = await store.setMode('re2_leon', 'original')
    expect(afterMode.modes).toEqual({ re1_us: 'enhanced', re2_leon: 'original' })

    const afterScenario = await store.setScenario('re2_leon', 'claire')
    expect(afterScenario.scenarios).toEqual({ re2_leon: 'claire' })
    expect(afterScenario.modes).toEqual({ re1_us: 'enhanced', re2_leon: 'original' })
    expect(await readStoredConfig()).toEqual(afterScenario)
  })

  it('no-ops on an empty version id', async () => {
    const store = makeStore()
    const after = await store.setMode('', 'enhanced')
    expect(after.modes).toEqual({})
  })
})

describe('reset', () => {
  it('restores the defaults and persists them', async () => {
    const store = makeStore()
    await store.patch({
      crtEnabled: true,
      masterVolume: 0.2,
      lastSelectedTitle: 're3',
      modes: { re1_us: 'enhanced' }
    })

    expect(await store.reset()).toEqual(defaultConfig())
    expect(store.get()).toEqual(defaultConfig())
    expect(await readStoredConfig()).toEqual(defaultConfig())
  })
})

describe('write resilience', () => {
  it('keeps the in-memory config when the config path cannot be written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    // A file where the config's parent directory should be: every read and write
    // under it fails with ENOTDIR/EEXIST, which is the unwritable-path case.
    const blocker = join(dir, 'blocker')
    await writeFile(blocker, 'not a directory', 'utf8')

    const store = createConfigStore({
      configPath: join(blocker, 'config.json'),
      legacyConfigPath: join(blocker, 'config.ini')
    })

    await expect(store.patch({ masterVolume: 0.5 })).rejects.toThrow('could not be saved')
    expect(store.get().masterVolume).toBe(1)
    expect(warn).toHaveBeenCalled()
  })
})
describe('the locally-ticked RetroAchievements list', () => {
  it('starts empty, so a new install has ticked nothing', async () => {
    expect((await makeStore().load()).raTicked).toEqual([])
  })

  it('round-trips ids through a new store reading the same file', async () => {
    await makeStore().patch({ raTicked: [469906, 84984] })
    expect((await makeStore().load()).raTicked).toEqual([469906, 84984])
  })

  it('drops duplicates, because a tick is a set', async () => {
    // The same id twice would make toggling it behave differently depending on which copy was
    // removed, which is the kind of bug nobody thinks to look for.
    await writeFile(configPath, JSON.stringify({ raTicked: [7, 7, 8, 7] }), 'utf8')
    expect((await makeStore().load()).raTicked).toEqual([7, 8])
  })

  it('drops anything that is not a finite number', async () => {
    await writeFile(configPath, JSON.stringify({ raTicked: [1, '2', null, true, 3] }), 'utf8')
    expect((await makeStore().load()).raTicked).toEqual([1, 3])
  })

  it('falls back to the default when the value is not an array at all', async () => {
    await writeFile(configPath, JSON.stringify({ raTicked: 'nope' }), 'utf8')
    expect((await makeStore().load()).raTicked).toEqual([])
  })
})

describe('secure credentials', () => {
  const secrets = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text.split('').reverse().join('')),
    decryptString: (data: Buffer) => data.toString().split('').reverse().join('')
  }
  it('migrates plaintext and never returns a key in public configuration', async () => {
    await writeStoredConfig({ raKey: 'private-test-value', raUser: 'player' })
    const store = makeStore({ secrets })
    const config = await store.load()
    expect(config.raConfigured).toBe(true)
    expect(JSON.stringify(config)).not.toContain('private-test-value')
    expect(await store.getCredential()).toBe('private-test-value')
    expect(await readFile(configPath, 'utf8')).not.toContain('private-test-value')
    expect(await makeStore({ secrets }).getCredential()).toBe('private-test-value')
    await store.patch({ masterVolume: 0.4 })
    expect(await makeStore({ secrets }).getCredential()).toBe('private-test-value')
    await store.setCredential('', '')
    expect(await store.getCredential()).toBe('')
    expect(store.get().raConfigured).toBe(false)
  })
  it('preserves the original document when encryption is unavailable', async () => {
    await writeStoredConfig({ raKey: 'keep-until-secure' })
    const store = makeStore({ secrets: { ...secrets, isEncryptionAvailable: () => false } })
    await expect(store.load()).rejects.toThrow('unavailable')
    expect(await readFile(configPath, 'utf8')).toContain('keep-until-secure')
  })
  it('serializes concurrent edits without losing fields or secrets', async () => {
    const store = makeStore({ secrets })
    await store.load()
    await Promise.all([store.patch({ masterVolume: 0.4 }), store.setMode('re1_us', 'enhanced'), store.setCredential('player', 'key')])
    const fresh = makeStore({ secrets })
    expect((await fresh.load()).masterVolume).toBe(0.4)
    expect(fresh.get().modes.re1_us).toBe('enhanced')
    expect(await fresh.getCredential()).toBe('key')
  })
})
