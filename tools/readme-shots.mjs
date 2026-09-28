/**
 * Prepares the screenshots the README shows.
 *
 * The e2e suite already captures real frames of the running app - `captureScreenshot` is called all
 * over `tests/e2e/`, and its output lands in `test-results/`. This turns the useful ones into the
 * images a reader sees on the project page: picked by name, cropped of nothing, resized to a width
 * that reads well in a README, and re-encoded so the repository does not carry megabytes of PNG for
 * a handful of stills.
 *
 * Two things it refuses to do quietly:
 *
 *  - **Ship a blank frame.** A capture that happened before the renderer painted, or against a window
 *    that never appeared, is a black rectangle - and a black rectangle in a README looks like the
 *    project is broken rather than like the tooling failed. Every image is measured, and a frame whose
 *    standard deviation is near zero is reported and left out.
 *  - **Guess at its own output.** Each entry prints the source size, the size written and the pixel
 *    statistics, so a human reading the log can see what was produced without opening the files.
 *
 * Usage:
 *   node tools/readme-shots.mjs            # write docs/screenshots from test-results
 *   node tools/readme-shots.mjs --check    # report only, write nothing
 */
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_DIR = join(repoRoot, 'test-results')
const OUTPUT_DIR = join(repoRoot, 'docs', 'screenshots')

/** How wide the written images are. Wide enough to read the design's type, small enough to load. */
const TARGET_WIDTH = 1280

/**
 * A frame with less variation than this across its channels is treated as blank.
 *
 * The app's own backdrop is almost black, so a threshold has to sit below the variation a *real*
 * screen has while sitting well above a frame that never painted. Measured frames run in the forties;
 * a blank one is under two.
 */
const MIN_STDEV = 6

/**
 * The images the README uses, in the order it shows them.
 *
 * `source` is a prefix match against the captured file names, because the harness writes both a plain
 * name and a content-hashed twin and either is the same picture. `caption` is what the README says
 * about it, kept here so the two cannot drift apart.
 */
const SHOTS = [
  { name: 'main-menu', source: 'main-menu', caption: 'The main menu: the three titles as cards' },
  {
    name: 'version-screen',
    source: 'version-screen',
    caption: 'A title: every released version, with what is installed'
  },
  { name: 'launch-panel', source: 'flow-4-launch-panel', caption: 'The launch panel: mode, scenario, Play' },
  { name: 'settings', source: 'flow-6-settings', caption: 'Settings, reached with F1 from any screen' },
  {
    name: 'achievements',
    source: 'achievements',
    caption: 'Achievements: the launcher\u2019s own list, and RetroAchievements beside it'
  },
  {
    name: 'now-playing',
    source: 'flow-5-gameplay-now-playing',
    caption: 'A running game: the now-playing bar and Stop'
  }
]

/** Every PNG under `test-results`, as absolute paths. */
async function findCaptures() {
  const found = []
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.toLowerCase().endsWith('.png')) found.push(full)
    }
  }
  await walk(SOURCE_DIR)
  return found
}

/** The first capture whose file name starts with `prefix`, preferring the unhashed name. */
function pick(captures, prefix) {
  const matches = captures.filter((file) => {
    const base = file.slice(file.lastIndexOf('\\') + 1)
    return base.startsWith(prefix)
  })
  // The harness writes `name.png` and `name-<sha>.png` from the same frame; the shorter name is the
  // plain one, and preferring it keeps the log readable.
  matches.sort((left, right) => left.length - right.length)
  return matches[0] ?? null
}

function describe(stats) {
  const mean = stats.channels.map((channel) => Math.round(channel.mean)).join('/')
  const stdev = stats.channels.map((channel) => Math.round(channel.stdev)).join('/')
  return `mean ${mean}  stdev ${stdev}`
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const captures = await findCaptures()
  if (captures.length === 0) {
    console.error(`no captures found under ${relative(repoRoot, SOURCE_DIR)} - run the e2e suite first`)
    process.exitCode = 1
    return
  }
  console.log(`${String(captures.length)} captures under ${relative(repoRoot, SOURCE_DIR)}`)
  if (!checkOnly) await mkdir(OUTPUT_DIR, { recursive: true })

  let written = 0
  const skipped = []
  for (const shot of SHOTS) {
    const source = pick(captures, shot.source)
    if (source === null) {
      skipped.push(`${shot.name} (no capture matching "${shot.source}")`)
      continue
    }

    const input = sharp(source)
    const meta = await input.metadata()
    const stats = await sharp(source).stats()
    const variation = Math.max(...stats.channels.map((channel) => channel.stdev))
    if (variation < MIN_STDEV) {
      skipped.push(`${shot.name} (blank: stdev ${variation.toFixed(1)} < ${String(MIN_STDEV)})`)
      continue
    }

    const target = join(OUTPUT_DIR, `${shot.name}.png`)
    const width = Math.min(TARGET_WIDTH, meta.width ?? TARGET_WIDTH)
    const encoded = await sharp(source)
      .resize({ width, kernel: 'lanczos3' })
      // A palette is wrong for these: the design's gradients and the CRT grain band badly. Palette
      // compression and lossless compression both shrink the file without touching a pixel.
      .png({ compressionLevel: 9, effort: 10, palette: false })
      .toBuffer()

    if (!checkOnly) await writeFile(target, encoded)
    const after = await stat(source)
    console.log(
      `  ${shot.name.padEnd(14)} ${String(meta.width)}x${String(meta.height)} -> ${String(width)}px` +
        `  ${String(Math.round(after.size / 1024))} KB -> ${String(Math.round(encoded.length / 1024))} KB` +
        `  ${describe(stats)}`
    )
    written += 1
  }

  console.log(`\n${String(written)} of ${String(SHOTS.length)} shots ${checkOnly ? 'checked' : 'written'}`)
  if (skipped.length > 0) {
    console.log('skipped:')
    for (const entry of skipped) console.log(`  ${entry}`)
  }
  if (written === 0) process.exitCode = 1
}

await main()
