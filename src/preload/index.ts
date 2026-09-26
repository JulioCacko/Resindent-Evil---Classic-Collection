/**
 * Preload bridge: the entire surface the renderer is allowed to reach outside its
 * own page.
 *
 * The window is created with `contextIsolation: true` and `nodeIntegration: false`
 * (see `src/main/index.ts`), so renderer code has no `ipcRenderer`, no `require`
 * and no `process`. The one thing it gets is the object below, whose shape is
 * frozen by `ReLauncherApi` in `@shared/channels`. Nothing else is exposed on
 * purpose: a leaked `ipcRenderer` — or a `process` / `require` passthrough —
 * would let any script running in the page reach every registered main-process
 * handler, including `app:quit`, `shell:open-external` and `shell:reveal-path`.
 *
 * Channels are checked at runtime against the shared tables, not only by the type
 * system. The renderer compiles as TypeScript, but a bundle is still just JS at
 * runtime (and assets/state are user-replaceable), so a stray channel string has
 * to fail loudly here instead of surfacing as a rejected promise whose message
 * comes from deep inside main.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/channels'
import type {
  EventChannel,
  EventMap,
  InvokeChannel,
  InvokeMap,
  ReLauncherApi
} from '@shared/channels'

/**
 * Runtime mirrors of the channel tables. Built once from `Object.values` of the
 * `as const` tables so the allow-list cannot drift from the list the main process
 * registers its handlers with.
 */
const INVOKE_CHANNEL_SET: ReadonlySet<string> = new Set<string>(Object.values(INVOKE_CHANNELS))
const EVENT_CHANNEL_SET: ReadonlySet<string> = new Set<string>(Object.values(EVENT_CHANNELS))

function assertInvokeChannel(channel: string): void {
  if (INVOKE_CHANNEL_SET.has(channel)) return
  throw new Error(
    `reLauncher.invoke: "${channel}" is not an invoke channel. Known channels: ` +
      [...INVOKE_CHANNEL_SET].join(', ')
  )
}

function assertEventChannel(channel: string): void {
  if (EVENT_CHANNEL_SET.has(channel)) return
  throw new Error(
    `reLauncher.on/once: "${channel}" is not an event channel. Known channels: ` +
      [...EVENT_CHANNEL_SET].join(', ')
  )
}

/**
 * Registers a payload-only listener and returns its unsubscribe function.
 *
 * The wrapper deliberately drops the Electron `IpcRendererEvent`: it carries
 * `sender` (a `WebContents`) and `ports`, and neither must become reachable from
 * renderer code. `register` is injected so `on` and `once` share exactly one
 * implementation while each still calls the matching Electron method by name —
 * indexing `ipcRenderer` with a union of method names would type-check poorly.
 *
 * The wrapper is kept in a local so unsubscribe removes *that* function: the
 * renderer hands over a different (bridge-proxied) object than the one Electron
 * holds, so `removeListener(channel, listener)` would never match anything.
 */
function attachListener<C extends EventChannel>(
  channel: C,
  listener: (payload: EventMap[C]) => void,
  register: (
    channel: string,
    wrapped: (event: IpcRendererEvent, payload: EventMap[C]) => void
  ) => void
): () => void {
  assertEventChannel(channel)

  // A listener that is not a function would otherwise throw inside Electron's
  // callback — asynchronously, in the preload context, and therefore invisibly to
  // the renderer — the first time the event fires. Fail at subscribe time instead.
  if (typeof listener !== 'function') {
    throw new TypeError(`reLauncher: listener for "${channel}" must be a function`)
  }

  const wrapped = (_event: IpcRendererEvent, payload: EventMap[C]): void => {
    listener(payload)
  }

  register(channel, wrapped)

  return () => {
    // Also correct after a `once` has already fired: Electron removed the wrapper
    // itself, and removing an absent listener is a no-op. So the returned function
    // is always safe to call, whether or not the event ever arrived.
    ipcRenderer.removeListener(channel, wrapped)
  }
}

function on<C extends EventChannel>(
  channel: C,
  listener: (payload: EventMap[C]) => void
): () => void {
  return attachListener(channel, listener, (name, wrapped) => ipcRenderer.on(name, wrapped))
}

function once<C extends EventChannel>(
  channel: C,
  listener: (payload: EventMap[C]) => void
): () => void {
  return attachListener(channel, listener, (name, wrapped) => ipcRenderer.once(name, wrapped))
}

/**
 * Request/response half of the bridge.
 *
 * The payload travels as a single argument so main-side handlers stay
 * `(payload) => response` and cannot depend on argument order or count; a `void`
 * request is sent as `undefined` and the handler ignores it. `ipcRenderer.invoke`
 * is typed as returning `Promise<any>` by Electron, and this signature is the
 * narrowing: `InvokeMap` is the only declaration of what main answers with, and
 * main implements it via the frozen signatures in `src/main/contracts.ts`.
 */
function invoke<C extends InvokeChannel>(
  channel: C,
  payload: InvokeMap[C]['request']
): Promise<InvokeMap[C]['response']> {
  assertInvokeChannel(channel)
  return ipcRenderer.invoke(channel, payload)
}

/**
 * `npm_package_version` is present when the app is started through an npm/pnpm
 * script (i.e. `electron-vite dev`), and absent in a packaged build, where main
 * owns the real version. It is not synthesised from anything else here — main's
 * `app:ping` reply is the authoritative source, and an empty string is an honest
 * "unknown" rather than a plausible-looking wrong number.
 */
const appVersion = process.env.npm_package_version ?? ''

const api: ReLauncherApi = {
  invoke,
  on,
  once,
  platform: process.platform,
  appVersion
}

contextBridge.exposeInMainWorld('reLauncher', api)
