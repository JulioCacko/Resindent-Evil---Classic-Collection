/**
 * Mod injection: overlay a RE-Enhance tree onto a retail install, reversibly.
 *
 * Behavioural reference: `src/games/mod_loader.cpp`, deleted from the working
 * tree but still readable from git history. That version joined paths with
 * `Paths::Join`, copied with `CopyFileBinary` (which created the destination
 * parent with `Paths::EnsureDirTree`), recursed the source tree with
 * `FindFirstFileA` / `readdir`, skipped `.`/`..`, and skipped any *source* file
 * whose name contained `readme` or `changelog` (`ShouldSkipFileByName`). It had
 * no way back out: `ModLoader::RemoveMod` only logged "restore from backup is
 * not yet implemented".
 *
 * This module keeps those copy rules and adds the missing half: every file that
 * is about to be overwritten is first stored under
 * `<installPath>/.mod_backup/<same relative path>` and recorded in
 * `.mod_backup/manifest.txt`, one relative path per line, so `removeMod` can put
 * the retail install back exactly as it was.
 *
 * Two divergences from the C++ are forced by the size of a real `reenhancemods`
 * tree (tens of thousands of files), not by taste:
 *  - every filesystem call goes through `node:fs/promises`, so a multi-second
 *    injection never stalls the main process event loop (the launcher window
 *    keeps painting while the progress bar moves);
 *  - the source tree is walked twice, once to count and once to act, so
 *    `ModProgress.filesTotal` is a real number instead of a guess.
 *
 * This module deliberately imports nothing from its sibling main-process
 * modules, so it stays unit-testable with no Electron and no logger present.
 */
import { constants as fsConstants } from 'node:fs'
import { appendFile, copyFile, lstat, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ModProgress } from '@shared/types'
import type { ModContext, LauncherFile, ModResult } from './contracts'

/** Backup directory name, fixed by the brief and shared with the IPC layer. */
const BACKUP_DIR_NAME = '.mod_backup'

/** Manifest file name inside the backup directory. */
const MANIFEST_FILE_NAME = 'manifest.txt'

/**
 * A source file whose *name* contains one of these fragments is documentation,
 * not payload; the legacy `ShouldSkipFileByName` tested the file name only, so a
 * mod's `README.md` is skipped even when the install has its own `README.md`
 * somewhere else in the tree.
 */
const SKIPPED_NAME_FRAGMENTS = ['readme', 'changelog']

/** One file of the mod source tree, with the install-relative path it maps to. */
interface SourceFile {
  absolute: string
  relative: string
}

/**
 * A file the *launcher* puts in the install, rather than one that comes from the mod payload.
 *
 * Declared in `contracts.ts` (this module implements those declarations); see `LauncherFile` there
 * for why the overlay rides the injection pass.
 */

// ---------------------------------------------------------------------------
// small path / errno helpers
// ---------------------------------------------------------------------------

/**
 * Splits an install-relative path into safe segments, or returns null when the
 * path could escape the root (absolute, drive-qualified, or containing `..`).
 * The manifest is a file on disk that a user can edit, so its entries are never
 * trusted blindly: `removeMod` deletes files, and a `..` entry would otherwise
 * let a corrupt manifest reach outside the install.
 */
function relativeSegments(relativePath: string): string[] | null {
  const normalized = relativePath.replace(/\\/g, '/').trim()
  if (normalized === '' || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return null
  }
  const segments = normalized
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
  if (segments.length === 0 || segments.includes('..')) {
    return null
  }
  return segments
}

/** Resolves `segments` under `root`, rejecting anything that leaves `root`. */
function resolveInside(root: string, segments: string[]): string {
  const resolved = resolve(root, ...segments)
  const contained = relative(root, resolved)
  if (contained === '' || contained.startsWith('..') || isAbsolute(contained)) {
    throw new Error(`path escapes ${root}: ${segments.join('/')}`)
  }
  return resolved
}

function errnoCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null
  }
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function isErrno(error: unknown, code: string): boolean {
  return errnoCode(error) === code
}

/**
 * Names the failing path *and* the errno. Node's own message already begins with
 * the errno and names the path it touched (e.g. `EISDIR: illegal operation on a
 * directory, copyfile 'a' -> 'b'`), so it is reused verbatim when it does; only
 * synthesized/aggravated errors fall back to the caller-supplied path.
 */
function failureMessage(error: unknown, fallbackPath: string): string {
  const code = errnoCode(error)
  const detail = error instanceof Error ? error.message : String(error)
  if (code !== null && detail.startsWith(`${code}:`)) {
    return detail
  }
  return `${code ?? 'ERROR'}: ${fallbackPath}: ${detail}`
}

function failure(error: unknown, fallbackPath: string, filesDone: number, filesTotal: number): ModResult {
  return { ok: false, filesDone, filesTotal, message: failureMessage(error, fallbackPath) }
}

// ---------------------------------------------------------------------------
// small filesystem probes
// ---------------------------------------------------------------------------

/**
 * Existence probe that treats every stat failure as "absent", mirroring the
 * legacy `Paths::FileExists` / `Paths::DirectoryExists`, which reported false
 * whenever `GetFileAttributesA` / `stat` failed for any reason.
 */
async function isRegularFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile()
  } catch {
    return false
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

/**
 * `lstat`, not `stat`: an entry is only entered when it is a directory in its own
 * right, so a directory symlink — or a Windows junction, which `stat` reports as
 * a directory — can never make the walk leave the mod tree. A probe failure is
 * treated as "do not enter", because entering the wrong thing is unrecoverable
 * while skipping an unreadable directory is merely incomplete.
 */
async function isRealDirectory(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isDirectory()
  } catch {
    return false
  }
}

function shouldSkipFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return SKIPPED_NAME_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

// ---------------------------------------------------------------------------
// progress reporting
// ---------------------------------------------------------------------------

/**
 * Wraps the caller's progress callback so a throwing consumer (in practice the
 * IPC sender, when the window went away mid-launch) cannot abort a half-finished
 * copy. The returned function never throws.
 */
function createReporter(
  versionId: string,
  onProgress?: (progress: ModProgress) => void
): (phase: ModProgress['phase'], filesDone: number, filesTotal: number) => void {
  if (onProgress === undefined) {
    return () => undefined
  }
  return (phase, filesDone, filesTotal) => {
    try {
      onProgress({ versionId, phase, filesDone, filesTotal })
    } catch {
      // Intentionally ignored: progress is advisory, the copy is not.
    }
  }
}

// ---------------------------------------------------------------------------
// source tree walk
// ---------------------------------------------------------------------------

/**
 * Collects every file of the mod source tree that will actually be copied,
 * depth-first, with entries sorted by name so the walk — and therefore the
 * manifest — is deterministic across runs (the legacy walk returned whatever
 * order the filesystem handed out, which made "which file failed first"
 * unpredictable).
 *
 * `relativePrefix` is always `/`-separated: the manifest stores POSIX-style
 * relative paths, matching the legacy `Paths::NormalizePath` + `Paths::Join`,
 * and `relativeSegments` converts them back to native separators when resolving.
 */
async function collectSourceFiles(
  directory: string,
  relativePrefix: string,
  collected: SourceFile[]
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))

  for (const entry of entries) {
    const relativePath = relativePrefix === '' ? entry.name : `${relativePrefix}/${entry.name}`
    const absolutePath = join(directory, entry.name)

    if (entry.isDirectory()) {
      if (await isRealDirectory(absolutePath)) {
        await collectSourceFiles(absolutePath, relativePath, collected)
      }
      continue
    }

    if (entry.isSymbolicLink()) {
      // A symlink is never recursed into (isRealDirectory above rejects it); one
      // that resolves to a regular file is still copied as content, which is what
      // the legacy `std::fopen(..., "rb")` did — it read through the link.
      if ((await isRegularFile(absolutePath)) && !shouldSkipFileName(entry.name)) {
        collected.push({ absolute: absolutePath, relative: relativePath })
      }
      continue
    }

    // FIFOs, sockets and device nodes are not mod payload.
    if (!entry.isFile()) {
      continue
    }

    if (shouldSkipFileName(entry.name)) {
      continue
    }

    collected.push({ absolute: absolutePath, relative: relativePath })
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * True when `<installPath>/.mod_backup` exists, i.e. the install carries the
 * state of an injection. Note this is the *directory*, not the manifest: an
 * injection that crashed between its first backup and the first manifest flush
 * still leaves backups on disk, and the caller should treat that as "not clean".
 */
export async function hasBackup(installPath: string): Promise<boolean> {
  if (installPath === '') {
    return false
  }
  return isDirectory(join(installPath, BACKUP_DIR_NAME))
}

/**
 * Reads the injection manifest. A missing manifest is an empty list (the normal
 * state of a clean install); any other read failure is rethrown so `removeMod`
 * can report it with the errno instead of silently believing there is nothing to
 * restore.
 */
export async function readManifest(installPath: string): Promise<string[]> {
  if (installPath === '') {
    return []
  }
  const manifestPath = join(installPath, BACKUP_DIR_NAME, MANIFEST_FILE_NAME)

  let contents: string
  try {
    contents = await readFile(manifestPath, 'utf8')
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return []
    }
    throw error
  }

  return contents
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter((line) => line !== '')
}

/**
 * Overlays `<modsDir>/<modPath>` onto `context.installPath`.
 *
 * For every source file, in this order: if the destination already exists it is
 * copied into `.mod_backup/<same relative path>`, then its relative path is
 * recorded in the manifest, and only then does the mod file overwrite it. That
 * ordering is the whole point, and it has two halves: a file is never overwritten
 * before its original is saved, and never overwritten before the manifest says so
 * — see `recordOverlay` for what the second half costs.
 *
 * Files whose names contain `readme` or `changelog` are skipped and are not
 * counted in `filesTotal`, so a consumer's progress bar reaches 100% exactly at
 * the last real file.
 */
export async function injectMod(
  context: ModContext,
  onProgress?: (progress: ModProgress) => void,
  signal?: AbortSignal,
  launcherFiles?: readonly LauncherFile[]
): Promise<ModResult> {
  const { installPath } = context
  const modPathSegments = context.modPath === '' ? null : relativeSegments(context.modPath)

  if (installPath === '' || context.modsDir === '' || modPathSegments === null) {
    return {
      ok: false,
      filesDone: 0,
      filesTotal: 0,
      message: `EINVAL: an injection needs an install path, a mods directory and a mod folder name: installPath='${installPath}' modsDir='${context.modsDir}' modPath='${context.modPath}'`
    }
  }

  const backupDir = join(installPath, BACKUP_DIR_NAME)
  const manifestPath = join(backupDir, MANIFEST_FILE_NAME)
  const report = createReporter(context.versionId, onProgress)

  // Directories this call already created; `mkdir` is idempotent but a real mod
  // tree puts thousands of files in a handful of directories, so the memo removes
  // thousands of redundant syscalls.
  const ensuredDirectories = new Set<string>()
  const ensureDirectory = async (directory: string): Promise<void> => {
    if (ensuredDirectories.has(directory)) {
      return
    }
    await mkdir(directory, { recursive: true })
    ensuredDirectories.add(directory)
  }

  /**
   * Records one overlayed file in the manifest, durably, BEFORE its destination is overwritten.
   *
   * The order is the whole point, and it is not the order the copy used to use. `removeMod` walks the
   * manifest and then deletes `.mod_backup` wholesale, so an overwritten file that never reached the
   * manifest does not merely stay injected: its backup is orphaned and then removed along with the
   * tree, and the retail original is gone for good. The previous version buffered 128 lines and
   * appended them in batches, which left up to 127 overwritten files in exactly that window — and a
   * hard kill or a power loss during the copy is precisely when it would be hit, because no `finally`
   * runs to flush what is still in memory.
   *
   * One small append per file is what closing that window costs, against a `copyFile` that has just
   * touched the same directory tree. Recording a path whose copy then fails is harmless by comparison:
   * `removeMod` restores its backup, or deletes a file that was never written.
   */
  const recordOverlay = async (relative: string): Promise<void> => {
    await ensureDirectory(backupDir)
    await appendFile(manifestPath, `${relative}\n`, 'utf8')
  }

  let filesDone = 0
  let filesTotal = 0
  // Path of the operation in flight, used only to name the first failing path.
  let currentTarget = installPath

  try {
    // The destination must already exist: `mkdir` is recursive, so an unchecked
    // injection into a mistyped install path would happily create the retail
    // directory tree out of nothing.
    try {
      if (!(await stat(installPath)).isDirectory()) {
        return {
          ok: false,
          filesDone: 0,
          filesTotal: 0,
          message: `ENOTDIR: install path is not a directory: ${installPath}`
        }
      }
    } catch (error) {
      return failure(error, installPath, 0, 0)
    }

    const sourceRoot = resolveInside(context.modsDir, modPathSegments)
    try {
      if (!(await stat(sourceRoot)).isDirectory()) {
        return {
          ok: false,
          filesDone: 0,
          filesTotal: 0,
          message: `ENOTDIR: mod source path is not a directory: ${sourceRoot}`
        }
      }
    } catch (error) {
      return failure(error, sourceRoot, 0, 0)
    }

    // A previous injection is recorded by its manifest. Its progress is not
    // forwarded: restore/cleanup counters describe a different file list, and
    // mixing them into this call's monotonic 0..filesTotal sequence would make the
    // caller's progress bar jump backwards. Injected files already exist in the
    // destination, so undoing first also keeps the new backups capturing retail
    // originals rather than mod files.
    if (await isRegularFile(manifestPath)) {
      const undone = await removeMod(context)
      if (!undone.ok) {
        return {
          ok: false,
          filesDone: 0,
          filesTotal: 0,
          message: `previous injection could not be undone: ${undone.message ?? 'unknown error'}`
        }
      }
    }

    const files: SourceFile[] = []
    try {
      await collectSourceFiles(sourceRoot, '', files)
    } catch (error) {
      return failure(error, sourceRoot, 0, 0)
    }

    /*
     * The launcher's own files join the same list, so every line below - backup, copy, manifest -
     * treats them identically. Only the ones that exist are added: a launcher file that is not there
     * is a build that has not run `pnpm build:overlay`, and that must not fail a launch.
     */
    for (const file of launcherFiles ?? []) {
      if (await isRegularFile(file.from)) {
        files.push({ absolute: file.from, relative: file.to })
      }
    }

    filesTotal = files.length
    report('backup', 0, filesTotal)

    for (const file of files) {
      if (signal?.aborted === true) {
        return {
          ok: false,
          filesDone,
          filesTotal,
          message: `aborted: ${filesDone} of ${filesTotal} mod files were copied to ${installPath}`
        }
      }

      const segments = relativeSegments(file.relative)
      if (segments === null) {
        return {
          ok: false,
          filesDone,
          filesTotal,
          message: `EINVAL: mod file name is not a safe relative path: ${file.relative}`
        }
      }

      const destination = resolveInside(installPath, segments)
      currentTarget = destination

      if (await isRegularFile(destination)) {
        report('backup', filesDone, filesTotal)
        const backupPath = resolveInside(backupDir, segments)
        currentTarget = backupPath
        await ensureDirectory(dirname(backupPath))
        try {
          // COPYFILE_EXCL, not a plain copy: if an earlier injection crashed and
          // left an orphaned `.mod_backup` (backups, no manifest), the older copy
          // is closer to the retail original, so it is kept instead of being
          // overwritten with an already-injected file.
          await copyFile(destination, backupPath, fsConstants.COPYFILE_EXCL)
        } catch (error) {
          if (!isErrno(error, 'EEXIST')) {
            throw error
          }
        }
        currentTarget = destination
      }

      // Recorded before the overwrite, never after it: a path whose copy then fails is recoverable,
      // and an overwrite that was never recorded is not.
      await recordOverlay(file.relative)

      await ensureDirectory(dirname(destination))
      await copyFile(file.absolute, destination)

      filesDone += 1
      report('copy', filesDone, filesTotal)
    }

    if (signal?.aborted === true) {
      return {
        ok: false,
        filesDone,
        filesTotal,
        message: `aborted: ${filesDone} of ${filesTotal} mod files were copied to ${installPath}`
      }
    }

    return { ok: true, filesDone, filesTotal }
  } catch (error) {
    return failure(error, currentTarget, filesDone, filesTotal)
  }
}

/**
 * Undoes an injection: every manifest entry is restored from `.mod_backup` when a
 * backup exists, or deleted when it does not (that is a mod-only file, which had
 * nothing to back up), then the whole `.mod_backup` tree is removed.
 *
 * With no manifest this still removes a stray `.mod_backup` and otherwise
 * succeeds trivially, which is what lets `injectMod` retry after a crash.
 *
 * Deliberately no directory pruning: removing a mod-only file leaves an empty
 * directory behind, exactly as the legacy copy left one behind, because an empty
 * directory is harmless to the game and pruning could delete a directory the mod
 * did not create.
 */
export async function removeMod(
  context: ModContext,
  onProgress?: (progress: ModProgress) => void
): Promise<ModResult> {
  const { installPath } = context
  const backupDir = join(installPath, BACKUP_DIR_NAME)
  const report = createReporter(context.versionId, onProgress)

  if (installPath === '') {
    return {
      ok: false,
      filesDone: 0,
      filesTotal: 0,
      message: 'EINVAL: a restore needs an install path'
    }
  }

  let entries: string[]
  try {
    entries = await readManifest(installPath)
  } catch (error) {
    return failure(error, join(backupDir, MANIFEST_FILE_NAME), 0, 0)
  }

  const filesTotal = entries.length
  let filesDone = 0
  let currentTarget = backupDir
  report('restore', 0, filesTotal)

  try {
    for (const entry of entries) {
      const segments = relativeSegments(entry)
      if (segments === null) {
        return {
          ok: false,
          filesDone,
          filesTotal,
          message: `EINVAL: manifest entry is not a safe relative path: ${entry}`
        }
      }

      const destination = resolveInside(installPath, segments)
      const backupPath = resolveInside(backupDir, segments)
      currentTarget = destination

      if (await isRegularFile(backupPath)) {
        // `mkdir` first: a backup can only exist for a file that existed, so the
        // parent normally does too, but the user may have removed an empty
        // directory by hand between injection and restore.
        await mkdir(dirname(destination), { recursive: true })
        await copyFile(backupPath, destination)
      } else {
        // `force` makes a missing destination a success: the file may have been
        // deleted by the user, and that is already the desired end state.
        await rm(destination, { force: true })
      }

      filesDone += 1
      report('restore', filesDone, filesTotal)
    }

    currentTarget = backupDir
    await rm(backupDir, { recursive: true, force: true })
    report('cleanup', filesDone, filesTotal)

    return { ok: true, filesDone, filesTotal }
  } catch (error) {
    return failure(error, currentTarget, filesDone, filesTotal)
  }
}
