/**
 * config-store — persistence for the launcher's settings.
 *
 * Behavioural reference: the removed `src/config/config.cpp` (the `Config`
 * class), the keys the README's Configuration section documents, and the one
 * bare key the code actually read (`gog_path_override`, `gog_detector.cpp`:
 * `if (cfg.Has("gog_path_override"))`). Three behaviours are carried over
 * deliberately, because a settings file written by the old launcher must still
 * describe the same configuration after migration:
 *  - the same key names and the same defaults,
 *  - the tolerant boolean vocabulary of `ParseBoolString` in `config.cpp`
 *    (`1 / true / yes / on` and `0 / false / no / off`),
 *  - `GetFloat`'s `strtof` numeric coercion, which accepted a numeric prefix.
 *
 * Two things differ on purpose:
 *  - the live file is JSON in `options.configPath` (Electron's `userData`)
 *    instead of `config.ini` next to the executable, because writing beside the
 *    executable fails inside `Program Files`. The legacy path is only ever read,
 *    exactly once, to migrate it,
 *  - a write can never leave a half-written file behind: it is written to a temp
 *    file in the same directory and renamed over the target, and a failure is
 *    logged rather than thrown, so a read-only disk cannot take the launcher
 *    down.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { DEFAULT_TITLE_ID, TITLES } from '@shared/catalog'
import type { LauncherConfig, LaunchMode, LaunchWindowMode, Re2Scenario, TitleId } from '@shared/types'

import type { ConfigStore, ConfigStoreOptions } from './contracts'

/**
 * The legacy launcher logged through its global logger (`src/core/log.cpp`). This
 * module uses the plain Node `console` instead, so the store stays unit-testable
 * in a plain Node process without pulling the Electron-adjacent logger into the
 * import graph. Matches the convention the sibling main-process stores use.
 */
function info(message: string): void {
  console.info(`[config-store] ${message}`)
}

function warn(message: string): void {
  console.warn(`[config-store] ${message}`)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A missing file is the normal first run, not a problem worth reporting. */
function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

// ---------------------------------------------------------------------------
// defaults
// ---------------------------------------------------------------------------

/**
 * The defaults, mirroring the legacy `config.ini` values (README,
 * "Configuration"): `[display] crt_enabled=0, scanline_intensity=0.3,
 * curvature=0.08`, `[audio] master_volume=1.0`, `[game] last_selected=re1`.
 * `crtVignette`/`crtGrain`/`sfxVolume`/`musicVolume`/`keepLauncherVisible` have
 * no legacy key, so their defaults are the ones the new settings panel draws.
 *
 * A fresh object (with fresh maps) is returned every call, so a caller can never
 * mutate the defaults other callers receive.
 */
export function defaultConfig(): LauncherConfig {
  return {
    crtEnabled: false,
    scanlineIntensity: 0.3,
    curvature: 0.08,
    crtVignette: 0.35,
    crtGrain: 0.04,
    masterVolume: 1,
    sfxVolume: 1,
    musicVolume: 1,
    lastSelectedTitle: DEFAULT_TITLE_ID,
    modes: {},
    scenarios: {},
    // These games cannot be embedded in the launcher window (docs/ARCHITECTURE.md
    // section 6), so the launcher minimises and lets the game be the thing on screen.
    launchWindowMode: 'minimise',
    // The launcher's own CRT filter and the in-game one are different mechanisms - CSS over
    // the launcher, the game's own options - so a user who wants one has not asked for the
    // other, and both start off.
    inGameCrt: false,
    // Empty until the user supplies them: no key is shipped, and the achievements surface
    // says so rather than showing an empty list as if the game had no achievements.
    raUser: '',
    raKey: '',
    gogPathOverride: '',
    keepLauncherVisible: true
  }
}

// ---------------------------------------------------------------------------
// defensive readers
// ---------------------------------------------------------------------------

/**
 * The catalog is the single source of truth for which titles exist, so the id
 * list is read from it rather than repeated here (`@shared/types` alone cannot
 * validate a string at runtime).
 */
function isTitleId(value: unknown): value is TitleId {
  return typeof value === 'string' && TITLES.some((title) => title.id === value)
}

function isLaunchMode(value: unknown): value is LaunchMode {
  return value === 'enhanced' || value === 'original'
}

function isRe2Scenario(value: unknown): value is Re2Scenario {
  return value === 'leon' || value === 'claire'
}

/**
 * Whether the launcher steps aside when a game starts, or stays on the now-playing
 * surface. Anything else in the file falls back to the default rather than reaching the
 * launch path, where an unrecognised value would silently mean "stay".
 */
function readLaunchWindowMode(value: unknown, fallback: LaunchWindowMode): LaunchWindowMode {
  return value === 'minimise' || value === 'stay' ? value : fallback
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Numbers are taken as written and never clamped: `Config::GetFloat` returned
 * whatever `strtof` produced, and range policing belongs to the settings UI, not
 * to the file reader. Only non-numbers and non-finite values (`NaN` survives a
 * `JSON.stringify` round trip as `null`, but a hand-edited file can hold one) are
 * rejected.
 */
function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function readTitleId(value: unknown, fallback: TitleId): TitleId {
  return isTitleId(value) ? value : fallback
}

/**
 * Reads a `versionId -> literal` map. Malformed entries are dropped instead of
 * discarding the whole map, matching the renderer's own tolerance
 * (`resolveMode`/`resolveScenario` fall back per row).
 */
function readMap<T extends string>(
  value: unknown,
  isEntry: (candidate: unknown) => candidate is T,
  fallback: Record<string, T>
): Record<string, T> {
  if (!isRecord(value)) return { ...fallback }
  const out: Record<string, T> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0) continue
    if (isEntry(entry)) out[key] = entry
  }
  return out
}

/**
 * Rebuilds a `LauncherConfig` from untrusted data (a parsed JSON file, or a
 * `Partial` arriving over IPC): every recognised key is kept when it has the
 * right runtime type, and every missing or malformed key falls back to `base`.
 *
 * Unknown keys are dropped — they are not part of the type the renderer
 * receives, so carrying them through the file would only give a later refactor
 * something stale to trip over.
 */
function sanitizeConfig(value: unknown, base: LauncherConfig): LauncherConfig {
  const source: Record<string, unknown> = isRecord(value) ? value : {}
  return {
    crtEnabled: readBoolean(source.crtEnabled, base.crtEnabled),
    scanlineIntensity: readNumber(source.scanlineIntensity, base.scanlineIntensity),
    curvature: readNumber(source.curvature, base.curvature),
    crtVignette: readNumber(source.crtVignette, base.crtVignette),
    crtGrain: readNumber(source.crtGrain, base.crtGrain),
    masterVolume: readNumber(source.masterVolume, base.masterVolume),
    sfxVolume: readNumber(source.sfxVolume, base.sfxVolume),
    musicVolume: readNumber(source.musicVolume, base.musicVolume),
    lastSelectedTitle: readTitleId(source.lastSelectedTitle, base.lastSelectedTitle),
    modes: readMap(source.modes, isLaunchMode, base.modes),
    scenarios: readMap(source.scenarios, isRe2Scenario, base.scenarios),
    launchWindowMode: readLaunchWindowMode(source.launchWindowMode, base.launchWindowMode),
    inGameCrt: readBoolean(source.inGameCrt, base.inGameCrt),
    raUser: readString(source.raUser, base.raUser),
    raKey: readString(source.raKey, base.raKey),
    gogPathOverride: readString(source.gogPathOverride, base.gogPathOverride),
    keepLauncherVisible: readBoolean(source.keepLauncherVisible, base.keepLauncherVisible)
  }
}

// ---------------------------------------------------------------------------
// legacy migration
// ---------------------------------------------------------------------------

type LegacyField =
  | 'crtEnabled'
  | 'scanlineIntensity'
  | 'curvature'
  | 'crtVignette'
  | 'crtGrain'
  | 'masterVolume'
  | 'sfxVolume'
  | 'musicVolume'
  | 'lastSelectedTitle'
  | 'gogPathOverride'
  | 'keepLauncherVisible'

/**
 * Legacy key -> `LauncherConfig` field.
 *
 * Every key appears twice: once section-qualified and once bare. `Config::Load`
 * folded `[display]` headers into the key (`currentSection + "." + key`), so a
 * hand-written ini — the one the README documents — yields
 * `display.crt_enabled`, while `Config::Save` wrote its already-qualified map with
 * no headers at all, which yields the same dotted key again. A file that spells
 * the key bare (as the README's `gog_path_override`, the one key the C++ code
 * genuinely read, arguably does) is accepted too: the two spellings are
 * unambiguous, and refusing one of them would silently drop a user's settings.
 *
 * Keys that are not listed here are ignored, exactly as the C++ lookups ignored
 * everything they did not ask for.
 */
const LEGACY_FIELDS: Record<string, LegacyField> = {
  'display.crt_enabled': 'crtEnabled',
  crt_enabled: 'crtEnabled',
  'display.scanline_intensity': 'scanlineIntensity',
  scanline_intensity: 'scanlineIntensity',
  'display.curvature': 'curvature',
  curvature: 'curvature',
  'display.crt_vignette': 'crtVignette',
  'display.vignette': 'crtVignette',
  crt_vignette: 'crtVignette',
  vignette: 'crtVignette',
  'display.crt_grain': 'crtGrain',
  'display.noise_amount': 'crtGrain',
  crt_grain: 'crtGrain',
  // The CRT shader calls this `noiseAmount`; it is the same setting.
  noise_amount: 'crtGrain',
  'audio.master_volume': 'masterVolume',
  master_volume: 'masterVolume',
  'audio.sfx_volume': 'sfxVolume',
  sfx_volume: 'sfxVolume',
  'audio.music_volume': 'musicVolume',
  music_volume: 'musicVolume',
  'game.last_selected': 'lastSelectedTitle',
  last_selected: 'lastSelectedTitle',
  last_selected_title: 'lastSelectedTitle',
  'game.gog_path_override': 'gogPathOverride',
  // `gog_path_override` is the spelling `gog_detector.cpp` looked up: a bare key,
  // with no section prefix.
  gog_path_override: 'gogPathOverride',
  'display.keep_launcher_visible': 'keepLauncherVisible',
  keep_launcher_visible: 'keepLauncherVisible'
}

/** The part of a dotted legacy key after its last dot; the key itself when bare. */
function bareKey(key: string): string {
  const dot = key.lastIndexOf('.')
  return dot === -1 ? key : key.slice(dot + 1)
}

/**
 * `ParseBoolString` from `config.cpp`: `1/true/yes/on` are true, `0/false/no/off`
 * are false, and anything else is not a boolean at all (the C++ `GetBool`
 * returned its default in that case, so the caller keeps the base value).
 */
function parseLegacyBoolean(value: string): boolean | null {
  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false
    default:
      return null
  }
}

/**
 * `Config::GetFloat` used `strtof` and only rejected a string that consumed no
 * character at all, so `0.3` and `0.3ms` both meant 0.3. `parseFloat` has exactly
 * those semantics, and an empty value stays "unset" (the C++ getter short-circuited
 * on an empty string before parsing).
 */
function parseLegacyNumber(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * A hand-edited ini usually quotes a value that contains spaces — a GOG install
 * path is the obvious case. The C++ reader kept the quotes, which produced an
 * unusable path; stripping a single matching pair is the one deliberate
 * divergence here.
 */
function parseLegacyString(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/**
 * Maps a legacy `config.ini` value map onto a `LauncherConfig`, layering the
 * recognised keys over `base` and leaving every other field of `base` alone.
 *
 * Section-qualified (`display.crt_enabled`) and bare (`crt_enabled`) spellings
 * both resolve, matching is case-insensitive, numeric strings are coerced, and
 * unknown keys are ignored.
 */
export function migrateLegacyConfig(
  legacy: Record<string, string>,
  base: LauncherConfig
): LauncherConfig {
  // A fresh config, with maps that do not alias `base`'s, so migrating twice from
  // the same map cannot accumulate state.
  const next: LauncherConfig = {
    ...base,
    modes: { ...base.modes },
    scenarios: { ...base.scenarios }
  }

  for (const [rawKey, rawValue] of Object.entries(legacy)) {
    const key = rawKey.trim().toLowerCase()
    if (key.length === 0 || typeof rawValue !== 'string') continue
    const field = LEGACY_FIELDS[key] ?? LEGACY_FIELDS[bareKey(key)]
    if (!field) continue

    switch (field) {
      case 'crtEnabled': {
        const parsed = parseLegacyBoolean(rawValue)
        if (parsed !== null) next.crtEnabled = parsed
        break
      }
      case 'keepLauncherVisible': {
        const parsed = parseLegacyBoolean(rawValue)
        if (parsed !== null) next.keepLauncherVisible = parsed
        break
      }
      case 'scanlineIntensity': {
        const parsed = parseLegacyNumber(rawValue)
        if (parsed !== null) next.scanlineIntensity = parsed
        break
      }
      case 'curvature': {
        const parsed = parseLegacyNumber(rawValue)
        if (parsed !== null) next.curvature = parsed
        break
      }
      case 'crtVignette': {
        const parsed = parseLegacyNumber(rawValue)
        if (parsed !== null) next.crtVignette = parsed
        break
      }
      case 'crtGrain': {
        const parsed = parseLegacyNumber(rawValue)
        if (parsed !== null) next.crtGrain = parsed
        break
      }
      case 'masterVolume': {
        const parsed = parseLegacyNumber(rawValue)
        if (parsed !== null) next.masterVolume = parsed
        break
      }
      case 'sfxVolume': {
        const parsed = parseLegacyNumber(rawValue)
        if (parsed !== null) next.sfxVolume = parsed
        break
      }
      case 'musicVolume': {
        const parsed = parseLegacyNumber(rawValue)
        if (parsed !== null) next.musicVolume = parsed
        break
      }
      case 'lastSelectedTitle': {
        // A title the catalog no longer knows about must not survive migration,
        // or the boot screen would try to select a row that does not exist.
        const candidate = rawValue.trim().toLowerCase()
        if (isTitleId(candidate)) next.lastSelectedTitle = candidate
        break
      }
      case 'gogPathOverride': {
        next.gogPathOverride = parseLegacyString(rawValue)
        break
      }
    }
  }

  return next
}

// ---------------------------------------------------------------------------
// legacy ini reader
// ---------------------------------------------------------------------------

/**
 * Default implementation of `ConfigStoreOptions.readLegacy`: parses the file the
 * old `Config` class wrote, line for line like `Config::Load` did.
 *
 * Blank lines, `#` comments (and `;`, the other conventional ini comment, which
 * the C++ reader would have tried to split on `=` and then discarded anyway) are
 * skipped, `[section]` headers qualify the keys that follow, and a line without
 * `=` is ignored. CRLF endings need no special handling because every field is
 * trimmed.
 *
 * Returns `null` when the file does not exist or cannot be read — the caller then
 * simply keeps the defaults.
 */
async function readLegacyIni(path: string): Promise<Record<string, string> | null> {
  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if (!isMissingFile(error)) warn(`could not read legacy config ${path}: ${describeError(error)}`)
    return null
  }

  const values: Record<string, string> = {}
  let section = ''
  // A UTF-8 BOM is invisible in every text editor and would otherwise glue itself
  // to the first key, hiding the first setting in a hand-edited file.
  for (const line of contents.replace(/^\uFEFF/, '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
    if (trimmed.length >= 2 && trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.slice(1, -1).trim()
      continue
    }
    const equals = trimmed.indexOf('=')
    if (equals === -1) continue
    const key = trimmed.slice(0, equals).trim()
    if (key.length === 0) continue
    const value = trimmed.slice(equals + 1).trim()
    // Last assignment wins, as in the C++ `values[key] = val`.
    values[section.length > 0 ? `${section}.${key}` : key] = value
  }
  return values
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

/**
 * Reads the JSON config, or `null` when there is no usable one. Every failure
 * mode — missing file, truncated JSON, a JSON document that is not an object —
 * degrades to `null` so `load()` can fall back to defaults, and is reported
 * without throwing.
 */
async function readExistingConfig(configPath: string): Promise<LauncherConfig | null> {
  let contents: string
  try {
    contents = await readFile(configPath, 'utf8')
  } catch (error) {
    if (!isMissingFile(error)) warn(`could not read ${configPath}: ${describeError(error)}`)
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch (error) {
    warn(`ignoring malformed config at ${configPath}: ${describeError(error)}`)
    return null
  }
  if (!isRecord(parsed)) {
    warn(`ignoring config at ${configPath}: expected a JSON object`)
    return null
  }
  return sanitizeConfig(parsed, defaultConfig())
}

export function createConfigStore(options: ConfigStoreOptions): ConfigStore {
  const readLegacy = options.readLegacy ?? readLegacyIni

  let current = defaultConfig()
  /**
   * `load()` runs once per store instance. The first successful load is what
   * decides whether the legacy ini is still relevant (it is not, once the JSON
   * exists), and every later call returns the same object, so a caller that
   * awaits `load()` twice cannot observe two different configs.
   */
  let loaded = false

  /**
   * Writes the config atomically: a temp file in the target directory, then a
   * rename over the target. A reader therefore never sees a partial document, and
   * because the rename replaces in one step a crash mid-write cannot corrupt the
   * previous settings.
   *
   * Failures (a read-only disk, a config path whose parent is a file, a locked
   * target) are logged and swallowed: the in-memory config stays authoritative so
   * the launcher keeps running with the user's changes applied for this session.
   */
  async function persist(next: LauncherConfig): Promise<void> {
    // The pid keeps two launcher instances from fighting over one temp file.
    const tempPath = `${options.configPath}.${process.pid}.tmp`
    try {
      await mkdir(dirname(options.configPath), { recursive: true })
      await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      await rename(tempPath, options.configPath)
    } catch (error) {
      warn(`could not write ${options.configPath}: ${describeError(error)}`)
      await rm(tempPath, { force: true }).catch(() => undefined)
    }
  }

  /** Sets in-memory state before persisting, so a failed write is not a lost change. */
  async function commit(next: LauncherConfig): Promise<LauncherConfig> {
    current = next
    await persist(next)
    return current
  }

  async function readLegacySafely(): Promise<Record<string, string> | null> {
    try {
      return await readLegacy(options.legacyConfigPath)
    } catch (error) {
      warn(`could not migrate legacy config ${options.legacyConfigPath}: ${describeError(error)}`)
      return null
    }
  }

  /**
   * A mutation always starts from the persisted state, never from a not-yet-loaded
   * default: patching one volume must not silently reset everything else that is
   * in the file. `load()` is idempotent and never throws, so this is safe.
   */
  async function ensureLoaded(): Promise<void> {
    if (!loaded) await load()
  }

  async function load(): Promise<LauncherConfig> {
    if (loaded) return current

    const existing = await readExistingConfig(options.configPath)
    if (existing) {
      current = existing
      loaded = true
      return current
    }

    // First run (or an unusable file): the legacy `config.ini` is the only place
    // the user's settings can come from. Writing the JSON straight after is what
    // makes the migration happen exactly once — from the next start on, the JSON
    // exists and this branch is never reached again.
    const legacy = await readLegacySafely()
    if (legacy) {
      current = migrateLegacyConfig(legacy, defaultConfig())
      info(`migrated legacy settings from ${options.legacyConfigPath}`)
    } else {
      current = defaultConfig()
    }
    loaded = true
    await persist(current)
    return current
  }

  return {
    load,

    get: () => current,

    async patch(partial: Partial<LauncherConfig>): Promise<LauncherConfig> {
      await ensureLoaded()
      // A shallow merge, as the contract states: a patch that carries `modes`
      // replaces the whole map, which is what the renderer's `patchConfig` sends.
      // Sanitising the result keeps a malformed IPC payload from reaching the file.
      return commit(sanitizeConfig({ ...current, ...partial }, current))
    },

    async setMode(versionId: string, mode: LaunchMode): Promise<LauncherConfig> {
      await ensureLoaded()
      if (versionId.length === 0 || !isLaunchMode(mode)) {
        warn(`ignoring setMode(${JSON.stringify(versionId)}, ${String(mode)})`)
        return current
      }
      return commit({
        ...current,
        modes: { ...current.modes, [versionId]: mode }
      })
    },

    async setScenario(versionId: string, scenario: Re2Scenario): Promise<LauncherConfig> {
      await ensureLoaded()
      if (versionId.length === 0 || !isRe2Scenario(scenario)) {
        warn(`ignoring setScenario(${JSON.stringify(versionId)}, ${String(scenario)})`)
        return current
      }
      return commit({
        ...current,
        scenarios: { ...current.scenarios, [versionId]: scenario }
      })
    },

    async reset(): Promise<LauncherConfig> {
      await ensureLoaded()
      return commit(defaultConfig())
    }
  }
}
