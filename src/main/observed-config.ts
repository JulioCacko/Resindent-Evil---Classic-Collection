/**
 * Reading an `observed` condition out of the catalogue, defensively.
 *
 * This lives apart from the loader so it can be tested on its own, and it earns that because of what it
 * guards: the conditions come from a JSON file the player may have edited, and a condition that is accepted
 * too generously ticks achievements nobody earned and writes them into the player's own progress file.
 *
 * The two failures it refuses outright:
 *
 *  - **No usable `titleId`.** A condition without one is not a narrower rule, it is a rule that matches every
 *    launch, which is the opposite of what "observed" should mean. The whole condition is dropped.
 *  - **A `mode` that is not one of the two modes.** Passed through as-is it would match nothing (harmless but
 *    confusing); dropped, the condition still matches on the fields it does name.
 *
 * Everything else is optional and an absent field is a wildcard, exactly as `observedIds` matches: a
 * condition naming only a title ticks when any row of that title launches.
 */
import type { ObservedCondition, TitleId } from '@shared/types'

/*
 * Local guards, in the shape `achievements.ts`, `config-store.ts`, `ipc.ts` and `retroachievements.ts` each
 * already keep their own copies of: two three-line checks are not worth a shared module that four callers
 * would then depend on, and this file joins that convention rather than starting a fifth pattern.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTitleId(value: unknown): value is TitleId {
  return value === 're1' || value === 're2' || value === 're3'
}

/** A non-empty trimmed string, or undefined - the shape every field but `titleId` takes. */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * The condition this row declares, or undefined when the row declares none or declares one that cannot be
 * trusted. Returning undefined rather than throwing is deliberate: one malformed row in a hand-edited
 * catalogue must not stop the launcher from reading the other 364.
 */
export function readObservedCondition(value: unknown): ObservedCondition | undefined {
  if (!isRecord(value)) return undefined

  const titleId = optionalText(value['titleId'])
  if (titleId === undefined || !isTitleId(titleId)) return undefined

  const condition: ObservedCondition = { titleId }

  const versionId = optionalText(value['versionId'])
  if (versionId !== undefined) condition.versionId = versionId

  const scenario = optionalText(value['scenario'])
  if (scenario !== undefined) condition.scenario = scenario

  const mode = optionalText(value['mode'])
  if (mode === 'enhanced' || mode === 'original') condition.mode = mode

  return condition
}
