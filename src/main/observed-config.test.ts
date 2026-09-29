/**
 * The defensive parse, tested on the cases where being wrong is not cosmetic.
 *
 * A condition that is accepted too generously does not merely look odd: it ticks achievements nobody earned
 * and writes them to the player's own progress file, without being asked. So the interesting cases here are
 * the refusals, not the successes.
 */
import { describe, expect, it } from 'vitest'

import { readObservedCondition } from './observed-config'

describe('readObservedCondition', () => {
  it('reads a condition naming only a title, which is the broadest useful form', () => {
    expect(readObservedCondition({ titleId: 're3' })).toEqual({ titleId: 're3' })
  })

  it('reads the narrower fields when they are there', () => {
    expect(
      readObservedCondition({ titleId: 're2', scenario: 'claire', mode: 'enhanced', versionId: 're2_claire_us' })
    ).toEqual({ titleId: 're2', scenario: 'claire', mode: 'enhanced', versionId: 're2_claire_us' })
  })

  it('refuses a condition with no usable title, rather than matching everything', () => {
    /*
     * THE CASE THAT MATTERS. A condition without a title is not a narrow rule - it is a rule that matches
     * every launch, so "Complete the game as Jill" would tick the moment any game started.
     */
    for (const value of [undefined, null, {}, 're3', { titleId: '' }, { titleId: '   ' }, { titleId: 're4' }, 42]) {
      expect(readObservedCondition(value), JSON.stringify(value) ?? 'undefined').toBeUndefined()
    }
  })

  it('drops an unknown mode but keeps the rest of the condition', () => {
    // `mode: 'fullscreen'` is a typo, not a reason to ignore a valid title: the condition still matches on
    // what it does name, which is the narrower and more honest behaviour.
    expect(readObservedCondition({ titleId: 're1', mode: 'fullscreen' })).toEqual({ titleId: 're1' })
  })

  it('treats blank optional fields as absent rather than as empty strings', () => {
    // An empty `scenario` is a wildcard, not a scenario named "": otherwise every RE2 rule written with a
    // blank field would silently stop matching rows that legitimately have no scenario.
    expect(readObservedCondition({ titleId: 're2', scenario: '  ', versionId: '' })).toEqual({ titleId: 're2' })
  })

  it('trims the values it keeps, because a hand-edited file will have stray spaces', () => {
    expect(readObservedCondition({ titleId: ' re3 ', scenario: ' claire ' })).toEqual({
      titleId: 're3',
      scenario: 'claire'
    })
  })
})
