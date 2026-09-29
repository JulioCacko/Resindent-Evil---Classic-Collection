import { useLauncher } from '@renderer/state/store'
/**
 * First-run installation gate.
 *
 * This is the screen the launcher boots into when any title is missing
 * (`CatalogSnapshot.needsInstallScreen`) and it replaces
 * `git show HEAD:src/ui/screens/screen_install.cpp` one-for-one, so its geometry
 * is the legacy screen's rather than invented:
 *
 *   Draw()  the surface is a full-canvas `COLOR_BG` (#0f0f0f) fill; the heading
 *           is centred at y=80 in 32px; the sub-line is centred at y=140 in 20px
 *           `COLOR_GREY`; the rows start at y=260, are 1680px wide at x=120,
 *           100px tall and step 120px apart, with the title name 40px in from the
 *           row's left edge and the state on the right
 *   TitleLineStatus()  all versions installed -> INSTALLED, some -> PARTIAL,
 *                      none -> MISSING; this file derives the same state from
 *                      `GameVersion.state`, because the pill and the row caption
 *                      must never disagree about it
 *
 * Colours are the concept's, not the legacy launcher's: headings are `#cccccc`
 * (`MainMenuRe1.tsx:173`, `COLOR.heading`) and the state word is rendered by
 * `StatusPill`, which owns the one palette the design does not define.
 *
 * The rows share the card surface the other overlays use — `#1a1a1a` plate, 1px
 * `#4d4d4d` hairline, 4px corner, inset glow — so the gate reads as the same
 * family of surfaces as the dialog and the toast. The legacy row's 3px
 * `COLOR_CARD_BORDER` top strip is subsumed by that hairline: it was drawn in the
 * same grey for every row, so it carried no state and nothing is lost by folding
 * it into a uniform border.
 */
import type { ReactNode } from 'react'

import type { GameTitle, GameVersion, InstallState } from '@shared/types'
import { Backdrop } from '@renderer/components/Backdrop'
import { KeyCap } from '@renderer/components/HelperBar'
import { StatusPill } from '@renderer/components/StatusPill'
import type { InstallStatusProps } from '@renderer/contracts'
import { BACKDROP } from '@renderer/data/design'

/** The shared overlay surface; see the file header. Written out, never interpolated. */
const CARD_SURFACE =
  'bg-[#1a1a1a] border border-[#4d4d4d] border-solid rounded-[4px] shadow-[inset_0px_0px_36px_0px_rgba(255,255,255,0.15)]'

/**
 * The state word each derived state prints. `StatusPill` uppercases its label by
 * CSS (`StatusPill.tsx:43`), so these are spelled the way the legacy screen
 * printed them (`TitleLineStatus` + `StatusToColor`) and passed explicitly rather
 * than relied on as the pill's default wording.
 */
const STATE_LABEL: Record<InstallState, string> = {
  installed: 'INSTALLED',
  partial: 'PARTIAL',
  missing: 'MISSING'
}

/**
 * The legacy `TitleLineStatus`. Note that an empty version list falls through to
 * MISSING on its own: `allInstalled` starts false for a version-less title, so
 * the empty case needs no branch of its own.
 */
function titleState(versions: readonly GameVersion[]): InstallState {
  let anyInstalled = false
  let allInstalled = versions.length > 0

  for (const version of versions) {
    if (version.state === 'installed') {
      anyInstalled = true
    } else {
      allInstalled = false
    }
  }

  if (allInstalled) return 'installed'
  if (anyInstalled) return 'partial'
  return 'missing'
}

/**
 * Where a missing install is expected to be: `<appDir>/GOG Games/<gogFolderName>`.
 * `CatalogSnapshot.appDir` is documented as the directory `GOG Games` lives in
 * (src/shared/types.ts), which is also why the legacy detector looked for
 * `GOG Games/<folder>` under it (`git show HEAD:src/install/gog_detector.cpp`).
 *
 * The separator is whatever `appDir` already uses, so a Windows path is never
 * mixed with POSIX separators. With no `appDir` to learn from there is nothing to
 * join to and only the relative tail is returned; the Windows separator is the
 * default because that is the only platform electron-builder.yml targets.
 */
function expectedInstallPath(appDir: string, gogFolderName: string): string {
  const separator = appDir.includes('/') && !appDir.includes('\\') ? '/' : '\\'
  const base = appDir.replace(/[\\/]+$/, '')
  const tail = ['GOG Games', gogFolderName]
  return base.length === 0 ? tail.join(separator) : [base, ...tail].join(separator)
}

/** One 1680x100 title row, with the expected location when the title is missing. */
function InstallRow({ title, appDir }: { title: GameTitle; appDir: string }): ReactNode {
  const state = titleState(title.versions)

  return (
    <li
      className={`${CARD_SURFACE} flex h-[100px] items-center px-[40px] w-[1680px]`}
      data-name={`install-row-${title.id}`}
    >
      {/*
        `flex-1 min-w-0` rather than a content-sized column: a long expected path
        must truncate instead of pushing the state pill out of the row.
      */}
      <div className="flex flex-1 flex-col gap-[4px] min-w-0">
        <p className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[20px] text-white truncate">
          {title.name}
        </p>
        {state === 'missing' ? (
          /*
            Only for a fully missing title: when a title is PARTIAL the install
            root was found (that is what made some versions validate), so pointing
            at it again would say nothing the pill has not already said.
          */
          <p className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[#999] text-[14px] truncate">
            {`Expected at ${expectedInstallPath(appDir, title.gogFolderName)}`}
          </p>
        ) : null}
      </div>
      <div className="ml-[24px] shrink-0">
        <StatusPill label={STATE_LABEL[state]} state={state} />
      </div>
    </li>
  )
}

/**
 * The gate itself. Presentational on purpose: `onContinue` is dispatched by the
 * launcher's screen-level action handler, not from here (see the one-hook rule in
 * src/renderer/src/input/useActions.ts: "A screen wires exactly one hook").
 *
 * That is also why the surface adds no controls beyond the one caption the brief
 * allows: `CHANGE INSTALL FOLDER` is a label this pass does not act on, and
 * wiring it would mean reaching for `LauncherActions.setInstallRoot`, which is not
 * part of `InstallStatusProps`.
 */
export function InstallStatus(props: InstallStatusProps): ReactNode {
  /**
   * Destructured rather than read off `props` at each use site, except
   * `onContinue`: see the header. It stays on the parameter object so the
   * signature is the frozen one while no listener is installed here.
   */
  const { titles, configPath, appDir } = props
  const refresh = useLauncher((state) => state.refreshCatalog)
  const settings = useLauncher((state) => state.openSettings)

  return (
    <div className="absolute bg-[#0f0f0f] inset-0 overflow-hidden z-40" data-name="install-status">
      {/*
        The design places this layer on every screen below the main menu at
        `opacity-10` and pinned 40.23px below the frame (`BACKDROP.opacityScreen`,
        `BACKDROP.bottomOffset`; MainMenuRe1.tsx:179-185).
      */}
      <Backdrop bottomOffset={BACKDROP.bottomOffset} opacity={BACKDROP.opacityScreen} />

      <p
        className="absolute font-['Actor:Regular',sans-serif] leading-none left-0 not-italic right-0 text-[#ccc] text-[32px] text-center top-[80px]"
        data-name="install-heading"
      >
        INSTALLATION STATUS
      </p>
      <p
        className="absolute font-['Actor:Regular',sans-serif] leading-none left-0 not-italic right-0 text-[#999] text-[20px] text-center top-[140px]"
        data-name="install-subline"
      >
        Review detected games and defaults. Missing games remain unavailable.
      </p>

      {/* x=120 and a 20px step: `ScreenInstall::Draw`'s 1680x100 rows at 120px
          intervals. */}
      <ul
        className="absolute flex flex-col gap-[20px] left-[120px] top-[260px] w-[1680px]"
        data-name="install-rows"
      >
        {titles.length === 0 ? (
          // An empty catalog would otherwise leave the gate as a bare heading; the
          // message states which side is empty rather than blaming the user's disk.
          <li className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[#999] text-[20px]">
            No titles were reported by the catalog.
          </li>
        ) : (
          titles.map((title) => <InstallRow appDir={appDir} key={title.id} title={title} />)
        )}
      </ul>

      <div className="absolute left-[120px] top-[650px] right-[120px] text-[#ccc] text-[20px] leading-[1.5]">
        <p>Defaults: launcher minimises during play · Enhanced overlay enabled · CRT disabled · no accounts connected.</p>
        <p>RE1 Enhanced requires the Japanese GOG installation. In GOG, install or verify Resident Evil with Japanese selected, then re-detect. Never rename English data folders as a repair.</p>
        <p>For missing or partial games: verify files in the owning store, select the installation folder, then scan again.</p>
      </div>
      {/*
        Pinned above the 68px helper bar (`HELPER_BAR.height`) rather than flowed
        after the rows, so a screen holding three or eight titles keeps its meta
        block in the same place.
      */}
      <div
        className="absolute bottom-[104px] flex flex-col gap-[16px] items-center left-0 right-0"
        data-name="install-meta"
      >
        <p className="font-['Actor:Regular',sans-serif] leading-none not-italic px-[120px] text-[#999] text-[14px] text-center break-all">
          {`Config: ${configPath}`}
        </p>
        {/* The helper bar's own idiom for a key hint: 32px cap, 8px to the caption,
            24px `#999` caption. */}
        <button className="flex gap-[8px] items-center" data-name="install-recheck" onClick={() => void refresh()}>
          <KeyCap kind="enter" />
          <p className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[#999] text-[24px] whitespace-nowrap">
            RE-DETECT
          </p>
        </button>
        {/*
          Informational this pass: the label is clickable-looking because the
          pointer path is planned, but it is a `<span>` and not a `<button>` on
          purpose — a focusable control that does nothing would be a lie to the
          keyboard user, who navigates this screen through the action layer.
        */}
        <button onClick={settings}
          className="cursor-pointer font-['Actor:Regular',sans-serif] leading-none not-italic text-[#ccc] text-[20px] hover:text-white"
          data-name="install-change-folder"
        >
          CHANGE INSTALL FOLDER
        </button>
        <button className="text-white text-[24px]" onClick={props.onContinue}>CONTINUE TO COLLECTION</button>
      </div>
    </div>
  )
}
