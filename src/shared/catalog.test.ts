/**
 * The RetroAchievements mapping.
 *
 * The ids matter beyond being the right three numbers: the launcher may only ever *show* these
 * lists, because RA tracks by reading an emulator's memory and the games it launches are native
 * Windows builds. A wrong id would silently show another game's achievements, which is the one
 * failure this data can have - so it is asserted rather than left to a comment.
 */
import { describe, expect, it } from 'vitest'

import { TITLES } from './catalog'

describe('the RetroAchievements game ids', () => {
  it('gives every title a decimal id', () => {
    for (const title of TITLES) {
      expect(title.raGameId, `${title.id} has an RA game id`).toMatch(/^\d+$/)
    }
  })

  it('names the three PlayStation entries RA actually has for these games', () => {
    // 29328 Resident Evil, 11245 Resident Evil 2: DualShock Ver. and 11265 Resident Evil 3:
    // Nemesis - all PlayStation, which is why they are reference material here and not a source
    // of unlocks.
    expect(TITLES.map((title) => [title.id, title.raGameId])).toEqual([
      ['re1', '29328'],
      ['re2', '11245'],
      ['re3', '11265']
    ])
  })

  it('keeps every id distinct, so no two titles can show the same list', () => {
    const ids = TITLES.map((title) => title.raGameId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})