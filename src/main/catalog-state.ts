/**
 * catalog-state — joins the static catalog (`@shared/catalog`) with what is
 * actually on disk.
 *
 * The deleted launcher did this in three boot steps (see `src/core/app.cpp`:
 * `GOGDetector::DetectAllGames`, then `InstallValidator::ValidateAll`, then a
 * `CatalogNeedsInstallScreen` check). This module keeps that order — detect once
 * for every title, probe every version, then decide the boot screen — but returns
 * a plain `CatalogSnapshot` so the IPC layer and the renderer share one shape.
 *
 * Everything that touches the OS is injectable (`CatalogBuildOptions.detect`,
 * `.probe`, `.modsAvailableFn`), so the whole join is testable in plain Node with
 * no Electron and no registry.
 */
import { TITLES } from '@shared/catalog'
import type { GameTitleSeed, GameVersionSeed } from '@shared/catalog'
import type {
  CatalogSnapshot,
  GameTitle,
  GameVersion,
  InstallState,
  LauncherConfig
} from '@shared/types'
import type {
  CatalogBuildOptions,
  MainPaths,
  VersionProbe,
  VersionProbeInput
} from './contracts'
import { detectAllInstallPaths } from './detect/gog'
import { hasBackup } from './mods'
import { modsAvailable, probeVersion, stateFromProbe } from './validate'

/** The three injected functions, read off the frozen options type. */
type DetectFn = NonNullable<CatalogBuildOptions['detect']>
type ProbeFn = NonNullable<CatalogBuildOptions['probe']>
type ModsFn = NonNullable<CatalogBuildOptions['modsAvailableFn']>

/**
 * Short, human strings for the Install Status screen. The order they are tested
 * in matters: the legacy validator only checked the executable and the payload
 * when the install root existed (`InstallValidator::ValidateTitle` gates `exeOk`
 * and `dataOk` on `installOk`), so an absent root is always the root cause and
 * the most useful thing to report.
 */
const REASON = {
  folder: 'Game folder not found',
  executable: 'Executable not found',
  /** A version that cannot run without its RE-Enhance files, with none on disk. */
  modRequired: 'Requires the RE-Enhance files',
  data: 'Game data incomplete',
  incomplete: 'Install incomplete',
  /** Detection or probing threw; the row is reported missing rather than guessed. */
  checkFailed: 'Install check failed'
} as const

export async function buildCatalogSnapshot(options: CatalogBuildOptions): Promise<CatalogSnapshot> {
  const { paths, config } = options
  const detect = options.detect ?? detectAllInstallPaths
  const probe = options.probe ?? probeVersion
  const modsAvailableFn = options.modsAvailableFn ?? modsAvailable

  // One detection pass for the whole catalog, exactly as the legacy
  // `DetectAllGames` walked every title before validation started.
  const detected = await detectInstallPaths(detect, paths, config)

  const titles = await Promise.all(
    TITLES.map((seed) => buildTitle(seed, detected, paths, probe, modsAvailableFn))
  )

  return {
    titles,
    config,
    needsInstallScreen: needsInstallScreen(titles),
    appDir: paths.appDir,
    configPath: paths.configPath,
    progressPath: paths.progressPath
  }
}

/**
 * True when the launcher must open on Install Status instead of the main menu.
 *
 * This is the legacy `CatalogNeedsInstallScreen` rule (`src/core/app.cpp`): a
 * title with no `InstallState::INSTALLED` version sends the user to Install
 * Status. The legacy version also short-circuited on an empty `installPath`, but
 * that case is subsumed here — an empty root fails the install check, so the
 * title has no installed version either way.
 */
export function needsInstallScreen(titles: CatalogSnapshot['titles']): boolean {
  return titles.some((title) => !title.versions.some((version) => version.state === 'installed'))
}

async function buildTitle(
  seed: GameTitleSeed,
  detected: Record<string, string>,
  paths: MainPaths,
  probe: ProbeFn,
  modsAvailableFn: ModsFn
): Promise<GameTitle> {
  const installPath = resolveInstallPath(detected, seed)

  // All versions of a title share one install root (the legacy validator used
  // `title.installPath` for every row), but each row probes its own executable.
  const versions = await Promise.all(
    seed.versions.map((version) => buildVersion(version, installPath, paths, probe, modsAvailableFn))
  )

  return {
    id: seed.id,
    name: seed.name,
    cardAsset: seed.cardAsset,
    gogGameId: seed.gogGameId,
    gogFolderName: seed.gogFolderName,
    versions,
    installPath,
    // Only a fully validated row counts. A partial install is still launchable
    // (the renderer's `canLaunch` accepts 'partial'), but it must not satisfy the
    // boot gate, otherwise a half-copied install would skip Install Status.
    hasAnyInstalled: versions.some((version) => version.state === 'installed')
  }
}

async function buildVersion(
  seed: GameVersionSeed,
  installPath: string,
  paths: MainPaths,
  probe: ProbeFn,
  modsAvailableFn: ModsFn
): Promise<GameVersion> {
  const input: VersionProbeInput = {
    titleId: seed.titleId,
    installPath,
    execRelPath: seed.execRelPath,
    requiresMod: seed.requiresMod,
    modPath: seed.modPath,
    modsDir: paths.modsDir
  }

  const [hasMod, modInstalled, resolved] = await Promise.all([
    resolveHasMod(modsAvailableFn, paths.modsDir, seed.modPath),
    resolveModInstalled(installPath),
    resolveInstallState(probe, input)
  ])

  return {
    ...seed,
    state: resolved.state,
    // A concept row is never launchable, so its on-disk state is not the reason
    // the row is dead — the design wants the concept note shown instead, while
    // `state` keeps reporting what the probe found. (The note itself,
    // "Planned Release IN March 1997 (Scrapped and remade.)", is drawn in
    // `.ref/designref/src/imports/Frame219.tsx`.)
    stateReason: seed.launchable ? resolved.stateReason : seed.unavailableReason,
    hasMod,
    modInstalled
  }
}

/**
 * Whether RE-Enhance files are already sitting in the install.
 *
 * This is what makes an unset launch mode default correctly. The legacy launcher
 * opened the launch screen with `useEnhanced = ModLoader::HasBackup(installPath)`
 * (`src/ui/screens/screen_launch.cpp`), i.e. "the mod is injected, so keep it
 * injected" — and the renderer's `resolveMode` now reproduces that from this flag.
 * Without it, a machine with the overlay already applied defaulted to ORIGINAL,
 * and pressing LAUNCH *restored* the retail files instead of starting the modded
 * game: the launcher would have silently undone a working mod setup.
 */
async function resolveModInstalled(installPath: string): Promise<boolean> {
  if (installPath === '') return false
  try {
    return await hasBackup(installPath)
  } catch {
    // An unreadable install is reported by the probe; the mode just falls back to
    // ORIGINAL rather than the catalog failing to build.
    return false
  }
}

interface ResolvedInstallState {
  state: InstallState
  stateReason: string | null
}

async function resolveInstallState(probe: ProbeFn, input: VersionProbeInput): Promise<ResolvedInstallState> {
  try {
    const result = await probe(input)
    // `stateFromProbe` is the frozen 3-check rule from ./validate and is
    // deliberately not injectable: the renderer's `canLaunch` and the launch
    // guard both depend on the same thresholds.
    const state = stateFromProbe(result)
    return { state, stateReason: reasonFromProbe(state, result) }
  } catch {
    // A probe failure (unreadable directory, a vanished drive) is
    // indistinguishable from an unusable install from the user's point of view,
    // and one broken title must not take the whole snapshot — and therefore the
    // Install Status screen that diagnoses it — down with it.
    return { state: 'missing', stateReason: REASON.checkFailed }
  }
}

function reasonFromProbe(state: InstallState, probe: VersionProbe): string | null {
  if (state === 'installed') return null
  // Only when the mod is the *sole* unmet requirement. Checking `modOk` alone
  // would name the mod for a version whose game folder is simply not there, since
  // a failed install probe leaves every field false.
  if (probe.installOk && probe.exeOk && probe.dataOk && !probe.modOk) return REASON.modRequired
  if (!probe.installOk) return REASON.folder
  if (!probe.exeOk) return REASON.executable
  if (!probe.dataOk) return REASON.data
  // Unreachable for the current 3/3 rule, but keeps the reason non-null for any
  // other combination a future probe might report.
  return REASON.incomplete
}

async function resolveHasMod(modsAvailableFn: ModsFn, modsDir: string, modPath: string): Promise<boolean> {
  // Rows without a mod folder (the BIOHAZARD 1.5 concept row, and any version
  // that only ever shipped retail) can never have a mod injected.
  if (modPath === '') return false
  try {
    return await modsAvailableFn(modsDir, modPath)
  } catch {
    // An unreadable `reenhancemods/` must not fail the catalog; it only means the
    // row falls back to its original executable.
    return false
  }
}

/**
 * Detection results are keyed by title id, which is what the legacy
 * `SetInstallPath(titleId, path)` used. The `gogGameId` and folder-name
 * fallbacks keep this module composable with a detector that keys its map
 * differently: all three identifiers are unique and can never collide, so the
 * extra lookups cannot select the wrong title.
 */
function resolveInstallPath(detected: Record<string, string>, title: GameTitleSeed): string {
  return (
    lookup(detected, title.id) ??
    lookup(detected, title.gogGameId) ??
    lookup(detected, title.gogFolderName) ??
    ''
  )
}

function lookup(map: Record<string, string>, key: string): string | undefined {
  const value = map[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

async function detectInstallPaths(
  detect: DetectFn,
  paths: MainPaths,
  config: LauncherConfig
): Promise<Record<string, string>> {
  const refs = TITLES.map((title) => ({
    id: title.id,
    gogGameId: title.gogGameId,
    gogFolderName: title.gogFolderName
  }))

  try {
    return await detect(refs, {
      appDir: paths.appDir,
      gogPathOverride: config.gogPathOverride,
      platform: process.platform
    })
  } catch {
    // Detection reads the registry and the filesystem. When it fails, "nothing
    // found" is the honest answer: every row degrades to missing and the boot
    // gate sends the user to Install Status, which is exactly where they need to
    // be to point the launcher at their installs.
    return {}
  }
}
