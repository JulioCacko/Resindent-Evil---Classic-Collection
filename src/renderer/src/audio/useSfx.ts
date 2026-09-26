/**
 * The launcher's sound effects: three WAVs decoded once into one AudioContext.
 *
 * Nothing in the Figma export defines sound, so this module has no design
 * citations -- the reference is the deleted SDL2 mixer
 * (`git show HEAD:src/audio/audio_system.cpp`) plus the frozen `SfxApi` in
 * @renderer/contracts. Everything below mirrors that mixer deliberately:
 *
 *  - One device. `AudioSystem::Init` opened a single SDL device
 *    (`audio_system.cpp:51`) and every `PlaySound` queued into it, so this module
 *    keeps exactly one `AudioContext` and one destination.
 *  - `vol = masterVolume * sfxVolume` (`audio_system.cpp:147`), with `PlaySound`
 *    returning before it touches the device when that product is <= 0
 *    (`audio_system.cpp:148-149`), and both setters clamped to [0, 1]
 *    (`audio_system.cpp:173-191`).
 *  - The same three files, in the same load order (`audio_system.cpp:61-63`):
 *    `DECIDE.wav` -> confirm, `Cancel (2).wav` -> back, `CURSOR (2).wav` -> cursor.
 *    `@renderer/data/assets` is the one place that knows the bundled URLs.
 *  - All three are loaded up front and a sound that fails to load is skipped
 *    rather than fatal: `LoadWav` returned false on a missing file and `Init`
 *    ignored the result, leaving the other two usable.
 *
 * The one thing that cannot be mirrored is *when* the device is opened. SDL opens
 * it during startup, but Chromium refuses to start an `AudioContext` before a user
 * gesture, and one constructed too early is born `suspended` and stays silent.
 * So the context is created on the first `unlock()` or `play()` and `unlock()`
 * resumes it -- which is exactly why `unlock()` is part of the frozen `SfxApi`.
 *
 * Mixer defaults are 1.0 for both multipliers, matching `masterVolume` and
 * `sfxVolume` in `defaultConfig()` (`src/main/config-store.ts:81-83`).
 */
import type { SfxApi, SfxName } from '@renderer/contracts'
import { SFX_URLS } from '@renderer/data/assets'

/** Legacy default for every volume (`audio_system.cpp:11-13`). */
const DEFAULT_VOLUME = 1

/**
 * The three sounds, in the legacy load order (`audio_system.cpp:61-63`).
 *
 * Spelled out rather than derived from `SFX_URLS` so the lookup below is checked:
 * a name added to `SfxName` without a matching entry in `SFX_URLS` is a compile
 * error here, instead of a sound that silently never plays.
 */
const SFX_NAMES = ['confirm', 'back', 'cursor'] as const satisfies readonly SfxName[]

/**
 * How one sound will be played, once the question of its bytes is settled.
 *
 * `buffer` is the intended path. `element` is the fallback for a packaged build,
 * where the bytes cannot be read at all -- see `readBytes`.
 */
type SfxSource =
  | { readonly kind: 'buffer'; readonly buffer: AudioBuffer }
  | { readonly kind: 'element'; readonly url: string }

// --- module state ----------------------------------------------------------
// Deliberately no AudioContext here: see the file comment. Nothing in this module
// touches the Web Audio API until `unlock()` or `play()` is called.

let context: AudioContext | null = null
/** The in-flight (or finished) one-shot decode of all three sounds. */
let preloading: Promise<void> | null = null
let masterLevel = DEFAULT_VOLUME
let sfxLevel = DEFAULT_VOLUME

const sources = new Map<SfxName, SfxSource>()

// --- levels ----------------------------------------------------------------

/**
 * Mirrors `SetMasterVolume` / `SetSFXVolume`, which clamped to [0, 1]
 * (`audio_system.cpp:173-191`) rather than passing an out-of-range value on to the
 * mixer. The config is not clamped on the way in ("Numbers are taken as written
 * and never clamped", `src/main/config-store.ts:118`), so a `master_volume=5.0` in
 * the ini file arrives here and is capped instead of becoming a clipped, distorted
 * play.
 *
 * A non-finite value cannot reach here -- `readNumber` only accepts finite numbers
 * (`src/main/config-store.ts:124-125`) -- but falling back to the default keeps a
 * stray NaN from silencing the launcher through a NaN gain.
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

// --- context ---------------------------------------------------------------

/**
 * The one context, created on first use and never at import time.
 *
 * A context that has reached `closed` is replaced rather than handed back: only
 * `teardown` closes one, and it nulls its own reference, so a stale closed context
 * means something outside this module closed it and returning it would make every
 * later `play` a silent no-op.
 */
function ensureContext(): AudioContext | null {
  if (context && context.state !== 'closed') return context

  try {
    context = new AudioContext()
  } catch (error) {
    // Chromium caps the number of live contexts per document. A launcher window
    // that somehow exhausted them must still navigate, so a missing device is a
    // logged failure here and every later `play` is a no-op.
    console.warn('[sfx] AudioContext could not be created; sounds are disabled', error)
    return null
  }

  return context
}

/** Resumes a context Chromium suspended. Safe to call repeatedly, and cheap. */
function resume(ctx: AudioContext): void {
  if (ctx.state !== 'suspended') return
  // The promise only rejects for a context that is closed, which the caller's
  // checks rule out; the catch exists so a rejection can never surface as an
  // unhandled one.
  void ctx.resume().catch(() => undefined)
}

// --- loading ---------------------------------------------------------------

/**
 * Reads a bundled WAV's bytes, or null when the URL scheme cannot be read.
 *
 * `fetch` is right in dev, where Vite serves the renderer over http
 * (`src/main/index.ts:159-162`). It is not usable in a packaged build: that window
 * is loaded with `loadFile` (`src/main/index.ts:164`), and Chromium's fetch refuses
 * the `file` scheme outright, with `webSecurity` left at its default of true
 * (`src/main/index.ts:101-111`).
 *
 * So a null is an expected outcome rather than an error, and `loadSound` falls
 * back to letting a media element load the URL itself -- the same thing
 * `components/Media.tsx` does for every image and video in this app, and the one
 * path Chromium does allow from a `file://` page.
 */
async function readBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.warn(`[sfx] ${url} responded ${response.status}; using media playback instead`)
      return null
    }
    return await response.arrayBuffer()
  } catch (error) {
    console.warn(`[sfx] could not read ${url}; using media playback instead`, error)
    return null
  }
}

/**
 * Records a loaded sound, unless the device it was loaded for has gone away.
 *
 * Loading is asynchronous, so `teardown` can close and clear everything in the
 * middle of a read; without this check the result would land in a map that was just
 * emptied, leaving the next context to play a buffer decoded by a dead one.
 */
function remember(ctx: AudioContext, name: SfxName, source: SfxSource): void {
  if (context !== ctx) return
  sources.set(name, source)
}

/**
 * Fetches and decodes one sound, or records how it should be played without it.
 */
async function loadSound(ctx: AudioContext, name: SfxName): Promise<void> {
  const url = SFX_URLS[name]
  const bytes = await readBytes(url)

  if (!bytes) {
    remember(ctx, name, { kind: 'element', url })
    return
  }

  try {
    // `decodeAudioData` detaches the ArrayBuffer; it is only ever used once.
    remember(ctx, name, { kind: 'buffer', buffer: await ctx.decodeAudioData(bytes) })
  } catch (error) {
    // A decode that fails only because the device went away underneath it says
    // nothing about the file, and there is no sound left to disable.
    if (context !== ctx) return
    // Otherwise: a WAV that arrives but cannot be decoded disables just that sound,
    // exactly as one failed `LoadWav` left the other two usable.
    console.warn(`[sfx] "${name}" could not be decoded; it will stay silent`, error)
  }
}

/**
 * Decodes all three sounds once. Repeat calls join the first attempt, so a screen
 * that calls `unlock()` on every click does not re-read the files.
 */
async function ensurePreload(ctx: AudioContext): Promise<void> {
  if (preloading) {
    await preloading
    return
  }

  // Assigned before the first await so a second call cannot start a second load.
  const started = Promise.all(SFX_NAMES.map((name) => loadSound(ctx, name))).then(() => undefined)
  preloading = started
  await started
}

// --- playback --------------------------------------------------------------

/**
 * Plays a sound through a media element instead of a decoded buffer.
 *
 * Used only when the bytes could not be read (see `readBytes`). It still honours
 * the mixer: `HTMLMediaElement.volume` takes the same `master * sfx` product the
 * gain node would. A fresh element per play gives the position-0 restart and the
 * overlap that buffer sources give, and it is released as soon as it finishes, so
 * at most the currently-sounding effects are alive.
 */
function playElement(url: string, gain: number): void {
  const element = new Audio(url)
  // Already clamped to [0, 1] by `setVolumes`; the setter throws outside that range.
  element.volume = gain

  const release = (): void => {
    element.removeEventListener('ended', release)
    element.removeEventListener('error', release)
    // Drop the loader so the element and its decoded samples can be collected.
    // `src = ''` would resolve to the document URL instead, hence the reload.
    element.removeAttribute('src')
    element.load()
  }

  element.addEventListener('ended', release)
  element.addEventListener('error', release)

  // Rejects while Chromium has not seen a user gesture; `unlock()` is the fix for
  // that, so there is nothing worth reporting here.
  void element.play().catch(() => release())
}

function play(name: SfxName): void {
  const gain = masterLevel * sfxLevel

  // `PlaySound` returned before touching the device when the product was zero
  // (`audio_system.cpp:148-149`); the same early-out also keeps a muted launcher
  // from opening an audio device it will never use.
  if (gain <= 0) return

  // Also the entry point that starts the decode, so a caller that never reaches
  // `unlock()` still gets sound from its second interaction onwards.
  const ctx = ensureContext()
  if (ctx) void ensurePreload(ctx)

  const source = sources.get(name)
  // Either still decoding, or disabled because it failed to decode.
  if (!source) return

  if (source.kind === 'element') {
    playElement(source.url, gain)
    return
  }

  if (!ctx) return

  // A suspended context is the normal state until the first gesture, and `play` is
  // usually called from a click or a keydown, so it is worth trying to resume here
  // as well as in `unlock` (which stays the documented path).
  resume(ctx)

  const node = ctx.createBufferSource()
  node.buffer = source.buffer

  const amp = ctx.createGain()
  amp.gain.value = gain

  node.connect(amp)
  amp.connect(ctx.destination)

  // One source per play, released the moment it finishes. A cursor sound fires on
  // every arrow key, so without this the graph would grow a source-and-gain pair
  // per keypress for the lifetime of the window.
  node.onended = () => {
    node.disconnect()
    amp.disconnect()
    node.onended = null
  }

  // No arguments: start now, from the beginning of the buffer (offset 0) -- the
  // position-0 restart the cursor and confirm sounds assume.
  node.start()
}

// --- teardown --------------------------------------------------------------

/**
 * Releases the audio device. Called when the page is torn down, and by Vite when
 * this module is hot-replaced: a launcher that is opened and closed repeatedly must
 * not leave one context behind per window or per reload.
 *
 * Everything is reset -- level state is deliberately kept, since volumes belong to
 * the config rather than to the device -- so a later `play` builds a fresh context
 * and decodes again rather than handing a source to a dead one. A load still in
 * flight is dropped by `remember`.
 *
 * Sounds currently playing through a media element are not tracked: each lasts a
 * fraction of a second, and the only caller is a document that is already going
 * away.
 */
function teardown(): void {
  const current = context
  context = null
  preloading = null
  sources.clear()

  if (current && current.state !== 'closed') {
    // Rejects only for an already-closed context, which the guard rules out.
    void current.close().catch(() => undefined)
  }
}

// Registered at import time, which is safe: no context exists yet, and a listener
// is not an audio resource. Guarded because this module is a renderer module and a
// non-DOM import (a node-side tool) must not crash on load.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', teardown)
}

if (import.meta.hot) {
  import.meta.hot.dispose(teardown)
}

// --- public surface --------------------------------------------------------

/**
 * The non-React surface: the store, the input hook and the launch pipeline all need
 * to click, and none of them renders.
 */
export const sfx: SfxApi = { play, unlock, setVolumes }

/**
 * `sfx` again, for components. It is a module constant rather than a
 * `useMemo`/`useRef` so it is the same object on every render and in every
 * component: `sfx.play('cursor')` from a handler or an effect is always the one
 * shared mixer, and calling this hook can never create a context per render.
 */
export function useSfx(): SfxApi {
  return sfx
}

/**
 * Resumes the device and starts decoding, so the first interaction after the
 * gesture is already audible -- the legacy launcher loaded all three WAVs during
 * startup for the same reason (`audio_system.cpp:61-63`). Safe to call repeatedly.
 */
function unlock(): void {
  const ctx = ensureContext()
  if (!ctx) return

  resume(ctx)
  void ensurePreload(ctx)
}

/** Sets the mixer levels used by subsequent plays, clamped like the legacy setters. */
function setVolumes(master: number, sfx: number): void {
  masterLevel = clamp01(master)
  sfxLevel = clamp01(sfx)
}
