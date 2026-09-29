/** Owned-game gate. Window/render evidence is separate from reviewed gameplay. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'
import sharp from 'sharp'
import type { LaunchMode, Re2Scenario, TitleId } from '../../src/shared/types'

const run = promisify(execFile)
const cases: { titleId: TitleId; versionId: string; scenario: Re2Scenario | null }[] = [
  { titleId: 're1', versionId: 're1_us', scenario: null },
  { titleId: 're2', versionId: 're2_leon_us', scenario: 'leon' },
  { titleId: 're2', versionId: 're2_leon_us', scenario: 'claire' },
  { titleId: 're3', versionId: 're3_us', scenario: null }
]
const cycles = Number(process.env.RE_LIVE_CYCLES ?? 10)
if (!Number.isInteger(cycles) || cycles < 1 || cycles > 10) throw new Error('RE_LIVE_CYCLES must be 1–10.')

for (const entry of cases) for (const mode of ['original', 'enhanced'] as LaunchMode[]) {
  const label = [entry.titleId, entry.scenario ?? 'main', mode].join('-')
  test(label + ': window, stop and relaunch (' + cycles + ' cycles)', async ({}, info) => {
    test.skip(process.env.RE_LIVE_LAUNCH !== '1', 'Owned games are a local release gate.')
    test.skip(Boolean(process.env.RE_LIVE_CASE) && process.env.RE_LIVE_CASE !== label, 'Filtered case; not full release evidence.')
    test.setTimeout(cycles * 240_000 + 60_000)
    const profile = await mkdtemp(join(tmpdir(), 're-live-matrix-'))
    await writeFile(join(profile, 'config.json'), JSON.stringify({ onboardingComplete: true, lastSelectedTitle: entry.titleId, modes: { [entry.versionId]: mode }, scenarios: { [entry.versionId]: entry.scenario }, launchWindowMode: 'minimise', inGameCrt: false }))
    const app = await _electron.launch({ args: ['out/main/index.js'], cwd: process.cwd(), env: { ...process.env, RE_TEST_CONFIG_DIR: profile, RE_GAME_FRAME_CAPTURE: '1' } as Record<string, string> })
    const page = await app.firstWindow()
    const evidence: unknown[] = []
    let gameConfigPath: string | null = null
    let originalConfig: Buffer | null = null
    try {
      await page.locator('[data-figma-node="stage"]').waitFor()
      const catalog = await page.evaluate(async () => window.reLauncher!.invoke('catalog:get', undefined))
      const row = catalog.titles.flatMap((title) => title.versions).find((version) => version.id === entry.versionId)
      expect(row?.installPath, 'Owned installation required; missing data fails the gate.').toBeTruthy()
      expect(row?.launchable).toBe(true)
      if (row) {
        gameConfigPath = join(row.installPath, 'config.ini')
        originalConfig = await readFile(gameConfigPath).catch(() => null)
      }
      if (mode === 'enhanced') expect(row?.hasMod).toBe(true)
      expect((await page.evaluate(async () => window.reLauncher!.invoke('game:status', undefined))).running, 'Do not disturb an already running game.').toBe(false)
      for (let cycle = 1; cycle <= cycles; cycle++) {
        const verifyDisplay = mode === 'enhanced' && entry.titleId === 're3' && process.env.RE_LIVE_VERIFY_DISPLAY === '1'
        const display = verifyDisplay && cycle <= 4 ? cycle - 1 : null
        if (verifyDisplay) {
          const changed = await page.evaluate(async (request) => window.reLauncher!.invoke('game:display-set', request), { versionId: entry.versionId, mode: 'enhanced' as const, display })
          expect(changed.ok, changed.message).toBe(true)
        }
        const logBefore = (await readFile(join(profile, 're-log.txt'), 'utf8').catch(() => '')).length
        const result = await page.evaluate(async (request) => window.reLauncher!.invoke('launch', request), { ...entry, mode })
        expect(result.ok, JSON.stringify(result)).toBe(true)
        if (!result.ok) break
        let windows: { class: string; visible: boolean; width: number; height: number; borderX: number; borderY: number }[] = []
        await expect.poll(async () => {
          const answer = await run('pwsh', ['-NoProfile', '-File', 'resources/window-host.ps1', '-Action', 'query', '-ProcessId', String(result.pid)], { timeout: 15_000 })
          windows = (JSON.parse(answer.stdout) as { windows: typeof windows }).windows
          return windows.some((window) => window.visible && window.class !== '#32770' && window.width > 300 && window.height > 200)
        }, { timeout: 180_000, intervals: [1000, 2000, 4000], message: label + ' must create a game window, not only an error dialog.' }).toBe(true)
        if (mode === 'enhanced') {
          await expect.poll(async () => /in-game overlay: available=true api=d3d9 \(rendering\)/.test((await readFile(join(profile, 're-log.txt'), 'utf8')).slice(logBefore)), { timeout: 180_000, intervals: [1000, 2000] }).toBe(true)
        }
        if (display !== null) {
          const game = windows.find((window) => window.visible && window.class !== '#32770' && window.width > 300)!
          expect(game.width - game.borderX).toBe([640, 960, 1280, 1600][display])
          expect(game.height - game.borderY).toBe([480, 720, 960, 1200][display])
        }
        if (verifyDisplay && display === null && originalConfig && gameConfigPath) {
          const original = /^\s*Display_mode\s*=\s*(.+)$/im.exec(originalConfig.toString('latin1'))?.[1]?.trim()
          const restored = /^\s*Display_mode\s*=\s*(.+)$/im.exec(await readFile(gameConfigPath, 'latin1'))?.[1]?.trim()
          expect(restored, 'removing the override restores the captured native value').toBe(original)
        }
        if (cycle === 1) {
          const image = info.outputPath(label + '-game.png')
          await expect.poll(async () => {
            if (mode === 'enhanced') {
              const raw = await readFile(join(tmpdir(), 're-classic-overlay', 'capture-' + result.pid + '-0.bgra')).catch(() => null)
              if (!raw || raw.length < 8) return 0
              const width = raw.readInt32LE(0), height = raw.readInt32LE(4)
              if (width < 1 || height < 1 || raw.length !== 8 + width * height * 4) return 0
              const pixels = Buffer.from(raw.subarray(8))
              for (let offset = 0; offset < pixels.length; offset += 4) {
                const blue = pixels[offset]; pixels[offset] = pixels[offset + 2]; pixels[offset + 2] = blue
              }
              await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(image)
            } else {
              try { await run('pwsh', ['-NoProfile', '-File', 'tools/capture-game.ps1', '-ProcessId', String(result.pid), '-Output', image], { timeout: 20_000 }) }
              catch { return 0 }
            }
            return (await sharp(image).stats()).entropy
          }, { timeout: 60_000, intervals: [2000, 4000], message: 'Reject blank captures; require visible game imagery.' }).toBeGreaterThan(2)
          await info.attach('game-window-for-review', { path: image, contentType: 'image/png' })
        }
        evidence.push({ cycle, pid: result.pid, windows })
        await page.evaluate(async () => window.reLauncher!.invoke('game:stop', undefined))
        await expect.poll(async () => (await page.evaluate(async () => window.reLauncher!.invoke('game:status', undefined))).running, { timeout: 20_000 }).toBe(false)
      }
    } finally {
      await page.evaluate(async () => window.reLauncher!.invoke('game:stop', undefined)).catch(() => undefined)
      await info.attach('cycle-evidence', { body: JSON.stringify({ label, cycles, evidence, gameplayReviewed: false, cleanInGameExitReviewed: false }, null, 2), contentType: 'application/json' })
      await info.attach('launcher-log', { body: await readFile(join(profile, 're-log.txt'), 'utf8').catch(() => ''), contentType: 'text/plain' })
      await app.close()
      if (gameConfigPath && originalConfig) await writeFile(gameConfigPath, originalConfig)
    }
  })
}
