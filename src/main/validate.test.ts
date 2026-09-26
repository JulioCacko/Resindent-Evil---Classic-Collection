/**
 * Fixture-driven tests for the install validator (`src/main/validate.ts`).
 *
 * Fixtures are real directory trees in the OS temp directory, and every name that
 * matters (executables, data markers, mod folders) is read from `@shared/catalog`
 * instead of being repeated here: were a row renamed, this suite must fail rather
 * than silently turn each real install into 'missing'. That is also why
 * `probeVersion` is called with the same `execRelPath` / `modPath` / `requiresMod`
 * values the catalog ships.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { TITLE_DATA_PROBES, findVersion } from '@shared/catalog'
import type { GameVersionSeed } from '@shared/catalog'
import type { TitleId } from '@shared/types'
import { afterAll, describe, expect, it } from 'vitest'

import type { VersionProbeInput } from './contracts'
import { modsAvailable, probeVersion, stateFromProbe } from './validate'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ROOTS: string[] = []

/** A fresh temp directory that `afterAll` removes. */
async function makeRoot(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `re-validate-${label}-`))
  FIXTURE_ROOTS.push(dir)
  return dir
}

afterAll(async () => {
  for (const dir of FIXTURE_ROOTS) {
    await rm(dir, { recursive: true, force: true })
  }
})

/** A catalog row, or a loud failure (never a non-null assertion in a test). */
function seed(versionId: string): GameVersionSeed {
  const version = findVersion(versionId)
  if (!version) throw new Error(`catalog row '${versionId}' is not in @shared/catalog`)
  return version
}

/**
 * The probe input the catalog implies for one row, rooted at a fixture tree.
 * `modsDir` stays `''` unless a test supplies one: rows that do not require a mod
 * never consult it.
 */
function probeInput(versionId: string, installPath: string, modsDir = ''): VersionProbeInput {
  const version = seed(versionId)
  return {
    titleId: version.titleId,
    installPath,
    execRelPath: version.execRelPath,
    requiresMod: version.requiresMod,
    modPath: version.modPath,
    modsDir
  }
}

/** Creates the row's retail executable, optionally under another spelling/name. */
async function writeExecutable(
  root: string,
  versionId: string,
  nameOverride?: string
): Promise<string> {
  const name = nameOverride ?? seed(versionId).execRelPath
  if (name.length === 0) throw new Error(`catalog row '${versionId}' has no executable to write`)
  const file = join(root, name)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, '')
  return file
}

/**
 * Creates the title's first data marker the way the install would carry it: RE1's
 * probe is the `USA` directory, RE2/RE3's is an executable.
 */
async function writeDataMarker(
  root: string,
  titleId: TitleId,
  markerOverride?: string
): Promise<void> {
  const marker = markerOverride ?? TITLE_DATA_PROBES[titleId][0]
  if (!marker) throw new Error(`@shared/catalog lists no data probe for '${titleId}'`)
  if (marker.toLowerCase().endsWith('.exe')) {
    const file = join(root, marker)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, '')
    return
  }
  await mkdir(join(root, marker), { recursive: true })
}

/** A complete install for a row: executable plus data marker. */
async function writeFullInstall(root: string, versionId: string): Promise<void> {
  const version = seed(versionId)
  if (version.execRelPath.length > 0) await writeExecutable(root, versionId)
  await writeDataMarker(root, version.titleId)
}

// ---------------------------------------------------------------------------
// catalog premises
// ---------------------------------------------------------------------------

describe('catalog premises', () => {
  it('keeps the rows these fixtures are built from', () => {
    // Guards the suite against becoming vacuous: `re1_jp` is the only shipped
    // row that requires a mod, and the requiresMod cases below are only
    // meaningful while that (and its mod folder name) holds.
    expect(seed('re1_jp').requiresMod).toBe(true)
    expect(seed('re1_jp').modPath.length).toBeGreaterThan(0)
    expect(seed('re1_us').requiresMod).toBe(false)
    expect(seed('re1_us').execRelPath.length).toBeGreaterThan(0)
    expect(TITLE_DATA_PROBES.re1.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// stateFromProbe
// ---------------------------------------------------------------------------

describe('stateFromProbe', () => {
  it('maps 3/3 probes to installed, 0/3 to missing and anything else to partial', () => {
    expect(stateFromProbe({ installOk: true, exeOk: true, dataOk: true, modOk: true })).toBe(
      'installed'
    )
    expect(stateFromProbe({ installOk: true, exeOk: true, dataOk: false, modOk: true })).toBe(
      'partial'
    )
    expect(stateFromProbe({ installOk: true, exeOk: false, dataOk: false, modOk: true })).toBe(
      'partial'
    )
    expect(stateFromProbe({ installOk: false, exeOk: true, dataOk: true, modOk: true })).toBe(
      'partial'
    )
    expect(stateFromProbe({ installOk: false, exeOk: false, dataOk: false, modOk: true })).toBe(
      'missing'
    )
  })

  it('demotes an otherwise complete install when the RE-Enhance requirement is unmet', () => {
    // This is the legacy veto, not a fourth probe: the legacy
    // `InstallValidator::ValidateTitle` scored the three probes first and then set
    // a `requiresMod` version with no mod back to MISSING. Reproducing it here
    // rather than inside `probeVersion` is what keeps `installOk`/`exeOk`/`dataOk`
    // truthful, so `catalog-state.ts` can tell the user that the mod is missing
    // instead of claiming the game folder is.
    expect(stateFromProbe({ installOk: true, exeOk: true, dataOk: true, modOk: false })).toBe(
      'missing'
    )

    // The veto can only demote a would-be 'installed': a row that already failed a
    // real probe keeps the score the legacy 3/3 rule gave it.
    expect(stateFromProbe({ installOk: true, exeOk: true, dataOk: false, modOk: false })).toBe(
      'partial'
    )
    expect(stateFromProbe({ installOk: false, exeOk: false, dataOk: false, modOk: false })).toBe(
      'missing'
    )
  })
})

// ---------------------------------------------------------------------------
// install probes
// ---------------------------------------------------------------------------

describe('probeVersion — install probes', () => {
  it('reads a complete RE1 install as installed', async () => {
    const root = await makeRoot('re1-full')
    await writeFullInstall(root, 're1_us')

    const probe = await probeVersion(probeInput('re1_us', root))
    expect(probe).toEqual({ installOk: true, exeOk: true, dataOk: true, modOk: true })
    expect(stateFromProbe(probe)).toBe('installed')
  })

  it('reads an install with the executable but no data marker as partial', async () => {
    const root = await makeRoot('re1-no-data')
    await writeExecutable(root, 're1_us')

    const probe = await probeVersion(probeInput('re1_us', root))
    expect(probe).toEqual({ installOk: true, exeOk: true, dataOk: false, modOk: true })
    expect(stateFromProbe(probe)).toBe('partial')
  })

  it('reads an install with the data marker but no executable as partial', async () => {
    const root = await makeRoot('re1-no-exe')
    await writeDataMarker(root, 're1')

    const probe = await probeVersion(probeInput('re1_us', root))
    expect(probe).toEqual({ installOk: true, exeOk: false, dataOk: true, modOk: true })
    expect(stateFromProbe(probe)).toBe('partial')
  })

  it('reads a missing install root as missing', async () => {
    const parent = await makeRoot('re1-absent')
    const root = join(parent, 'Resident Evil')

    const probe = await probeVersion(probeInput('re1_us', root))
    expect(probe).toEqual({ installOk: false, exeOk: false, dataOk: false, modOk: true })
    expect(stateFromProbe(probe)).toBe('missing')
  })

  it('reads an undetected install root (empty path) as missing', async () => {
    // Detection yields '' when a title is not found anywhere, and the legacy
    // guard refused to probe relative paths against it.
    const probe = await probeVersion(probeInput('re1_us', ''))
    expect(probe).toEqual({ installOk: false, exeOk: false, dataOk: false, modOk: true })
    expect(stateFromProbe(probe)).toBe('missing')
  })

  it('reads an existing but empty install folder as partial, not missing', async () => {
    // Legacy semantics: a directory that exists is one passing probe, so an empty
    // one is "partial" — the folder is there, its contents are not.
    const root = await makeRoot('re1-empty')
    const probe = await probeVersion(probeInput('re1_us', root))
    expect(probe).toEqual({ installOk: true, exeOk: false, dataOk: false, modOk: true })
    expect(stateFromProbe(probe)).toBe('partial')
  })

  it('matches the executable and the data marker case-insensitively', async () => {
    const root = await makeRoot('re1-case')
    // A repack or a user-renamed install: the catalog spells these names one way,
    // the filesystem another. The legacy stat-based check failed here.
    await writeExecutable(root, 're1_us', 'RESIDENTEVIL.EXE')
    await mkdir(join(root, 'usa'), { recursive: true })

    const probe = await probeVersion(probeInput('re1_us', root))
    expect(probe).toEqual({ installOk: true, exeOk: true, dataOk: true, modOk: true })
    expect(stateFromProbe(probe)).toBe('installed')
  })

  it("accepts a `USA` folder carrying the deeper `Data` subfolder", async () => {
    const root = await makeRoot('re1-nested-marker')
    await writeExecutable(root, 're1_us')
    await mkdir(join(root, 'USA', 'Data'), { recursive: true })

    // RE1's two catalog probes (`USA` and `USA/Data`) both resolve through the
    // `USA` directory, which is the shape a real GOG install has. Multi-segment
    // resolution itself is covered by the nested-executable case below.
    expect((await probeVersion(probeInput('re1_us', root))).dataOk).toBe(true)
  })

  it('resolves a multi-segment relative path beneath the install root', async () => {
    const root = await makeRoot('nested-exec')
    const nested = { ...probeInput('re1_us', root), execRelPath: 'bin/usa/ResidentEvil.exe' }
    await writeExecutable(root, 're1_us', 'bin/USA/residentevil.exe')
    await writeDataMarker(root, 're1')

    // Every segment is matched case-insensitively, not just the last one.
    expect(await probeVersion(nested)).toEqual({
      installOk: true,
      exeOk: true,
      dataOk: true,
      modOk: true
    })
  })

  it('does not accept a directory where the executable is expected', async () => {
    const root = await makeRoot('dir-as-exe')
    await mkdir(join(root, seed('re1_us').execRelPath), { recursive: true })
    await writeDataMarker(root, 're1')

    const probe = await probeVersion(probeInput('re1_us', root))
    expect(probe.exeOk).toBe(false)
    expect(stateFromProbe(probe)).toBe('partial')
  })

  it('does not accept a file where a directory marker is expected', async () => {
    const root = await makeRoot('file-as-dir')
    await writeExecutable(root, 're1_us')
    await writeFile(join(root, 'USA'), '')

    const probe = await probeVersion(probeInput('re1_us', root))
    expect(probe.dataOk).toBe(false)
    expect(stateFromProbe(probe)).toBe('partial')
  })

  it('validates RE2 through its own scenario executables', async () => {
    const root = await makeRoot('re2-leon')
    // `LeonU.exe` is both RE2's catalog executable and one of its data markers, so
    // a lone Leon file is a complete install.
    await writeExecutable(root, 're2_jp')

    const probe = await probeVersion(probeInput('re2_jp', root))
    expect(probe).toEqual({ installOk: true, exeOk: true, dataOk: true, modOk: true })
    expect(stateFromProbe(probe)).toBe('installed')
  })

  it('reads an RE2 install holding only Claire as partial', async () => {
    const root = await makeRoot('re2-claire')
    await writeDataMarker(root, 're2', 'ClaireU.exe')

    const probe = await probeVersion(probeInput('re2_jp', root))
    expect(probe).toEqual({ installOk: true, exeOk: false, dataOk: true, modOk: true })
    expect(stateFromProbe(probe)).toBe('partial')
  })

  it('validates RE3 through ResidentEvil3.exe', async () => {
    const root = await makeRoot('re3')
    await writeFullInstall(root, 're3_us')

    const probe = await probeVersion(probeInput('re3_us', root))
    expect(probe).toEqual({ installOk: true, exeOk: true, dataOk: true, modOk: true })
    expect(stateFromProbe(probe)).toBe('installed')
  })

  it('never reports the concept row (BIOHAZARD 1.5) as installed', async () => {
    const root = await makeRoot('re2-proto')
    // That row ships with `execRelPath: ''` because it was scrapped before
    // release, so there is nothing on disk that can satisfy the executable probe.
    // It is launchable: false regardless, so 'partial' cannot be acted on; this
    // asserts only that it can never reach 'installed'.
    await writeDataMarker(root, 're2', 'ClaireU.exe')

    const probe = await probeVersion(probeInput('re2_proto', root))
    expect(probe).toEqual({ installOk: true, exeOk: false, dataOk: true, modOk: true })
    expect(stateFromProbe(probe)).toBe('partial')
  })
})

// ---------------------------------------------------------------------------
// requiresMod
// ---------------------------------------------------------------------------

describe('probeVersion — requiresMod rows', () => {
  it('reads a complete RE1 JP install without the mod folder as missing', async () => {
    const root = await makeRoot('jp-no-mod')
    const modsDir = await makeRoot('jp-no-mod-mods')
    await writeFullInstall(root, 're1_jp')

    const probe = await probeVersion(probeInput('re1_jp', root, modsDir))
    // The three probes still describe the disk truthfully — the game really is
    // installed — and `modOk` carries the unmet RE-Enhance requirement that
    // `stateFromProbe` turns into 'missing'.
    expect(probe).toEqual({ installOk: true, exeOk: true, dataOk: true, modOk: false })
    expect(stateFromProbe(probe)).toBe('missing')
  })

  it('treats an empty mod folder as unavailable', async () => {
    const root = await makeRoot('jp-empty-mod')
    const modsDir = await makeRoot('jp-empty-mod-mods')
    await writeFullInstall(root, 're1_jp')
    await mkdir(join(modsDir, seed('re1_jp').modPath), { recursive: true })

    const probe = await probeVersion(probeInput('re1_jp', root, modsDir))
    expect(probe.modOk).toBe(false)
    expect(stateFromProbe(probe)).toBe('missing')
  })

  it('reads the row as installed once the mod folder holds a file', async () => {
    const root = await makeRoot('jp-with-mod')
    const modsDir = await makeRoot('jp-with-mod-mods')
    await writeFullInstall(root, 're1_jp')
    const modDir = join(modsDir, seed('re1_jp').modPath)
    await mkdir(modDir, { recursive: true })
    await writeFile(join(modDir, 'dinput.dll'), '')

    const probe = await probeVersion(probeInput('re1_jp', root, modsDir))
    expect(probe).toEqual({ installOk: true, exeOk: true, dataOk: true, modOk: true })
    expect(stateFromProbe(probe)).toBe('installed')
  })

  it('lets a present mod fold away, not mask, an incomplete install', async () => {
    const root = await makeRoot('jp-partial')
    const modsDir = await makeRoot('jp-partial-mods')
    await writeExecutable(root, 're1_jp')
    const modDir = join(modsDir, seed('re1_jp').modPath)
    await mkdir(modDir, { recursive: true })
    await writeFile(join(modDir, 'dinput.dll'), '')

    const probe = await probeVersion(probeInput('re1_jp', root, modsDir))
    expect(probe).toEqual({ installOk: true, exeOk: true, dataOk: false, modOk: true })
    expect(stateFromProbe(probe)).toBe('partial')
  })

  it('leaves a row that does not require a mod installed when no mod is present', async () => {
    const root = await makeRoot('no-requirement')
    const modsDir = await makeRoot('no-requirement-mods')
    await writeFullInstall(root, 're1_us')

    const probe = await probeVersion(probeInput('re1_us', root, modsDir))
    // `modOk` answers "was the mod requirement met", not "are mod files present";
    // that second question is `hasMod`, answered by the catalog builder.
    expect(probe.modOk).toBe(true)
    expect(stateFromProbe(probe)).toBe('installed')
  })
})

// ---------------------------------------------------------------------------
// modsAvailable
// ---------------------------------------------------------------------------

describe('modsAvailable', () => {
  const modPath = () => seed('re1_jp').modPath

  it('requires an existing folder that holds at least one entry', async () => {
    const modsDir = await makeRoot('mods')
    expect(await modsAvailable(modsDir, modPath())).toBe(false)

    await mkdir(join(modsDir, modPath()), { recursive: true })
    expect(await modsAvailable(modsDir, modPath())).toBe(false)

    await writeFile(join(modsDir, modPath(), 'dinput.dll'), '')
    expect(await modsAvailable(modsDir, modPath())).toBe(true)
  })

  it('ignores case when locating the mod folder', async () => {
    const modsDir = await makeRoot('mods-case')
    const lower = join(modsDir, modPath().toLowerCase())
    await mkdir(lower, { recursive: true })
    await writeFile(join(lower, 'dinput.dll'), '')

    expect(await modsAvailable(modsDir, modPath())).toBe(true)
  })

  it('accepts a folder whose only entry is a subfolder or a hidden file', async () => {
    const modsDir = await makeRoot('mods-entries')
    const subfolderOnly = join(modsDir, 'subfolder-only')
    await mkdir(join(subfolderOnly, 'nested'), { recursive: true })
    expect(await modsAvailable(modsDir, 'subfolder-only')).toBe(true)

    // Parity with `DirHasAnyFile`, which only skipped the `.` / `..` names.
    const hiddenOnly = join(modsDir, 'hidden-only')
    await mkdir(hiddenOnly, { recursive: true })
    await writeFile(join(hiddenOnly, '.gitkeep'), '')
    expect(await modsAvailable(modsDir, 'hidden-only')).toBe(true)
  })

  it('rejects an empty mod path, a file and a missing parent', async () => {
    const modsDir = await makeRoot('mods-edge')
    await writeFile(join(modsDir, 'not-a-folder'), '')

    // An empty folder name cannot identify a mod (legacy cleared `hasMod`).
    expect(await modsAvailable(modsDir, '')).toBe(false)
    // A file in the mod folder's place is not a mod folder.
    expect(await modsAvailable(modsDir, 'not-a-folder')).toBe(false)
    // A missing mod base directory is not an error, just unavailable.
    expect(await modsAvailable(join(modsDir, 'absent'), 'anything')).toBe(false)
  })
})
