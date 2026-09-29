/**
 * The matching rules for observed unlocks, including the cases that decide whether the feature is honest.
 *
 * The rule that matters most is the negative one: a launch the table does not name must earn **nothing**.
 * An observed unlock writes to the player's own progress file without them asking, so a matcher that is
 * merely close is worse than no matcher at all — it puts unearned ticks in a save the launcher does not own.
 */
import { describe, expect, it } from 'vitest'

import { observedIds, rulesFrom } from './observed'
import type { ObservedRule } from './observed'
import type { Achievement } from './types'
import catalogue from '../../assets/achievements/achievements.json'

it('never infers an Enhanced RE2 character from a launcher preference', () => {
  const characterRows = catalogue.re2.filter((row) => row.id === 're2_leon' || row.id === 're2_claire')
  for (const row of characterRows) {
    expect('observed' in row && row.observed?.mode).toBe('original')
  }
})

const RULES: ObservedRule[] = [
  // Any row of the title: "Play Resident Evil 3".
  { id: 're3_play', titleId: 're3' },
  // One scenario, either version: "Play Resident Evil 2 as Claire".
  { id: 're2_claire', titleId: 're2', scenario: 'claire' },
  // One specific row: a regional or special release.
  { id: 're1_dc', titleId: 're1', versionId: 're1_dc' },
  // A mode, across every row of a title.
  { id: 're1_original', titleId: 're1', mode: 'original' }
]

describe('observedIds', () => {
  it('ticks a title-wide achievement from any of its rows', () => {
    const ids = observedIds({ titleId: 're3', versionId: 're3_us', mode: 'enhanced' }, RULES)
    expect(ids).toEqual(['re3_play'])

    // Both RE3 rows count: the rule named a title, not a release.
    expect(observedIds({ titleId: 're3', versionId: 're3_jp', mode: 'enhanced' }, RULES)).toEqual(['re3_play'])
  })

  it('waits for the scenario a rule names', () => {
    const asClaire = { titleId: 're2' as const, versionId: 're2_claire_us', mode: 'enhanced' as const, scenario: 'claire' }
    const asLeon = { titleId: 're2' as const, versionId: 're2_leon_us', mode: 'enhanced' as const, scenario: 'leon' }

    expect(observedIds(asClaire, RULES)).toContain('re2_claire')
    expect(observedIds(asLeon, RULES), 'Leon is not Claire').not.toContain('re2_claire')
  })

  it('ticks every rule that matches, not just the first', () => {
    // A specific row can satisfy a title-wide rule and a version rule at once, and losing either would be a
    // silent omission rather than a visible one.
    const ids = observedIds(
      { titleId: 're1', versionId: 're1_dc', mode: 'original' },
      RULES
    )
    expect(ids).toEqual(['re1_dc', 're1_original'])
  })

  it('narrows on mode', () => {
    const enhanced = { titleId: 're1' as const, versionId: 're1_us', mode: 'enhanced' as const }
    const original = { titleId: 're1' as const, versionId: 're1_us', mode: 'original' as const }

    expect(observedIds(enhanced, RULES)).toEqual([])
    expect(observedIds(original, RULES)).toEqual(['re1_original'])
  })

  it('earns nothing when no rule names the launch', () => {
    /*
     * THE NEGATIVE CASE, and the reason this module exists in its own file. These unlock into the player's
     * progress without being asked, so a matcher that is merely permissive would tick achievements nobody
     * earned. An empty table must earn nothing either - the rules are data, and data can be missing.
     */
    expect(observedIds({ titleId: 're2', versionId: 're2_proto', mode: 'enhanced' }, RULES)).toEqual([])
    expect(observedIds({ titleId: 're3', versionId: 're3_us', mode: 'enhanced' }, [])).toEqual([])
  })

  it('does not report the same id twice when two rules name it', () => {
    const doubled: ObservedRule[] = [
      { id: 're3_play', titleId: 're3' },
      { id: 're3_play', titleId: 're3', mode: 'enhanced' }
    ]
    expect(observedIds({ titleId: 're3', versionId: 're3_us', mode: 'enhanced' }, doubled)).toEqual(['re3_play'])
  })

  it('treats an absent scenario as a value, not a wildcard request', () => {
    // A rule that names a scenario must not match a launch that has none, or RE1 and RE3 rows would tick
    // RE2's scenario achievements.
    expect(observedIds({ titleId: 're2', versionId: 're2_proto', mode: 'enhanced' }, RULES)).toEqual([])
  })
})

describe('rulesFrom', () => {
  /** The smallest thing that satisfies `Achievement`, so the test says what it is about. */
  const definition = (id: string, observed?: Achievement['observed']): Achievement => ({
    id,
    gameId: 're3',
    name: id,
    desc: '',
    icon: '',
    unlocked: false,
    unlockDate: '',
    ...(observed === undefined ? {} : { observed })
  })

  it('turns only the definitions that declare a condition into rules', () => {
    // 365 of the shipped definitions declare none: they are in-game conditions the launcher cannot see, and
    // a rule invented for one of them would tick an achievement nobody earned.
    const rules = rulesFrom([definition('in_game_only'), definition('re3_play', { titleId: 're3' })])

    expect(rules).toEqual([{ id: 're3_play', titleId: 're3' }])
  })

  it('carries every field the condition names, and only those', () => {
    const rules = rulesFrom([
      definition('broad', { titleId: 're3' }),
      definition('narrow', { titleId: 're2', scenario: 'claire', mode: 'enhanced' })
    ])

    // A wildcard is an absent field, not a field set to undefined - `observedIds` matches on presence.
    expect(rules).toEqual([
      { id: 'broad', titleId: 're3' },
      { id: 'narrow', titleId: 're2', scenario: 'claire', mode: 'enhanced' }
    ])
  })

  it('end to end: definitions in, ids out, with nothing in between but the derivation', () => {
    // The join that matters - the shape a caller actually uses.
    const rules = rulesFrom([
      definition('re3_play', { titleId: 're3' }),
      definition('re2_claire', { titleId: 're2', scenario: 'claire' })
    ])

    expect(observedIds({ titleId: 're3', versionId: 're3_us', mode: 'enhanced' }, rules)).toEqual(['re3_play'])
    expect(
      observedIds({ titleId: 're2', versionId: 're2_claire_us', mode: 'enhanced', scenario: 'claire' }, rules)
    ).toEqual(['re2_claire'])
  })
})
