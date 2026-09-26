/**
 * Install validation — the port of the removed `src/install/install_validator.cpp`.
 *
 * The legacy launcher answered three questions per version (`ValidateTitle`):
 * does the install root exist, does the version's executable exist, and does the
 * title-specific data marker exist. Three of three answered "installed", zero of
 * three "missing", anything in between "partial", and the Install Status screen
 * grouped those per-version states into INSTALLED / PARTIAL / MISSING per title
 * (`screen_install.cpp: TitleLineStatus`).
 *
 * Two deliberate departures from the C++:
 *
 *  - Name comparisons are case-insensitive and are made against a directory
 *    listing rather than a single `stat`. `GetFileAttributesA` / `stat` defer
 *    case folding to the filesystem, so a repacked install whose file is called
 *    `residentevil.exe` failed the legacy check that the catalog spells
 *    `ResidentEvil.exe`, and on a case-sensitive volume it was expected to. The
 *    catalog strings are hand-authored once — executables, data markers and mod
 *    folder names alike — so the check is made here against what is actually on
 *    disk instead of trusting the spelling.
 *  - `requiresMod` is folded into the probe (see `probeVersion`), because the new
 *    catalog can express "this row is only playable with RE-Enhance" (RE1 JP),
 *    which the legacy `GameVersion` struct could not.
 *
 * No design values appear here: this module never renders anything, so nothing in
 * `.ref/designref/` bears on it.
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { TITLE_DATA_PROBES } from '@shared/catalog'
import type { InstallState, TitleId } from '@shared/types'

import type { VersionProbe, VersionProbeInput } from './contracts'

// ---------------------------------------------------------------------------
// directory probing
// ---------------------------------------------------------------------------

/** What one segment of a probed relative path has to be. */
type ProbeEntryKind = 'file' | 'dir'

/**
 * A directory entry flattened at read time: the probe loop then decides on kind
 * without holding a `Dirent` (whose type signature varies across `@types/node`
 * versions), and `other` costs one `stat` only when a name actually matched.
 */
interface ListedEntry {
  name: string
  kind: 'file' | 'dir' | 'other'
  fullPath: string
}

/**
 * The catalog's data probes mix both kinds: RE1 is validated by the `USA`
 * directory, RE2/RE3 by an executable. The legacy validator made that same
 * distinction by hand (`DirExists` for RE1, `FileExists` for RE2/RE3), so the
 * kind is recovered from the marker's shape — a short alphanumeric extension is
 * a file name, anything else (`USA`, `USA/Data`) a directory name.
 */
const FILE_MARKER = /\.[a-z0-9]{1,8}$/i

function markerKind(marker: string): ProbeEntryKind {
  return FILE_MARKER.test(marker) ? 'file' : 'dir'
}

/**
 * Splits a catalog-authored relative path into segments, accepting either
 * separator: the catalog writes `USA/Data` while the legacy validator joined
 * `USA\Data` with a literal backslash, which could only ever resolve on Windows.
 */
function pathSegments(relative: string): string[] {
  return relative.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

/** A listing, or `null` when the path is not a readable directory. */
async function listEntries(dirPath: string): Promise<ListedEntry[] | null> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.map(
      (entry): ListedEntry => ({
        name: entry.name,
        kind: entry.isFile() ? 'file' : entry.isDirectory() ? 'dir' : 'other',
        fullPath: join(dirPath, entry.name)
      })
    )
  } catch {
    // ENOENT (no install), ENOTDIR (a file where a folder was expected) and
    // EACCES (no traversal right) all mean the same thing to a probe: the path
    // cannot be confirmed. The legacy `DirHasAnyFile` likewise returned false on
    // any failure to open the directory.
    return null
  }
}

async function entryAcceptsKind(entry: ListedEntry, kind: ProbeEntryKind): Promise<boolean> {
  if (entry.kind !== 'other') return entry.kind === kind
  // A symlink, or a volume that reports no dirent type. `GetFileAttributesA`
  // followed reparse points, so resolve the target rather than fail the probe.
  try {
    const info = await stat(entry.fullPath)
    return kind === 'dir' ? info.isDirectory() : info.isFile()
  } catch {
    return false
  }
}

/** Directory existence, with the legacy guard against an undetected root. */
async function dirExists(dirPath: string): Promise<boolean> {
  if (dirPath.length === 0) return false // `!title.installPath.empty()`
  try {
    return (await stat(dirPath)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Case-insensitive resolution of a catalog-authored relative path beneath
 * `root`, returning the real on-disk path or `null`. Intermediate segments must
 * be directories, the last one must be of `kind`, and an empty path never
 * resolves — there is nothing to look for.
 *
 * This is used for the mod folder as well: `modPath` is authored in the catalog
 * too, so joining it blindly would push the case question back onto the OS and
 * fail outright on a case-sensitive volume.
 */
async function resolveRelativePath(
  root: string,
  relative: string,
  kind: ProbeEntryKind
): Promise<string | null> {
  const segments = pathSegments(relative)
  if (segments.length === 0) return null

  let currentDir = root
  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1
    const entries = await listEntries(currentDir)
    if (entries === null) return null

    const wanted = segment.toLowerCase()
    let matched: string | null = null
    for (const entry of entries) {
      if (entry.name.toLowerCase() !== wanted) continue
      // Keep looking rather than give up on the first name hit: on a
      // case-sensitive volume two entries can differ by case alone, and only one
      // of them may be the file/directory the probe wants.
      if (await entryAcceptsKind(entry, isLast ? kind : 'dir')) {
        matched = entry.fullPath
        break
      }
    }

    if (matched === null) return null
    currentDir = matched
  }
  return currentDir
}

/** Port of `ExtraDataOk`: the title-specific marker from the shared catalog. */
async function dataOkFor(titleId: TitleId, installPath: string): Promise<boolean> {
  const markers = TITLE_DATA_PROBES[titleId]
  // `ExtraDataOk` returned false for a title it did not recognise, so an unknown
  // id fails the probe rather than passing it by default.
  if (!markers || markers.length === 0) return false

  for (const marker of markers) {
    if ((await resolveRelativePath(installPath, marker, markerKind(marker))) !== null) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------

/**
 * True when `<modsDir>/<modPath>` is a folder holding at least one entry —
 * `ValidateMods` + `DirHasAnyFile`. Any entry counts, including a subfolder or a
 * hidden file, so a `.gitkeep` placeholder keeps a mod "available"; only the
 * `.` / `..` names the legacy loop skipped are excluded, and `readdir` never
 * yields those.
 *
 * An empty `modPath` is unavailable: legacy cleared `hasMod` for that case
 * instead of falling back to listing the whole mod base directory.
 */
export async function modsAvailable(modsDir: string, modPath: string): Promise<boolean> {
  if (modPath.length === 0) return false
  // The folder is located case-insensitively, like every other catalog-authored
  // name; a file sitting where the mod folder should be does not match.
  const modDir = await resolveRelativePath(modsDir, modPath, 'dir')
  if (modDir === null) return false
  const entries = await listEntries(modDir)
  return entries !== null && entries.length > 0
}

/**
 * The legacy count — three probes, 3 -> installed, 0 -> missing, else partial —
 * followed by the legacy RE-Enhance veto.
 *
 * The legacy `InstallValidator::ValidateTitle` computed the state from the three
 * probes and *then* demoted an `INSTALLED` version to `MISSING` when it required
 * RE-Enhance and the mod was absent. `modOk` carries that requirement, so the veto
 * lives here, where the legacy code had it, and the three probes keep reporting
 * what is actually on disk. That matters for the message the user sees: the real
 * cause of an RE1 JP row being unusable is a missing mod folder, not a missing
 * game, and `catalog-state.ts` reads the probes to say which.
 *
 * The veto can only *demote*: a row that already failed a real probe stays
 * exactly as the legacy rule scored it.
 */
export function stateFromProbe(probe: VersionProbe): InstallState {
  const passed = (probe.installOk ? 1 : 0) + (probe.exeOk ? 1 : 0) + (probe.dataOk ? 1 : 0)
  const state: InstallState = passed === 3 ? 'installed' : passed === 0 ? 'missing' : 'partial'
  if (state === 'installed' && !probe.modOk) return 'missing'
  return state
}

/**
 * Runs the three legacy probes for one catalog row and reports the RE-Enhance
 * requirement alongside them.
 *
 * `modOk` reports whether the row's *requirement* is met: for a `requiresMod` row
 * the mod folder must exist and hold something; for every other row there is no
 * requirement that can fail, so it is `true`. Whether RE-Enhance files happen to
 * be present for a row that does not need them is the separate `hasMod` question,
 * which the catalog builder answers with `modsAvailable` on its own
 * (`CatalogBuildOptions.modsAvailableFn`).
 *
 * `stateFromProbe` applies the veto, so a `requiresMod` row with no mod is
 * 'missing'. Keeping the three probes truthful is what lets the row explain
 * itself; folding them away would report a perfectly good install as absent.
 *
 * `modExecRelPath` is intentionally not probed: the legacy validator only checked
 * that the mod *folder* existed and held something, and whether the mod's own
 * executable is really there is decided when the mod is injected.
 */
export async function probeVersion(input: VersionProbeInput): Promise<VersionProbe> {
  const installOk = await dirExists(input.installPath)

  // Both remaining probes are relative to the install root, so legacy skipped
  // them when it was absent — and a relative lookup against a missing root can
  // only fail anyway.
  const exeOk = installOk
    ? (await resolveRelativePath(input.installPath, input.execRelPath, 'file')) !== null
    : false
  const dataOk = installOk ? await dataOkFor(input.titleId, input.installPath) : false

  const modOk = input.requiresMod ? await modsAvailable(input.modsDir, input.modPath) : true

  return { installOk, exeOk, dataOk, modOk }
}
