/**
 * Handing a launch to Steam.
 *
 * The decision table is the point: three facts have to agree before an app id becomes a URL the
 * OS shell will act on, and each of the three is a way the launcher could otherwise start the
 * wrong thing.
 */
import { describe, expect, it } from 'vitest'

import { isSteamAppId, steamLaunchFor, steamLaunchUrl } from './steam-launch'

/** The three Classic Collection apps, as the catalog carries them. */
const RE1 = '4249100'

describe('isSteamAppId', () => {
  it('accepts the real app ids', () => {
    expect(isSteamAppId(RE1)).toBe(true)
    expect(isSteamAppId('4249110')).toBe(true)
    expect(isSteamAppId('4249120')).toBe(true)
  })

  it('refuses an empty id', () => {
    expect(isSteamAppId('')).toBe(false)
  })

  it('refuses anything that is not plain decimal digits', () => {
    // The id is interpolated into a URL that is handed to the shell, so nothing but digits may
    // reach it: a `../`, a space or a quote is not an app id.
    for (const bad of ['4249100 ', ' 4249100', '4249100\n', '../4249100', '42491_00', '-1', '4.2']) {
      expect(isSteamAppId(bad), bad).toBe(false)
    }
  })

  it('refuses zero and an id too large to be exact', () => {
    expect(isSteamAppId('0')).toBe(false)
    expect(isSteamAppId('99999999999999999999')).toBe(false)
  })
})

describe('steamLaunchUrl', () => {
  it('builds the rungameid URL', () => {
    expect(steamLaunchUrl(RE1)).toBe('steam://rungameid/4249100')
  })

  it('returns null rather than a malformed URL', () => {
    expect(steamLaunchUrl('')).toBeNull()
    expect(steamLaunchUrl('not-an-id')).toBeNull()
  })
})

describe('steamLaunchFor', () => {
  it('launches through Steam when the row is a Steam install and the user asked', () => {
    expect(steamLaunchFor({ source: 'steam', enabled: true, appId: RE1 })).toEqual({
      url: 'steam://rungameid/4249100',
      appId: RE1
    })
  })

  it('never sends a GOG row to Steam', () => {
    // Steam does not know the copy, so the app id would open a store page instead of the game.
    // Launching it this way would also lose the launcher's own tracking for no benefit.
    expect(steamLaunchFor({ source: 'gog', enabled: true, appId: RE1 })).toBeNull()
  })

  it('does nothing when the row has no app id', () => {
    // DIRECTOR'S CUT and BIOHAZARD 1.5 have no Steam equivalent, so their `steamAppId` maps to
    // nothing for those rows.
    expect(steamLaunchFor({ source: 'steam', enabled: true, appId: '' })).toBeNull()
  })

  it('respects the setting being off', () => {
    expect(steamLaunchFor({ source: 'steam', enabled: false, appId: RE1 })).toBeNull()
  })

  it('does nothing for a row nothing was found for', () => {
    expect(steamLaunchFor({ source: 'none', enabled: true, appId: RE1 })).toBeNull()
  })
})
