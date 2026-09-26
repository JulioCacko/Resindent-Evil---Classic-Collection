/**
 * Tests for the `config.ini` patcher.
 *
 * The string cases are plain literal in / literal out on purpose: the whole
 * point of this module is that a file it was not asked to change comes back byte
 * for byte, so every expectation here is written out in full rather than
 * assembled from the input, otherwise a bug that reformatted whitespace would
 * hide inside the expectation.
 *
 * The `patchIniFile` cases use a real temporary directory because what they are
 * checking is the part the string tests cannot reach: whether a missing file gets
 * created, whether the write ends with a newline, and whether an unwritable path
 * comes back as `false` instead of throwing.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { patchIniFile, patchIniValue } from './ini'

/**
 * The shape RE-Enhance writes: comments that mention the very keys we patch, a
 * section before the one we care about, aligned ` = ` rows and CRLF endings.
 */
const RE_ENHANCE_INI = [
  '; RE-Enhance (Classic REbirth) configuration',
  '; written by the mod on first run - do not delete',
  '',
  '[General]',
  'Language = JP',
  'WindowMode = 1',
  '',
  '[DLL]',
  '; 1 loads the japanese text and audio files, 0 the english ones',
  'JapaneseEnable = 0',
  '; 0 skips the setup dialog',
  'BootConfig = 1',
  'LoadLibrary = dinput8.dll',
  ''
].join('\r\n')

describe('patchIniValue', () => {
  it('rewrites an existing key and keeps the spacing that was already there', () => {
    expect(patchIniValue('[DLL]\nJapaneseEnable = 1\n', 'DLL', 'JapaneseEnable', '0')).toBe(
      '[DLL]\nJapaneseEnable = 0\n'
    )

    // Hand-aligned rows stay aligned: only the text after '=' is replaced.
    expect(patchIniValue('[DLL]\nJapaneseEnable    =    1\n', 'DLL', 'JapaneseEnable', '0')).toBe(
      '[DLL]\nJapaneseEnable    =    0\n'
    )

    // A row written without spaces stays written without spaces.
    expect(patchIniValue('[DLL]\nJapaneseEnable=1\n', 'DLL', 'JapaneseEnable', '0')).toBe(
      '[DLL]\nJapaneseEnable=0\n'
    )
  })

  it('keeps trailing whitespace after the old value', () => {
    // Those spaces belong to the file we did not write, so replacing the value
    // must not quietly trim the row.
    expect(patchIniValue('[DLL]\nBootConfig = 1  \n', 'DLL', 'BootConfig', '0')).toBe(
      '[DLL]\nBootConfig = 0  \n'
    )
  })

  it('inserts a missing key at the end of its section, before the next header', () => {
    const contents = '[DLL]\nJapaneseEnable = 1\n\n[Other]\nFoo = 1\n'

    expect(patchIniValue(contents, 'DLL', 'BootConfig', '0')).toBe(
      '[DLL]\nJapaneseEnable = 1\n\nBootConfig = 0\n[Other]\nFoo = 1\n'
    )
  })

  it('inserts a missing key at EOF when its section is the last one', () => {
    const contents = '[General]\nLanguage = JP\n\n[DLL]\nJapaneseEnable = 1\n'

    expect(patchIniValue(contents, 'DLL', 'BootConfig', '0')).toBe(
      '[General]\nLanguage = JP\n\n[DLL]\nJapaneseEnable = 1\nBootConfig = 0\n'
    )
  })

  it('appends the section and the key when the section is missing', () => {
    const contents = '[General]\nLanguage = JP\n'

    expect(patchIniValue(contents, 'DLL', 'JapaneseEnable', '1')).toBe(
      '[General]\nLanguage = JP\n[DLL]\nJapaneseEnable = 1\n'
    )
  })

  it('creates the whole file when there is nothing to patch yet', () => {
    expect(patchIniValue('', 'DLL', 'JapaneseEnable', '1')).toBe('[DLL]\nJapaneseEnable = 1\n')
  })

  it('appends at the very end of a file that has no trailing newline', () => {
    // patchIniValue never adds a terminator of its own; patchIniFile is the one
    // that guarantees a newline on disk.
    expect(patchIniValue('[General]\nLanguage = JP', 'DLL', 'BootConfig', '0')).toBe(
      '[General]\nLanguage = JP\n[DLL]\nBootConfig = 0'
    )
  })

  it('leaves blank lines exactly where they are', () => {
    const contents = '\n\n[DLL]\n\nJapaneseEnable = 1\n\n'

    expect(patchIniValue(contents, 'DLL', 'JapaneseEnable', '0')).toBe(
      '\n\n[DLL]\n\nJapaneseEnable = 0\n\n'
    )
  })

  it('never rewrites comment lines inside the section', () => {
    const contents = ['[DLL]', '; JapaneseEnable = 1', '#BootConfig = 1', '  ; BootConfig = 1', 'JapaneseEnable = 0', ''].join(
      '\n'
    )

    expect(patchIniValue(contents, 'DLL', 'JapaneseEnable', '1')).toBe(
      ['[DLL]', '; JapaneseEnable = 1', '#BootConfig = 1', '  ; BootConfig = 1', 'JapaneseEnable = 1', ''].join('\n')
    )
  })

  it('adds a real row when the only match is commented out', () => {
    const contents = '[DLL]\n; BootConfig = 1\nJapaneseEnable = 0\n'

    expect(patchIniValue(contents, 'DLL', 'BootConfig', '0')).toBe(
      '[DLL]\n; BootConfig = 1\nJapaneseEnable = 0\nBootConfig = 0\n'
    )
  })

  it('matches section and key case-insensitively without re-casing the file', () => {
    expect(patchIniValue('[dll]\njapaneseenable = 1\n', 'DLL', 'JapaneseEnable', '0')).toBe(
      '[dll]\njapaneseenable = 0\n'
    )
    expect(patchIniValue('[DLL]\nJapaneseEnable = 1\n', 'dll', 'japaneseenable', '0')).toBe(
      '[DLL]\nJapaneseEnable = 0\n'
    )
  })

  it('preserves CRLF endings, for existing rows and for new ones', () => {
    expect(patchIniValue('[DLL]\r\nJapaneseEnable = 1\r\nBootConfig = 1\r\n', 'DLL', 'JapaneseEnable', '0')).toBe(
      '[DLL]\r\nJapaneseEnable = 0\r\nBootConfig = 1\r\n'
    )

    // A row added to a CRLF file uses the ending the file already uses, so the
    // file does not end up with two different endings inside it.
    expect(patchIniValue('[DLL]\r\nJapaneseEnable = 1\r\n', 'Extra', 'BootConfig', '0')).toBe(
      '[DLL]\r\nJapaneseEnable = 1\r\n[Extra]\r\nBootConfig = 0\r\n'
    )
  })

  it('does not confuse a key with a longer key that starts with it', () => {
    const contents = '[DLL]\nJapanese = 1\nJapaneseEnable = 1\n'

    expect(patchIniValue(contents, 'DLL', 'Japanese', '0')).toBe('[DLL]\nJapanese = 0\nJapaneseEnable = 1\n')
    expect(patchIniValue(contents, 'DLL', 'JapaneseEnable', '0')).toBe('[DLL]\nJapanese = 1\nJapaneseEnable = 0\n')
  })

  it('does not treat a section whose name starts with ours as ours', () => {
    const contents = '[DLLX]\nBootConfig = 1\n'

    expect(patchIniValue(contents, 'DLL', 'BootConfig', '0')).toBe(
      '[DLLX]\nBootConfig = 1\n[DLL]\nBootConfig = 0\n'
    )
  })

  it('is idempotent: patching the same value twice changes nothing the second time', () => {
    const contents = '[DLL]\nJapaneseEnable = 1\n\n[Other]\nFoo = 1\n'

    const replaced = patchIniValue(contents, 'DLL', 'JapaneseEnable', '0')
    expect(patchIniValue(replaced, 'DLL', 'JapaneseEnable', '0')).toBe(replaced)

    // The append paths matter most: a second run must not add a second [DLL]
    // section, nor a duplicate row inside the existing one.
    const addedRow = patchIniValue(contents, 'DLL', 'BootConfig', '0')
    expect(patchIniValue(addedRow, 'DLL', 'BootConfig', '0')).toBe(addedRow)

    const addedSection = patchIniValue(contents, 'Extra', 'BootConfig', '0')
    expect(patchIniValue(addedSection, 'Extra', 'BootConfig', '0')).toBe(addedSection)
  })

  it('patches the real RE-Enhance shape: BootConfig to 0 and JapaneseEnable to 0 and 1', () => {
    const bootOff = patchIniValue(RE_ENHANCE_INI, 'DLL', 'BootConfig', '0')
    expect(bootOff).toBe(RE_ENHANCE_INI.replace('BootConfig = 1', 'BootConfig = 0'))

    // Already 0: the file comes back identical, not merely equivalent.
    const japaneseOff = patchIniValue(bootOff, 'DLL', 'JapaneseEnable', '0')
    expect(japaneseOff).toBe(bootOff)

    const japaneseOn = patchIniValue(japaneseOff, 'DLL', 'JapaneseEnable', '1')
    expect(japaneseOn).toBe(
      RE_ENHANCE_INI.replace('BootConfig = 1', 'BootConfig = 0').replace('JapaneseEnable = 0', 'JapaneseEnable = 1')
    )

    // The comments that mention both keys, the other keys, and every CRLF ending
    // are still there afterwards.
    expect(japaneseOn).toContain('; 1 loads the japanese text and audio files, 0 the english ones')
    expect(japaneseOn).toContain('LoadLibrary = dinput8.dll')
    expect(japaneseOn.split('\r\n').length).toBe(RE_ENHANCE_INI.split('\r\n').length)
  })
})

describe('patchIniFile', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 're-launcher-ini-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('creates the file when the game has not written one yet', async () => {
    const filePath = join(directory, 'config.ini')

    await expect(patchIniFile(filePath, 'DLL', 'JapaneseEnable', '1')).resolves.toBe(true)
    await expect(readFile(filePath, 'utf8')).resolves.toBe('[DLL]\nJapaneseEnable = 1\n')
  })

  it('patches an existing CRLF file, writes the rest back unchanged, and stays put on a second run', async () => {
    const filePath = join(directory, 'config.ini')
    await writeFile(filePath, RE_ENHANCE_INI, 'utf8')
    const expected = RE_ENHANCE_INI.replace('BootConfig = 1', 'BootConfig = 0')

    await expect(patchIniFile(filePath, 'DLL', 'BootConfig', '0')).resolves.toBe(true)
    await expect(readFile(filePath, 'utf8')).resolves.toBe(expected)

    await expect(patchIniFile(filePath, 'DLL', 'BootConfig', '0')).resolves.toBe(true)
    await expect(readFile(filePath, 'utf8')).resolves.toBe(expected)
  })

  it('terminates a file that had no trailing newline when it writes it back', async () => {
    const filePath = join(directory, 'config.ini')
    await writeFile(filePath, '[DLL]\r\nBootConfig = 1', 'utf8')

    await expect(patchIniFile(filePath, 'DLL', 'BootConfig', '0')).resolves.toBe(true)
    await expect(readFile(filePath, 'utf8')).resolves.toBe('[DLL]\r\nBootConfig = 0\r\n')
  })

  it('returns false instead of throwing when the path cannot be written', async () => {
    const unwritable = join(directory, 'missing-subdirectory', 'config.ini')

    await expect(patchIniFile(unwritable, 'DLL', 'BootConfig', '0')).resolves.toBe(false)
    await expect(readFile(unwritable, 'utf8')).rejects.toThrow()

    // The path is a directory: the read fails with something other than ENOENT,
    // so the patcher refuses instead of truncating something it could not read.
    await expect(patchIniFile(directory, 'DLL', 'BootConfig', '0')).resolves.toBe(false)
  })
})
