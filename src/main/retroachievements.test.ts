/**
 * The RetroAchievements client.
 *
 * The payloads below are trimmed copies of what the real API returned for this project's three
 * games - `Achievements` as an object keyed by id, every field a string - because those two
 * facts are what the parser exists to handle.
 */
import { describe, expect, it } from 'vitest'

import { fetchGameAchievements, parseGame } from './retroachievements'

/** A trimmed `API_GetGameExtended.php` response, in the real shape. */
const RESPONSE = {
  ID: 11245,
  Title: 'Resident Evil 2: DualShock Ver.',
  ConsoleID: 7,
  ConsoleName: 'PlayStation',
  NumAchievements: 2,
  Achievements: {
    '1': {
      ID: '1',
      Title: 'Welcome to Raccoon City',
      Description: 'Arrive at the police station.',
      Points: '5',
      BadgeName: '00001'
    },
    '2': {
      ID: '2',
      Title: 'A Rookie No More',
      Description: 'Complete Leon A.',
      Points: '25',
      BadgeName: '00002'
    }
  }
}

const KEY = 'test-key'

describe('fetchGameAchievements', () => {
  it('asks the extended endpoint with the key, and no user name when none is given', async () => {
    const urls: string[] = []
    const game = await fetchGameAchievements(
      11245,
      { user: '', key: KEY },
      async (url) => {
        urls.push(url)
        return RESPONSE
      }
    )
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('API_GetGameExtended.php')
    expect(urls[0]).toContain('i=11245')
    expect(urls[0]).toContain(`y=${KEY}`)
    // The API answers with the key alone, and an empty `z` is a different request.
    expect(urls[0]).not.toContain('z=')
    expect(game?.title).toBe('Resident Evil 2: DualShock Ver.')
  })

  it('sends the user name when there is one', async () => {
    const urls: string[] = []
    await fetchGameAchievements(11245, { user: 'Julio', key: KEY }, async (url) => {
      urls.push(url)
      return RESPONSE
    })
    expect(urls[0]).toContain('z=Julio')
  })

  it('refuses to ask without a key, and asks nobody', async () => {
    let called = false
    const game = await fetchGameAchievements(11245, { user: 'Julio', key: '' }, async () => {
      called = true
      return RESPONSE
    })
    expect(game).toBeNull()
    expect(called, 'no request is made without a key').toBe(false)
  })

  it('refuses a game id that is not a positive integer', async () => {
    expect(await fetchGameAchievements(0, { user: '', key: KEY }, async () => RESPONSE)).toBeNull()
    expect(await fetchGameAchievements(-3, { user: '', key: KEY }, async () => RESPONSE)).toBeNull()
  })

  it('returns null when the network fails, rather than throwing', async () => {
    const game = await fetchGameAchievements(11245, { user: '', key: KEY }, async () => {
      throw new Error('offline')
    })
    expect(game).toBeNull()
  })

  it('returns null for a payload that is not a game', async () => {
    expect(await fetchGameAchievements(11245, { user: '', key: KEY }, async () => 'nope')).toBeNull()
    expect(await fetchGameAchievements(11245, { user: '', key: KEY }, async () => ({}))).toBeNull()
  })
})

describe('parseGame', () => {
  it('reads the console, which is what says these are emulated entries', () => {
    expect(parseGame(RESPONSE)?.console).toBe('PlayStation')
  })

  it('turns the id-keyed object into an array, sorted by id', () => {
    const game = parseGame(RESPONSE)
    expect(game?.achievements.map((a) => a.id)).toEqual([1, 2])
    expect(game?.achievements[1]).toEqual({
      id: 2,
      title: 'A Rookie No More',
      description: 'Complete Leon A.',
      points: 25,
      badge: '00002'
    })
  })

  it('copes with a game that has no achievements yet', () => {
    expect(parseGame({ ID: 1, Title: 'x' })?.achievements).toEqual([])
  })

  it('skips an entry with no usable id instead of failing the whole list', () => {
    const game = parseGame({
      ID: 1,
      Title: 'x',
      Achievements: { a: { Title: 'no id' }, b: { ID: '7', Title: 'has one', Points: '3' } }
    })
    expect(game?.achievements.map((a) => a.title)).toEqual(['has one'])
  })

  it('treats a missing Points as zero rather than NaN', () => {
    const game = parseGame({ ID: 1, Title: 'x', Achievements: { a: { ID: '3', Title: 't' } } })
    expect(game?.achievements[0]?.points).toBe(0)
  })
})
