/**
 * Pure derived-state helpers.
 *
 * These are written once here rather than inside components so that the launch
 * panel, the version screen and the store's action handler all agree on what the
 * currently selected version and its effective mode are.
 */
import { findTitle } from '@shared/catalog'
import type { GameTitle, GameVersion, LaunchMode, Re2Scenario } from '@shared/types'
import type { DerivedVersion, LauncherState } from '../contracts'

/**
 * The mode a version actually uses. `requiresMod` versions are locked to
 * enhanced (the legacy launcher forced this, because JapaneseEnable needs the
 * RE-Enhance DLL). Rows without mod files available are locked to original.
 */
export function resolveMode(config: { modes: Record<string, LaunchMode> } | null, version: GameVersion): LaunchMode {
  if (version.requiresMod) return 'enhanced'
  if (!version.hasMod) return 'original'
  return config?.modes?.[version.id] ?? 'original'
}

/** The RE2 scenario a version uses; null for versions that have no scenario. */
export function resolveScenario(
  config: { scenarios: Record<string, Re2Scenario> } | null,
  version: GameVersion
): Re2Scenario | null {
  if (version.scenarios.length === 0) return null
  const stored = config?.scenarios?.[version.id]
  if (stored && version.scenarios.includes(stored)) return stored
  return version.defaultScenario
}

/** True when nothing stands between this version and a successful launch. */
export function canLaunch(version: GameVersion): boolean {
  if (!version.launchable) return false
  return version.state === 'installed' || version.state === 'partial'
}

/** Launch-panel rows, in the order the design's own box style implies. */
export function panelOptions(version: GameVersion): ('mode' | 'crt' | 'scenario' | 'launch')[] {
  const options: ('mode' | 'crt' | 'scenario' | 'launch')[] = []
  if (version.launchable && version.hasMod && !version.requiresMod) options.push('mode')
  options.push('crt')
  if (version.scenarios.length > 1) options.push('scenario')
  options.push('launch')
  return options
}

export function titleAt(state: LauncherState, index: number): GameTitle | null {
  const titles = state.catalog?.titles
  if (!titles || titles.length === 0) return null
  const wrapped = ((index % titles.length) + titles.length) % titles.length
  return titles[wrapped] ?? null
}

export function versionAt(state: LauncherState, index: number): DerivedVersion | null {
  const title = state.catalog?.titles.find((candidate) => candidate.id === state.titleId)
  if (!title || title.versions.length === 0) return null
  const wrapped = ((index % title.versions.length) + title.versions.length) % title.versions.length
  const version = title.versions[wrapped]
  if (!version) return null
  return {
    version,
    mode: resolveMode(state.config, version),
    scenario: resolveScenario(state.config, version)
  }
}

export function currentTitle(state: LauncherState): GameTitle | null {
  if (!state.catalog) return null
  return state.catalog.titles.find((title) => title.id === state.titleId) ?? null
}

export function currentVersion(state: LauncherState): DerivedVersion | null {
  return versionAt(state, state.versionIndex)
}

/** Static catalog fallback for a title that has not been validated yet. */
export function seedTitle(id: string): GameTitle | null {
  const seed = findTitle(id as GameTitle['id'])
  if (!seed) return null
  return {
    id: seed.id,
    name: seed.name,
    cardAsset: seed.cardAsset,
    gogGameId: seed.gogGameId,
    gogFolderName: seed.gogFolderName,
    versions: seed.versions.map((version) => ({
      ...version,
      titleId: seed.id,
      // Unvalidated static seeds are always 'missing' until the main process
      // reports what is actually on disk.
      state: 'missing' as const,
      stateReason: null,
      hasMod: false
    })),
    installPath: '',
    hasAnyInstalled: false
  }
}
