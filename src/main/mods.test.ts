/**
 * Tests for the mod injector.
 *
 * Every case builds a real fixture on disk in a temp directory — a retail install
 * tree and a mod source tree — because the behaviour that matters here is
 * filesystem behaviour: which bytes end up where, and whether the originals can
 * still be recovered byte-for-byte afterwards. Byte identity is checked with
 * SHA-256 rather than string equality so the guarantee is about the file, not
 * about how the fixture happened to be written.
 *
 * The `.mod_backup` directory name is spelled out literally (in `backupRoot()`
 * below) instead of being imported from the module under test, so a rename of the
 * constant in `mods.ts` fails these tests instead of silently following along.
 */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ModProgress } from '@shared/types'
import type { ModContext } from './contracts'
import { hasBackup, injectMod, readManifest, removeMod } from './mods'

/** Retail install: two files the mod overwrites, one it must leave alone. */
const RETAIL_FILES: Record<string, string> = {
  'GAME.EXE': 'retail-executable',
  'data/stage1.dat': 'retail-stage-one-payload',
  'data/keep.idx': 'retail-index-the-mod-must-not-touch'
}

/** Mod tree: three payload files plus three documentation files (skipped). */
const MOD_FILES: Record<string, string> = {
  'GAME.EXE': 'mod-executable',
  'data/stage1.dat': 'mod-stage-one-payload',
  'data/extra/newfile.bin': 'mod-only-payload',
  'README.md': 'mod-readme-must-never-be-copied',
  'docs/Changelog.txt': 'mod-changelog-must-never-be-copied',
  'data/ChAnGeLoG-notes.txt': 'mod-mixed-case-changelog-must-never-be-copied'
}

/** Payload files of the mod tree, i.e. what `filesTotal` must report. */
const EXPECTED_MANIFEST = ['GAME.EXE', 'data/stage1.dat', 'data/extra/newfile.bin']

/** Documentation files of the mod tree, i.e. what the walk must skip. */
const SKIPPED_MOD_FILES = ['README.md', 'docs/Changelog.txt', 'data/ChAnGeLoG-notes.txt']

/** Files of the mod tree that also exist in the retail install. */
const OVERWRITTEN_FILES = ['GAME.EXE', 'data/stage1.dat']

/** Folder name as it appears in the static catalog (`GameVersion.modPath`). */
const MOD_FOLDER = 'RE-ENHANCE_RE1_v1.1_GOG'

let sandbox = ''
let installPath = ''
let modsDir = ''
const retailHashes = new Map<string, string>()

// ---------------------------------------------------------------------------
// fixture helpers
// ---------------------------------------------------------------------------

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(root, ...relativePath.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }
}

function installFile(relativePath: string): string {
  return join(installPath, ...relativePath.split('/'))
}

/** Literal `.mod_backup` layout: `<installPath>/.mod_backup/<relative path>`. */
function backupRoot(): string {
  return join(installPath, '.mod_backup')
}

function backupFile(relativePath: string): string {
  return join(backupRoot(), ...relativePath.split('/'))
}

function context(overrides: Partial<ModContext> = {}): ModContext {
  return { installPath, modsDir, modPath: MOD_FOLDER, versionId: 're1-us', ...overrides }
}

async function sha256(target: string): Promise<string> {
  return createHash('sha256').update(await readFile(target)).digest('hex')
}

async function readText(target: string): Promise<string> {
  return readFile(target, 'utf8')
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

/** Every file below `root`, as `/`-separated paths relative to `root`. */
async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      found.push(...(await listFiles(join(root, entry.name), relativePath)))
      continue
    }
    found.push(relativePath)
  }
  return found
}

async function installHashes(relativePaths: string[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {}
  for (const relativePath of relativePaths) {
    hashes[relativePath] = await sha256(installFile(relativePath))
  }
  return hashes
}

describe('mods', () => {
  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 're-mods-'))
    installPath = join(sandbox, 'GOG Games', 'Resident Evil')
    modsDir = join(sandbox, 'reenhancemods')
    await writeTree(installPath, RETAIL_FILES)
    await writeTree(join(modsDir, MOD_FOLDER), MOD_FILES)

    retailHashes.clear()
    for (const relativePath of Object.keys(RETAIL_FILES)) {
      retailHashes.set(relativePath, await sha256(installFile(relativePath)))
    }
  })

  afterEach(async () => {
    if (sandbox !== '') {
      await rm(sandbox, { recursive: true, force: true })
    }
    sandbox = ''
  })

  it('injects the mod tree over the install and records a manifest', async () => {
    const result = await injectMod(context())

    expect(result.ok).toBe(true)
    expect(result.filesDone).toBe(EXPECTED_MANIFEST.length)
    expect(result.filesTotal).toBe(EXPECTED_MANIFEST.length)

    const manifest = await readManifest(installPath)
    expect([...manifest].sort()).toEqual([...EXPECTED_MANIFEST].sort())

    expect(await readText(installFile('GAME.EXE'))).toBe(MOD_FILES['GAME.EXE'])
    expect(await readText(installFile('data/stage1.dat'))).toBe(MOD_FILES['data/stage1.dat'])
    expect(await readText(installFile('data/extra/newfile.bin'))).toBe(MOD_FILES['data/extra/newfile.bin'])

    // A file the mod does not ship must survive untouched.
    expect(await readText(installFile('data/keep.idx'))).toBe(RETAIL_FILES['data/keep.idx'])
    expect(await hasBackup(installPath)).toBe(true)
  })

  it('backs up every overwritten file byte-identically', async () => {
    await injectMod(context())

    for (const relativePath of OVERWRITTEN_FILES) {
      expect(await sha256(backupFile(relativePath))).toBe(retailHashes.get(relativePath))
    }

    // The backup tree holds the two overwritten originals plus the manifest —
    // nothing else, and nothing for the file the mod introduced.
    expect((await listFiles(backupRoot())).sort()).toEqual(
      ['GAME.EXE', 'data/stage1.dat', 'manifest.txt'].sort()
    )
    expect(await exists(backupFile('data/extra/newfile.bin'))).toBe(false)
    expect(await exists(backupFile('data/keep.idx'))).toBe(false)
  })

  it('restores the originals byte-identically, deletes mod-only files and removes the backup tree', async () => {
    await injectMod(context())

    const removal = await removeMod(context())
    expect(removal.ok).toBe(true)
    expect(removal.filesTotal).toBe(EXPECTED_MANIFEST.length)

    for (const [relativePath, retailHash] of retailHashes) {
      expect(await sha256(installFile(relativePath))).toBe(retailHash)
    }
    expect(await exists(installFile('data/extra/newfile.bin'))).toBe(false)
    expect(await exists(backupRoot())).toBe(false)
    expect(await hasBackup(installPath)).toBe(false)
    expect(await readManifest(installPath)).toEqual([])

    // Removing again is the trivial path: no manifest, no backup tree.
    expect(await removeMod(context())).toMatchObject({ ok: true, filesDone: 0, filesTotal: 0 })
  })

  it('skips readme and changelog files whatever their case or depth', async () => {
    const result = await injectMod(context())

    expect(result.filesTotal).toBe(EXPECTED_MANIFEST.length)
    for (const relativePath of SKIPPED_MOD_FILES) {
      expect(await exists(installFile(relativePath))).toBe(false)
    }

    // Nothing documentation-like reached the install or the manifest, so the
    // skip is applied to the source tree and not just to the file names the test
    // happened to list.
    expect((await listFiles(installPath)).some((path) => /readme|changelog/i.test(path))).toBe(false)
    expect((await readManifest(installPath)).some((path) => /readme|changelog/i.test(path))).toBe(false)
  })

  it('injects twice in a row idempotently and still restores the originals', async () => {
    const first = await injectMod(context())
    expect(first.ok).toBe(true)
    const firstManifest = [...(await readManifest(installPath))].sort()
    const firstInstall = await installHashes(EXPECTED_MANIFEST)

    const second = await injectMod(context())
    expect(second.ok).toBe(true)
    expect(second.filesTotal).toBe(EXPECTED_MANIFEST.length)

    expect([...(await readManifest(installPath))].sort()).toEqual(firstManifest)
    expect(await installHashes(EXPECTED_MANIFEST)).toEqual(firstInstall)

    // The second injection must not have backed up its own output.
    for (const relativePath of OVERWRITTEN_FILES) {
      expect(await sha256(backupFile(relativePath))).toBe(retailHashes.get(relativePath))
    }

    const removal = await removeMod(context())
    expect(removal.ok).toBe(true)
    for (const [relativePath, retailHash] of retailHashes) {
      expect(await sha256(installFile(relativePath))).toBe(retailHash)
    }
  })

  it('reports monotonic progress that ends at filesTotal', async () => {
    const progress: ModProgress[] = []
    const result = await injectMod(context(), (update) => progress.push(update))

    expect(result.ok).toBe(true)
    expect(progress.length).toBeGreaterThan(0)

    const phases = new Set(progress.map((update) => update.phase))
    expect(phases.has('backup')).toBe(true)
    expect(phases.has('copy')).toBe(true)

    let previous = 0
    for (const update of progress) {
      expect(update.versionId).toBe('re1-us')
      expect(update.filesTotal).toBe(EXPECTED_MANIFEST.length)
      expect(update.filesDone).toBeLessThanOrEqual(update.filesTotal)
      expect(update.filesDone).toBeGreaterThanOrEqual(previous)
      previous = update.filesDone
    }

    expect(progress.at(-1)).toMatchObject({
      phase: 'copy',
      filesDone: EXPECTED_MANIFEST.length,
      filesTotal: EXPECTED_MANIFEST.length
    })
  })

  it('reports restore then cleanup progress on removal', async () => {
    await injectMod(context())

    const progress: ModProgress[] = []
    const result = await removeMod(context(), (update) => progress.push(update))

    expect(result.ok).toBe(true)
    const phases = progress.map((update) => update.phase)
    expect(phases).toContain('restore')
    expect(phases).toContain('cleanup')
    expect(phases.indexOf('cleanup')).toBeGreaterThan(phases.lastIndexOf('restore'))

    let previous = 0
    for (const update of progress) {
      expect(update.filesDone).toBeLessThanOrEqual(update.filesTotal)
      expect(update.filesDone).toBeGreaterThanOrEqual(previous)
      previous = update.filesDone
    }

    expect(progress.at(-1)).toMatchObject({
      phase: 'cleanup',
      filesDone: EXPECTED_MANIFEST.length,
      filesTotal: EXPECTED_MANIFEST.length
    })
  })

  it('returns ok:false when aborted mid-injection and stays restorable', async () => {
    const controller = new AbortController()

    // Aborting from inside the progress callback stops the copy between two
    // files, which is the only way to reach a genuine half-finished injection.
    const result = await injectMod(
      context(),
      (update) => {
        if (update.phase === 'copy' && update.filesDone === 1) {
          controller.abort()
        }
      },
      controller.signal
    )

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/abort/i)
    expect(result.filesDone).toBe(1)
    expect(result.filesTotal).toBe(EXPECTED_MANIFEST.length)

    // Whatever was copied before the abort must still be reversible, which is what
    // the manifest is flushed for on every exit path.
    const removal = await removeMod(context())
    expect(removal.ok).toBe(true)
    for (const [relativePath, retailHash] of retailHashes) {
      expect(await sha256(installFile(relativePath))).toBe(retailHash)
    }
  })

  it('returns ok:false without touching the install when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await injectMod(context(), undefined, controller.signal)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/abort/i)
    for (const [relativePath, retailHash] of retailHashes) {
      expect(await sha256(installFile(relativePath))).toBe(retailHash)
    }
    expect(await hasBackup(installPath)).toBe(false)
    expect(await exists(installFile('data/extra/newfile.bin'))).toBe(false)
  })

  it('removes a stray backup directory when no manifest exists', async () => {
    await writeTree(backupRoot(), { 'stray.bin': 'leftover-from-an-interrupted-injection' })
    expect(await hasBackup(installPath)).toBe(true)
    expect(await readManifest(installPath)).toEqual([])

    expect(await removeMod(context())).toMatchObject({ ok: true, filesDone: 0, filesTotal: 0 })
    expect(await hasBackup(installPath)).toBe(false)

    for (const [relativePath, retailHash] of retailHashes) {
      expect(await sha256(installFile(relativePath))).toBe(retailHash)
    }
  })

  it('names the failing path and the errno when the mod source is missing', async () => {
    const missingFolder = 'RE-ENHANCE_DOES_NOT_EXIST'
    const result = await injectMod(context({ modPath: missingFolder }))

    expect(result.ok).toBe(false)
    expect(result.filesDone).toBe(0)
    expect(result.message).toContain('ENOENT')
    expect(result.message).toContain(missingFolder)
  })
})
