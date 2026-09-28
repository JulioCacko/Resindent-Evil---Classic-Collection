/**
 * Tests for the catalog join.
 *
 * The three catalog scenarios mirror the three states the Install Status screen
 * has to survive: a complete collection, a machine with nothing installed, and a
 * half-finished install. Detection, probing and mod availability are all faked so
 * the suite never touches the registry, the filesystem or `reenhancemods/`.
 *
 * `stateFromProbe` is *not* faked: it is the frozen 3-check rule from ./validate,
 * and the point of these tests is that the real rule composes with the join.
 */
import { describe, expect, it } from 'vitest'
import { TITLES } from '@shared/catalog'
import type {
  CatalogSnapshot,
  GameTitle,
  GameVersion,
  InstallState,
  LauncherConfig,
  TitleId
} from '@shared/types'
import type {
  CatalogBuildOptions,
  GogDetectionOptions,
  GogTitleRef,
  MainPaths,
  VersionProbe,
  VersionProbeInput
} from './contracts'
import { buildCatalogSnapshot, needsInstallScreen } from './catalog-state'

type DetectFn = NonNullable<CatalogBuildOptions['detect']>
type ProbeFn = NonNullable<CatalogBuildOptions['probe']>
type ModsFn = NonNullable<CatalogBuildOptions['modsAvailableFn']>

const PATHS: MainPaths = {
  appDir: 'C:\\GOG Games',
  configDir: 'C:\\Users\\tester\\AppData\\Roaming\\re-launcher',
  configPath: 'C:\\Users\\tester\\AppData\\Roaming\\re-launcher\\config.json',
  progressPath: 'C:\\Users\\tester\\AppData\\Roaming\\re-launcher\\progress.json',
  modsDir: 'C:\\GOG Games\\reenhancemods',
  assetsDir: 'C:\\Program Files\\RE Launcher\\assets',
  legacyConfigPath: 'C:\\GOG Games\\config.ini',
  legacyProgressPath: 'C:\\Users\\tester\\AppData\\Roaming\\re-launcher\\achievements.sav',
  isPackaged: false
}

const CONFIG: LauncherConfig = {
  crtEnabled: true,
  scanlineIntensity: 0.4,
  curvature: 0.2,
  crtVignette: 0.3,
  crtGrain: 0.12,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.6,
  lastSelectedTitle: 're1',
  modes: {},
  scenarios: {},
  launchWindowMode: 'minimise',
  inGameCrt: false,
    raUser: '',
    raKey: '',
  launchThroughSteam: false,
  raTicked: [],
  gogPathOverride: 'D:\\GOG Games',
  keepLauncherVisible: true
}

const INSTALL_ROOTS = {
  re1: 'C:\\GOG Games\\Resident Evil',
  re2: 'C:\\GOG Games\\Resident Evil 2',
  re3: 'C:\\GOG Games\\Resident Evil 3'
} satisfies Record<TitleId, string>

const RE1_MOD = 'RE-ENHANCE_RE1_v1.1_GOG'
const RE2_MOD = 'RE-ENHANCE_RE2_v2.0.1_GOG'
const RE3_MOD = 'RE-ENHANCE_RE3_v2.2_GOG'

/** The 8 rows the design lays out, in row order, from @shared/catalog's TITLES. */
const EXPECTED_ROW_IDS = [
  're1_us',
  're1_jp',
  're1_dc',
  're2_leon_us',
  're2_proto',
  're2_jp',
  're3_us',
  're3_jp'
]

/** `unavailableReason` of the BIOHAZARD 1.5 row (the one non-launchable row). */
const CONCEPT_REASON = 'CONCEPT — NEVER RELEASED'

const INSTALLED_PROBE: VersionProbe = { installOk: true, exeOk: true, dataOk: true, modOk: true }

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

function makeDetect(roots: Partial<Record<TitleId, string>>) {
  const calls: { titles: GogTitleRef[]; options: GogDetectionOptions }[] = []
  const detect: DetectFn = async (titles, options) => {
    calls.push({ titles, options })
    const found: Record<string, string> = {}
    for (const title of titles) {
      const root = roots[title.id]
      if (typeof root === 'string' && root !== '') found[title.id] = root
    }
    return found
  }
  return { detect, calls }
}

/** A probe that ignores the input and returns one fixed verdict. */
function makeStubProbe(result: VersionProbe) {
  const calls: VersionProbeInput[] = []
  const probe: ProbeFn = async (input) => {
    calls.push(input)
    return result
  }
  return { probe, calls }
}

interface FakeInstall {
  installed: boolean
  hasExecutable?: boolean
  hasGameData?: boolean
}

type FakeWorld = Partial<Record<TitleId, FakeInstall>>

/**
 * Emulates the legacy `InstallValidator::ValidateTitle` against a described fake
 * install: every check is gated on the install root, and the executable check
 * fails for a row with no `execRelPath` — which is how the concept row behaves.
 */
function makeValidatorProbe(world: FakeWorld) {
  const calls: VersionProbeInput[] = []
  const probe: ProbeFn = async (input) => {
    calls.push(input)
    const install = world[input.titleId]
    const installOk = input.installPath !== '' && install?.installed === true
    const exeOk = installOk && install?.hasExecutable === true && input.execRelPath !== ''
    const dataOk = installOk && install?.hasGameData === true
    const modOk = installOk && input.modPath !== ''
    return { installOk, exeOk, dataOk, modOk }
  }
  return { probe, calls }
}

function makeMods(available: string[]) {
  const calls: { modsDir: string; modPath: string }[] = []
  const modsAvailableFn: ModsFn = async (modsDir, modPath) => {
    calls.push({ modsDir, modPath })
    return available.includes(modPath)
  }
  return { modsAvailableFn, calls }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function rows(snapshot: CatalogSnapshot): GameVersion[] {
  return snapshot.titles.flatMap((title) => title.versions)
}

function rowIds(snapshot: CatalogSnapshot): string[] {
  return rows(snapshot).map((version) => version.id)
}

function rowStates(snapshot: CatalogSnapshot): InstallState[] {
  return rows(snapshot).map((version) => version.state)
}

function repeated(state: InstallState, count: number): InstallState[] {
  return Array.from({ length: count }, () => state)
}

function conceptRow(snapshot: CatalogSnapshot): GameVersion | undefined {
  return rows(snapshot).find((version) => version.id === 're2_proto')
}

/** A minimal title whose versions only carry install states, for the boot rule. */
function titleWithStates(states: InstallState[]): GameTitle {
  const seed = TITLES[0]
  return {
    id: seed.id,
    name: seed.name,
    cardAsset: seed.cardAsset,
    gogGameId: seed.gogGameId,
    gogFolderName: seed.gogFolderName,
    steamAppId: seed.steamAppId,
    installPath: INSTALL_ROOTS.re1,
    hasAnyInstalled: states.includes('installed'),
    versions: states.map((state, index) => ({
      ...seed.versions[0],
      id: `re1_row_${index}`,
      state,
      stateReason: null,
      modInstalled: false,
      hasMod: false,
      installSource: 'gog',
      installPath: INSTALL_ROOTS.re1
    }))
  }
}

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------

describe('buildCatalogSnapshot', () => {
  it('reports all 8 rows as installed when detection and probes succeed', async () => {
    const { detect, calls: detectCalls } = makeDetect(INSTALL_ROOTS)
    const { probe, calls: probeCalls } = makeStubProbe(INSTALLED_PROBE)
    const { modsAvailableFn, calls: modsCalls } = makeMods([RE1_MOD])

    const snapshot = await buildCatalogSnapshot({
      paths: PATHS,
      config: CONFIG,
      detect,
      probe,
      modsAvailableFn
    })

    expect(snapshot.titles.map((title) => title.id)).toEqual(['re1', 're2', 're3'])
    expect(rows(snapshot)).toHaveLength(8)
    expect(rowIds(snapshot)).toEqual(EXPECTED_ROW_IDS)
    expect(rowStates(snapshot)).toEqual(repeated('installed', 8))
    expect(snapshot.titles.every((title) => title.hasAnyInstalled)).toBe(true)
    expect(snapshot.needsInstallScreen).toBe(false)

    // Paths and config travel with the snapshot so the renderer needs no second call.
    expect(snapshot.config).toEqual(CONFIG)
    expect(snapshot.appDir).toBe(PATHS.appDir)
    expect(snapshot.configPath).toBe(PATHS.configPath)
    expect(snapshot.progressPath).toBe(PATHS.progressPath)

    // Installed rows are silent; the concept row always explains itself.
    const launchable = rows(snapshot).filter((version) => version.launchable)
    expect(launchable).toHaveLength(7)
    expect(launchable.every((version) => version.stateReason === null)).toBe(true)
    expect(conceptRow(snapshot)?.stateReason).toBe(CONCEPT_REASON)

    // Detection ran once, for every title at once, with the launcher's own paths.
    expect(detectCalls).toHaveLength(1)
    expect(detectCalls[0].titles.map((title) => title.id)).toEqual(['re1', 're2', 're3'])
    expect(detectCalls[0].titles.map((title) => title.gogGameId)).toEqual([
      '1580232252',
      '1534123252',
      '1266089300'
    ])
    expect(detectCalls[0].options).toEqual({
      appDir: PATHS.appDir,
      gogPathOverride: CONFIG.gogPathOverride,
      platform: process.platform
    })

    // One probe per row, carrying the resolved root and the row's own executable.
    expect(probeCalls).toHaveLength(8)
    const re1Jp = probeCalls.find((call) => call.titleId === 're1' && call.requiresMod)
    expect(re1Jp).toEqual({
      titleId: 're1',
      installPath: INSTALL_ROOTS.re1,
      execRelPath: 'ResidentEvil.exe',
      requiresMod: true,
      modPath: RE1_MOD,
      modsDir: PATHS.modsDir
    })
    const re2Proto = probeCalls.find((call) => call.execRelPath === '')
    expect(re2Proto).toEqual({
      titleId: 're2',
      installPath: INSTALL_ROOTS.re2,
      execRelPath: '',
      requiresMod: false,
      modPath: '',
      modsDir: PATHS.modsDir
    })

    // Only rows that declare a mod folder are asked about on disk: the 7 modded
    // rows are, the concept row is not.
    expect(modsCalls).toHaveLength(7)
    expect(modsCalls.every((call) => call.modsDir === PATHS.modsDir && call.modPath !== '')).toBe(true)
    expect(rows(snapshot).map((version) => [version.id, version.hasMod])).toEqual([
      ['re1_us', true],
      ['re1_jp', true],
      ['re1_dc', true],
      ['re2_leon_us', false],
      ['re2_proto', false],
      ['re2_jp', false],
      ['re3_us', false],
      ['re3_jp', false]
    ])
  })

  it('reports every row as missing and gates the boot screen when nothing is installed', async () => {
    const { detect, calls: detectCalls } = makeDetect({})
    const { probe } = makeValidatorProbe({})
    const { modsAvailableFn } = makeMods([])

    const snapshot = await buildCatalogSnapshot({
      paths: PATHS,
      config: CONFIG,
      detect,
      probe,
      modsAvailableFn
    })

    expect(rowIds(snapshot)).toEqual(EXPECTED_ROW_IDS)
    expect(rowStates(snapshot)).toEqual(repeated('missing', 8))
    expect(snapshot.needsInstallScreen).toBe(true)
    expect(snapshot.titles.every((title) => !title.hasAnyInstalled)).toBe(true)
    expect(snapshot.titles.map((title) => title.installPath)).toEqual(['', '', ''])

    // A missing root is the reported cause for every launchable row...
    const launchable = rows(snapshot).filter((version) => version.launchable)
    expect(launchable.every((version) => version.stateReason === 'Game folder not found')).toBe(true)
    // ...and the concept row still reports its own note instead.
    expect(conceptRow(snapshot)?.stateReason).toBe(CONCEPT_REASON)

    // Detection only ever ran once, even though every title came back empty.
    expect(detectCalls).toHaveLength(1)
  })

  it('keeps a partial install partial, with the failing check named', async () => {
    // RE1 is complete, RE2 exists but has lost its payload, RE3 was never found.
    const { detect } = makeDetect({ re1: INSTALL_ROOTS.re1, re2: INSTALL_ROOTS.re2 })
    const { probe } = makeValidatorProbe({
      re1: { installed: true, hasExecutable: true, hasGameData: true },
      re2: { installed: true, hasExecutable: true, hasGameData: false }
    })
    const { modsAvailableFn } = makeMods([RE1_MOD, RE2_MOD, RE3_MOD])

    const snapshot = await buildCatalogSnapshot({
      paths: PATHS,
      config: CONFIG,
      detect,
      probe,
      modsAvailableFn
    })

    expect(rowStates(snapshot)).toEqual([
      'installed',
      'installed',
      'installed',
      'partial',
      'partial',
      'partial',
      'missing',
      'missing'
    ])
    expect(rows(snapshot).map((version) => version.stateReason)).toEqual([
      null,
      null,
      null,
      'Game data incomplete',
      CONCEPT_REASON,
      'Game data incomplete',
      'Game folder not found',
      'Game folder not found'
    ])

    // Per-title rollup: only RE1 satisfies the boot gate, so Install Status opens.
    expect(snapshot.titles.map((title) => [title.id, title.hasAnyInstalled])).toEqual([
      ['re1', true],
      ['re2', false],
      ['re3', false]
    ])
    expect(snapshot.needsInstallScreen).toBe(true)

    // The concept row keeps the state the probe derived (it is not 'missing'),
    // while still reporting the concept note.
    const concept = conceptRow(snapshot)
    expect(concept?.state).toBe('partial')
    expect(concept?.launchable).toBe(false)
    expect(concept?.stateReason).toBe(CONCEPT_REASON)
    expect(concept?.hasMod).toBe(false)
  })

  it('degrades a throwing probe to missing instead of rejecting the snapshot', async () => {
    const { detect } = makeDetect(INSTALL_ROOTS)
    const probe: ProbeFn = async (input) => {
      if (input.titleId === 're2') throw new Error('RE2 install vanished during the probe')
      return INSTALLED_PROBE
    }
    const { modsAvailableFn, calls: modsCalls } = makeMods([RE1_MOD])

    const building = buildCatalogSnapshot({ paths: PATHS, config: CONFIG, detect, probe, modsAvailableFn })
    await expect(building).resolves.toBeDefined()
    const snapshot = await building

    expect(rowStates(snapshot)).toEqual([
      'installed',
      'installed',
      'installed',
      'missing',
      'missing',
      'missing',
      'installed',
      'installed'
    ])
    expect(rows(snapshot).map((version) => version.stateReason)).toEqual([
      null,
      null,
      null,
      'Install check failed',
      CONCEPT_REASON,
      'Install check failed',
      null,
      null
    ])
    // Only RE2 failed; the rest of the catalog is still reported accurately.
    expect(snapshot.titles.map((title) => title.hasAnyInstalled)).toEqual([true, false, true])
    expect(snapshot.needsInstallScreen).toBe(true)
    // Mod availability is resolved independently of the probe outcome.
    expect(modsCalls).toHaveLength(7)
    expect(rows(snapshot).map((version) => version.hasMod)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false
    ])
  })

  it('degrades a throwing detector to an empty detection map', async () => {
    const detect: DetectFn = async () => {
      throw new Error('registry unavailable')
    }
    const { probe } = makeValidatorProbe({ re1: { installed: true, hasExecutable: true, hasGameData: true } })
    const { modsAvailableFn } = makeMods([])

    const snapshot = await buildCatalogSnapshot({ paths: PATHS, config: CONFIG, detect, probe, modsAvailableFn })

    expect(snapshot.titles.map((title) => title.installPath)).toEqual(['', '', ''])
    expect(rowStates(snapshot)).toEqual(repeated('missing', 8))
    expect(snapshot.needsInstallScreen).toBe(true)
  })

  it('treats a throwing mod check as "no mod" rather than failing', async () => {
    const { detect } = makeDetect(INSTALL_ROOTS)
    const { probe } = makeStubProbe(INSTALLED_PROBE)
    const modsAvailableFn: ModsFn = async () => {
      throw new Error('reenhancemods is unreadable')
    }

    const snapshot = await buildCatalogSnapshot({
      paths: PATHS,
      config: CONFIG,
      detect,
      probe,
      modsAvailableFn
    })

    expect(rows(snapshot).every((version) => !version.hasMod)).toBe(true)
    expect(rowStates(snapshot)).toEqual(repeated('installed', 8))
  })

  it('accepts a detection map keyed by GOG game id as well as by title id', async () => {
    const detect: DetectFn = async () => ({ '1534123252': INSTALL_ROOTS.re2 })
    const { probe } = makeValidatorProbe({
      re2: { installed: true, hasExecutable: true, hasGameData: true }
    })
    const { modsAvailableFn } = makeMods([])

    const snapshot = await buildCatalogSnapshot({
      paths: PATHS,
      config: CONFIG,
      detect,
      probe,
      modsAvailableFn
    })

    expect(snapshot.titles.map((title) => [title.id, title.installPath])).toEqual([
      ['re1', ''],
      ['re2', INSTALL_ROOTS.re2],
      ['re3', '']
    ])
    // The GOG-id-keyed map drives real validation for RE2 and leaves the rest missing.
    expect(rowStates(snapshot)).toEqual([
      'missing',
      'missing',
      'missing',
      'installed',
      'partial',
      'installed',
      'missing',
      'missing'
    ])
  })
})

describe('needsInstallScreen', () => {
  it('is false only when every title has an installed version', () => {
    expect(needsInstallScreen([titleWithStates(['installed', 'installed'])])).toBe(false)
    // A partial sibling does not matter while one version is fully validated.
    expect(needsInstallScreen([titleWithStates(['installed', 'missing'])])).toBe(false)
    expect(
      needsInstallScreen([
        titleWithStates(['installed']),
        titleWithStates(['installed', 'partial']),
        titleWithStates(['installed'])
      ])
    ).toBe(false)
  })

  it('is true when any title has nothing installed, including partial-only titles', () => {
    // A partial install is launchable but must not satisfy the boot gate.
    expect(needsInstallScreen([titleWithStates(['partial'])])).toBe(true)
    expect(needsInstallScreen([titleWithStates(['missing', 'partial'])])).toBe(true)
    expect(needsInstallScreen([titleWithStates(['installed']), titleWithStates(['missing'])])).toBe(true)
    expect(needsInstallScreen([titleWithStates([])])).toBe(true)
    expect(needsInstallScreen([])).toBe(false)
  })
})
