import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { getDisplayMode, rememberEnhancedConfig, restoreDisplayLine, restoreEnhancedConfig, setDisplayMode } from './native-settings'
import { redactDiagnostics } from './diagnostics'

it('preserves native bindings and restores the original display value across mod replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 're-native-settings-'))
  const game = join(dir, 'game')
  const file = join(game, 'config.ini')
  const original = '[GAME]\r\nDisplay_mode = 6\r\n; user comment\r\nKey_Def = DE AD BE EF\r\n'
  try {
    await mkdir(game)
    await writeFile(file, original, 'latin1')
    await setDisplayMode(dir, game, 2)
    await rememberEnhancedConfig(dir, game)
    await writeFile(file, '[GAME]\nDisplay_mode = 0\nKey_Def = 00\n')
    await restoreEnhancedConfig(dir, game, true)
    expect(await readFile(file, 'latin1')).toBe(original.replace('Display_mode = 6', 'Display_mode = 2'))
    await rememberEnhancedConfig(dir, game)
    await setDisplayMode(dir, game, null)
    await restoreEnhancedConfig(dir, game, true)
    expect(await readFile(file, 'latin1')).toBe(original)
    expect(await getDisplayMode(dir, game)).toBeNull()
    await expect(setDisplayMode(dir, game, 4)).rejects.toThrow('Unsupported')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

it('removes only an added display row and redacts secrets and local paths', () => {
  expect(restoreDisplayLine('[GAME]\r\nDisplay_mode = 2\r\nKey=1\r\n', null)).toBe('[GAME]\r\nKey=1\r\n')
  expect(redactDiagnostics('raKey=private')).not.toContain('private')
  expect(redactDiagnostics('failed at C:\\Users\\Person Name\\config.json')).not.toContain('Person')
})
