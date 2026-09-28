/**
 * Tests for launch preparation and process tracking.
 *
 * Two things are exercised with real files in a temp directory rather than with
 * mocks, because that is where the behaviour lives: whether the chosen executable
 * really exists on disk (the enhanced / retail / scenario picks), and whether
 * `config.ini` really ends up with the two `[DLL]` rows the RE-Enhance loader
 * reads. Those two cases go through the real `ini.ts` patcher, so a broken patcher
 * fails here instead of reaching the games.
 *
 * `spawn` is always replaced by a double that records its arguments and hands the
 * test the child's `exit` / `error` events, so nothing is ever started. The double
 * reports no pid, which is also what keeps `killGame()` from signalling a real
 * process: the frozen `LaunchDeps.spawn` makes `pid` optional, and a tracked game
 * with no pid is exactly the "nothing to signal" case.
 *
 * Every case registers an install-context resolver. The real one detects the
 * install root on this machine — which would patch the developer's own
 * `GOG Games/.../config.ini` as a test side effect — so the seam is used here for
 * isolation as well as for determinism. It also reports the row's install state
 * directly, which is why a fixture only needs the executable and the `config.ini`
 * the launch path itself touches: the `USA/` data probe is `validate.ts`'s
 * business, not `prepareLaunch`'s.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findVersion } from '@shared/catalog'
import type { GameVersionSeed } from '@shared/catalog'
import type { GameExitEvent, LaunchFailure, LaunchRequest, LaunchResult } from '@shared/types'

import type { LaunchDeps, PreparedLaunch } from './contracts'
import type { InstallContext } from './launch'
import {
  getGameStatus,
  killGame,
  onGameExit,
  performLaunch,
  prepareLaunch,
  setInstallContextResolver,
  setLaunchDeps
} from './launch'

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** Retail RE1 executable, spelled as the catalog spells it. */
const RETAIL_EXECUTABLE = 'ResidentEvil.exe'
/** RE-Enhance RE1 executable (README, "RE-Enhance Mod Executables"). */
const MOD_EXECUTABLE = 'Biohazard.exe'
const CONFIG_INI = 'config.ini'

/**
 * A `config.ini` shaped like the retail one (`GOG Games/Resident Evil/config.ini`),
 * CRLF endings included. `JapaneseEnable` starts at 1 so that writing 0 is an
 * observable change, and `Play_Number` is there to prove the other rows survive.
 */
const CONFIG_INI_FIXTURE = [
  '[RE1]',
  'Play_Number = 16',
  '',
  '[DLL]',
  'JapaneseEnable = 1',
  'BootConfig = 1',
  ''
].join('\r\n')

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

let sandbox = ''
/** The install root, with the space the real GOG folder names have. */
let installDir = ''

async function installExecutable(name: string): Promise<void> {
  await writeFile(join(installDir, name), 'stub-executable', 'utf8')
}

async function writeConfigIni(contents: string = CONFIG_INI_FIXTURE): Promise<void> {
  await writeFile(join(installDir, CONFIG_INI), contents, 'utf8')
}

async function readConfigIni(): Promise<string> {
  return await readFile(join(installDir, CONFIG_INI), 'utf8')
}

/** Value of one `key = value` row, with the case folding `ini.ts` matches with. */
function readIniValue(contents: string, key: string): string | null {
  const wanted = key.toLowerCase()
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith(';') || trimmed.startsWith('#')) continue
    const equals = trimmed.indexOf('=')
    if (equals < 0) continue
    if (trimmed.slice(0, equals).trim().toLowerCase() !== wanted) continue
    return trimmed.slice(equals + 1).trim()
  }
  return null
}

// ---------------------------------------------------------------------------
// seams
// ---------------------------------------------------------------------------

type SpawnFn = NonNullable<LaunchDeps['spawn']>
type SpawnOptions = Parameters<SpawnFn>[2]

interface SpawnCall {
  executable: string
  args: string[]
  options: SpawnOptions
}

interface FakeSpawn {
  spawn: SpawnFn
  calls: SpawnCall[]
  emit(event: string, ...args: unknown[]): void
}

/**
 * Records what it was asked to run and lets the test play the child's events.
 *
 * pid defaults to none, which is what keeps `killGame` from signalling anything real: a
 * test that wants the kill path passes a pid and injects `LaunchDeps.kill`.
 */
function createFakeSpawn(pid?: number): FakeSpawn {
  const calls: SpawnCall[] = []
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  const spawn: SpawnFn = (executable, args, options) => {
    calls.push({ executable, args, options })
    return {
      pid,
      on: (event, listener) => {
        const registered = listeners.get(event)
        if (registered === undefined) listeners.set(event, [listener])
        else registered.push(listener)
      }
    }
  }

  return {
    spawn,
    calls,
    emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    }
  }
}

/** Resolvers and exit subscriptions are torn down by `afterEach`. */
function useInstallContext(overrides: Partial<InstallContext>): void {
  setInstallContextResolver(async () => ({
    installPath: installDir,
    // The fixture install is a GOG one: its executables sat in the root, which is
    // why `execRelPath` is the catalog's own name and not a locale-folder path.
    source: 'gog',
    execRelPath: 'ResidentEvil.exe',
    state: 'installed',
    stateReason: null,
    hasMod: false,
    modInstalled: false,
    ...overrides
  }))
}

const activeSubscriptions: Array<() => void> = []

function subscribeToExits(events: GameExitEvent[]): void {
  activeSubscriptions.push(onGameExit((event) => events.push(event)))
}

interface PatchCall {
  filePath: string
  section: string
  key: string
  value: string
}

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 're-launch-'))
  installDir = join(sandbox, 'Resident Evil')
  await mkdir(installDir, { recursive: true })
})

afterEach(async () => {
  for (const unsubscribe of activeSubscriptions.splice(0)) unsubscribe()
  killGame()
  setLaunchDeps(null)
  setInstallContextResolver(null)
  await rm(sandbox, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// request and result helpers
// ---------------------------------------------------------------------------

function requireSeed(id: string): GameVersionSeed {
  const seed = findVersion(id)
  if (seed === undefined) throw new Error(`@shared/catalog has no row "${id}"`)
  return seed
}

function request(versionId: string, overrides: Partial<LaunchRequest> = {}): LaunchRequest {
  const seed = requireSeed(versionId)
  return { titleId: seed.titleId, versionId, mode: 'original', scenario: null, ...overrides }
}

type PrepareResult = Awaited<ReturnType<typeof prepareLaunch>>

function expectPrepared(result: PrepareResult): PreparedLaunch {
  if (!result.ok) throw new Error(`expected a prepared launch, got ${result.code}: ${result.message}`)
  return result.prepared
}

function expectPrepareFailure(result: PrepareResult): { code: LaunchFailure; message: string } {
  if (result.ok) throw new Error(`expected a failure, got ${result.prepared.executable}`)
  return { code: result.code, message: result.message }
}

function expectLaunched(result: LaunchResult): { pid: number; executable: string; injectedMod: boolean } {
  if (!result.ok) throw new Error(`expected a launch, got ${result.code}: ${result.message}`)
  return result
}

function expectLaunchFailure(result: LaunchResult): LaunchFailure {
  if (result.ok) throw new Error(`expected a failure, got pid ${result.pid}`)
  return result.code
}

// ---------------------------------------------------------------------------
// prepareLaunch
// ---------------------------------------------------------------------------

describe('prepareLaunch', () => {
  it('rejects a concept row with its own unavailable reason', async () => {
    useInstallContext({})

    const failure = expectPrepareFailure(await prepareLaunch(request('re2_proto')))

    expect(failure.code).toBe('not-launchable')
    expect(failure.message).toBe('CONCEPT — NEVER RELEASED')
  })

  it('rejects a version id that is not in the catalog', async () => {
    useInstallContext({})
    const unknown: LaunchRequest = {
      titleId: 're1',
      versionId: 're9_us',
      mode: 'original',
      scenario: null
    }

    expect(expectPrepareFailure(await prepareLaunch(unknown)).code).toBe('not-launchable')
  })

  it('rejects a version id paired with another title', async () => {
    useInstallContext({})
    const mismatched: LaunchRequest = {
      titleId: 're1',
      versionId: 're2_leon_us',
      mode: 'original',
      scenario: null
    }

    expect(expectPrepareFailure(await prepareLaunch(mismatched)).code).toBe('not-launchable')
  })

  it('rejects an empty install path and a missing install state', async () => {
    await installExecutable(RETAIL_EXECUTABLE)

    useInstallContext({ installPath: '' })
    expect(expectPrepareFailure(await prepareLaunch(request('re1_us'))).code).toBe('not-installed')

    useInstallContext({ state: 'missing', stateReason: 'Game folder not found' })
    const missing = expectPrepareFailure(await prepareLaunch(request('re1_us')))
    expect(missing.code).toBe('not-installed')
    expect(missing.message).toBe('Game folder not found')
  })

  it('accepts a partial install, exactly like the renderer canLaunch does', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    useInstallContext({ state: 'partial' })

    const prepared = expectPrepared(await prepareLaunch(request('re1_us')))

    expect(prepared.version.state).toBe('partial')
  })

  it('resolves the catalog row before asking for its install state', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    const seen: string[] = []
    setInstallContextResolver(async (version) => {
      seen.push(version.id)
      return {
        installPath: installDir,
        source: 'gog',
        execRelPath: 'ResidentEvil.exe',
        state: 'installed',
        stateReason: null,
        hasMod: false,
        modInstalled: false
      }
    })

    const prepared = expectPrepared(await prepareLaunch(request('re1_us')))

    expect(seen).toEqual(['re1_us'])
    expect(prepared.version.displayName).toBe('RESIDENT EVIL')
    expect(prepared.version.row).toBe(0)
  })

  it('runs the RE-Enhance executable in enhanced mode', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    await installExecutable(MOD_EXECUTABLE)
    useInstallContext({ hasMod: true })

    const prepared = expectPrepared(await prepareLaunch(request('re1_us', { mode: 'enhanced' })))

    expect(prepared.executable).toBe(join(installDir, MOD_EXECUTABLE))
    expect(prepared.mode).toBe('enhanced')
    expect(prepared.cwd).toBe(installDir)
    expect(prepared.version.hasMod).toBe(true)
  })

  it('runs the retail executable in original mode, even when RE-Enhance is available', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    await installExecutable(MOD_EXECUTABLE)
    useInstallContext({ hasMod: true })

    const prepared = expectPrepared(await prepareLaunch(request('re1_us', { mode: 'original' })))

    expect(prepared.executable).toBe(join(installDir, RETAIL_EXECUTABLE))
    expect(prepared.mode).toBe('original')
  })

  it('falls back to the retail executable when the overlay is not available', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    await installExecutable(MOD_EXECUTABLE)
    useInstallContext({ hasMod: false })

    const prepared = expectPrepared(await prepareLaunch(request('re1_us', { mode: 'enhanced' })))

    expect(prepared.executable).toBe(join(installDir, RETAIL_EXECUTABLE))
  })

  it('falls back to the retail executable when the mod executable is not on disk', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    useInstallContext({ hasMod: true })

    const prepared = expectPrepared(await prepareLaunch(request('re1_us', { mode: 'enhanced' })))

    expect(prepared.executable).toBe(join(installDir, RETAIL_EXECUTABLE))
  })

  it('rejects a missing executable', async () => {
    useInstallContext({})

    const failure = expectPrepareFailure(await prepareLaunch(request('re1_us')))

    expect(failure.code).toBe('executable-missing')
    expect(failure.message).toContain(RETAIL_EXECUTABLE)
  })

  it('uses the chosen RE2 player executable in original mode', async () => {
    await installExecutable('LeonU.exe')
    await installExecutable('ClaireU.exe')
    await installExecutable('Resident Evil 2.exe')
    useInstallContext({ hasMod: true })

    const claire = expectPrepared(
      await prepareLaunch(request('re2_leon_us', { mode: 'original', scenario: 'claire' }))
    )
    expect(claire.executable).toBe(join(installDir, 'ClaireU.exe'))
    expect(claire.scenario).toBe('claire')

    const leon = expectPrepared(await prepareLaunch(request('re2_leon_us', { mode: 'original' })))
    expect(leon.executable).toBe(join(installDir, 'LeonU.exe'))
    // The request carried no scenario, so the row's default player is used.
    expect(leon.scenario).toBe('leon')
  })

  it('keeps the RE-Enhance loader as the RE2 executable in enhanced mode', async () => {
    await installExecutable('LeonU.exe')
    await installExecutable('ClaireU.exe')
    await installExecutable('Resident Evil 2.exe')
    useInstallContext({ hasMod: true })

    const prepared = expectPrepared(
      await prepareLaunch(request('re2_leon_us', { mode: 'enhanced', scenario: 'claire' }))
    )

    // RE-Enhance boots its own loader, so the player cannot be encoded in the file
    // name; the choice is still carried in the prepared launch.
    expect(prepared.executable).toBe(join(installDir, 'Resident Evil 2.exe'))
    expect(prepared.scenario).toBe('claire')
  })

  it('ignores a scenario on a row that has none', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    useInstallContext({})

    const prepared = expectPrepared(await prepareLaunch(request('re1_us', { scenario: 'claire' })))

    expect(prepared.scenario).toBeNull()
    expect(prepared.executable).toBe(join(installDir, RETAIL_EXECUTABLE))
  })

  it('patches BootConfig and JapaneseEnable into the game config.ini', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    await writeConfigIni()
    useInstallContext({})

    expectPrepared(await prepareLaunch(request('re1_jp')))
    const japaneseRow = await readConfigIni()
    expect(readIniValue(japaneseRow, 'BootConfig')).toBe('0')
    expect(readIniValue(japaneseRow, 'JapaneseEnable')).toBe('1')
    // The rows the patch did not target are untouched.
    expect(readIniValue(japaneseRow, 'Play_Number')).toBe('16')

    expectPrepared(await prepareLaunch(request('re1_us')))
    const englishRow = await readConfigIni()
    expect(readIniValue(englishRow, 'JapaneseEnable')).toBe('0')
    expect(readIniValue(englishRow, 'BootConfig')).toBe('0')
  })

  it('asks the config patcher for the [DLL] rows, in order, and adds the CRT row when asked', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    const calls: PatchCall[] = []
    setLaunchDeps({
      patchConfig: async (filePath, section, key, value) => {
        calls.push({ filePath, section, key, value })
        return true
      },
      // Injected, so this test does not read the developer's own settings file.
      inGameCrt: true
    })
    useInstallContext({})

    expectPrepared(await prepareLaunch(request('re1_jp')))

    expect(calls).toEqual([
      { filePath: join(installDir, CONFIG_INI), section: 'DLL', key: 'BootConfig', value: '0' },
      { filePath: join(installDir, CONFIG_INI), section: 'DLL', key: 'JapaneseEnable', value: '1' },
      // The in-game CRT, from the same `[DLL]` block. No dgVoodoo row: this fixture install
      // has no `dgVoodoo.conf`, and the patch is skipped rather than invented.
      { filePath: join(installDir, CONFIG_INI), section: 'DLL', key: 'RetroMode', value: '1' }
    ])
  })

  it('turns the in-game CRT off by writing the payloads own defaults back', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    // A fixture install that also has dgVoodoo's file, which only the RE1 payload ships.
    await writeFile(
      join(installDir, 'dgVoodoo.conf'),
      '[General]\nScalingMode = stretched_4_3_crt\n',
      'utf8'
    )
    const calls: PatchCall[] = []
    setLaunchDeps({
      patchConfig: async (filePath, section, key, value) => {
        calls.push({ filePath, section, key, value })
        return true
      },
      inGameCrt: false
    })
    useInstallContext({})

    expectPrepared(await prepareLaunch(request('re1_us')))

    const crtCalls = calls.filter((call) => call.key === 'RetroMode' || call.key === 'ScalingMode')
    expect(crtCalls).toEqual([
      { filePath: join(installDir, CONFIG_INI), section: 'DLL', key: 'RetroMode', value: '0' },
      // `centered` is what the payload itself ships, so "off" restores the mod's own default
      // rather than inventing one.
      {
        filePath: join(installDir, 'dgVoodoo.conf'),
        section: 'General',
        key: 'ScalingMode',
        value: 'centered'
      }
    ])
  })

  it('reports config-unwritable when the config cannot be patched', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    setLaunchDeps({ patchConfig: async () => false })
    useInstallContext({})

    const failure = expectPrepareFailure(await prepareLaunch(request('re1_us')))

    expect(failure.code).toBe('config-unwritable')
    expect(failure.message).toContain(CONFIG_INI)
  })

  it('refuses to prepare while a game is running', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    useInstallContext({})
    const prepared = expectPrepared(await prepareLaunch(request('re1_us')))
    const fake = createFakeSpawn()
    expectLaunched(await performLaunch(prepared, { spawn: fake.spawn }))

    const failure = expectPrepareFailure(await prepareLaunch(request('re1_us')))

    expect(failure.code).toBe('game-already-running')
  })
})

// ---------------------------------------------------------------------------
// performLaunch / killGame / getGameStatus / onGameExit
// ---------------------------------------------------------------------------

describe('performLaunch', () => {
  it('starts the executable as an argument array with the install root as cwd', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    await installExecutable(MOD_EXECUTABLE)
    useInstallContext({ hasMod: true })
    const prepared = expectPrepared(await prepareLaunch(request('re1_us', { mode: 'enhanced' })))
    const fake = createFakeSpawn()

    const result = expectLaunched(await performLaunch(prepared, { spawn: fake.spawn }))

    expect(fake.calls).toHaveLength(1)
    const call = fake.calls[0]
    expect(call.executable).toBe(join(installDir, MOD_EXECUTABLE))
    // An argument array and no shell: a name like `BIOHAZARD(R) 3 PC.exe` would be
    // a syntax error through a shell, and quoting is the caller's problem there.
    expect(call.args).toEqual([])
    expect('shell' in call.options).toBe(false)
    expect(call.options).toEqual({
      cwd: installDir,
      detached: false,
      windowsHide: false,
      stdio: 'ignore'
    })
    expect(result.executable).toBe(join(installDir, MOD_EXECUTABLE))
    expect(result.injectedMod).toBe(true)
  })

  it('reports a launch without the overlay as an un-modded run', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    await installExecutable(MOD_EXECUTABLE)
    useInstallContext({ hasMod: true })
    const prepared = expectPrepared(await prepareLaunch(request('re1_us', { mode: 'original' })))
    const fake = createFakeSpawn()

    const result = expectLaunched(await performLaunch(prepared, { spawn: fake.spawn }))

    expect(fake.calls[0].executable).toBe(join(installDir, RETAIL_EXECUTABLE))
    expect(result.injectedMod).toBe(false)
  })

  it('reports the exit code through onGameExit', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    useInstallContext({})
    const prepared = expectPrepared(await prepareLaunch(request('re1_us')))
    const fake = createFakeSpawn()
    const events: GameExitEvent[] = []
    subscribeToExits(events)

    expectLaunched(await performLaunch(prepared, { spawn: fake.spawn }))
    // While it runs, no exit code is known yet (the legacy `g_exitValid` rule).
    expect(getGameStatus()).toMatchObject({
      running: true,
      titleId: 're1',
      versionId: 're1_us',
      exitCode: null
    })

    fake.emit('exit', 3, null)

    expect(events).toEqual([
      { titleId: 're1', versionId: 're1_us', exitCode: 3, signal: null, requested: false }
    ])
    expect(getGameStatus()).toMatchObject({
      running: false,
      titleId: null,
      versionId: null,
      exitCode: 3
    })
  })

  it('treats a failed spawn as an exit with no code', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    useInstallContext({})
    const prepared = expectPrepared(await prepareLaunch(request('re1_us')))
    const fake = createFakeSpawn()
    const events: GameExitEvent[] = []
    subscribeToExits(events)

    expectLaunched(await performLaunch(prepared, { spawn: fake.spawn }))
    fake.emit('error', new Error('spawn ENOENT'))

    expect(events).toEqual([
      { titleId: 're1', versionId: 're1_us', exitCode: null, signal: null, requested: false }
    ])
    expect(getGameStatus().running).toBe(false)
  })

  it('reports a spawn that fails synchronously as spawn-failed', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    useInstallContext({})
    const prepared = expectPrepared(await prepareLaunch(request('re1_us')))
    const spawn: SpawnFn = () => {
      throw new Error('EACCES')
    }

    const result = await performLaunch(prepared, { spawn })

    expect(expectLaunchFailure(result)).toBe('spawn-failed')
    expect(getGameStatus().running).toBe(false)
  })

  it('refuses a second game while one is running', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    useInstallContext({})
    const prepared = expectPrepared(await prepareLaunch(request('re1_us')))
    const fake = createFakeSpawn()
    expectLaunched(await performLaunch(prepared, { spawn: fake.spawn }))

    expect(expectLaunchFailure(await performLaunch(prepared, { spawn: fake.spawn }))).toBe(
      'game-already-running'
    )
    // Nothing was started the second time.
    expect(fake.calls).toHaveLength(1)

    // Once it exits, the slot is free again.
    fake.emit('exit', 0, null)
    expectLaunched(await performLaunch(prepared, { spawn: createFakeSpawn().spawn }))
  })

  it('tells the listeners once, whatever the child reports', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    useInstallContext({})
    const prepared = expectPrepared(await prepareLaunch(request('re1_us')))
    const fake = createFakeSpawn()
    const events: GameExitEvent[] = []
    subscribeToExits(events)

    expectLaunched(await performLaunch(prepared, { spawn: fake.spawn }))
    fake.emit('exit', 1, null)
    fake.emit('error', new Error('late error'))
    fake.emit('exit', 2, null)

    expect(events).toHaveLength(1)
    expect(events[0].exitCode).toBe(1)
  })

  it('clears the tracked process when it is killed, and still reports the exit', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    useInstallContext({})
    const prepared = expectPrepared(await prepareLaunch(request('re1_us')))
    const fake = createFakeSpawn(4242)
    const events: GameExitEvent[] = []
    subscribeToExits(events)
    expectLaunched(await performLaunch(prepared, { spawn: fake.spawn }))

    // The kill is injected: this test is about who is recorded as having ended the game,
    // and signalling a real pid would be a very bad way to find that out.
    const killed: number[] = []
    killGame({ kill: (pid) => killed.push(pid) })
    expect(killed, 'the kill was handed the spawned pid').toEqual([4242])

    expect(getGameStatus()).toMatchObject({ running: false, titleId: null, versionId: null })

    // The killed child still reports its own exit; the slot is already free. `requested`
    // is what keeps that exit from being reported to the user as a crash: `taskkill /F`
    // kills with a non-zero code, so without it the launcher would tell the user its own
    // deliberate stop was "stopped unexpectedly".
    fake.emit('exit', 1, null)
    expect(events).toEqual([
      { titleId: 're1', versionId: 're1_us', exitCode: 1, signal: null, requested: true }
    ])
    expect(getGameStatus().running).toBe(false)

    // And a new launch is allowed immediately.
    const next = createFakeSpawn()
    expectLaunched(await performLaunch(prepared, { spawn: next.spawn }))
    expect(next.calls).toHaveLength(1)

    // The request is consumed by that one exit: this game's own end is not the launcher's
    // doing, and must be reported as it is.
    next.emit('exit', 0, null)
    expect(events).toHaveLength(2)
    expect(events[1]?.requested, 'a fresh exit is not a requested stop').toBe(false)
  })
})

describe('onGameExit', () => {
  it('stops reporting after the listener unsubscribes', async () => {
    await installExecutable(RETAIL_EXECUTABLE)
    useInstallContext({})
    const prepared = expectPrepared(await prepareLaunch(request('re1_us')))
    const fake = createFakeSpawn()
    const events: GameExitEvent[] = []
    const unsubscribe = onGameExit((event) => events.push(event))

    expectLaunched(await performLaunch(prepared, { spawn: fake.spawn }))
    unsubscribe()
    fake.emit('exit', 0, null)

    expect(events).toEqual([])
  })
})
