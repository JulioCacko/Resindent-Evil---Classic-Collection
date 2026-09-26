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
  gameplayRe3: '1ce77847797f861cb5cbac51dc257a06b4435c07',
  // The info panel's lane art, one asset per catalog row. Taken from the design's
  // own frames rather than from `media/`: the export's lanes place these at their
  // exact aspect (the RE2 US lane is `aspect-[1016/1132]` and its art IS
  // 1016x1132), while the `media/game_re*_region_*.png` files are all near-square
  // 1068x1080 - a different image in a different shape in every lane.
  laneRe1Us: '6b9a2a4e71fbacbbc6a27673c927df64c2a179a0',
  laneRe1Jp: '876ae37e572fddf5d603bfd671c5b90df4cfa4f5',
  laneRe1Dc: 'e736a17d4422ba825408c34032b5d7d3c6d4076c',
  laneRe2Leon: '8c48435db9d52dd5b04c9234227dd601baa2cbbf',
  laneRe2Proto: '2a4dea96a06159267f83ecc8efc454778d1e68a4',
  laneRe2Jp: 'b12c50123899f890436f2efdbde5b2a090e9d3e1',
  laneRe3Us: '58d40011eaef29d1d44ec90e8ed08041d5b0c468',
  laneRe3Jp: 'cf21968f1c075e671f72eb879de346b6729865b9'
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

  // The info panel's lane art, one per catalog row.
  //
  // Each is sized to what its lane can actually show, and never upscaled: the lane
  // is 860px wide, so 1720px is 2x for a HiDPI display, and a source narrower than
  // that is left alone. RE1 JP is the extreme case - the design puts a 640x480
  // image in a 1254x940.5 box, i.e. it is upscaled on purpose by the concept, and
  // it stays a 640x480 asset here rather than being invented at a larger size.
  { source: 'design', id: H.laneRe1Us, out: 'game/lane-re1-us', quality: 88 },
  { source: 'design', id: H.laneRe1Jp, out: 'game/lane-re1-jp', quality: 88 },
  { source: 'design', id: H.laneRe1Dc, out: 'game/lane-re1-dc', width: 1720, quality: 86 },
  { source: 'design', id: H.laneRe2Leon, out: 'game/lane-re2-leon', quality: 88 },
  { source: 'design', id: H.laneRe2Proto, out: 'game/lane-re2-proto', width: 1720, quality: 86 },
  { source: 'design', id: H.laneRe2Jp, out: 'game/lane-re2-jp', quality: 88 },
  { source: 'design', id: H.laneRe3Us, out: 'game/lane-re3-us', quality: 88 },
  { source: 'design', id: H.laneRe3Jp, out: 'game/lane-re3-jp', width: 1720, quality: 86 },

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
 * The "Classic Collection" badge.
 *
 * `assets/textures/main-logo.png` is the concept's assembled lockup: the red
 * "Resident Evil" wordmark in its upper half, a transparent gap, then the badge.
 * `tools/inspect-image.mjs` reports the three bands - red through y208, empty
 * y216..226, grey/white y227..307 - and the badge band's opaque columns run x57 to
 * x711, which is the design's own 7.52% / 7.57% inset of 770px (57.9 and 711.7) to
 * the pixel.
 *
 * The badge is lifted out of that texture rather than re-typeset, because the face
 * the concept sets it in is not in this repository (docs/DESIGN-FIDELITY.md, "The
 * badge typeface"). The designer's own pixels make the glyphs exact instead of
 * approximate, and need no font file at all.
 *
 * Two regions are left behind on purpose. The wordmark, because LogoBlock draws it
 * as inline SVG so it stays sharp at any stage scale - which matters on a display
 * larger than the 1920x1080 canvas. And the badge's baked drop shadow, because
 * Figma flattened the layer's shadow into this texture while LogoBlock draws the
 * same shadow in CSS from the export's own values; keeping both would darken it
 * twice.
 */
async function badgeArtRect() {
  const source = join(texturesDir, 'main-logo.png')
  if (!existsSync(source)) return null

  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels } = info
  const alphaAt = (x, y) => data[(y * W + x) * channels + 3]

  // Find the bands of rows that carry any pixel at all - the lockup is a stack of
  // them with transparent gaps - and take the last one, which is the badge. Taking
  // a fixed fraction of the height instead would have to guess where the wordmark
  // ends; on this texture the wordmark alone runs to y208 of 313.
  const bands = []
  for (let y = 0; y < H; y += 1) {
    let opaque = 0
    for (let x = 0; x < W; x += 1) {
      if (alphaAt(x, y) >= 32) opaque += 1
    }
    const last = bands.at(-1)
    if (opaque === 0) bands.push({ from: -1, to: -1 })
    else if (last !== undefined && last.to === y - 1 && last.from !== -1) last.to = y
    else bands.push({ from: y, to: y })
  }
  const band = bands.filter((candidate) => candidate.from !== -1).at(-1)
  if (band === undefined) return null

  let y0 = band.from
  let y1 = band.to

  // Trim the badge's flattened drop shadow off the bottom. Figma baked the layer's
  // shadow into this texture and LogoBlock draws that same shadow in CSS from the
  // export's values, so keeping both would darken it twice. The shadow's rows are
  // the ones with no light pixel at all: the lettering reaches ~248 and even the
  // bare grey fill sits near 130.
  const rowHasLight = (y) => {
    for (let x = 0; x < W; x += 1) {
      if (alphaAt(x, y) < 32) continue
      const i = (y * W + x) * channels
      if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] >= 100) return true
    }
    return false
  }
  const bottomWithShadow = y1
  while (y1 > y0 && !rowHasLight(y1)) y1 -= 1

  // The fill's own columns, measured over the trimmed band so the shadow cannot
  // widen them.
  let x0 = W
  let x1 = -1
  for (let y = y0; y <= y1; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (alphaAt(x, y) < 32) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
    }
  }
  if (x1 < 0) return null

  return {
    source,
    left: x0,
    top: y0,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
    bandsFound: bands.filter((candidate) => candidate.from !== -1).length,
    trimmedShadowRows: bottomWithShadow - y1
  }
}

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

  for (const group of [VIDEOS, AUDIO, FONTS]) {
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

  // The badge, cropped out of the concept's own lockup texture. `--check` reports
  // the same rectangle it would cut, so the crop stays auditable without writing.
  const badge = await badgeArtRect()
  if (badge === null) {
    missing.push(`${texturesDir}\\main-logo.png`)
  } else {
    const out = 'game/badge-classic-collection.webp'
    const dest = join(outRoot, out)
    if (!check) {
      await mkdir(dirname(dest), { recursive: true })
      await sharp(badge.source)
        .extract({ left: badge.left, top: badge.top, width: badge.width, height: badge.height })
        .webp({ quality: 94, effort: 5 })
        .toFile(dest)
    }
    const size = (await import('node:fs')).statSync(dest).size
    written.push({
      out,
      source: `assets/textures/main-logo.png [${badge.left},${badge.top} ${badge.width}x${badge.height}]`,
      bytes: size
    })
    manifest.images.push({
      key: 'game/badge-classic-collection',
      file: out,
      source: 'assets/textures/main-logo.png',
      crop: { left: badge.left, top: badge.top, width: badge.width, height: badge.height },
      trimmedShadowRows: badge.trimmedShadowRows,
      bytes: size
    })
  }

  // The export names several of its assets by hash rather than by semantic key, and
  // some frames reach the same art through a second hash. These entries are the ones
  // the sync's own naming cannot infer, written out so the vendored Figma JSX could
  // be imported unedited. Each maps to the row whose art it is - `logo-re2-proto` is
  // the RE2 Alt logo, which is the BIOHAZARD 1.5 row, not a Claire scenario.
  designMap['18fb9a00f28d573818b95bd7ae1d1ecab2df9883'] = 'game/logo-re2-leon.webp'
  designMap['33e66c27f8da095f0102a73b1c0d2fee8e68b3a9'] = 'game/logo-re3-us.webp'
  designMap['9b6e0e65ba185590981bf00e804ba7d696a9dd40'] = 'game/logo-re1-us.webp'
  designMap['15fba969ce9619062d27c8c68dfe61e78e470509'] = 'game/logo-re2-proto.webp'
  designMap['224a236631d0ee6393b92aab293e54d48973ad00'] = 'game/logo-re1-jp.webp'
  designMap['57406ca19408bbace2755440946d0fa49a246ca9'] = 'game/logo-re1-dc.webp'
  designMap['ac6158854fda777638c9d097f999b5b7cecd91c1'] = 'game/logo-re2-jp.webp'
  designMap['fda2f63964de51029878d3049d5b6c523bb68bb0'] = 'game/logo-re3-jp.webp'
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
  console.log(`sync-design-assets: ${written.length} files, ${(total / 1024 / 1024).toFixed(2)} MiB`)
  if (badge !== null) {
    console.log(
      `sync-design-assets: badge cropped at [${badge.left},${badge.top}] ` +
        `${badge.width}x${badge.height} from main-logo.png ` +
        `(band ${badge.bandsFound} of the lockup, trimmed ${badge.trimmedShadowRows} row(s) of baked shadow; ` + `the CSS shadow from the export is drawn instead)`
    )
  }
  for (const w of written) {
    console.log(`  ${String(Math.round(w.bytes / 1024)).padStart(6)} KiB  ${w.out}  <-  ${w.source}`)
  }
}

await main()
