/**
 * Deciding to hand a launch to Steam, and the URL that does it.
 *
 * Steam records playtime, shows its overlay and tracks achievements for games it starts, and it
 * only starts games it knows about. So a player with the Classic Collection on Steam gets all
 * of that by asking Steam to do the launching - `steam://rungameid/<appid>`, which Windows hands
 * to the running client - instead of the launcher spawning the executable itself.
 *
 * The cost is the launcher's own tracking, and it is worth naming here because it is what the
 * rest of the wiring has to compensate for. A game the launcher spawns is a *child process*: a
 * handle, a pid, an exit event. A game Steam spawns is none of those things - the process the
 * launcher starts is `steam.exe`, which exits a moment later - so status, the now-playing bar
 * and the "quitting takes the game with it" guarantee all have to come from finding the game by
 * the name of its image instead. That is `processes.ts`, and it is why the two landed together.
 *
 * Two things this refuses to do, both deliberate:
 *
 *  - **Only Steam installs.** A GOG copy is invisible to Steam unless the user has added it as a
 *    non-Steam shortcut themselves, and launching an app id for a game Steam does not have opens
 *    a store page at best. The caller passes the row's `installSource` and a `gog` row is always
 *    a no.
 *  - **Only a real app id.** Steam's ids are decimal; an empty or non-numeric one is not
 *    something to build a URL out of, because the URL is handed to the OS shell.
 *
 * **Not wired yet.** Nothing calls this module: the setting, the IPC-side branch and the
 * image-name polling that replaces child-process tracking are the change that follows, and they
 * are one change because a Steam launch without that polling would report a running game as
 * stopped.
 */

/** The installed store a row's files came from, as the catalog reports it. */
export type InstallSourceForLaunch = 'gog' | 'steam' | 'none'

export interface SteamLaunchDecision {
  /** Where this row's files are. */
  source: InstallSourceForLaunch
  /** Whether the user asked for Steam launching. */
  enabled: boolean
  /** The row's Steam app id, or `''` when the Steam release has no equivalent app. */
  appId: string
}

/**
 * The URL that asks Steam to start an app, or `null` when the id is not one.
 *
 * `rungameid` rather than the older `run/<id>` spelling: both are registered, but `rungameid` is
 * the one Steam's own documentation and its client use for "start this app".
 */
export function steamLaunchUrl(appId: string): string | null {
  if (!isSteamAppId(appId)) return null
  return `steam://rungameid/${appId}`
}

/**
 * Steam app ids are plain decimal numbers.
 *
 * `Number.isSafeInteger` on the parsed value as well as the character test, so an id long enough
 * to lose precision - or to be something other than an id - is refused rather than turned into a
 * URL.
 */
export function isSteamAppId(appId: string): boolean {
  if (!/^\d+$/.test(appId)) return false
  const parsed = Number(appId)
  return Number.isSafeInteger(parsed) && parsed > 0
}

/**
 * Whether this launch should go to Steam, and the URL to hand the shell.
 *
 * One function rather than two call sites deciding separately: the answer is a conjunction of
 * three facts (the row came from Steam, the user asked for it, the row has an app id) and a
 * launcher that checked two of them somewhere would hand the shell a URL for the wrong game.
 */
export function steamLaunchFor(
  decision: SteamLaunchDecision
): { url: string; appId: string } | null {
  if (!decision.enabled) return null
  if (decision.source !== 'steam') return null
  const url = steamLaunchUrl(decision.appId)
  return url === null ? null : { url, appId: decision.appId }
}
