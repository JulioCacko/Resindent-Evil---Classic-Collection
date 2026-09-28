/**
 * Live launch smoke test: starts a real game.
 *
 * This is the one spec that is NOT hermetic and is therefore opt-in. Every other
 * spec replaces the main process's `launch` handler so no test can start an
 * executable, and points the app at a throwaway fixture; this one deliberately does
 * neither, because its whole purpose is to prove the chain that only a real install
 * can exercise: catalog -> launch panel -> IPC -> mod injection -> config.ini patch
 * -> process spawn -> exit tracking -> kill on quit.
 *
 * Run it explicitly:
 *
 *     pnpm compile
 *     $env:RE_LIVE_LAUNCH = '1'; npx playwright test tests/e2e/live-launch.spec.ts
 *
 * It launches the app with the real application directory, so it sees the actual
 * `GOG Games/` and `reenhancemods/` folders, writes to the real config and patches
 * the real game's `config.ini` - exactly what launching from the UI does. It leaves
 * the game stopped and reports what it changed.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { describe, press, probe } from './electron-app'

const run = promisify(execFile)
const repoRoot = process.cwd()
const MAIN_ENTRY = 'out/main/index.js'

/** The row this spec drives. RE1 US, because its mod folder and backup both exist. */
const TARGET_VERSION = 're1_us'

interface RowSummary {
  readonly id: string
  readonly titleId: string
  readonly state: string
  readonly hasMod: boolean
  readonly modInstalled: boolean
  readonly execRelPath: string
  readonly modExecRelPath: string
  readonly japaneseMode: boolean
}

interface Snapshot {
  readonly titles: { id: string; installPath: string; versions: RowSummary[] }[]
  readonly appDir: string
  readonly config: { modes: Record<string, string>; lastSelectedTitle: string }
}

let app: ElectronApplication | undefined
let page: Page | undefined

/** Every process this spec started, so `finally` can make sure none survives. */
const startedImages = new Set<string>()

/** Reads the two `[DLL]` values the launcher owns, as raw lines. */
async function readDllSection(installPath: string): Promise<Record<string, string>> {
  try {
    const text = await readFile(join(installPath, 'config.ini'), 'latin1')
    const found: Record<string, string> = {}
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(BootConfig|JapaneseEnable)\s*=\s*(.*?)\s*$/i.exec(line)
      if (match !== null && match[1] !== undefined && match[2] !== undefined) {
        found[match[1]] = match[2]
      }
    }
    return found
  } catch (error) {
    return { readError: String(error) }
  }
}

async function isImageRunning(image: string): Promise<boolean> {
  try {
    const { stdout } = await run('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'])
    return stdout.toLowerCase().includes(image.toLowerCase())
  } catch {
    return false
  }
}

test.describe('live launch', () => {
  test.skip(
    process.env.RE_LIVE_LAUNCH !== '1',
    'starts a real game: set RE_LIVE_LAUNCH=1 to opt in'
  )

  test.afterAll(async () => {
    // Belt and braces: the launcher kills its child on quit, but a failure in the
    // middle of this spec must not leave a game running on someone's desktop.
    for (const image of startedImages) {
      if (await isImageRunning(image)) {
        await run('taskkill', ['/IM', image, '/T', '/F']).catch(() => undefined)
      }
    }
    if (app !== undefined) await app.close().catch(() => undefined)
  })

  test('a real row launches: injected mod, patched config, a live process, then a clean kill', async ({}, testInfo) => {
    // 1. The app runs against the REAL application directory, so the real installs
    //    are what this test talks to. No fixture and no stubbed launch handler. Its
    //    *profile* is redirected to a throwaway directory, though: the spec must be
    //    repeatable, and a launch mode left behind by a previous run would otherwise
    //    decide what this one asserts. `src/main/paths.ts` separates the two, so the
    //    real `GOG Games/` and `reenhancemods/` are still what gets probed.
    const profileDir = await mkdtemp(join(tmpdir(), 're-classic-live-'))
    app = await electron.launch({
      args: [MAIN_ENTRY],
      cwd: repoRoot,
      env: { ...process.env, RE_TEST_CONFIG_DIR: profileDir } as Record<string, string>
    })
    page = await app.firstWindow()
    const diagnostics: string[] = []
    // The main process's own output: warnings from the config store (a rejected or
    // failed write) and the temporary `RE_DIAG` traces only appear here.
    app.process().stdout?.on('data', (chunk: Buffer) => diagnostics.push(`OUT ${String(chunk).trim()}`))
    app.process().stderr?.on('data', (chunk: Buffer) => diagnostics.push(`ERR ${String(chunk).trim()}`))
    page.on('console', (message) => {
      const text = message.text()
      if (text.includes('RE_DIAG')) diagnostics.push(text)
    })
    await page.waitForSelector('[data-figma-node="stage"]', { timeout: 30_000 })
    await page.locator('[data-figma-node="main-menu"]').first().waitFor({ timeout: 30_000 })

    const snapshot = await page.evaluate<Snapshot>(async () => {
      const bridge = window.reLauncher
      if (bridge === undefined) throw new Error('window.reLauncher is missing')
      return (await bridge.invoke('catalog:get', undefined)) as Snapshot
    })

    const title = snapshot.titles.find((candidate) =>
      candidate.versions.some((version) => version.id === TARGET_VERSION)
    )
    const row = title?.versions.find((version) => version.id === TARGET_VERSION)
    expect(title, `the catalog knows ${TARGET_VERSION}`).toBeDefined()
    expect(row, `the catalog has a row for ${TARGET_VERSION}`).toBeDefined()
    if (title === undefined || row === undefined) return

    testInfo.annotations.push({
      type: 'live-row',
      description: JSON.stringify({
        appDir: snapshot.appDir,
        installPath: title.installPath,
        storedModes: snapshot.config.modes,
        lastSelectedTitle: snapshot.config.lastSelectedTitle,
        ...row
      })
    })

    // 2. A real install is a precondition, not something to simulate. `partial` is
    //    accepted because that is what `canLaunch` accepts.
    test.skip(
      title.installPath === '' || (row.state !== 'installed' && row.state !== 'partial'),
      `no usable ${TARGET_VERSION} install: state=${row.state} path="${title.installPath}"`
    )

    const before = await readDllSection(title.installPath)
    const expectedMode = row.modInstalled && row.hasMod ? 'ENHANCED' : 'ORIGINAL'
    const expectedExecutable =
      expectedMode === 'ENHANCED' && row.modExecRelPath !== '' ? row.modExecRelPath : row.execRelPath
    // RE-Enhance ships as a replacement launcher (`Biohazard.exe`) that can start the
    // retail binary itself, so BOTH names are watched: asserting only on the one the
    // launcher spawned would pass while an orphaned retail process kept running.
    const images = [expectedExecutable, row.execRelPath]
      .map((relative) => relative.split(/[\\/]/).pop() ?? relative)
      .filter((image) => image.toLowerCase().endsWith('.exe'))
    for (const image of images) startedImages.add(image)
    testInfo.annotations.push({
      type: 'live-expectation',
      description: JSON.stringify({ before, expectedMode, expectedExecutable, images, row })
    })

    // 3. Drive the UI. The cursor is clamped to the first card first: the menu
    //    restores its selection from the saved config, so which card is under the
    //    cursor when the window opens is not this spec's to assume. ArrowLeft
    //    clamps rather than wraps on the menu, so four presses always land on RE1.
    //
    //    Every step is recorded, because a live run reports a wrong ROW or a wrong
    //    MODE as a bare value and the sequence that produced it is what explains it.
    const steps: string[] = []
    const record = async (label: string): Promise<void> => {
      if (page === undefined) return
      const state = await page.evaluate(() => {
        const has = (selector: string): boolean => document.querySelector(selector) !== null
        const selectedRow = Array.from(document.querySelectorAll('[data-figma-node^="version-row-"]')).findIndex(
          (row) => row.querySelector('[class*="8.5px"]') !== null
        )
        return {
          menu: has('[data-figma-node="main-menu"]'),
          version: has('[data-figma-node="version-screen"]'),
          panel: has('[data-name="launch-panel"]'),
          gameplay: has('[data-figma-node="gameplay-screen"]'),
          selectedRow,
          panelRow: Array.from(document.querySelectorAll('[data-name="launch-panel"] [data-name^="row-"]')).findIndex(
            (row) => row.getAttribute('aria-selected') === 'true'
          )
        }
      })
      steps.push(`${label}=${JSON.stringify(state)}`)
    }

    await record('boot')
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press('ArrowLeft')
      await record(`ArrowLeft${String(step + 1)}`)
    }
    await page.keyboard.press('Enter')
    await page.locator('[data-figma-node="version-screen"]').first().waitFor({ timeout: 15_000 })
    await record('Enter(version)')

    // Which title the version screen actually opened, read off the frame's own
    // `data-name` rather than assumed - the failure this replaced reported a launch
    // of re3_us while the spec expected re1_us, and the frame name is what says
    // which one was on screen.
    const frameName =
      (await page.locator('[data-figma-node="version-screen"]').first().getAttribute('data-name')) ?? ''
    testInfo.annotations.push({ type: 'live-frame', description: frameName })
    expect(frameName, 'the version screen opened the RE1 frame').toContain('RE 1')

    await page.keyboard.press('Enter')
    await page.locator('[data-name="launch-panel"]').first().waitFor({ timeout: 15_000 })
    await record('Enter(panel)')

    // 4. The mode the panel shows must match what is on disk. This is the assertion
    //    for the parity bug: an install with the overlay already applied must not
    //    present ORIGINAL, because pressing LAUNCH would then restore the retail
    //    files instead of starting the modded game.
    const panelText = await page.locator('[data-name="launch-panel"]').first().innerText()
    testInfo.annotations.push({ type: 'live-panel', description: panelText.replace(/\s+/g, ' ').slice(0, 300) })
    testInfo.annotations.push({ type: 'live-diag', description: diagnostics.join(' | ') })
    expect(
      panelText.toUpperCase(),
      `the panel shows ${expectedMode} | storedModes=${JSON.stringify(snapshot.config.modes)} | ` +
        `steps=${steps.join(' ')} | main=${diagnostics.join(' ')}`
    ).toContain(expectedMode)
    // A fresh profile stores no mode, so a stored one appearing here is proof that
    // the panel wrote a mode nobody asked for.
    expect(snapshot.config.modes, 'opening the panel stores no mode').toEqual({})

    const rows = page.locator('[data-name="launch-panel"] [data-name^="row-"]')
    const rowCount = await rows.count()
    let launchIndex = -1
    let crtIndex = -1
    for (let index = 0; index < rowCount; index += 1) {
      const name = await rows.nth(index).getAttribute('data-name')
      if (name === 'row-launch') launchIndex = index
      if (name === 'row-crt') crtIndex = index
    }
    expect(launchIndex, 'the panel has a LAUNCH row').toBeGreaterThanOrEqual(0)

    // 3b. The settings round trip, through the real config store and onto disk. The
    //     CRT filter is the observable one: turning it on must persist, and the
    //     overlay must actually mount, which is the difference between a toggle that
    //     writes a value and a feature that works.
    if (crtIndex >= 0) {
      for (let step = 0; step < crtIndex; step += 1) await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await record('crt-on')
      const crtOn = await page.locator('[data-name="launch-panel"]').first().innerText()
      expect(crtOn.toUpperCase(), 'the CRT row reads ON').toContain('ON')
      await expect(page.locator('[data-crt-overlay="true"]')).toHaveCount(1)
      const persisted = JSON.parse(await readFile(join(profileDir, 'config.json'), 'utf8')) as {
        crtEnabled: boolean
      }
      expect(persisted.crtEnabled, 'crtEnabled was written to the profile').toBe(true)

      // Back to OFF and back to the top row, so the launch below is the ordinary one.
      await page.keyboard.press('Enter')
      await expect(page.locator('[data-crt-overlay="true"]')).toHaveCount(0)
      for (let step = 0; step < crtIndex; step += 1) await page.keyboard.press('ArrowUp')
      await record('crt-off')
    }

    for (let step = 0; step < launchIndex; step += 1) {
      await page.keyboard.press('ArrowDown')
    }
    await page.keyboard.press('Enter')

    // 5. The gameplay screen only appears after the main process reports a spawn,
    //    so this single wait covers injection, the config patch and the process
    //    start. It gets a long timeout because injecting RE-Enhance copies ~1900
    //    files over the install.
    await page
      .locator('[data-figma-node="gameplay-screen"]')
      .first()
      .waitFor({ timeout: 180_000 })
    await page.screenshot({ path: 'test-results/live-1-gameplay.png' }).catch(() => undefined)

    // 6. The main process agrees a game is running, and it is the row we asked for.
    const status = await page.evaluate(async () => {
      const bridge = window.reLauncher
      if (bridge === undefined) throw new Error('window.reLauncher is missing')
      return (await bridge.invoke('game:status', undefined)) as {
        running: boolean
        titleId: string | null
        versionId: string | null
      }
    })
    testInfo.annotations.push({ type: 'live-status', description: JSON.stringify(status) })
    expect(status.running, 'the launcher tracks a running game').toBe(true)
    expect(status.versionId).toBe(TARGET_VERSION)
    expect(
      typeof (status as { startedAt?: number | null }).startedAt,
      'the status carries when the game started, so the now-playing bar can count'
    ).toBe('number')

    // 6b. The launcher got out of the game's way. This is the whole of "press play and
    //     the game is what you see": these games cannot be embedded in the launcher
    //     window (tools/probe-embed.ps1 measured that), so the window minimises and the
    //     real game is on screen instead.
    const windowState = await app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows()
      if (window === undefined) return { exists: false, minimised: false }
      return { exists: true, minimised: window.isMinimized() }
    })
    testInfo.annotations.push({ type: 'live-window', description: JSON.stringify(windowState) })
    expect(windowState.exists, 'the launcher window still exists').toBe(true)
    expect(windowState.minimised, 'the launcher minimised so the game is visible').toBe(true)

    // 6c. And the surface it will show when the user comes back says the truth rather
    //     than implying the footage in the card is the running game.
    const nowPlaying = page.locator('[data-figma-node="now-playing"]').first()
    await expect(nowPlaying).toHaveCount(1)
    await expect(nowPlaying).toHaveAttribute('data-running', 'true')
    await expect(nowPlaying).toContainText('NOW PLAYING')
    await expect(page.locator('[data-figma-node="now-playing-stop"]')).toHaveCount(1)

    // 7. And it is really a process, not just launcher state.
    const spawned = expectedExecutable.split(/[\\/]/).pop() ?? expectedExecutable
    expect(await isImageRunning(spawned), `${spawned} is a live process`).toBe(true)

    // 8. The launch patched the game's config before spawning it. This spec cannot
    //    assert the patched *values* from here: RE-Enhance rewrites `config.ini`
    //    itself as it starts, so by the time the gameplay screen is up the file has
    //    already been written back (`BootConfig` returns to 1 on this very install).
    //    That is exactly why the launcher re-patches on every launch, and it is why
    //    the patch's *effect* is asserted where it is deterministic - `ini.test.ts`
    //    for the line editing and `launch.test.ts` for the two values - while the
    //    live run asserts the things only a real install can show: the enhanced
    //    executable was chosen (step 7) and the game really started.
    const after = await readDllSection(title.installPath)
    testInfo.annotations.push({
      type: 'live-config-after',
      description: `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
    })
    expect(Object.keys(after).length, 'the install still has a readable config.ini').toBeGreaterThan(0)
    expect(after.readError, 'config.ini is readable').toBeUndefined()

    // 9. STOP GAME ends it, and the launcher comes back.
    //
    //    The launcher is minimised at this point, which is the state a player is in: the
    //    game is on screen and the launcher is in the taskbar. Pressing the button on the
    //    now-playing bar is therefore how a user stops a game without alt-tabbing to its
    //    own menu, and it has to work from that state.
    await app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows()
      if (window === undefined) throw new Error('no launcher window')
      // Restoring first is what a click on the taskbar would do; the button needs the
      // renderer to be visible for Playwright to click it.
      if (window.isMinimized()) window.restore()
    })
    await page.locator('[data-figma-node="now-playing-stop"]').first().click()

    /** Waits for every watched image to disappear, then reports which did not. */
    const waitForImagesGone = async (): Promise<string[]> => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const alive: string[] = []
        for (const image of images) {
          if (await isImageRunning(image)) alive.push(image)
        }
        if (alive.length === 0) return []
        await new Promise((resolveWait) => setTimeout(resolveWait, 500))
      }
      const alive: string[] = []
      for (const image of images) {
        if (await isImageRunning(image)) alive.push(image)
      }
      return alive
    }

    expect(
      await waitForImagesGone(),
      'STOP GAME ended the process, not just the launcher state'
    ).toEqual([])

    // The bar switches to the truth, and the main process agrees nothing runs.
    const stoppedStatus = await page.evaluate(async () => {
      const bridge = window.reLauncher
      if (bridge === undefined) throw new Error('window.reLauncher is missing')
      return (await bridge.invoke('game:status', undefined)) as { running: boolean }
    })
    expect(stoppedStatus.running, 'the launcher knows the game stopped').toBe(false)
    await expect(page.locator('[data-figma-node="now-playing"]').first()).toHaveAttribute(
      'data-running',
      'false'
    )
    await expect(page.locator('[data-figma-node="now-playing"]').first()).toContainText('NOT RUNNING')

    // 10. Relaunching and quitting must still take the game with it (the `before-quit`
    //     kill), or a player who closes the window is left with an orphaned game.
    //
    //     One Escape, not a loop. This step is what caught the launcher reporting its own
    //     STOP as a crash: `taskkill /F` kills with exit code 1, so the store showed
    //     "GAME EXITED WITH AN ERROR - RESIDENT EVIL stopped unexpectedly (exit code 1)",
    //     and the first Escape dismissed that dialog instead of going back. With
    //     `GameExitEvent.requested` the dialog is gone and a single Back does what the
    //     helper bar says it does.
    const beforeBack = await probe(page)
    await press(page, 'Escape')
    const afterBack = await probe(page)
    testInfo.annotations.push({
      type: 'live-back',
      description: `before=[${describe(beforeBack)}] after=[${describe(afterBack)}]`
    })
    expect(
      beforeBack.error,
      'stopping the game on purpose is not reported as an error'
    ).toBeNull()
    expect(
      afterBack.screen,
      `one Back after STOP returns to the version list; after=[${describe(afterBack)}]`
    ).toBe('version')
    await press(page, 'Enter')
    await page
      .locator('[data-name="launch-panel"]')
      .first()
      .waitFor({ timeout: 30_000 })
    const relaunchRows = page.locator('[data-name="launch-panel"] [data-name^="row-"]')
    const relaunchCount = await relaunchRows.count()
    let relaunchIndex = -1
    for (let index = 0; index < relaunchCount; index += 1) {
      if ((await relaunchRows.nth(index).getAttribute('data-name')) === 'row-launch') {
        relaunchIndex = index
        break
      }
    }
    expect(relaunchIndex).toBeGreaterThanOrEqual(0)
    for (let step = 0; step < relaunchIndex; step += 1) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page
      .locator('[data-figma-node="gameplay-screen"]')
      .first()
      .waitFor({ timeout: 120_000 })
    expect(await isImageRunning(spawned), `${spawned} is running again`).toBe(true)

    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit()
    })
    await app.waitForEvent('close', { timeout: 30_000 })
    app = undefined

    const survivors = await waitForImagesGone()
    expect(survivors, `killed when the launcher quit; still running: ${survivors.join(', ')}`).toEqual([])

    // 11. Report what this run changed, so the side effects are never a surprise.
    testInfo.annotations.push({
      type: 'live-summary',
      description: `mode=${expectedMode} executable=${expectedExecutable} watched=${images.join(',')} config.ini: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    })
  })
})
