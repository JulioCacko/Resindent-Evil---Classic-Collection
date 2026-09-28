/**
 * Every measured value from the Figma export, in one place.
 *
 * Components read these instead of re-deriving numbers from class strings, and
 * the Playwright geometry test asserts against the same constants — so a value
 * can only be wrong once, not in two places.
 *
 * Source of truth for each number: `.ref/designref/src/imports/*.tsx`. The
 * Figma frame is a fixed 1920x1080 canvas; nothing here is responsive.
 */

export const CANVAS = {
  width: 1920,
  height: 1080,
  background: '#0F0F0F'
} as const

export const COLOR = {
  bg: '#0F0F0F',
  bodyGameplay: '#010101',
  panel: '#1A1A1A',
  border: '#4D4D4D',
  textPrimary: '#FFFFFF',
  textMuted: '#999999',
  heading: '#CCCCCC',
  keyBg: '#2A2A2A',
  keyBorder: '#232323',
  keyGlyph: '#FFFFFE',
  reRed: '#FE0000',
  badgeBg: '#7F828A',
  badgeText: '#F7F8FA',
  badgeShadow: '#434343'
} as const

/**
 * The "Classic Collection" badge, which is the concept's own texture rather than
 * live text.
 *
 * The design builds it from a `#7f828a` fill, an `overlay` gradient and a
 * gradient-clipped text run in a face called `Resident Evil Classic Font`
 * (Peter Jonca's "Resident Evil Classic Game Font", CC BY-ND 3.0) that is not in
 * this repository. `assets/textures/main-logo.png` is the concept's assembled
 * lockup, and its badge band is the designer's own rendering of all of that, so
 * the badge uses those pixels: exact glyphs, no font dependency, no licence
 * question. `tools/sync-design-assets.mjs` crops the band and records where.
 *
 * `badgeInset`, `badgeRadius` and `badgeShadow` are still the export's, because
 * the texture supplies only the badge's face and lettering - its position in the
 * 625.021x250 lockup and its drop shadow are drawn in CSS exactly as the export
 * declares them.
 */
export const BADGE_ART = {
  /** Asset key, resolved by data/assets.ts. */
  key: 'game/badge-classic-collection',
  /** Cropped band in `assets/textures/main-logo.png`, as measured by the sync. */
  sourceWidth: 655,
  sourceHeight: 81
} as const

/** The full-stage backdrop: a portrait photo, flipped, blended hard-light. */
export const BACKDROP = {
  boxWidth: 1920,
  boxHeight: 1539.34,
  /** Main menu blends at .20; the version and gameplay screens at .10. */
  opacityMenu: 0.2,
  opacityScreen: 0.1,
  /** Version/gameplay screens shift the layer down by this much. */
  bottomOffset: -40.23
} as const

export const MAIN_MENU = {
  padding: { top: 56, right: 32, bottom: 72, left: 32 },
  menuGap: 32,
  logo: {
    width: 625.021,
    height: 250,
    /** `inset-[5.52%_0_33.15%_0.05%]` then an inner `inset-[0_0_-5.22%_0]`. */
    wordmarkInset: { top: '5.52%', right: '0', bottom: '33.15%', left: '0.05%' },
    wordmarkInnerInset: { top: '0', right: '0', bottom: '-5.22%', left: '0' },
    wordmarkViewBox: '0 0 624.714 161.327',
    wordmarkDropShadow: '0 8.00915px 0 rgba(0, 0, 0, 0.4), 0 3.43249px 0 #848484',
    badgeInset: { top: '73.96%', right: '7.57%', bottom: '0', left: '7.52%' },
    badgeRadius: 4.786,
    badgeShadow: `0px 1.944px 0px 0px ${COLOR.badgeShadow}, 0px 3.888px 0px 0px rgba(0, 0, 0, 0.4)`
  },
  cardRowHeight: 616,
  cardGap: 48,
  card: {
    width: 380,
    height: 580,
    radius: 8,
    selectedRadius: 8.5,
    selectedScale: 1.02,
    transitionMs: 200,
    glow: 'inset 0px 0px 36px 0px rgba(255, 255, 255, 0.25)',
    dimOpacity: 0.6,
    /** RE3's cover art carries its own corner radius in the design. */
    re3ImageRadius: 15.795
  },
  copyright: {
    fontSize: 18,
    text: '\u00A9 CAPCOM CO.,LTD. 1996, 2025 All Rights Reserved. FAn Concept Julio CACKO'
  }
} as const

export const VERSION_SCREEN = {
  leftPanelWidth: 1060,
  rightPanelWidth: 860,
  padding: { top: 56, right: 32, bottom: 72, left: 32 },
  panelGap: 32,
  headingFontSize: 32,
  headingLabel: 'Game Version',
  rowGap: 18,
  rowRadius: 8,
  rowSelectedRadius: 8.5,
  /** Version rows frame their hero art at this ratio. */
  heroAspect: 1600 / 740,
  rowGlow: 'inset 0px 0px 36px 0px rgba(255, 255, 255, 0.25)',
  rowDimOpacity: 0.6,
  info: {
    /** Region-art lane inside the info panel. */
    artTop: 433,
    artHeight: 647,
    artOpacity: 0.98,
    overlayWidth: 1028.197,
    overlayHeight: 925.377,
    overlayTop: 'calc(50% + 0.31px)',
    blockHeight: 482,
    blockPadding: { top: 16, right: 32, bottom: 73, left: 32 },
    blockGap: 16,
    blockGradient:
      'linear-gradient(0deg, rgba(15, 15, 15, 0.9) 24.667%, rgba(0, 0, 0, 0.565) 72.167%, rgba(18, 18, 18, 0.267) 84.667%, rgba(117, 117, 117, 0) 100%)',
    dateFontSize: 32,
    dateLineHeight: 0.99,
    textShadow: '0px 0px 2px rgba(0, 0, 0, 0.12), 0px 4px 8px rgba(0, 0, 0, 0.14)',
    descriptionFontSize: 20,
    descriptionLineHeight: 1,
    descriptionHeight: 160,
    metaGap: 18,
    boxPadding: 16,
    boxGap: 8,
    boxShadow: 'inset 0px 0px 8px 0px rgba(255, 255, 255, 0.15)',
    metaFontSize: 16,
    metaRowGap: 10,
    videoHeight: 444,
    videoRadius: 2
  }
} as const

/**
 * The export expresses its masks as inline SVG gradients in data URIs. They are
 * plain linear gradients, so they are reproduced here as CSS directly.
 */
export const MASKS = {
  /** Info panel base layer, 860x1080, fades in from the left edge. */
  infoPanel:
    'linear-gradient(90deg, rgba(217, 217, 217, 0) 0%, rgba(175, 175, 175, 0.415094) 0.529034%, #737373 21%)',
  /** Region-art lane, 860x647. */
  regionArt: 'linear-gradient(180deg, rgba(8, 8, 8, 0) 0%, rgba(8, 8, 8, 0.8) 3.66663%, #080808 58.1666%)',
  /** Video lane, 860x602.548. */
  videoLane:
    'linear-gradient(180deg, rgba(217, 217, 217, 0) 10.9104%, rgba(175, 175, 175, 0.415094) 23.8689%, rgba(115, 115, 115, 0.8) 32.2379%)',
  /** The video frame itself, 859.898x418.749, fading its bottom edge out. */
  videoFrame: 'linear-gradient(0deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.799296) 20.6666%, #000000 99.6666%)'
} as const

export const HELPER_BAR = {
  height: 68,
  padding: { x: 32, y: 18 },
  groupGap: 24,
  itemGap: 8,
  keycapSize: 32,
  keycapInner: 24,
  keycapInset: 4,
  keycapRadius: 6,
  /** The Enter key uses a 25x25 artwork instead of the square cap. */
  enterSize: 25,
  glyphFontSize: 10,
  labelFontSize: 24,
  colorGlyph: COLOR.keyGlyph,
  colorLabel: COLOR.textMuted,
  keyShadow: '1px 1px 1px 0px rgba(0, 0, 0, 0.1)'
} as const

/** A row in the bottom helper bar. `art` picks the glyph the design draws. */
export interface HelperHint {
  keys: ('left' | 'right' | 'up' | 'down' | 'enter' | 'esc' | 'text')[]
  text?: string
  label: string
}

/**
 * The now-playing bar's three labels.
 *
 * The bar itself is an addition (docs/DESIGN-FIDELITY.md 7.1): the concept's Gameplay
 * frame fills its card with gameplay footage and says nothing about what is running, so
 * the app says it instead. `stoppedDetail` stands in for the elapsed time when nothing
 * is running, where a duration would be a claim about a process that is not there.
 */
/**
 * Settings rows.
 *
 * The surface is an addition (docs/DESIGN-FIDELITY.md 7.1) and the concept has no frame for
 * it, so the rows are the launcher's whole configuration, named once here and rendered by
 * `overlays/Settings.tsx`. `kind` is what the surface needs to know about a row in order to
 * drive it: a toggle flips, a step moves by a fixed increment, and an action runs something
 * on Enter.
 */
export type SettingsRowId =
  | 'crt'
  | 'scanlines'
  | 'curvature'
  | 'vignette'
  | 'grain'
  | 'master'
  | 'sfx'
  | 'music'
  | 'window'
  | 'ingameCrt'
  | 'installRoot'
  | 'redetect'
  | 'reset'
  | 'achievements'
  | 'retroAccount'

export interface SettingsRow {
  id: SettingsRowId
  label: string
  kind: 'toggle' | 'step' | 'action'
}

export const SETTINGS_ROWS: readonly SettingsRow[] = [
  { id: 'crt', label: 'CRT Filter', kind: 'toggle' },
  { id: 'scanlines', label: 'Scanlines', kind: 'step' },
  { id: 'curvature', label: 'Curvature', kind: 'step' },
  { id: 'vignette', label: 'Vignette', kind: 'step' },
  { id: 'grain', label: 'Grain', kind: 'step' },
  { id: 'master', label: 'Master Volume', kind: 'step' },
  { id: 'sfx', label: 'Effects Volume', kind: 'step' },
  { id: 'music', label: 'Music Volume', kind: 'step' },
  { id: 'window', label: 'When A Game Starts', kind: 'toggle' },
  // The launcher's CSS filter cannot reach the game (docs/ARCHITECTURE.md section 6), so this
  // row is the only CRT the game itself can have. It writes RE-Enhance's RetroMode and
  // dgVoodoo's CRT scaling before launch, and needs RE-Enhance injected to have anywhere to
  // write them.
  { id: 'ingameCrt', label: 'In-Game CRT', kind: 'toggle' },
  { id: 'installRoot', label: 'Games Folder', kind: 'action' },
  { id: 'redetect', label: 'Scan For Games', kind: 'action' },
  { id: 'reset', label: 'Reset Settings', kind: 'action' },
  // The achievements screen. A row rather than a key of its own: the designed screens share one
  // canonical action set, and this costs them nothing.
  { id: 'achievements', label: 'Achievements', kind: 'action' },
  { id: 'retroAccount', label: 'RetroAchievements Login', kind: 'action' }
]

/**
 * How far one arrow press moves a numeric settings row.
 *
 * Here rather than in either the store or the surface, because both need it: the store applies
 * the step and the surface draws the readout, and two copies of a step size is exactly how a
 * display ends up disagreeing with the value it displays.
 */
export const SETTINGS_STEP = {
  scanlines: 0.05,
  curvature: 0.02,
  vignette: 0.05,
  grain: 0.02,
  volume: 0.05
} as const

/** The legacy Clamp01, with a guard for NaN. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export const SETTINGS_LABEL = {
  auto: 'AUTOMATIC',
  on: 'ON',
  off: 'OFF',
  minimise: 'MINIMISE THE LAUNCHER',
  ingameCrtNote: 'NEEDS RE-ENHANCE',
  stay: 'STAY ON NOW PLAYING',
  resetConfirm: 'RESET SETTINGS?',
  resetDetail: 'Enter again to put every setting back to its default.'
} as const

export const RA_LOGIN_LABEL = {
  heading: 'RETROACHIEVEMENTS LOGIN',
  blurb: 'Paste your own web API key from retroachievements.org (Settings, then API Keys). It is stored in this launcher\u2019s configuration on your machine and sent only to retroachievements.org.',
  userLabel: 'ACCOUNT NAME (OPTIONAL)',
  userHint: 'Only needed if RA ever asks for it; the API answers with the key alone.',
  keyLabel: 'WEB API KEY',
  keyHint: 'A personal credential. Nothing here is shared, uploaded or bundled with the launcher.',
  note: 'Connecting loads the achievement lists as reference. RetroAchievements cannot unlock anything for these games: it reads an emulator\u2019s memory, and the launcher starts the native Windows builds where no emulator is running.',
  save: 'SAVE',
  cancel: 'CANCEL'
} as const

export const HINTS_ACHIEVEMENTS: HelperHint[] = [{ keys: ['esc'], label: 'Back' }]

/**
 * The achievements surface's own text.
 *
 * locked is what the launcher can honestly say, because it has never detected an in-game
 * event - the previous launcher's hook was a stub too - so an achievement is either carried as
 * unlocked by the player's own progress file or it is not.
 */
export const ACHIEVEMENTS_LABEL = {
  locked: 'LOCKED',
  unlocked: 'UNLOCKED',
  of: 'of',
  unlockedCount: 'UNLOCKED',
  empty: 'No achievements for this title yet.',
  // The RetroAchievements half. Its states are separate because 'RA has nothing for this game' and
  // 'you have not connected RA' are different facts, and the surface must not merge them.
  retroHeading: 'RETROACHIEVEMENTS',
  retroLoading: 'Loading...',
  retroEmpty: 'RetroAchievements has no list for this game.',
  retroUnconnected: 'Not connected. Add your RetroAchievements key in Settings to load its list.',
  retroCount: 'achievements, from RetroAchievements.',
  note:
    'These are the launcher\u2019s own definitions, read from your progress file. RetroAchievements cannot unlock anything for a native Windows build - it reads an emulator\u2019s memory, and these games are not emulated - so its lists appear here as reference and are ticked locally.'
} as const

export const HINTS_SETTINGS: HelperHint[] = [
  { keys: ['up', 'down'], label: 'Navigate' },
  { keys: ['left', 'right'], label: 'Change' },
  { keys: ['enter'], label: 'Select' },
  { keys: ['esc'], label: 'Back' }
]

export const NOW_PLAYING_LABEL = {
  running: 'NOW PLAYING',
  stopped: 'NOT RUNNING',
  stoppedDetail: 'the game is not running',
  stop: 'STOP GAME'
} as const
export const HINTS_MENU: HelperHint[] = [
  { keys: ['left', 'right'], label: 'Navigate' },
  { keys: ['enter'], label: 'Confirm' },
  { keys: ['esc'], label: 'Back' }
]

export const HINTS_VERSION: HelperHint[] = [
  { keys: ['up', 'down'], label: 'Navigate' },
  { keys: ['enter'], label: 'Confirm' },
  { keys: ['esc'], label: 'Back' }
]

export const HINTS_PANEL: HelperHint[] = [
  { keys: ['left', 'right'], label: 'Change' },
  { keys: ['enter'], label: 'Confirm' },
  { keys: ['esc'], label: 'Back' }
]

export const HINTS_GAMEPLAY: HelperHint[] = [{ keys: ['esc'], label: 'Back' }]

export const HINTS_INSTALL: HelperHint[] = [{ keys: ['enter'], label: 'Continue' }]

export const HINTS_ERROR: HelperHint[] = [{ keys: ['esc', 'enter'], label: 'Dismiss' }]

/** Gameplay screen: shared geometry, then the per-title differences. */
export const GAMEPLAY_COMMON = {
  card: { width: 1300, height: 975, radius: 4, background: '#FFFFFF' },
  /** The media inside the card is oversized and offset to crop as designed. */
  mediaInset: { height: '107.28%', left: '-0.05%', top: '-3.78%', width: '100.1%' },
  logoRotation: -90
} as const

export interface GameplayLayout {
  /** Region-art lane behind the card. */
  art: {
    width: number
    right: number
    top: string
    aspect: string
    /** Offsets applied to the art inside the lane (percent strings as designed). */
    laneInset: string
    mediaInset: { height: string; left: string; top: string; width: string } | null
  }
  cardTop: number
  logo: { left: number; boxWidth: number; boxHeight: number; width: number; height: number; top: string }
}

export const GAMEPLAY_LAYOUTS: Record<'re1' | 're2' | 're3', GameplayLayout> = {
  re1: {
    art: {
      width: 999,
      right: -293,
      top: '50%',
      aspect: '1218.7529296875/1445.560546875',
      laneInset: '-109.94px 0 auto 0',
      mediaInset: { height: '163.67%', left: '-20.62%', top: '-27.26%', width: '120.62%' }
    },
    cardTop: 45,
    logo: { left: 73.11, boxWidth: 137.574, boxHeight: 516.266, width: 516.266, height: 137.574, top: 'calc(50% - 1.13px)' }
  },
  re2: {
    art: {
      width: 999,
      right: -418,
      top: '0',
      aspect: '1016/1132',
      laneInset: '0 auto 0 -0.05%',
      mediaInset: null
    },
    cardTop: 45,
    logo: { left: 73, boxWidth: 130, boxHeight: 543.803, width: 543.803, height: 130, top: '50%' }
  },
  re3: {
    art: {
      width: 1285,
      right: -74,
      top: 'calc(50% - 0.22px)',
      aspect: '1920/1441',
      laneInset: '-22.19% 0 0 0',
      mediaInset: null
    },
    cardTop: 52.28,
    logo: { left: 96, boxWidth: 130.318, boxHeight: 632, width: 632, height: 130.318, top: '50%' }
  }
}

/** CRT overlay defaults, mirroring the legacy `config.ini` keys. */
export const CRT_DEFAULTS = {
  enabled: false,
  scanlineIntensity: 0.3,
  curvature: 0.08,
  vignette: 0.35,
  grain: 0.04
} as const

export const MODE_LABEL = {
  enhanced: 'ENHANCED',
  original: 'ORIGINAL'
} as const

export const SCENARIO_LABEL = {
  leon: 'LEON',
  claire: 'CLAIRE'
} as const
