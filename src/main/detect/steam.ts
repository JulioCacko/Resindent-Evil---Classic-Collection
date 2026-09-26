/**
 * Steam library detection.
 *
 * The Classic Collection also ships on Steam, and its layout is nothing like GOG's:
 * each localization is a *complete copy* of the game in its own folder
 * (`4249100_Biohazard\english\ResidentEvil.exe`, `…\japanese\Biohazard.exe`), and
 * the game folder is named `<appid>_<Title>` rather than after the title. So a
 * Steam install is resolved in three steps, and every one of them is read from
 * Valve's own files rather than guessed from a folder name:
 *
 *   1. the Steam root, from the registry (`SteamPath` under HKCU, else
 *      `InstallPath` under HKLM, both spellings of the WOW64 view);
 *   2. the library folders, from `<root>\steamapps\libraryfolders.vdf`, which lists
 *      every drive a library lives on;
 *   3. the app's install folder, from `appmanifest_<appid>.acf`, whose `installdir`
 *      is the authoritative folder name.
 *
 * The per-row game root is then `<library>\steamapps\common\<installdir>\<locale>`,
 * and because each locale folder carries its own data (`english\` holds 2940 files
 * including `USA\Data`) that whole subtree is what the rest of the launcher treats
 * as the install: probing, the working directory and the `config.ini` patch all work
 * against it unchanged.
 *
 * Everything that touches the OS is injected, so the parsing and the resolution
 * order are unit-testable without a registry or a Steam install.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

/** Runs `reg query <key> /v <value>` and returns the data, or null. */
export type SteamRegQuery = (key: string, value: string) => Promise<string | null>
/** Reads a text file, or returns null when it cannot be read. */
export type ReadTextFile = (path: string) => Promise<string | null>
/** Reports whether a directory exists. */
export type DirExists = (path: string) => Promise<boolean>

export interface SteamDetectionOptions {
  platform: NodeJS.Platform
  runRegQuery?: SteamRegQuery
  readTextFile?: ReadTextFile
  dirExists?: DirExists
  /**
   * Roots tried when the registry yields nothing. Non-Windows has no registry, and
   * a test wants no registry either; both pass what to try here.
   */
  fallbackRoots?: string[]
}

/**
 * The registry keys that hold the Steam root, in the order Valve writes them.
 *
 * `HKCU\Software\Valve\Steam` is the client's own key and holds `SteamPath` with
 * forward slashes; the machine-wide keys hold `InstallPath` with backslashes. Both
 * spellings of the 32/64-bit view are tried, because a 32-bit Steam writes the
 * WOW6432Node copy and a 64-bit one may not.
 */
const STEAM_REGISTRY_KEYS: readonly { key: string; value: string }[] = [
  { key: 'HKCU\\Software\\Valve\\Steam', value: 'SteamPath' },
  { key: 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', value: 'InstallPath' },
  { key: 'HKLM\\SOFTWARE\\Valve\\Steam', value: 'InstallPath' }
]

/** Where the client keeps the list of library folders, relative to the root. */
const LIBRARY_FOLDERS_VDF = join('steamapps', 'libraryfolders.vdf')

// ---------------------------------------------------------------------------
// VDF
// ---------------------------------------------------------------------------

export type VdfValue = string | VdfObject
export interface VdfObject {
  [key: string]: VdfValue
}

/**
 * Unescapes a VDF string: `\\` is a backslash and `\"` a quote, which is why every
 * library path in `libraryfolders.vdf` reads `D:\\SteamLibrary`.
 */
export function unescapeVdfString(value: string): string {
  return value.replace(/\\(["\\])/g, '$1')
}

/**
 * Parses Valve's KeyValues format: `"key" "value"`, `"key" { … }`, `//` comments.
 *
 * Deliberately a parser rather than a regex sweep over the text: a library's `apps`
 * block has app ids as keys and sizes as values, so finding which library holds an
 * app means reading the nesting, and a regex over the whole file would happily match
 * one library's block against another's app id.
 *
 * Returns null on unbalanced braces, which is a corrupted file rather than an empty
 * one and must not be mistaken for "no libraries".
 */
export function parseVdf(text: string): VdfObject | null {
  const root: VdfObject = {}
  const stack: VdfObject[] = [root]
  /** `"key"` awaiting either a value or a block. */
  let pendingKey: string | null = null
  let cursor = 0

  while (cursor < text.length) {
    const char = text[cursor]

    if (char === undefined) break

    if (char === '/' && text[cursor + 1] === '/') {
      const newline = text.indexOf('\n', cursor)
      cursor = newline === -1 ? text.length : newline + 1
      continue
    }

    if (char === '"') {
      const end = findClosingQuote(text, cursor + 1)
      if (end === -1) return null
      const token = unescapeVdfString(text.slice(cursor + 1, end))
      cursor = end + 1
      if (pendingKey === null) {
        pendingKey = token
      } else {
        ;(stack.at(-1) as VdfObject)[pendingKey] = token
        pendingKey = null
      }
      continue
    }

    if (char === '{') {
      if (pendingKey === null) return null
      const child: VdfObject = {}
      ;(stack.at(-1) as VdfObject)[pendingKey] = child
      stack.push(child)
      pendingKey = null
      cursor += 1
      continue
    }

    if (char === '}') {
      if (stack.length <= 1) return null
      stack.pop()
      pendingKey = null
      cursor += 1
      continue
    }

    cursor += 1
  }

  return stack.length === 1 ? root : null
}

/** The index of the quote that closes the one at `open`, honouring `\"`. */
function findClosingQuote(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1
      continue
    }
    if (text[index] === '"') return index
  }
  return -1
}

/** Normalises a path from a Valve file: forward slashes out, no trailing separator. */
export function normaliseSteamPath(value: string): string {
  // Slashes first, then the trailing separator: doing it the other way round leaves
  // a trailing backslash behind whenever the file wrote `E:/SteamLibrary/`.
  return value.replace(/\//g, '\\').replace(/\\+$/, '')
}

/** Windows paths are case-insensitive, so two spellings can be one library. */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Every library folder in a `libraryfolders.vdf`, normalised to a plain path.
 *
 * The file is a map of numeric slots to objects with a `path`, so the slot numbers
 * are not read: they are insertion order, not an index anything else refers to.
 */
export function libraryPathsFromVdf(vdf: VdfObject): string[] {
  const folders = vdf['libraryfolders']
  if (folders === null || typeof folders !== 'object') return []

  const paths: string[] = []
  for (const slot of Object.values(folders)) {
    if (slot === null || typeof slot !== 'object') continue
    const path = slot['path']
    if (typeof path !== 'string' || path === '') continue
    const normalised = normaliseSteamPath(path)
    if (!paths.some((known) => samePath(known, normalised))) paths.push(normalised)
  }
  return paths
}

/**
 * App id -> the library paths whose `apps` block lists it.
 *
 * Valve records installed apps per library, so this says where to look before
 * touching the disk. The caller treats it as a hint: a library that lists the app
 * but has no folder is a stale entry, and one that has the folder but no listing is
 * a hand-copied install, so the resolution below checks the disk either way.
 */
export function appLibrariesFromVdf(vdf: VdfObject): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const folders = vdf['libraryfolders']
  if (folders === null || typeof folders !== 'object') return found

  for (const slot of Object.values(folders)) {
    if (slot === null || typeof slot !== 'object') continue
    const path = slot['path']
    const apps = slot['apps']
    if (typeof path !== 'string' || apps === null || typeof apps !== 'object') continue
    const library = normaliseSteamPath(path)
    for (const appId of Object.keys(apps)) {
      const libraries = found.get(appId) ?? []
      if (!libraries.some((known) => samePath(known, library))) libraries.push(library)
      found.set(appId, libraries)
    }
  }
  return found
}

/** The fields of an `appmanifest_<appid>.acf` this module needs. */
export interface AppManifest {
  name: string
  /** The folder name under `steamapps\common\` — the authoritative one. */
  installdir: string
  /** Valve's state flags; 4 means fully installed. */
  stateFlags: number
}

/**
 * Parses an app manifest.
 *
 * `installdir` is why this exists: the Classic Collection's three apps install to
 * `4249100_Biohazard` and friends, so a folder name cannot be derived from the
 * title and a scan of `common\` would be a guess. Returns null when either field is
 * missing, because a manifest without an installdir describes nothing.
 */
export function parseAppManifest(text: string): AppManifest | null {
  const vdf = parseVdf(text)
  if (vdf === null) return null
  const appState = vdf['AppState']
  if (appState === null || typeof appState !== 'object') return null

  const installdir = appState['installdir']
  if (typeof installdir !== 'string' || installdir === '') return null

  const name = appState['name']
  const stateFlags = appState['StateFlags']
  return {
    name: typeof name === 'string' ? name : '',
    installdir,
    stateFlags: typeof stateFlags === 'string' ? Number.parseInt(stateFlags, 10) || 0 : 0
  }
}

// ---------------------------------------------------------------------------
// defaults that touch the OS
// ---------------------------------------------------------------------------

async function defaultRunRegQuery(key: string, value: string): Promise<string | null> {
  const stdout = await new Promise<string | null>((resolveResult) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 }, (error, out) => {
      resolveResult(error === null ? out : null)
    })
  })
  if (stdout === null) return null
  // `reg query` prints `    SteamPath    REG_SZ    c:/program files (x86)/steam`.
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s+\S+\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/.exec(line)
    if (match !== null && match[1] !== undefined) return match[1].trim()
  }
  return null
}

async function defaultReadTextFile(path: string): Promise<string | null> {
  try {
    // Valve writes UTF-8 with a BOM on some installs; `parseVdf` tolerates the
    // remaining bytes either way, and the BOM would otherwise become part of the
    // first token.
    return (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')
  } catch {
    return null
  }
}

async function defaultDirExists(path: string): Promise<boolean> {
  const { stat } = await import('node:fs/promises')
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

/** The Steam client's install root, or '' when Steam is not installed. */
export async function findSteamRoot(options: SteamDetectionOptions): Promise<string> {
  const dirExists = options.dirExists ?? defaultDirExists

  if (options.platform === 'win32') {
    const runRegQuery = options.runRegQuery ?? defaultRunRegQuery
    for (const { key, value } of STEAM_REGISTRY_KEYS) {
      const raw = await runRegQuery(key, value)
      if (raw === null || raw === '') continue
      // `SteamPath` is written with forward slashes, `InstallPath` with backslashes.
      const candidate = normaliseSteamPath(raw)
      if (await dirExists(candidate)) return candidate
    }
  }

  for (const candidate of options.fallbackRoots ?? []) {
    const normalised = normaliseSteamPath(candidate)
    if (await dirExists(normalised)) return normalised
  }

  return ''
}

/** Every library folder Steam knows about, with the client's own root first. */
export async function findSteamLibraries(
  options: SteamDetectionOptions,
  root?: string
): Promise<string[]> {
  const steamRoot = root ?? (await findSteamRoot(options))
  if (steamRoot === '') return []

  const libraries = [steamRoot]
  const readTextFile = options.readTextFile ?? defaultReadTextFile
  const text = await readTextFile(join(steamRoot, LIBRARY_FOLDERS_VDF))
  if (text === null) return libraries

  const vdf = parseVdf(text)
  if (vdf === null) return libraries

  for (const path of libraryPathsFromVdf(vdf)) {
    if (!libraries.some((known) => samePath(known, path))) libraries.push(path)
  }
  return libraries
}

/**
 * Where an app is installed, or '' when it is not.
 *
 * Order: the libraries Valve lists the app in, then every other library. The second
 * pass costs one directory check per library and covers the installs Valve does not
 * list — a library rebuilt by hand, or a manifest that has been edited — which is
 * exactly the case a launcher for a 1998 re-release should tolerate.
 */
export async function findSteamAppDir(
  appId: string,
  options: SteamDetectionOptions
): Promise<string> {
  if (appId === '') return ''

  const dirExists = options.dirExists ?? defaultDirExists
  const steamRoot = await findSteamRoot(options)
  if (steamRoot === '') return ''

  const libraries = await findSteamLibraries(options, steamRoot)

  const readTextFile = options.readTextFile ?? defaultReadTextFile
  const listing = await readTextFile(join(steamRoot, LIBRARY_FOLDERS_VDF))
  const declared =
    listing === null ? [] : (appLibrariesFromVdf(parseVdf(listing) ?? {}).get(appId) ?? [])

  const ordered = [
    ...declared,
    ...libraries.filter((library) => !declared.some((known) => samePath(known, library)))
  ]

  for (const library of ordered) {
    const installDir = await appInstalldir(library, appId, readTextFile)
    if (installDir === '') continue
    const candidate = join(library, 'steamapps', 'common', installDir)
    if (await dirExists(candidate)) return candidate
  }

  return ''
}

/** The `installdir` from a library's manifest for an app, or ''. */
async function appInstalldir(
  library: string,
  appId: string,
  readTextFile: ReadTextFile
): Promise<string> {
  const manifest = await readTextFile(
    join(library, 'steamapps', `appmanifest_${appId}.acf`)
  )
  if (manifest === null) return ''
  return parseAppManifest(manifest)?.installdir ?? ''
}
