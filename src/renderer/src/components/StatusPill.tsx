/**
 * Install-state pill.
 *
 * The design has no install states -- the Figma concept only ever shows the game
 * version screen of a fully installed collection -- so this reuses the one
 * surface token the design does define for boxed meta text: the `Frame3` info box
 * (`bg-[#0f0f0f]` with `shadow-[inset_0px_0px_8px_0px_rgba(255,255,255,0.15)]`,
 * `.ref/designref/src/imports/MainMenuRe1.tsx:125-133`), sized down and coloured
 * per state.
 *
 * The state colours are the only new values here. They are picked to clear 4.5:1
 * against #0F0F0F at the 16px label size rather than to match any design pixel,
 * because the pill is the one place where a missed state means a missed install
 * (the red in the logo, #FE0000, only reaches 4.7:1 and is reserved for the
 * wordmark).
 */
import type { InstallState } from '@shared/types'
import type { StatusPillProps } from '@renderer/contracts'

interface StateTone {
  /** Label colour; always the strongest channel of the trio. */
  color: string
  /** Border plus dot at reduced alpha, so the box reads as a surface, not a flag. */
  border: string
  /** Used when the caller does not override the label. */
  label: string
}

const STATE_TONE = {
  installed: { color: '#4ADE80', border: 'rgba(74, 222, 128, 0.45)', label: 'Installed' },
  partial: { color: '#FBBF24', border: 'rgba(251, 191, 36, 0.45)', label: 'Partial' },
  missing: { color: '#FF4C4C', border: 'rgba(255, 76, 76, 0.45)', label: 'Missing' }
} as const satisfies Record<InstallState, StateTone>

export function StatusPill({ state, label }: StatusPillProps) {
  const tone: StateTone = STATE_TONE[state]

  return (
    <span
      // `uppercase` rather than uppercase strings in the data: the design's meta
      // text is uppercased by CSS (MainMenuRe1.tsx:128), and keeping the source
      // strings readable lets a caller pass "Installed (RE1 JP)" as a label.
      className="bg-[#0f0f0f] inline-flex items-center gap-[8px] px-[8px] py-[4px] font-[family-name:'Actor',sans-serif] text-[16px] tracking-[0.06em] uppercase whitespace-nowrap shadow-[inset_0px_0px_8px_0px_rgba(255,255,255,0.15)]"
      style={{ color: tone.color, border: `1px solid ${tone.border}` }}
    >
      {/* A shape cue next to the colour, so the state survives a colour-blind
          reader and a greyscale screenshot. */}
      <span aria-hidden="true" className="size-[6px] shrink-0" style={{ backgroundColor: tone.color }} />
      {label ?? tone.label}
    </span>
  )
}
