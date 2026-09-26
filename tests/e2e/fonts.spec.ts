/**
 * Typography E2E: the design's font families actually resolve.
 *
 * This guards a whole class of bug that geometry cannot see. The Figma export
 * classes every label `font-['Actor:Regular',sans-serif]` — Figma's own
 * `Family:Style` notation. Tailwind v4 compiles an arbitrary family verbatim, so
 * that class emits `font-family: Actor\:Regular, sans-serif`, which is not a family
 * any system has: the labels rendered in the OS sans (Segoe UI on Windows) while
 * every box on screen still measured exactly as designed. `styles/fonts.css`
 * answers it with an `@font-face` whose family name *includes* the suffix, so the
 * export's own class resolves without editing any markup.
 *
 * The assertions are comparative rather than numeric on purpose: they compare the
 * design's spelling against the resolved family, and that family against the
 * system sans, so the spec keeps its meaning if a font file is ever swapped. Every
 * measurement is recorded in the report so a failure explains itself.
 */
import { expect, test } from '@playwright/test'

import { closeApp, ensureMenu, firstWindow, launchApp } from './electron-app'
import type { AppHandle } from './electron-app'

let shared: AppHandle | undefined

test.afterAll(async () => {
  if (shared !== undefined) await closeApp(shared)
})

interface Measurements {
  /** The export's own spelling: `font-['Actor:Regular',sans-serif]`. */
  readonly actorAlias: number
  /** The plain family the alias is supposed to reach. */
  readonly actorPlain: number
  /** The OS default — what every label silently fell back to. */
  readonly systemSans: number
  /** A family that cannot exist, i.e. the exact shape of the old failure. */
  readonly missingFamily: number
  /** The badge in the design's badge family, and the same text in the label face. */
  readonly badgeSpec: number
  readonly badgeAsActor: number
  /** `Navigate` measured in the two candidate faces, for the live-element check. */
  readonly navActor: number
  readonly navSans: number
  /** Families the document reports as loaded. */
  readonly loaded: readonly string[]
}

test.describe('the design typography resolves', () => {
  test('the export spelled families resolve to real faces, not the system sans', async ({}, testInfo) => {
    if (shared === undefined) shared = await launchApp()
    const { app, page } = shared
    await firstWindow(app)
    await ensureMenu(page)

    const m = await page.evaluate<Measurements>(async () => {
      const SAMPLE = 'Navigate\u00A0Confirm\u00A0Back'
      // Ask for the faces the first screen needs, then wait, so the widths below
      // are measured against the real fonts rather than a fallback.
      await document.fonts.load('400 24px "Actor"')
      await document.fonts.load('400 24px "Actor:Regular"')
      await document.fonts.load('400 43.13px "Resident Evil Classic Font"')
      await document.fonts.ready

      // The synthetic spans are appended *inside* the stage layer, not to
      // `document.body`. The stage scales its whole 1920x1080 author space with a
      // CSS transform, so a span measured outside it comes back at 1:1 while the
      // live label comes back multiplied by the stage scale (0.9657 at the
      // suite's window size) — which is a silent 3.5% error in exactly the
      // comparison this spec exists to make.
      const host = document.querySelector('[data-figma-node="stage"]') ?? document.body

      const measure = (fontFamily: string, text: string, px: number, tracking: number): number => {
        const span = document.createElement('span')
        span.style.position = 'absolute'
        span.style.visibility = 'hidden'
        span.style.whiteSpace = 'nowrap'
        span.style.fontFamily = fontFamily
        span.style.fontSize = `${px}px`
        span.style.letterSpacing = `${tracking}px`
        span.style.fontWeight = '400'
        span.textContent = text
        host.append(span)
        const width = span.getBoundingClientRect().width
        span.remove()
        return Number(width.toFixed(3))
      }

      const loaded: string[] = []
      document.fonts.forEach((face) => {
        if (face.status === 'loaded') loaded.push(`${face.family}:${face.weight}`)
      })

      return {
        actorAlias: measure("'Actor:Regular', sans-serif", SAMPLE, 24, 0),
        actorPlain: measure("'Actor', sans-serif", SAMPLE, 24, 0),
        systemSans: measure('sans-serif', SAMPLE, 24, 0),
        missingFamily: measure("'__re_no_such_family__', sans-serif", SAMPLE, 24, 0),
        badgeSpec: measure("'Resident Evil Classic Font', 'Actor', sans-serif", 'Classic Collection', 43.13, 12.939),
        badgeAsActor: measure("'Actor', sans-serif", 'Classic Collection', 43.13, 12.939),
        navActor: measure("'Actor', sans-serif", 'Navigate', 24, 0),
        navSans: measure('sans-serif', 'Navigate', 24, 0),
        loaded
      }
    })

    testInfo.annotations.push({ type: 'font-measurements', description: JSON.stringify(m) })

    // 1. The export's spelling reaches the face it names.
    expect(
      Math.abs(m.actorAlias - m.actorPlain),
      `font-['Actor:Regular',sans-serif] must resolve to Actor: ` +
        `alias=${m.actorAlias} actor=${m.actorPlain} sans=${m.systemSans}`
    ).toBeLessThanOrEqual(0.01)

    // 2. Actor really is a different face from the OS sans, so (1) is not vacuous,
    //    and an unknown family falls back to that same sans — the old behaviour.
    expect(
      Math.abs(m.actorPlain - m.systemSans),
      `Actor must differ from the system sans: actor=${m.actorPlain} sans=${m.systemSans}`
    ).toBeGreaterThan(0.5)
    expect(
      Math.abs(m.missingFamily - m.systemSans),
      'an unknown family falls back to the system sans, which is what the export did before the alias existed'
    ).toBeLessThanOrEqual(0.01)

    // 3. Both families are loaded, not merely declared.
    expect(m.loaded.some((entry) => entry.startsWith('Actor:'))).toBe(true)
    expect(m.loaded.some((entry) => entry.startsWith('Actor:Regular:'))).toBe(true)

    // 4. The badge is set in a display face, not the label sans. Only a *missing*
    //    badge face would collapse these two together.
    expect(
      Math.abs(m.badgeSpec - m.badgeAsActor),
      `the badge face must not be Actor: badge=${m.badgeSpec} actor=${m.badgeAsActor}`
    ).toBeGreaterThan(1)

    // 5. The rendered badge asks for it — a live read, so a component that dropped
    //    the class fails here even though the font resolves.
    const badgeFamily = await page
      .getByText('Classic Collection', { exact: true })
      .first()
      .evaluate((element) => window.getComputedStyle(element).fontFamily)
    expect(badgeFamily).toContain('Resident Evil Classic Font')

    // 6. The helper bar's label is a live `font-['Actor:Regular',sans-serif]`
    //    element from the design: it must measure like Actor and unlike the sans.
    const labelWidth = await page
      .getByText('Navigate', { exact: true })
      .first()
      .evaluate((element) => Number(element.getBoundingClientRect().width.toFixed(3)))
    expect(
      Math.abs(labelWidth - m.navActor),
      `the helper bar's Navigate label must be Actor: label=${labelWidth} actor=${m.navActor} sans=${m.navSans}`
    ).toBeLessThanOrEqual(0.01)
    expect(
      Math.abs(labelWidth - m.navSans),
      `the helper bar's Navigate label must not be the system sans: label=${labelWidth} sans=${m.navSans}`
    ).toBeGreaterThan(0.5)
  })
})
