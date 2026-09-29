import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { patchIniValue } from './ini'

interface Profile {
  display: number | null
  originalLine?: string | null
  enhancedConfig?: string
}
const EMPTY: Profile = { display: null }

function profilePath(configDir: string, installPath: string): string {
  const id = createHash('sha256').update(resolve(installPath).toLowerCase()).digest('hex')
  return join(configDir, 'native-settings', `${id}.json`)
}
async function readProfile(configDir: string, installPath: string): Promise<Profile> {
  try {
    const value: unknown = JSON.parse(await readFile(profilePath(configDir, installPath), 'utf8'))
    if (typeof value !== 'object' || value === null) throw new Error('Invalid native settings profile.')
    const p = value as Profile
    if (p.display !== null && (!Number.isInteger(p.display) || p.display < 0 || p.display > 3)) throw new Error('Invalid display setting.')
    if (p.originalLine !== undefined && p.originalLine !== null && (typeof p.originalLine !== 'string' || /[\r\n]/.test(p.originalLine))) throw new Error('Invalid display backup.')
    if (p.enhancedConfig !== undefined && typeof p.enhancedConfig !== 'string') throw new Error('Invalid configuration backup.')
    return p
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY }
    throw error
  }
}
async function atomicWrite(path: string, contents: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, contents)
  await rename(`${path}.tmp`, path)
}
async function saveProfile(configDir: string, installPath: string, profile: Profile): Promise<void> {
  await atomicWrite(profilePath(configDir, installPath), JSON.stringify(profile))
}
function displayLine(text: string): string | null {
  let section = ''
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line)
    if (header) section = header[1].toLowerCase()
    if (section === 'game' && /^\s*Display_mode\s*=/i.test(line)) return line
  }
  return null
}
export function restoreDisplayLine(text: string, original: string | null): string {
  let section = ''
  return text.split(/(?<=\n)/).map((line) => {
    const header = /^\s*\[([^\]]+)\]/.exec(line)
    if (header) section = header[1].toLowerCase()
    if (section !== 'game' || !/^\s*Display_mode\s*=/i.test(line)) return line
    return original === null ? '' : original + (line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : '')
  }).join('')
}
export async function getDisplayMode(configDir: string, installPath: string): Promise<number | null> {
  return (await readProfile(configDir, installPath)).display
}
export async function setDisplayMode(configDir: string, installPath: string, mode: number | null): Promise<void> {
  if (mode !== null && (!Number.isInteger(mode) || mode < 0 || mode > 3)) throw new Error('Unsupported display mode.')
  const profile = await readProfile(configDir, installPath)
  if (profile.originalLine === undefined && mode !== null) {
    profile.originalLine = displayLine(await readFile(join(installPath, 'config.ini'), 'latin1'))
  }
  profile.display = mode
  await saveProfile(configDir, installPath, profile)
}
/** Capture an already enhanced install before mod copying or restoration. */
export async function rememberEnhancedConfig(configDir: string, installPath: string): Promise<void> {
  const profile = await readProfile(configDir, installPath)
  profile.enhancedConfig = (await readFile(join(installPath, 'config.ini'))).toString('base64')
  await saveProfile(configDir, installPath, profile)
}
/** Reapply the player's enhanced configuration after injection; retail backups remain untouched. */
export async function restoreEnhancedConfig(configDir: string, installPath: string, re3: boolean): Promise<void> {
  const profile = await readProfile(configDir, installPath)
  const path = join(installPath, 'config.ini')
  let text = profile.enhancedConfig === undefined
    ? await readFile(path, 'latin1') : Buffer.from(profile.enhancedConfig, 'base64').toString('latin1')
  if (re3) {
    if (profile.display !== null) text = patchIniValue(text, 'GAME', 'Display_mode', String(profile.display))
    else if (profile.originalLine !== undefined) text = restoreDisplayLine(text, profile.originalLine)
  }
  await atomicWrite(path, Buffer.from(text, 'latin1'))
  if (re3 && profile.display === null && profile.originalLine !== undefined) {
    delete profile.originalLine
    profile.enhancedConfig = Buffer.from(text, 'latin1').toString('base64')
    await saveProfile(configDir, installPath, profile)
  }
}
