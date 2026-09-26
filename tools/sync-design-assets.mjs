#!/usr/bin/env node
/**
 * Prepares every image/video/audio/font asset the launcher renders.
 *
 * Sources, in order of preference:
 *   1. `media/` — the game art the previous launcher shipped, which is the 1x
 *      twin of the Figma export's @2x/@4x originals. Verified by dimension:
 *      e.g. `media/RE1Logo.png` is 263x70 and the design box is 262.686x70,
 *      `media/game_re1_region_default.png` is 1068x1080 and the design's mask
 *      size is 1068x1080.
 *   2. `.ref/designref/src/assets/` — for the handful of assets the export has
 *      and `media/` does not (the Unsplash backdrop, the main-menu portrait
 *      covers, the gameplay stills).
 *
 * Everything is re-encoded to WebP so the renderer bundle stays small, and a
 * design-map.json is written so the vendored Figma JSX can still resolve its
 * `figma:asset/<hash>.png` specifiers to the single converted copy.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mediaDir = join(repoRoot, 'media')
const designDir = join(repoRoot, '.ref', 'designref', 'src', 'assets')
/**
 * The design's own texture exports, named the way Figma names its layers
 * (`Game=1, Type=Default.png`). These are the authoritative logos: 8 files, one
 * per catalog row, all RGBA, each ~1.55x the size of the `media/` copy the
 * previous launcher shipped. Verified per row by aspect ratio against the design's
 * own logo box - `Game=1, Type=Default` is 409x109, aspect 3.752, against a
 * 262.686x70 box, aspect 3.753.
 */
const texturesDir = join(repoRoot, 'assets', 'textures')
const outRoot = join(repoRoot, 'src', 'renderer', 'src', 'assets')

// --- design asset hashes (from the Figma export's `figma:asset/...` specifiers) ---
const H = {
  backdrop: 'e6746d9b64d4f1fe99adc0b88f3edf7822719e12',
  cardRe1: 'ecc806a21aeffd027d985a3da9ff383c45871820',
  cardRe2: '541c500672b5c6658760e12f28531a7b2b01f3f7',
  cardRe3: '5aa35917a70c6c21e8e6cb31cc8d7918f96df093',
  gameplayRe1: '4e4dca1d6a087479654cb2498612efc7376dd481',
  gameplayRe3: '1ce77847797f861cb5cbac51dc257a06b4435c07'
}

/**
 * Image work items.
 *   source: 'media' | 'design'
 *   out:    path under assets/, without extension
 */
const IMAGES = [
  // Backdrop: the design draws a 2787x4096 portrait photo flipped vertically at
  // 1920x1539.34 with object-cover, so only a 1920-wide slice is ever visible.
  { source: 'design', id: H.backdrop, out: 'game/backdrop-unsplash', width: 1920, quality: 88 },

  // Main menu cards (380x580 boxes; the export's art is 342x482 portrait).
  { source: 'design', id: H.cardRe1, out: 'game/card-re1', quality: 90 },
  { source: 'design', id: H.cardRe2, out: 'game/card-re2', quality: 90 },
  { source: 'design', id: H.cardRe3, out: 'game/card-re3', quality: 90 },

  // Gameplay stills, used by the RE1/RE3 gameplay screens (RE2 uses a video).
  { source: 'design', id: H.gameplayRe1, out: 'game/gameplay-re1', quality: 90 },
  { source: 'design', id: H.gameplayRe3, out: 'game/gameplay-re3', quality: 90 },

  // Version-row heroes: design aspect 1600/740.
  { source: 'media', id: 'game_re1_version_default.png', out: 'game/hero-re1-us', width: 1600, quality: 86 },
  { source: 'media', id: 'game_re1_version_jp.png', out: 'game/hero-re1-jp', width: 1600, quality: 86 },
  { source: 'media', id: 'game_re1_version_alt.png', out: 'game/hero-re1-dc', width: 1600, quality: 86 },
  { source: 'media', id: 'game_re2_version_default.png', out: 'game/hero-re2-leon', width: 1600, quality: 86 },
  { source: 'media', id: 'game_re2_version_alt.png', out: 'game/hero-re2-proto', width: 1600, quality: 86 },
  { source: 'media', id: 'game_re2_version_jp.png', out: 'game/hero-re2-jp', width: 1600, quality: 86 },
  { source: 'media', id: 'game_re3_version_default.png', out: 'game/hero-re3-us', width: 1600, quality: 86 },
  { source: 'media', id: 'game_re3_version_jp.png', out: 'game/hero-re3-jp', width: 1600, quality: 86 },

  // Info-panel region art: design mask-size 1068x1080.
  { source: 'media', id: 'game_re1_region_default.png', out: 'game/region-re1-us', width: 1068, quality: 86 },
  { source: 'media', id: 'game_re1_region_jp.png', out: 'game/region-re1-jp', width: 1068, quality: 86 },
  { source: 'media', id: 'game_re1_region_alt.png', out: 'game/region-re1-dc', width: 1068, quality: 86 },
  { source: 'media', id: 'game_re2_region_default.png', out: 'game/region-re2-leon', width: 1068, quality: 86 },
  { source: 'media', id: 'game_re2_region_alt.png', out: 'game/region-re2-proto', width: 1068, quality: 86 },
  { source: 'media', id: 'game_re2_region_jp.png', out: 'game/region-re2-jp', width: 1068, quality: 86 },
  { source: 'media', id: 'game_re3_region_default.png', out: 'game/region-re3-us', width: 1068, quality: 86 },
  { source: 'media', id: 'game_re3_region_jp.png', out: 'game/region-re3-jp', width: 1068, quality: 86 },

  // Info-panel logos, taken from the design's own texture exports at their native
  // size rather than from `media/`. The export renders each one into a box only
  // 64% of its pixel width (`Game=1, Type=Default` is 409px wide into a 262.686px
  // box), so this is the same downscale the concept performs and every pixel the
  // design has to offer is kept. The `media/` copies of these eight are the
  // previous launcher's own downscales of the same art.
  //
  // The filenames are the design's: Type=Default / Type=JP / Type=Alt per game.
  // Note that RE2's `Alt` is the BIOHAZARD 1.5 prototype row, which the catalog
  // calls `re2_proto` - the key follows the catalog row id, not the old C++ name.
  { source: 'texture', id: 'Game=1, Type=Default.png', out: 'game/logo-re1-us', quality: 92 },
  { source: 'texture', id: 'Game=1, Type=JP.png', out: 'game/logo-re1-jp', quality: 92 },
  { source: 'texture', id: 'Game=1, Type=Alt.png', out: 'game/logo-re1-dc', quality: 92 },
  { source: 'texture', id: 'Game=2, Type=Default.png', out: 'game/logo-re2-leon', quality: 92 },
  { source: 'texture', id: 'Game=2, Type=Alt.png', out: 'game/logo-re2-proto', quality: 92 },
  { source: 'texture', id: 'Game=2, Type=JP.png', out: 'game/logo-re2-jp', quality: 92 },
  { source: 'texture', id: 'Game=3, Type=Default.png', out: 'game/logo-re3-us', quality: 92 },
  { source: 'texture', id: 'Game=3, Type=JP.png', out: 'game/logo-re3-jp', quality: 92 }
]

/** Videos copied verbatim (re-encoding would cost quality for no real saving). */
const VIDEOS = [
  { from: 'assets/videos/Resident Evil 1.mp4', out: 'video/video-re1.mp4' },
  { from: 'assets/videos/BIOHAZARD 1 .mp4', out: 'video/video-re1-jp.mp4' },
  { from: 'assets/videos/Resident Evil 2 Demo Trailer.mp4', out: 'video/video-re2.mp4' },
  { from: 'assets/videos/RESIDENT EVIL 2\uff1a Live Action Trailer 1998 \uff5cJP. mp4.mp4', out: 'video/video-re2-jp.mp4' },
  { from: 'assets/videos/Resident Evil 3\uff1a Nemesis Trailer 1999.mp4', out: 'video/video-re3.mp4' },
  { from: 'assets/videos/BIOHAZARD 3 LAST ESCAPE Promotional Trailer_1.mp4', out: 'video/video-re3-jp.mp4' }
]

/** WAV sound effects, kept as-is (the Web Audio API decodes them directly). */
const AUDIO = [
  { from: 'assets/audio/DECIDE.wav', out: 'audio/confirm.wav' },
  { from: 'assets/audio/Cancel (2).wav', out: 'audio/back.wav' },
  { from: 'assets/audio/CURSOR (2).wav', out: 'audio/cursor.wav' }
]

const FONTS = [{ from: 'assets/fonts/Actor-Regular.ttf', out: 'font/Actor-Regular.ttf' }]

/**
 * The badge face.
 *
 * The concept sets "Classic Collection" in a family it names
 * `Resident Evil Classic Font` (`.ref/designref/src/app/components/MainMenuPage.tsx:54`).
 * That is a fan re-creation of the title lettering from RE1/RE2/RE3 — Peter
 * Jonca's "Resident Evil Classic Game Font", released on DeviantArt under
 * CC BY-ND 3.0 — and it is deliberately NOT in this repository: the licence
 * permits redistribution of the unmodified font with credit, but the download is
 * behind a DeviantArt login, so the file cannot be fetched or verified here.
 *
 * So the badge resolves in two steps, both declared in `styles/fonts.css`:
 *   1. `local()` picks up the authentic face when the user has installed it.
 *   2. Otherwise this file stands in — Metamorphous (Sorkin Type Co, SIL Open
 *      Font License 1.1), an eroded carved serif chosen as the closest
 *      redistributable match to the classic title lettering, so the badge is set
 *      in a display face rather than falling back to the label sans.
 *
 * Dropping the authentic file in as `assets/font/ResidentEvilClassic.ttf` and
 * re-running `pnpm assets:sync` switches the bundle over with no code change.
 */
const BADGE_FONT_AUTHENTIC = 'assets/font/ResidentEvilClassic.ttf'
const BADGE_FONT_FALLBACK = 'assets/font/vendor/Metamorphous-Regular.ttf'

function resolveSource(source, id) {
  if (source === 'texture') {
    const candidate = join(texturesDir, id)
    return existsSync(candidate) ? candidate : null
  }
  const candidates =
    source === 'design'
      ? [join(designDir, `${id}.png`), join(designDir, `${id}.webp`), join(designDir, `${id}.jpg`)]
      : [join(mediaDir, id)]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** The authentic badge face when it has been provided, else the bundled OFL stand-in. */
function badgeFontSource() {
  return existsSync(join(repoRoot, BADGE_FONT_AUTHENTIC)) ? BADGE_FONT_AUTHENTIC : BADGE_FONT_FALLBACK
}

async function hashFile(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function main() {
  const check = process.argv.includes('--check')
  const missing = []
  const designMap = {}
  const written = []
  const manifest = { generatedBy: 'tools/sync-design-assets.mjs', images: [], copies: [] }

  for (const item of IMAGES) {
    const src = resolveSource(item.source, item.id)
    if (!src) {
      missing.push(`${item.source}:${item.id}`)
      continue
    }
    const dest = join(outRoot, `${item.out}.webp`)
    if (item.source === 'design') {
      designMap[item.id] = `${item.out}.webp`
      // Some design frames reference the same art through a second hash; both
      // hashes must resolve for the vendored export to import cleanly.
    }
    if (!check) {
      await mkdir(dirname(dest), { recursive: true })
      let pipeline = sharp(src, { failOn: 'none' })
      if (item.width) pipeline = pipeline.resize({ width: item.width, withoutEnlargement: true })
      await pipeline.webp({ quality: item.quality ?? 90, effort: 5 }).toFile(dest)
    }
    const size = (await import('node:fs')).statSync(dest).size
    written.push({ out: `${item.out}.webp`, source: src.replace(repoRoot + '\\', ''), bytes: size })
    manifest.images.push({
      key: item.out,
      file: `${item.out}.webp`,
      source: src.replace(repoRoot + '\\', '').replaceAll('\\', '/'),
      bytes: size
    })
  }

  for (const group of [VIDEOS, AUDIO, FONTS, [{ from: badgeFontSource(), out: 'font/badge-display.ttf' }]]) {
    for (const item of group) {
      const src = join(repoRoot, item.from)
      if (!existsSync(src)) {
        missing.push(item.from)
        continue
      }
      const dest = join(outRoot, item.out)
      if (!check) {
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, await readFile(src))
      }
      const size = (await import('node:fs')).statSync(dest).size
      written.push({ out: item.out, source: item.from, bytes: size })
      manifest.copies.push({ file: item.out, source: item.from, bytes: size })
    }
  }

  // The export references the RE2 Alt art (Claire) through a second hash in the
  // gameplay frames; keep the map explicit rather than guessing at runtime.
  designMap['8c48435db9d52dd5b04c9234227dd601baa2cbbf'] = 'game/region-re2-leon.webp'
  designMap['18fb9a00f28d573818b95bd7ae1d1ecab2df9883'] = 'game/logo-re2-leon.webp'
  designMap['58d40011eaef29d1d44ec90e8ed08041d5b0c468'] = 'game/region-re3-us.webp'
  designMap['33e66c27f8da095f0102a73b1c0d2fee8e68b3a9'] = 'game/logo-re3-us.webp'
  designMap['9b6e0e65ba185590981bf00e804ba7d696a9dd40'] = 'game/logo-re1-us.webp'
  designMap['15fba969ce9619062d27c8c68dfe61e78e470509'] = 'game/logo-re2-proto.webp'
  designMap['224a236631d0ee6393b92aab293e54d48973ad00'] = 'game/logo-re1-jp.webp'
  designMap['57406ca19408bbace2755440946d0fa49a246ca9'] = 'game/logo-re1-dc.webp'
  designMap['ac6158854fda777638c9d097f999b5b7cecd91c1'] = 'game/logo-re2-jp.webp'
  designMap['fda2f63964de51029878d3049d5b6c523bb68bb0'] = 'game/logo-re3-jp.webp'
  designMap['6b9a2a4e71fbacbbc6a27673c927df64c2a179a0'] = 'game/region-re1-us.webp'
  designMap['352e234e9a1deb048b8d66078d298fc88e109d56'] = 'game/hero-re1-us.webp'
  designMap['a31c3aa8e8999bc7e1fdc31433ce7385ad05dcbf'] = 'game/hero-re1-jp.webp'
  designMap['2f63ca4ce622c7012e112295b12b584723394c01'] = 'game/hero-re1-dc.webp'

  if (missing.length > 0) {
    console.error('sync-design-assets: missing source assets:')
    for (const m of missing) console.error(`  - ${m}`)
    process.exitCode = 1
    return
  }

  if (!check) {
    await writeFile(join(outRoot, 'design-map.json'), `${JSON.stringify(designMap, null, 2)}\n`, 'utf8')
    await writeFile(
      join(outRoot, 'MANIFEST.json'),
      `${JSON.stringify({ ...manifest, designMapCount: Object.keys(designMap).length }, null, 2)}\n`,
      'utf8'
    )
  }

  const total = written.reduce((sum, w) => sum + w.bytes, 0)
  const badgeSource = badgeFontSource()
  console.log(`sync-design-assets: ${written.length} files, ${(total / 1024 / 1024).toFixed(2)} MiB`)
  console.log(
    `sync-design-assets: badge face = ${badgeSource}` +
      (badgeSource === BADGE_FONT_AUTHENTIC
        ? ' (authentic "Resident Evil Classic" file)'
        : ' (bundled OFL stand-in; drop the authentic font in as ' +
          BADGE_FONT_AUTHENTIC +
          ' to switch)')
  )
  for (const w of written) {
    console.log(`  ${String(Math.round(w.bytes / 1024)).padStart(6)} KiB  ${w.out}  <-  ${w.source}`)
  }
}

await main()
