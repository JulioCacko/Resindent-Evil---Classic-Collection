/**
 * Modal error dialog.
 *
 * The design has no frame for this surface, so it is assembled from the tokens
 * the concept already uses instead of new ones:
 *
 *  - the scrim is `rgba(0, 0, 0, .75)` — the exact alpha the screen this replaces
 *    painted (`RGBA(0, 0, 0, 0xC0)` in `git show HEAD:src/ui/screens/screen_error.cpp`);
 *  - the card plate is `#1a1a1a`, i.e. `COLOR.panel` in
 *    src/renderer/src/data/design.ts and the plate the legacy launcher filled its
 *    cards with (`RGBA(0x1A, 0x1A, 0x1A, 0xFF)`, same file);
 *  - the 1px `#4d4d4d` hairline, the 4px corner and the inset glow are the
 *    design's own panel idiom (`.ref/designref/src/imports/MainMenuRe1.tsx:21`
 *    for the hairline, `:130` for the `inset_0px_0px_8px_0px_rgba(255,255,255,0.15)`
 *    glow this file widens to the 36px radius the same token is used with on the
 *    menu cards).
 *
 * Geometry and behaviour are the legacy screen's, so the dialog cannot drift
 * from the launcher it replaces:
 *
 *   ScreenError::Draw   the card is 920x480 centred in the 1920x1080 frame; the
 *                       title sits 48px below the card's top edge, is 24px and
 *                       centred; the message is 20px, wrapped at
 *                       `cardW - 80.f` = 840px, and each wrapped line advances by
 *                       `f.LineHeight(scale) + 6.f`
 *   ScreenError::OnInput  Confirm *or* Back dismisses, which is why the footer
 *                       advertises Esc and Enter together
 *
 * The 30px line advance below is that rule with the font's real metrics: the
 * bundled `src/renderer/src/assets/font/Actor-Regular.ttf` reports hhea ascender
 * 941 and descender -262 over 1000 units per em, so `line-height: normal` is
 * 1.203em = 24.06px at 20px and 24.06 + 6 rounds to 30px.
 *
 * Clicking anywhere dismisses. The card deliberately owns no handler of its own:
 * a click on the card bubbles to the scrim, so one click can never call
 * `onDismiss` twice.
 */
import { useId } from 'react'
import type { ReactNode } from 'react'

import { KeyCap } from '@renderer/components/HelperBar'
import type { ErrorDialogProps } from '@renderer/contracts'

/**
 * The one card surface every dialog in this folder reuses. Tailwind only sees
 * candidate classes that appear as complete text in the source, so the class
 * string is written out rather than interpolated from data/design.ts values.
 */
const CARD_SURFACE =
  'bg-[#1a1a1a] border border-[#4d4d4d] border-solid rounded-[4px] shadow-[inset_0px_0px_36px_0px_rgba(255,255,255,0.15)]'

/**
 * The dialog a failed launch or a failed mod injection ends in.
 *
 * Esc and Enter are read by the launcher's screen-level action handler, not
 * here — see the store note in src/renderer/src/contracts.ts ("No component
 * reaches into the Electron bridge directly; that is the store's job") and the
 * one-hook rule in src/renderer/src/input/useActions.ts. The footer states those
 * keys rather than installing a second listener, so one keypress is dispatched
 * exactly once.
 */
export function ErrorDialog({ error, onDismiss }: ErrorDialogProps): ReactNode {
  /**
   * `useId` rather than fixed ids: the dialog is mounted while a screen is still
   * on the canvas underneath, and a duplicate id would make the accessible name
   * ambiguous rather than wrong.
   */
  const titleId = useId()
  const messageId = useId()

  return (
    <div
      className="absolute bg-[rgba(0,0,0,0.75)] flex inset-0 items-center justify-center z-50"
      data-name="error-scrim"
      onClick={onDismiss}
    >
      <div
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`${CARD_SURFACE} flex flex-col h-[480px] items-center px-[40px] pb-[40px] pt-[48px] w-[920px]`}
        data-name="error-dialog"
        role="alertdialog"
      >
        {/*
          `#fe0000` is `COLOR.reRed` — the design's own red. The legacy screen drew
          its title in `COLOR_RED`, which is one step brighter (255/0/0); the
          design token wins here because 254/0/0 is still 4.32:1 on the #1a1a1a
          plate, clearing the 3:1 a 24px normal-weight title needs, and it keeps
          the dialog on the same red as the wordmark. StatusPill's brighter alarm
          red stays reserved for the install states.
        */}
        <p
          className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[#fe0000] text-[24px] text-center uppercase"
          id={titleId}
        >
          {error.title}
        </p>
        {/*
          `mt-[68px]` completes the legacy 140px offset: 48px of card padding, a
          24px title line, then 68px puts the message's line box top where
          `ScreenError::Draw` starts drawing (`cy + 140.f`).

          No `whitespace-pre-wrap`: the legacy `WrapText` read the message with
          `iss >> word`, so a newline in the string was already just another
          word separator — the CSS default collapses it the same way.

          `max-h`/`overflow-y-auto` are the guard for a message longer than the
          fixed 480px card can hold; a short message never shows a scrollbar.
        */}
        <p
          className="font-['Actor:Regular',sans-serif] leading-[30px] max-h-[280px] mt-[68px] not-italic overflow-y-auto text-[20px] text-center text-white w-[840px]"
          id={messageId}
        >
          {error.message}
        </p>
        {/*
          The footer is the helper bar's own idiom — caps and captions at
          `HELPER_BAR.itemGap` 8px and `HELPER_BAR.labelFontSize` 24px in the
          muted `#999` — but drawn by the dialog, so the dialog is complete on its
          own and the screen underneath can keep its own bar hidden.

          `keys: ['esc', 'enter']` with a single caption is exactly what
          `HINTS_ERROR` (data/design.ts) states for this surface.
        */}
        <div className="flex gap-[8px] items-center mt-auto" data-name="error-hints">
          <KeyCap kind="esc" />
          <KeyCap kind="enter" />
          <p className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[#999] text-[24px] whitespace-nowrap">
            Dismiss
          </p>
        </div>
      </div>
    </div>
  )
}
