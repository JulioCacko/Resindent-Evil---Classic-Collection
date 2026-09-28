/**
 * Process discovery by image name.
 *
 * The fixtures are real `tasklist /FO CSV /NH` output, including the shapes that break a
 * naive parser: a UTF-8 BOM, a comma inside the memory column, a blank line, and the same
 * image appearing more than once (a game and its wrapper share a name more often than not).
 */
import { describe, expect, it } from 'vitest'

import {
  imageIsRunning,
  imageNameOf,
  isImageRunning,
  listRunningImages,
  parseTasklistImages
} from './processes'

const TASKLIST_OUTPUT = '\uFEFF"ResidentEvil.exe","12345","Console","1","12,345 K"\r\n' +
  '"Biohazard.exe","23456","Console","1","9,876 K"\r\n' +
  '"explorer.exe","1000","Console","1","45,000 K"\r\n' +
  '"Biohazard.exe","23457","Console","1","1,024 K"\r\n' +
  '\r\n'

describe('parseTasklistImages', () => {
  it('reads the first column of every record', () => {
    expect(parseTasklistImages(TASKLIST_OUTPUT)).toEqual([
      'ResidentEvil.exe',
      'Biohazard.exe',
      'explorer.exe'
    ])
  })

  it('ignores a comma inside a quoted field', () => {
    // "12,345 K" is one field; a split on commas would report `345 K"` as an image.
    expect(parseTasklistImages(TASKLIST_OUTPUT)).not.toContain('345 K"')
  })

  it('reports each image once, however many processes share it', () => {
    const images = parseTasklistImages(TASKLIST_OUTPUT)
    expect(images.filter((image) => image === 'Biohazard.exe')).toHaveLength(1)
  })

  it('skips headers, blank lines and anything unquoted', () => {
    const mixed = 'Image Name,PID\r\n\r\nINFO: No tasks are running which match.\r\n"a.exe","1","Console","1","1 K"\r\n'
    expect(parseTasklistImages(mixed)).toEqual(['a.exe'])
  })

  it('returns nothing for empty output', () => {
    expect(parseTasklistImages('')).toEqual([])
  })
})

describe('imageIsRunning', () => {
  const images = ['ResidentEvil.exe', 'steam.exe']

  it('matches a name exactly', () => {
    expect(imageIsRunning(images, 'ResidentEvil.exe')).toBe(true)
  })

  it('matches a name in any case, because Windows does', () => {
    expect(imageIsRunning(images, 'residentevil.EXE')).toBe(true)
    expect(imageIsRunning(['RESIDENTEVIL.EXE'], 'ResidentEvil.exe')).toBe(true)
  })

  it('does not match a name that merely contains the wanted one', () => {
    // `ResidentEvil3.exe` is a different game; a substring match would kill the wrong one.
    expect(imageIsRunning(['ResidentEvil3.exe'], 'ResidentEvil.exe')).toBe(false)
  })

  it('never matches an empty name', () => {
    expect(imageIsRunning([''], '')).toBe(false)
    expect(imageIsRunning(images, '')).toBe(false)
  })
})

describe('listRunningImages', () => {
  it('asks tasklist for CSV, with no header', async () => {
    const calls: { file: string; args: string[] }[] = []
    const images = await listRunningImages({
      runCommand: async (file, args) => {
        calls.push({ file, args })
        return TASKLIST_OUTPUT
      }
    })
    expect(calls).toEqual([{ file: 'tasklist', args: ['/FO', 'CSV', '/NH'] }])
    expect(images).toContain('Biohazard.exe')
  })

  it('reports nothing running when the command cannot be run', async () => {
    // A launcher that could not be closed because tasklist was unavailable would be worse
    // than one that reports nothing.
    expect(await listRunningImages({ runCommand: async () => null })).toEqual([])
    expect(await isImageRunning('Biohazard.exe', { runCommand: async () => null })).toBe(false)
  })
})

describe('imageNameOf', () => {
  it('takes the last segment of a Windows path', () => {
    expect(imageNameOf('C:\\GOG Games\\Resident Evil\\Biohazard.exe')).toBe('Biohazard.exe')
  })

  it('takes the last segment of a catalog path, which uses forward slashes', () => {
    // Steam rows name a locale folder: `english/ResidentEvil.exe`.
    expect(imageNameOf('english/ResidentEvil.exe')).toBe('ResidentEvil.exe')
  })

  it('copes with a bare name', () => {
    expect(imageNameOf('ResidentEvil.exe')).toBe('ResidentEvil.exe')
  })
})
