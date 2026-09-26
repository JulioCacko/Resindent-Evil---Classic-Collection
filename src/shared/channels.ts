/**
 * IPC channel names and the shape of the bridge the preload script exposes.
 *
 * `INVOKE_CHANNELS` are request/response; `EVENT_CHANNELS` are main -> renderer
 * pushes. Both lists are the contract the renderer and main process agree on, so
 * a typo becomes a type error rather than a silently dropped message.
 */
import type {
  Achievement,
  AppPaths,
  CatalogSnapshot,
  GameExitEvent,
  GameStatus,
  LaunchPhase,
  LaunchRequest,
  LaunchResult,
  LauncherConfig,
  ModProgress,
  Re2Scenario,
  TitleId
} from './types'

export const INVOKE_CHANNELS = {
  catalogGet: 'catalog:get',
  catalogRefresh: 'catalog:refresh',
  catalogSetInstallRoot: 'catalog:set-install-root',
  modesSet: 'modes:set',
  configPatch: 'config:patch',
  configReset: 'config:reset',
  launch: 'launch',
  gameStatus: 'game:status',
  gameFocus: 'game:focus',
  achievementsList: 'achievements:list',
  achievementsUnlock: 'achievements:unlock',
  achievementsReset: 'achievements:reset',
  appPaths: 'app:paths',
  openExternal: 'shell:open-external',
  revealPath: 'shell:reveal-path',
  quit: 'app:quit',
  ping: 'app:ping'
} as const

export const EVENT_CHANNELS = {
  modProgress: 'mod:progress',
  launchPhase: 'launch:phase',
  gameExit: 'game:exit',
  catalogChanged: 'catalog:changed',
  achievementUnlock: 'achievement:unlock',
  actionInput: 'input:action',
  toast: 'ui:toast'
} as const

export interface InvokeMap {
  [INVOKE_CHANNELS.catalogGet]: { request: void; response: CatalogSnapshot }
  [INVOKE_CHANNELS.catalogRefresh]: { request: void; response: CatalogSnapshot }
  [INVOKE_CHANNELS.catalogSetInstallRoot]: { request: { path: string }; response: CatalogSnapshot }
  [INVOKE_CHANNELS.modesSet]: {
    request: { versionId: string; mode?: 'enhanced' | 'original'; scenario?: Re2Scenario }
    response: LauncherConfig
  }
  [INVOKE_CHANNELS.configPatch]: { request: Partial<LauncherConfig>; response: LauncherConfig }
  [INVOKE_CHANNELS.configReset]: { request: void; response: LauncherConfig }
  [INVOKE_CHANNELS.launch]: { request: LaunchRequest; response: LaunchResult }
  [INVOKE_CHANNELS.gameStatus]: { request: void; response: GameStatus }
  [INVOKE_CHANNELS.gameFocus]: { request: { titleId: TitleId; versionId: string }; response: void }
  [INVOKE_CHANNELS.achievementsList]: { request: { gameId: TitleId }; response: Achievement[] }
  [INVOKE_CHANNELS.achievementsUnlock]: { request: { id: string }; response: Achievement | null }
  [INVOKE_CHANNELS.achievementsReset]: { request: { gameId?: TitleId }; response: Achievement[] }
  [INVOKE_CHANNELS.appPaths]: { request: void; response: AppPaths }
  [INVOKE_CHANNELS.openExternal]: { request: { url: string }; response: void }
  [INVOKE_CHANNELS.revealPath]: { request: { path: string }; response: void }
  [INVOKE_CHANNELS.quit]: { request: void; response: void }
  [INVOKE_CHANNELS.ping]: { request: void; response: { ok: true; version: string } }
}

export type InvokeChannel = keyof InvokeMap

export interface EventMap {
  [EVENT_CHANNELS.modProgress]: ModProgress
  [EVENT_CHANNELS.launchPhase]: LaunchPhase
  [EVENT_CHANNELS.gameExit]: GameExitEvent
  [EVENT_CHANNELS.catalogChanged]: CatalogSnapshot
  [EVENT_CHANNELS.achievementUnlock]: Achievement
  [EVENT_CHANNELS.actionInput]: { action: string }
  [EVENT_CHANNELS.toast]: { kind: 'info' | 'error'; title: string; message: string }
}

export type EventChannel = keyof EventMap

/** The object `window.reLauncher` exposes to the renderer. */
export interface ReLauncherApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    payload: InvokeMap[C]['request']
  ): Promise<InvokeMap[C]['response']>

  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void
  once<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void

  /**
   * `process.platform` from the main process. Typed as a plain string rather
   * than `NodeJS.Platform` so this shared module stays usable from the renderer
   * project, which deliberately has no Node types.
   */
  platform: string
  appVersion: string
}
