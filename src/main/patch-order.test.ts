/**
 * The regression test for the ordering defect that hid for this entire session.
 *
 * `launchSequence` used to patch the game's `config.ini` **before** the mod was injected, and the injection
 * copies the mod payload over the install — `config.ini` among those files, because every RE-Enhance payload
 * ships one and `.mod_backup/manifest.txt` records it. So `BootConfig = 0`, `JapaneseEnable`, `RetroMode` and
 * RE3's `Display_mode` were all written and then overwritten before the game started, on every enhanced
 * launch. It was found by measuring RE3's resolution and asking why the value the launcher wrote was not the
 * value the game used.
 *
 * What is asserted here is the *mechanism* rather than the call order, because the call order lives in
 * `ipc.ts`'s launch sequence, which has no unit harness (it imports Electron). These two facts are the ones
 * the fix rests on, and both would have caught the defect:
 *
 *   1. the injection really does replace the install's `config.ini` with the payload's, and
 *   2. a patch applied after it is what the file then holds.
 *
 * If (1) ever stops being true - a payload that ships no `config.ini`, or a copy filter that skips it -
 * this test fails and the ordering stops being load-bearing, which is worth knowing rather than assuming.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { patchIniFile } from './ini'
import { injectMod } from './mods'

let sandbox = ''

afterEach(async () => {
  if (sandbox !== '') {
    await rm(sandbox, { recursive: true, force: true })
    sandbox = ''
  }
})

describe('config patches against the mod injection', () => {
  it('loses the launchers values to the payload, and a patch after the injection is what survives', async () => {
    sandbox = await mkdtemp(join(tmpdir(), 're-order-'))
    const installPath = join(sandbox, 'Resident Evil 3')
    const modsDir = join(sandbox, 'reenhancemods')
    const modPath = 'RE-ENHANCE_RE3_v2.2_GOG'

    // An install that has been played before, and a payload that ships its own config - which every
    // RE-Enhance release does, carrying `Display_mode = 6`, the value that made RE3 open at 640x480.
    await mkdir(installPath, { recursive: true })
    await writeFile(join(installPath, 'config.ini'), '[GAME]\nDisplay_mode = 1\n', 'utf8')
    await mkdir(join(modsDir, modPath), { recursive: true })
    await writeFile(join(modsDir, modPath, 'config.ini'), '[GAME]\nDisplay_mode = 6\n', 'utf8')

    const result = await injectMod({ installPath, modsDir, modPath, versionId: 're3_us' })
    expect(result.ok, `the injection succeeded: ${result.message ?? ''}`).toBe(true)

    /*
     * THE PRECONDITION OF THE BUG, asserted rather than assumed: the payload's `config.ini` has replaced the
     * install's, so anything patched before this point is gone. A patch written here is exactly the state the
     * launcher used to launch from - which is why the game honoured `6` and not the launcher's value.
     */
    const afterInjection = await readFile(join(installPath, 'config.ini'), 'utf8')
    expect(afterInjection, 'the payload replaced the install config').toContain('Display_mode = 6')

    // THE FIX: the same patch, applied after the injection, is what the game reads.
    expect(await patchIniFile(join(installPath, 'config.ini'), 'GAME', 'Display_mode', '4')).toBe(true)

    const final = await readFile(join(installPath, 'config.ini'), 'utf8')
    expect(final, 'the launcher value is the one left in the file').toContain('Display_mode = 4')
    expect(final, 'and the payload value is gone').not.toContain('Display_mode = 6')
  })
})
