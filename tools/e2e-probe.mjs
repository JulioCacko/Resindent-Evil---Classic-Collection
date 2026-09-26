#!/usr/bin/env node
/**
 * Diagnostic probe: boots the built launcher in Electron, optionally drives it
 * to a screen, and dumps what the renderer actually produced — the DOM hooks,
 * console errors and, for `--node <hook>`, the element's author-space box plus
 * every ancestor's, which is what localises an offset that a failing geometry
 * assertion only reports as a number.
 *
 * Usage:
 *   node tools/e2e-probe.mjs
 *   node tools/e2e-probe.mjs --keys Enter,Enter --node gameplay-card
 *   node tools/e2e-probe.mjs --dom
 */
import { _electron as electron } from '@playwright/test'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')

function flag(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? null : (process.argv[index + 1] ?? '')
}

const keys = (flag('keys') ?? '').split(',').filter(Boolean)
const nodeHook = flag('node')
const dumpDom = process.argv.includes('--dom')

const app = await electron.launch({
  args: [resolve(repoRoot, 'out/main/index.js')],
  cwd: repoRoot
})

const page = await app.firstWindow()
const consoleMessages = []
const pageErrors = []
page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`))
page.on('pageerror', (error) => pageErrors.push(String(error && error.stack ? error.stack : error)))

await page.waitForSelector('[data-figma-node="stage"]', { timeout: 30_000 })
await page.waitForTimeout(800)

for (const key of keys) {
  await page.keyboard.press(key)
  await page.waitForTimeout(260)
}

const report = await page.evaluate(({ hook, dumpDom: withDom }) => {
  const stage = document.querySelector('[data-figma-node="stage"]')
  const stageRect = stage === null ? null : stage.getBoundingClientRect()
  const scale = stageRect === null || stageRect.width === 0 ? 1 : stageRect.width / 1920
  const toAuthor = (rect) => ({
    x: Number(((rect.x - (stageRect?.x ?? 0)) / scale).toFixed(1)),
    y: Number(((rect.y - (stageRect?.y ?? 0)) / scale).toFixed(1)),
    w: Number((rect.width / scale).toFixed(1)),
    h: Number((rect.height / scale).toFixed(1))
  })

  const hooks = Array.from(document.querySelectorAll('[data-figma-node]')).map((el) =>
    el.getAttribute('data-figma-node')
  )

  const result = {
    screen: hooks.includes('gameplay-screen')
      ? 'gameplay'
      : hooks.includes('version-screen')
        ? 'version'
        : hooks.includes('main-menu')
          ? 'menu'
          : 'unknown',
    stageScale: Number(scale.toFixed(6)),
    stageBox: stageRect === null ? null : toAuthor(stageRect),
    hooks
  }

  if (hook) {
    const el = document.querySelector(`[data-figma-node="${hook}"]`)
    if (el === null) {
      result.node = null
      result.ancestors = []
    } else {
      result.node = {
        cls: String(el.className),
        style: el.getAttribute('style'),
        box: toAuthor(el.getBoundingClientRect())
      }
      result.ancestors = []
      let cursor = el.parentElement
      while (cursor !== null) {
        const style = window.getComputedStyle(cursor)
        result.ancestors.push({
          tag: cursor.tagName.toLowerCase(),
          cls: String(cursor.className).slice(0, 150),
          position: style.position,
          box: toAuthor(cursor.getBoundingClientRect())
        })
        if (cursor === stage) break
        cursor = cursor.parentElement
      }
    }
  }

  if (withDom) {
    result.dom = (document.getElementById('root')?.innerHTML ?? '').slice(0, 6000)
  }

  return result
}, { hook: nodeHook, dumpDom })

console.log(JSON.stringify(report, null, 2))

if (consoleMessages.length > 0) {
  console.log('\n--- console ---')
  for (const message of consoleMessages.slice(0, 40)) console.log(message)
}

if (pageErrors.length > 0) {
  console.log('\n--- page errors ---')
  for (const error of pageErrors.slice(0, 10)) console.log(error)
}

await app.close()
