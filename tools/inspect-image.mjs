#!/usr/bin/env node
/**
 * Reports what a raster logo actually contains: its alpha bounding box, the
 * horizontal bands of red / grey-white / other content, and its dominant colours.
 *
 * This exists because the launcher's logos arrive as textures with names like
 * `Game=1, Type=Alt.png` or `main-logo.png`, and "is this the wordmark, the badge,
 * or the two assembled?" is not answerable from the filename. The design draws the
 * main-menu lockup as a red wordmark plus a grey "Classic Collection" badge
 * (`MainMenu.tsx`, `Frame` and `Frame1`), so a texture that carries both shows up
 * here as a red band above a grey-white band.
 *
 * Usage: node tools/inspect-image.mjs <file.png> [--rows]
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const args = process.argv.slice(2)
const file = args.find((argument) => !argument.startsWith('--'))
if (file === undefined) {
  console.error('usage: node tools/inspect-image.mjs <file.png>')
  process.exit(2)
}
const absolute = resolve(process.cwd(), file)
if (!existsSync(absolute)) {
  console.error(`inspect-image: no such file: ${absolute}`)
  process.exit(2)
}

const { data, info } = await sharp(absolute).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: W, height: H, channels } = info

const rowRed = new Array(H).fill(0)
const rowGrey = new Array(H).fill(0)
const rowOpaque = new Array(H).fill(0)
const colours = new Map()
let minX = W
let minY = H
let maxX = -1
let maxY = -1

for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * channels
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]
    if (a < 32) continue
    rowOpaque[y] += 1
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    // "Red" is the design's #FE0000 wordmark; "grey" catches the badge's #7F828A
    // fill and its near-white lettering.
    if (r > 120 && r - g > 60 && r - b > 60) rowRed[y] += 1
    else if (Math.abs(r - g) < 22 && Math.abs(g - b) < 22 && r > 100) rowGrey[y] += 1
    const key = `${r >> 5},${g >> 5},${b >> 5}`
    colours.set(key, (colours.get(key) ?? 0) + 1)
  }
}

/** Classifies a row by what most of its opaque pixels are. */
function classify(y) {
  const opaque = rowOpaque[y]
  if (opaque === 0) return 'transparent'
  if (rowRed[y] > opaque * 0.25) return 'red'
  if (rowGrey[y] > opaque * 0.25) return 'grey/white'
  return 'other'
}

const bands = []
for (let y = 0; y < H; y += 1) {
  const kind = classify(y)
  const last = bands.at(-1)
  if (last !== undefined && last.kind === kind) last.to = y
  else bands.push({ kind, from: y, to: y })
}

/** The opaque x range and luma range of a band, which is what a crop needs. */
function bandExtent(from, to) {
  let x0 = W
  let x1 = -1
  let minLuma = 255
  let maxLuma = 0
  let opaque = 0
  for (let y = from; y <= to; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * channels
      if (data[i + 3] < 32) continue
      opaque += 1
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      const luma = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])
      if (luma < minLuma) minLuma = luma
      if (luma > maxLuma) maxLuma = luma
    }
  }
  return { x0, x1, opaque, minLuma, maxLuma }
}

const shown = file.replace(/\\/g, '/')
console.log(`${shown}`)
console.log(`  raster        ${W} x ${H}, ${channels} channels`)
console.log(
  `  alpha bbox    x [${minX}..${maxX}] y [${minY}..${maxY}] -> content ${maxX - minX + 1} x ${maxY - minY + 1}`
)
console.log('  bands (5+ rows):')
for (const band of bands) {
  const rows = band.to - band.from + 1
  if (rows < 5) continue
  const slice = (arr) => arr.slice(band.from, band.to + 1).reduce((a, b) => a + b, 0)
  const extent = bandExtent(band.from, band.to)
  console.log(
    `    y ${String(band.from).padStart(4)}..${String(band.to).padStart(4)} (${String(rows).padStart(3)} rows) ` +
      `${band.kind.padEnd(14)} x [${extent.x0}..${extent.x1}] (${extent.x1 - extent.x0 + 1} wide) ` +
      `red=${slice(rowRed)} grey=${slice(rowGrey)} opaque=${slice(rowOpaque)} ` +
      `luma ${extent.minLuma}..${extent.maxLuma}`
  )
}
const top = [...colours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
console.log(`  dominant      ${top.map(([key, count]) => `${key}(${count})`).join(' ')}`)

if (args.includes('--rows')) {
  console.log('  per-row:')
  for (let y = 0; y < H; y += 1) {
    console.log(`    ${String(y).padStart(4)} ${classify(y).padEnd(14)} opaque=${rowOpaque[y]} red=${rowRed[y]} grey=${rowGrey[y]}`)
  }
}
