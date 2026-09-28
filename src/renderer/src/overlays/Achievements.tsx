/**
 * The achievements surface.
 *
 * There is no achievements frame in the design, so this is an addition (docs/DESIGN-FIDELITY.md
 * 7.1) built from the design's own tokens, and it follows the same rule as the settings surface: it
 * is reached from a row rather than from a key of its own, so the three designed screens stay
 * pixel-identical at rest.
 *
 * Two lists, deliberately apart. The first is the launcher's own: it carries an unlock state from
 * the player's progress file, and nothing here edits it, because the launcher has never detected an
 * in-game event (the previous launcher's hook was a stub too). The second is RetroAchievements',
 * which is reference material and cannot be unlocked here at all - RA reads an emulator's memory and
 * these games are native Windows builds - so the two are never merged into one list and never share
 * a heading.
 */
import { HelperBar } from '@renderer/components/HelperBar'
import { ACHIEVEMENTS_LABEL, HINTS_ACHIEVEMENTS } from '@renderer/data/design'
import type { Achievement, RaAchievement } from '@shared/types'

/** One achievement: a letter slot, the name, the description, and the state the launcher knows. */
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
        the one thing about an achievement this launcher can state truthfully from what it has. Its
        corners are square because the row's 4px radius over 12px of padding leaves no radius the
        inner shape could share: concentric here means zero.
      */}
      <div
        aria-hidden="true"
        className="bg-[#0f0f0f] border border-[#4d4d4d] border-solid flex h-[48px] items-center justify-center shrink-0 w-[48px]"
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

/**
 * One RetroAchievements entry: what RA calls it, what it asks for, and whether the player has ticked
 * it here.
 *
 * The tick is the whole of "tracked locally", and clicking is the only way to set it - deliberately,
 * because this list is reference material the launcher cannot verify: a tick is a note to self, not a
 * claim about the game, and it has no business on the keyboard path that drives every real decision
 * this launcher makes.
 *
 * `onToggle` is optional and the row only looks interactive when it is given: a row that invites a
 * click and does nothing is worse than one that plainly does not.
 */
function RetroRow({
  entry,
  ticked,
  onToggle
}: {
  entry: RaAchievement
  ticked: boolean
  onToggle?: (() => void) | undefined
}) {
  const interactive = onToggle !== undefined
  return (
    <div
      aria-pressed={interactive ? ticked : undefined}
      className={`bg-[#1a1a1a] border border-[#4d4d4d] border-solid flex gap-[12px] items-start p-[12px] rounded-[4px] w-full${interactive ? ' cursor-pointer' : ''}`}
      data-name="retro-row"
      data-ticked={ticked ? 'true' : 'false'}
      onClick={onToggle}
      role={interactive ? 'button' : undefined}
    >
      <div className="flex flex-col gap-[4px] min-w-px flex-[1_0_0]">
        <p
          className={`font-['Actor:Regular',sans-serif] leading-none not-italic text-[20px] ${ticked ? 'text-white' : 'text-[#ccc]'}`}
        >
          {entry.title}
        </p>
        <p className="font-['Actor:Regular',sans-serif] leading-[1.15] not-italic text-[16px] text-[#999]">
          {entry.description}
        </p>
      </div>
      <p
        className="font-['Actor:Regular',sans-serif] leading-none not-italic shrink-0 text-[16px] text-[#999]"
        data-name="retro-points"
      >
        {String(entry.points)}
      </p>
    </div>
  )
}

export interface AchievementsProps {
  /** The launcher's own list, or `null` before the main process has answered. */
  achievements: Achievement[] | null
  /** The title the list belongs to. */
  title: string
  onClose: () => void
  /**
   * The RetroAchievements list, or `null` before its own fetch answers.
   *
   * `raConnected` is separate on purpose: an empty list from a player who has not connected RA is a
   * different fact from an empty list for a game RA has nothing for, and the surface must not merge
   * the two into one message.
   */
  raAchievements: RaAchievement[] | null
  raConnected: boolean
  /**
   * RA's numeric ids the player has ticked here, and the way to change one.
   *
   * Optional so the surface renders correctly without them: no ticks and nothing to click, rather
   * than a tick count that would be a guess or a row that invites a click it cannot honour.
   */
  raTicked?: number[] | undefined
  onToggleRa?: ((id: number) => void) | undefined
}

export function Achievements({
  achievements,
  title,
  onClose,
  raAchievements,
  raConnected,
  raTicked = [],
  onToggleRa
}: AchievementsProps) {
  const list = achievements ?? []
  const unlocked = list.filter((achievement) => achievement.unlocked).length
  const tickedCount =
    raAchievements === null ? 0 : raAchievements.filter((entry) => raTicked.includes(entry.id)).length

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
            : `${title} · ${String(unlocked)} ${ACHIEVEMENTS_LABEL.of} ${String(list.length)} ${ACHIEVEMENTS_LABEL.unlockedCount}`}
        </p>

        <div
          className="flex flex-col gap-[8px] mt-[24px] min-h-0 overflow-y-auto pr-[8px]"
          data-figma-node="achievements-list"
        >
          {list.map((achievement) => (
            <AchievementRow achievement={achievement} key={achievement.id} />
          ))}
        </div>

        {/*
          The RetroAchievements half. Its own heading, because the two lists are different kinds of
          thing: the one above is the launcher's and knows whether it is unlocked, this one is RA's
          PlayStation reference and cannot be unlocked here at all.
        */}
        <div className="flex flex-col gap-[8px] mt-[24px]" data-figma-node="achievements-retro">
          <p className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[#ccc] text-[24px]">
            {ACHIEVEMENTS_LABEL.retroHeading}
          </p>
          <p
            className="font-['Actor:Regular',sans-serif] leading-[1.2] not-italic text-[16px] text-[#999]"
            data-figma-node="achievements-retro-state"
          >
            {raAchievements === null
              ? ACHIEVEMENTS_LABEL.retroLoading
              : raAchievements.length === 0
                ? raConnected
                  ? ACHIEVEMENTS_LABEL.retroEmpty
                  : ACHIEVEMENTS_LABEL.retroUnconnected
                : `${String(raAchievements.length)} ${ACHIEVEMENTS_LABEL.retroCount}${
                    onToggleRa === undefined
                      ? ''
                      : ` ${String(tickedCount)} ${ACHIEVEMENTS_LABEL.retroTicked}`
                  }`}
          </p>
          {raAchievements === null
            ? null
            : raAchievements.map((entry) => (
                <RetroRow
                  entry={entry}
                  key={entry.id}
                  onToggle={onToggleRa === undefined ? undefined : () => onToggleRa(entry.id)}
                  ticked={raTicked.includes(entry.id)}
                />
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
        className="absolute right-[120px] top-[64px] cursor-pointer font-['Actor:Regular',sans-serif] leading-none not-italic text-[#999] text-[20px] transition-[scale,color] duration-150 ease-out hover:text-[#ccc] active:scale-[0.96]"
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
