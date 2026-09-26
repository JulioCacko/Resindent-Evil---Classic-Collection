/**
 * GOG install detection.
 *
 * Port of the removed `src/install/gog_detector.cpp` (read it with
 * `git show HEAD:src/install/gog_detector.cpp`). The legacy detector called
 * `RegOpenKeyExA` / `GetFileAttributesA` directly, so it could only be exercised
 * by hand on a Windows box with the retail titles installed. Every OS touch now
 * goes through `GogDetectionOptions` so the detection itself stays unit
 * testable, while the stage order and the "the directory must exist" rule are
 * unchanged.
 *
 * Detection order for one title (legacy `DetectAllGames` + `DetectInstallPath`):
 *   1. `<gogPathOverride>/<gogFolderName>`      the user's explicit choice
 *   2. `<appDir>/GOG Games/<gogFolderName>`     the copy shipped next to the launcher
 *   3. registry `path` for the title's GOG id    WOW6432Node first, then the 64-bit view
 *   4. `C:\GOG Games`, `C:\Program Files (x86)\GOG Games`, `D:\GOG Games`
 *
 * A stage only wins when the candidate directory exists; anything else falls
 * through to the next stage. On non-Windows platforms the registry and the
 * `C:\` roots cannot exist, so stages 3-4 are replaced by the GOG Galaxy data
 * directory (see `detectGalaxyInstall`).
 */
import { execFile } from 'node:child_process'
import { access, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type { GogDetectionOptions, GogTitleRef } from '../contracts'

/** Local implementations of the two injected seams, taken from the contract. */
type PathExists = NonNullable<GogDetectionOptions['pathExists']>
type RegQueryRunner = NonNullable<GogDetectionOptions['runRegQuery']>

/** Registry value GOG writes the install root into. */
const REG_VALUE_NAME = 'path'

/** REG_SZ/REG_EXPAND_SZ value line from `reg query`, e.g. `    path    REG_SZ    D:\Games\Resident Evil`. */
const REG_VALUE_LINE = /^\s*(\S+)\s+(REG_[A-Z0-9_]+)\s*(.*)$/

/** `reg query` failure text: "unable to find the specified registry key or value". */
const REG_ERROR_LINE = /^\s*ERROR:/i

/** Value types the legacy detector accepted; anything else is not a path. */
const REG_PATH_TYPES = new Set(['REG_SZ', 'REG_EXPAND_SZ'])

/** Folder that holds GOG installs inside the launcher's own directory. */
const LOCAL_GOG_DIR_NAME = 'GOG Games'

/** Probe order copied from `ProbeCommonRoots` in the legacy detector. */
const WINDOWS_GOG_ROOTS = [
  'C:\\GOG Games',
  'C:\\Program Files (x86)\\GOG Games',
  'D:\\GOG Games'
] as const

/** GOG Galaxy's per-user data directory, relative to the home directory. */
const GALAXY_DATA_SEGMENTS = ['.local', 'share', 'GOG.com'] as const

/**
 * Legacy `GogIdToFolderName`. The catalog carries `gogFolderName` explicitly, so
 * this is only a fallback for callers that know nothing but the GOG id.
 */
const LEGACY_FOLDER_NAMES_BY_GOG_ID: Readonly<Record<string, string>> = {
  '1580232252': 'Resident Evil',
  '1534123252': 'Resident Evil 2',
  '1266089300': 'Resident Evil 3'
}

/**
 * Extracts the `path` value from `reg query <subkey> /v path` output.
 *
 * `reg query` is used rather than a native module because a native registry
 * binding would need `electron-rebuild` and a per-ABI binary. The tradeoff is
 * that the machine-readable output has to be parsed, which is what this handles:
 * variable column spacing, CRLF endings, REG_SZ and REG_EXPAND_SZ, values with
 * spaces, and the `ERROR: ...` line that `reg` prints when the key or the value
 * is missing.
 *
 * Returns null when there is no usable value: no `path` value line, a non-string
 * value type, an empty value (the legacy detector treated a zero-length buffer
 * as "not found" and every caller tested for empty), or the ERROR text.
 */
export function parseRegQueryOutput(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (REG_ERROR_LINE.test(line)) {
      return null
    }
    const match = REG_VALUE_LINE.exec(line)
    if (match === null) {
      continue
    }
    const name = match[1]
    const type = match[2]
    const data = match[3]
    // A bare `HKEY_LOCAL_MACHINE\...` header line never matches REG_VALUE_LINE,
    // and unrelated values (`gameID`, `DisplayName`) are skipped rather than
    // mistaken for a path.
    if (name.toLowerCase() !== REG_VALUE_NAME || !REG_PATH_TYPES.has(type)) {
      continue
    }
    const value = data.trim()
    return value === '' ? null : value
  }
  return null
}

/**
 * Resolves the on-disk folder name for a title. The catalog sets
 * `gogFolderName`; the id lookup mirrors the legacy `GogIdToFolderName` so a
 * caller holding only a GOG id still detects.
 */
function resolveGogFolderName(title: GogTitleRef): string {
  const declared = title.gogFolderName.trim()
  if (declared !== '') {
    return declared
  }
  return LEGACY_FOLDER_NAMES_BY_GOG_ID[title.gogGameId] ?? ''
}

/**
 * Real existence probe: `access` for the common case, then a directory check
 * because the legacy `Paths::DirExists` accepted directories only, so a stray
 * file must not be reported as an install root.
 */
async function defaultPathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate)
  } catch {
    return false
  }
  try {
    const info = await stat(candidate)
    return info.isDirectory()
  } catch {
    return false
  }
}

/**
 * Real registry probe. `reg query` exits non-zero and prints the ERROR text when
 * the key or value is missing, which is the ordinary "not installed here"
 * answer, so it becomes null instead of a rejection: detection must never throw
 * because of an unreadable registry.
 */
function defaultRunRegQuery(subkey: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    execFile(
      'reg',
      ['query', subkey, '/v', REG_VALUE_NAME],
      { windowsHide: true },
      (error, stdout) => {
        resolve(error === null ? stdout : null)
      }
    )
  })
}

/**
 * Registry key paths for a GOG id, in the legacy probe order: the 32-bit
 * installer writes under WOW6432Node even on a 64-bit OS, and the plain key is
 * the fallback for a native 64-bit install. The full `HKLM\` path is passed to
 * `runRegQuery` because that is exactly the argument `reg query` takes.
 */
function registrySubkeys(gogGameId: string): string[] {
  return [
    `HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\${gogGameId}`,
    `HKLM\\SOFTWARE\\GOG.com\\Games\\${gogGameId}`
  ]
}

/** Stage 3: the recorded install root, which must still exist on disk. */
async function detectRegistryInstall(
  gogGameId: string,
  runRegQuery: RegQueryRunner,
  pathExists: PathExists
): Promise<string> {
  if (gogGameId === '') {
    return ''
  }
  for (const subkey of registrySubkeys(gogGameId)) {
    let stdout: string | null
    try {
      stdout = await runRegQuery(subkey)
    } catch {
      // A registry read must never abort detection; treat a throwing runner the
      // same as a missing key and try the next one.
      stdout = null
    }
    if (stdout === null) {
      continue
    }
    const value = parseRegQueryOutput(stdout)
    if (value === null) {
      continue
    }
    // Legacy gated the registry result on `Paths::DirExists`, so a stale install
    // record falls through to the next key and then to the common roots.
    if (await pathExists(value)) {
      return value
    }
  }
  return ''
}

/**
 * Directory entries of a Galaxy data root, exported for the unit test that
 * cannot reach the real `~/.local/share/GOG.com`. Unreadable or missing roots
 * simply have no games in them.
 */
export async function listGalaxyGameDirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))
  } catch {
    return []
  }
}

/**
 * Non-Windows stage 3: Galaxy keeps its per-game data directories directly under
 * `~/.local/share/GOG.com`, so look for the folder name there first, then scan
 * the root once. The scan compares basenames case-insensitively because Galaxy
 * stores whatever spelling it chose at install time.
 */
async function detectGalaxyInstall(folderName: string, pathExists: PathExists): Promise<string> {
  if (folderName === '') {
    return ''
  }
  const root = join(homedir(), ...GALAXY_DATA_SEGMENTS)
  const direct = join(root, folderName)
  if (await pathExists(direct)) {
    return direct
  }
  // Guarded on the injected probe so a test never has to touch the real disk.
  if (!(await pathExists(root))) {
    return ''
  }
  const wanted = folderName.toLowerCase()
  for (const dir of await listGalaxyGameDirs(root)) {
    if (basename(dir).toLowerCase() === wanted) {
      return dir
    }
  }
  return ''
}

/**
 * Detects one title's install root. Returns '' when no stage produced an
 * existing directory, matching the legacy `std::string()` return that every
 * caller treated as "not installed".
 */
export async function detectInstallPath(
  title: GogTitleRef,
  options: GogDetectionOptions
): Promise<string> {
  const pathExists: PathExists = options.pathExists ?? defaultPathExists
  const folderName = resolveGogFolderName(title)
  const overrideRoot = options.gogPathOverride.trim()

  // 1. Explicit override. The legacy code only trusted the override when the
  //    base directory existed, and the per-title folder still had to exist. A
  //    missing folder falls through to the following stages rather than
  //    reporting the override root, which holds the other titles, not this one.
  if (overrideRoot !== '' && folderName !== '') {
    const candidate = join(overrideRoot, folderName)
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  // 2. The copy that sits next to the launcher. Guarded on a non-empty appDir so
  //    a relative `GOG Games/...` can never match the process working directory.
  if (options.appDir !== '' && folderName !== '') {
    const candidate = join(options.appDir, LOCAL_GOG_DIR_NAME, folderName)
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  if (options.platform === 'win32') {
    // 3. Registry.
    const registry = await detectRegistryInstall(
      title.gogGameId,
      options.runRegQuery ?? defaultRunRegQuery,
      pathExists
    )
    if (registry !== '') {
      return registry
    }

    // 4. Common roots.
    if (folderName !== '') {
      for (const root of WINDOWS_GOG_ROOTS) {
        const candidate = join(root, folderName)
        if (await pathExists(candidate)) {
          return candidate
        }
      }
    }
    return ''
  }

  // Non-Windows: no registry and no `C:\` roots, so the Galaxy data directory is
  // the last resort.
  return detectGalaxyInstall(folderName, pathExists)
}

/**
 * Detects every title, keyed by title id. Titles that were not found map to ''
 * rather than being omitted, so callers can overwrite `installPath` for the whole
 * catalog in one pass and never keep a stale path from a previous run. Each entry
 * comes from `detectInstallPath`, so the two exported detectors cannot disagree.
 */
export async function detectAllInstallPaths(
  titles: GogTitleRef[],
  options: GogDetectionOptions
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  // Sequential on purpose: titles usually share one override or `GOG Games` root,
  // and serial probing keeps the injected doubles call-ordered and cheap.
  for (const title of titles) {
    result[title.id] = await detectInstallPath(title, options)
  }
  return result
}
