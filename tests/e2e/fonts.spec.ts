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
 *
 * The concept's other face - the one it draws "Classic Collection" in - needs no
 * check here, because the badge is no longer live text: it renders the designer's
 * own cropped texture (see BADGE_ART in data/design.ts). This spec asserts that
 * art is present and decodes, which is the equivalent guarantee.
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

    // 4. The badge is the concept's own texture, not live text in a face this
    //    repository does not have. Asserted on the decoded image rather than on the
    //    class, so a missing or broken asset fails here instead of showing an empty
    //    box. The badge's *box* is measured by geometry.spec.ts.
    const badgeMedia = page.locator('[data-figma-node="logo-badge"] img').first()
    expect(await badgeMedia.count(), 'the badge renders an image').toBe(1)
    const badgeSrc = (await badgeMedia.getAttribute('src')) ?? ''
    expect(badgeSrc, 'the badge image is the cropped lockup texture').toContain('badge-classic-collection')
    const decoded = await badgeMedia.evaluate((element) => {
      const image = element as HTMLImageElement
      return { width: image.naturalWidth, height: image.naturalHeight }
    })
    expect(
      decoded.width,
      `the badge art decodes (natural size ${decoded.width}x${decoded.height})`
    ).toBeGreaterThan(0)
    expect(decoded.height, 'the badge art decodes').toBeGreaterThan(0)

    // 5. The helper bar's label is a live `font-['Actor:Regular',sans-serif]`
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
