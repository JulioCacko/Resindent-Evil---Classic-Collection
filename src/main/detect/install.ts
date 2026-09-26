/**
 * Which install a catalog row runs from.
 *
 * A title can be installed from GOG, from Steam, or from both, and the two layouts
 * have nothing in common: GOG puts the executables in the install root, Steam puts a
 * complete copy of the game per localization in `english\`, `japanese\` and so on.
 * `src/main/detect/gog.ts` and `src/main/detect/steam.ts` know how to find each;
 * this module is the single place that decides which one a row uses, so the catalog,
 * the validator and the launcher cannot disagree about it.
 *
 * The rule is **GOG first**. Both stores can be installed at once, and when they are,
 * GOG is the one with the RE-Enhance overlay and the `config.ini` the launcher
 * already patches, so it is the one whose setup the rest of the app understands.
 * Steam is used when GOG has nothing.
 *
 * What comes out is a *game root*: the folder that holds the executable and its data.
 * For GOG that is the install root, for Steam the locale folder — and because every
 * locale folder is self-contained (RE1's `english\` carries its own `USA\Data`),
 * everything downstream works against that subtree unchanged.
 */
import { retailExecutable } from '@shared/catalog'
import type { GameTitleSeed, GameVersionSeed } from '@shared/catalog'
import type { Re2Scenario } from '@shared/types'
import { detectInstallPath } from './gog'
import type { GogDetectionOptions } from '../contracts'
import { findSteamAppDir } from './steam'
import type { SteamDetectionOptions } from './steam'

/** Where a row's files came from. */
export type InstallSource = 'gog' | 'steam'

/** `'none'` is the runtime spelling for a row nothing was found for. */
export type ResolvedSource = InstallSource | 'none'

export interface ResolvedInstall {
  /** The game root: the folder holding the executable and its data. */
  path: string
  source: InstallSource
  /** The row's retail executable, relative to `path`. */
  execRelPath: string
}

export interface InstallResolutionOptions {
  /** The application directory, for GOG's local `GOG Games/` check. */
  appDir: string
  /** Explicit GOG root from the configuration, when set. */
  gogPathOverride: string
  platform: NodeJS.Platform
  /** Injected in tests; each detector's own seams are honoured. */
  gog?: GogDetectionOptions
  steam?: SteamDetectionOptions
}

function gogOptions(options: InstallResolutionOptions): GogDetectionOptions {
  return {
    appDir: options.appDir,
    gogPathOverride: options.gogPathOverride,
    platform: options.platform,
    ...options.gog
  }
}

function steamOptions(options: InstallResolutionOptions): SteamDetectionOptions {
  return { platform: options.platform, ...options.steam }
}

/**
 * The install a row runs from, or null when neither store has it.
 *
 * `null` rather than a `{path: '', source: 'none'}` value so a caller cannot forget
 * to check: an empty path is the shape of "not installed" that the rest of the app
 * already understands, and returning it as a success would be a lie.
 */
export async function resolveVersionInstall(
  title: GameTitleSeed,
  version: GameVersionSeed,
  options: InstallResolutionOptions
): Promise<ResolvedInstall | null> {
  const gogPath = await detectInstallPath(
    { id: title.id, gogGameId: title.gogGameId, gogFolderName: title.gogFolderName },
    gogOptions(options)
  )
  if (gogPath !== '') {
    return { path: gogPath, source: 'gog', execRelPath: version.execRelPath }
  }

  const steam = version.steam
  if (steam === null || steam === undefined || title.steamAppId === '') return null

  const appDir = await findSteamAppDir(title.steamAppId, steamOptions(options))
  if (appDir === '') return null

  // The locale folder is the game root. A locale the installed copy does not carry
  // is not an install of this row: Steam ships one app with several localizations, so
  // finding the app says nothing about whether this row's localization is present.
  //
  // The existence check goes through the *same* injected seam the detector used
  // rather than a second, private one - two ways of asking "is this there" is how a
  // test ends up asserting against the real filesystem while believing it is
  // asserting against a fixture.
  const dirExists = options.steam?.dirExists ?? defaultDirExists
  const root = joinPath(appDir, steam.locale)
  if (!(await dirExists(root))) return null

  return { path: root, source: 'steam', execRelPath: steam.exec }
}

/** `path.join` without importing it into every call site. */
function joinPath(base: string, child: string): string {
  if (base === '') return child
  const trimmed = base.replace(/[\\/]+$/, '')
  return `${trimmed}\\${child}`
}

async function defaultDirExists(path: string): Promise<boolean> {
  const { stat } = await import('node:fs/promises')
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Every row of a title with where it was found.
 *
 * The GOG lookup is per title but the Steam lookup is cached per app id, so a title
 * with three rows costs one GOG detection plus one Steam lookup rather than six.
 */
export async function resolveTitleInstalls(
  title: GameTitleSeed,
  options: InstallResolutionOptions
): Promise<Map<string, ResolvedInstall>> {
  const resolved = new Map<string, ResolvedInstall>()
  for (const version of title.versions) {
    const install = await resolveVersionInstall(title, version, options)
    if (install !== null) resolved.set(version.id, install)
  }
  return resolved
}

/**
 * The executable a launch actually runs, for a resolved install and a choice.
 *
 * Kept here rather than in the launcher because the *validator* asks the same
 * question when it probes a row, and the two used to answer it differently: a Steam
 * RE2 row in Japanese runs `LeonJ.exe`, not the `LeonU.exe` the GOG layout uses, so
 * a probe that assumed the GOG name would call a perfectly good install missing.
 */
export function retailExecutableFor(
  version: GameVersionSeed,
  source: ResolvedSource,
  scenario: Re2Scenario | null
): string {
  if (source === 'steam' && version.steam !== null && version.steam !== undefined) {
    if (scenario !== null && version.steam.scenarioExec !== null && version.steam.scenarioExec !== undefined) {
      const scoped = version.steam.scenarioExec[scenario]
      if (scoped !== undefined && scoped !== '') return scoped
    }
    return version.steam.exec
  }
  return retailExecutable(version, scenario)
}

/** The row's install source, defaulting to `'none'` for a row nothing was found for. */
export function sourceOrDefault(install: ResolvedInstall | null): ResolvedSource {
  return install === null ? 'none' : install.source
}
