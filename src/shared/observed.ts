/**
 * Which achievements the launcher can tick by itself, from what it saw launch.
 *
 * This is the second of the two unlock producers: the manual one is a row the player clicks, and this one is
 * what the launcher knows without asking anyone. The set is small and it is small *by nature* — these games
 * are native Windows binaries, so nothing here reads their memory, and the only facts available are the ones
 * the launcher itself caused: which title, which version, which scenario, which mode was launched.
 *
 * That boundary is the whole design. "Play Resident Evil 2 as Claire" is observable, because the launcher
 * chose that row. "Finish the game with an A rank" is not, and no rule here can make it so — a rule that
 * claimed otherwise would put an unearned tick in the player's own save file, which is worse than no tick.
 *
 * Pure and data-driven: the rules are a table (`assets/achievements/observed.json`, alongside the
 * definitions), so adding an observable achievement is a data change rather than a code change, and the
 * matching is testable without a launch.
 */
import type { Achievement, TitleId } from './types'

/** The two modes, spelled here rather than imported: this module needs nothing but the ids. */
export type ObservableMode = 'enhanced' | 'original'

/** What the launcher observed about a launch. Every field comes from the launch itself, never from the game. */
export interface ObservableLaunch {
  titleId: TitleId
  /** The catalog row's id, e.g. `re2_claire_us`. */
  versionId: string
  mode: ObservableMode
  /** The row's scenario option, for the titles that have one (RE2's Leon/Claire). */
  scenario?: string | undefined
}

/**
 * One `observed: true` achievement, and the launch that means the player did it.
 *
 * An unspecified field is a wildcard, and specified fields are combined with AND. So a rule naming only
 * `titleId` ticks when any row of that title launches — which is what "Play Resident Evil 3" means — while
 * one that also names `scenario` waits for that scenario. `versionId` is the narrowest form, for an
 * achievement about one specific release (a regional version, the Director's Cut).
 */
export interface ObservedRule {
  /** The achievement definition this ticks. */
  id: string
  titleId: TitleId
  versionId?: string | undefined
  scenario?: string | undefined
  mode?: ObservableMode | undefined
}

/**
 * The rules the engine matches, derived from the definitions themselves.
 *
 * Derived rather than stored, and that is the whole point of putting the condition on the definition: there
 * is no second table that can drift out of step with the first, so an achievement cannot read as observed in
 * the catalogue and match nothing at runtime.
 *
 * Definitions without a condition are skipped - which is 365 of them today. Already-unlocked ones are *not*
 * skipped here: this function is about definitions, and the caller decides what to do about progress, because
 * unlocking an achievement the player already has is idempotent in the store rather than something to filter
 * for at this layer.
 */
export function rulesFrom(definitions: readonly Achievement[]): ObservedRule[] {
  const rules: ObservedRule[] = []
  for (const definition of definitions) {
    const condition = definition.observed
    if (condition === undefined) continue

    const rule: ObservedRule = { id: definition.id, titleId: condition.titleId }
    if (condition.versionId !== undefined) rule.versionId = condition.versionId
    if (condition.scenario !== undefined) rule.scenario = condition.scenario
    if (condition.mode !== undefined) rule.mode = condition.mode
    rules.push(rule)
  }
  return rules
}

/** True when every field the rule names agrees with the launch. Absent fields are wildcards. */
function matches(rule: ObservedRule, launch: ObservableLaunch): boolean {
  if (rule.titleId !== launch.titleId) return false
  if (rule.versionId !== undefined && rule.versionId !== launch.versionId) return false
  if (rule.scenario !== undefined && rule.scenario !== launch.scenario) return false
  if (rule.mode !== undefined && rule.mode !== launch.mode) return false
  return true
}

/**
 * The ids this launch earns, in rule order and without duplicates.
 *
 * Every match is returned rather than the first: one launch can legitimately satisfy several achievements
 * ("play RE2 as Claire" *and* "play RE2 as Claire on the enhanced version"), and reporting only one would
 * silently lose the others. The caller decides what to do about repeats — a definition already unlocked
 * stays unlocked, so ticking it again is a no-op rather than a second toast.
 */
export function observedIds(
  launch: ObservableLaunch,
  rules: readonly ObservedRule[]
): string[] {
  const ids: string[] = []
  for (const rule of rules) {
    if (matches(rule, launch) && !ids.includes(rule.id)) ids.push(rule.id)
  }
  return ids
}
