/**
 * The achievements surface.
 *
 * There is no achievements frame in the design, so this is an addition (docs/DESIGN-FIDELITY.md
 * 7.1) built from the design's own tokens, and it follows the same rule as the settings surface:
 * it is reached from a row rather than from a key of its own, so the three designed screens stay
 * pixel-identical at rest.
 *
 * It is **read-only**. The achievements the launcher bundles carry an unlock state from the
 * player's own progress file, and nothing here edits it: the launcher has never detected an
 * in-game event (the previous launcher's hook was a stub too), so showing a tick the player did
 * not earn would be the worst thing this surface could do. When RetroAchievements lists are
 * fetched - a later change, once the credentials have somewhere to be typed - they appear beside
 * these, marked as RA's and tracked locally, because RA cannot unlock anything for a native
 * Windows build: it reads an emulator's memory, and these games are not emulated.
 *
 * **Not wired yet.** Nothing renders this component: it takes its list, its title and its close
 * handler as props and reads no store, so what remains is a store slice, a mount and an entry
 * point - and the entry point is why the settings row for it was removed rather than shipped: an
 * action row with no handler behind it does nothing when activated, and a dead row is worse than
 * an absent one.
 */
import { HelperBar } from '@renderer/components/HelperBar'
import { HINTS_ACHIEVEMENTS, ACHIEVEMENTS_LABEL } from '@renderer/data/design'
import type { Achievement } from '@shared/types'

/** One achievement: icon slot, name, description, and the state the launcher knows. */
function AchievementRow({ achievement }: { achievement: Achievement }) {
  const state = achievement.unlocked ? 'text-white' : 'text-[#999]'
  return (
    <div
      className="bg-[#1a1a1a] border border-[#4d4d4d] border-solid flex gap-[12px] items-start p-[12px] rounded-[4px] w-full"
      data-name="achievement-row"
      data-unlocked={achievement.unlocked ? 'true' : 'false'}
    >
      {/*
        The design has no achievement art. Rather than invent a badge or ship someone else's, the
        slot is a square of the same ground with the design's hairline, carrying the first letter -
        the one thing about an achievement this launcher can state truthfully from what it has.
      */}
      <div
        aria-hidden="true"
        className="bg-[#0f0f0f] border border-[#4d4d4d] border-solid flex h-[48px] items-center justify-center rounded-[4px] shrink-0 w-[48px]"
      >
        <p className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[22px] text-[#999]">
          {achievement.name.slice(0, 1).toUpperCase()}
        </p>
      </div>
      <div className="flex flex-col gap-[4px] min-w-px flex-[1_0_0]">
        <p className={`font-['Actor:Regular',sans-serif] leading-none not-italic text-[20px] ${state}`}>
          {achievement.name}
        </p>
        <p className="font-['Actor:Regular',sans-serif] leading-[1.15] not-italic text-[16px] text-[#999]">
          {achievement.desc}
        </p>
      </div>
      <p
        className="font-['Actor:Regular',sans-serif] leading-none not-italic shrink-0 text-[16px] text-[#999]"
        data-name="achievement-state"
      >
        {achievement.unlocked
          ? achievement.unlockDate === ''
            ? ACHIEVEMENTS_LABEL.unlocked
            : achievement.unlockDate
          : ACHIEVEMENTS_LABEL.locked}
      </p>
    </div>
  )
}

export interface AchievementsProps {
  /** The list to show, or `null` before the main process has answered. */
  achievements: Achievement[] | null
  /** The title the list belongs to. */
  title: string
  onClose: () => void
}

export function Achievements({ achievements, title, onClose }: AchievementsProps) {
  const list = achievements ?? []
  const unlocked = list.filter((achievement) => achievement.unlocked).length

  return (
    <div
      aria-label={`Achievements for ${title}`}
      className="absolute bg-[#0f0f0f] flex flex-col inset-0"
      data-figma-node="achievements"
      role="dialog"
      tabIndex={-1}
    >
      <div className="flex flex-col flex-[1_0_0] min-h-px min-w-px px-[180px] py-[64px] relative">
        <p className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[#ccc] text-[32px]">
          ACHIEVEMENTS
        </p>
        <p
          className="font-['Actor:Regular',sans-serif] leading-none not-italic mt-[10px] text-[#999] text-[20px]"
          data-figma-node="achievements-summary"
        >
          {list.length === 0
            ? ACHIEVEMENTS_LABEL.empty
            : `${title} \u00b7 ${String(unlocked)} ${ACHIEVEMENTS_LABEL.of} ${String(list.length)} ${ACHIEVEMENTS_LABEL.unlockedCount}`}
        </p>

        <div
          className="flex flex-col gap-[8px] mt-[24px] overflow-y-auto pr-[8px]"
          data-figma-node="achievements-list"
        >
          {list.map((achievement) => (
            <AchievementRow achievement={achievement} key={achievement.id} />
          ))}
        </div>

        <p
          className="font-['Actor:Regular',sans-serif] leading-[1.2] not-italic mt-[16px] text-[16px] text-[#999]"
          data-figma-node="achievements-note"
        >
          {ACHIEVEMENTS_LABEL.note}
        </p>
      </div>

      <div className="absolute bottom-0 h-[68px] left-0 w-[1920px]" data-figma-node="helper-bar">
        <HelperBar hints={HINTS_ACHIEVEMENTS} />
      </div>

      <button
        aria-label="Close achievements"
        className="absolute right-[120px] top-[64px] cursor-pointer font-['Actor:Regular',sans-serif] leading-none not-italic text-[#999] text-[20px]"
        data-figma-node="achievements-close"
        onClick={() => onClose()}
        type="button"
      >
        CLOSE
      </button>
    </div>
  )
}

export default Achievements