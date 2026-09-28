/**
 * The RetroAchievements login.
 *
 * The one surface in this launcher with text entry, and it exists because there is no way around it:
 * an API key has to be typed by a human. The settings surface is deliberately keyboard-driven with
 * non-focusable rows, so this is a separate panel rather than a row that grows an input - and while
 * it is open the launcher's canonical action layer stands aside, because `input/actions.ts` already
 * ignores keys typed into an editable target (`isEditableTarget`). Tab then moves between the fields
 * the way the browser does it, with no navigation logic of ours to get wrong.
 *
 * Two fields, because RA's API wants a key and optionally an account name: the modern endpoints
 * answer with the key alone, so the username is marked optional and an empty one is not an error.
 *
 * **What this cannot buy, and the panel says so:** connecting RA does not let it unlock anything for
 * these games. RetroAchievements works by reading an emulator's memory, and the launcher starts the
 * native Windows builds from GOG and Steam, where no emulator is running. Connecting loads the lists
 * as reference; nothing about it makes an achievement arrive by itself.
 */
import { useState } from 'react'

import { RA_LOGIN_LABEL } from '@renderer/data/design'

export interface CredentialsProps {
  /** The stored values, so reopening the panel shows what is already configured. */
  user: string
  key: string
  onSave: (user: string, key: string) => void
  onCancel: () => void
}

/** One labelled field. Local state only: nothing is persisted until Save. */
function Field({
  label,
  hint,
  value,
  onChange,
  name
}: {
  label: string
  hint: string
  value: string
  onChange: (next: string) => void
  name: string
}) {
  return (
    <label className="flex flex-col gap-[8px] w-full">
      <span className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[#ccc] text-[20px]">
        {label}
      </span>
      <input
        autoComplete="off"
        className="bg-[#1a1a1a] border border-[#4d4d4d] border-solid font-['Actor:Regular',sans-serif] h-[44px] leading-none not-italic px-[12px] rounded-[4px] text-[18px] text-white w-full focus:border-[#999] focus:outline-none"
        data-figma-node={`credentials-${name}`}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        value={value}
      />
      <span className="font-['Actor:Regular',sans-serif] leading-[1.2] not-italic text-[15px] text-[#999]">
        {hint}
      </span>
    </label>
  )
}

export function Credentials({ user, key: apiKey, onSave, onCancel }: CredentialsProps) {
  const [draftUser, setDraftUser] = useState(user)
  const [draftKey, setDraftKey] = useState(apiKey)

  return (
    <div
      aria-label="RetroAchievements login"
      className="absolute bg-[rgba(0,0,0,0.72)] flex inset-0 items-center justify-center"
      data-figma-node="credentials"
      onKeyDown={(event) => {
        // Escape cancels. The action layer ignores keys inside an editable target, so this surface
        // has to handle its own - which is also why it can be a plain form rather than a mode the
        // whole launcher has to know about.
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
      role="dialog"
      tabIndex={-1}
    >
      <form
        className="bg-[#0f0f0f] border border-[#4d4d4d] border-solid flex flex-col gap-[24px] p-[32px] rounded-[8px] w-[720px]"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draftUser.trim(), draftKey.trim())
        }}
      >
        <p className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[#ccc] text-[28px]">
          {RA_LOGIN_LABEL.heading}
        </p>
        <p className="font-['Actor:Regular',sans-serif] leading-[1.25] not-italic text-[16px] text-[#999]">
          {RA_LOGIN_LABEL.blurb}
        </p>

        <Field
          hint={RA_LOGIN_LABEL.userHint}
          label={RA_LOGIN_LABEL.userLabel}
          name="user"
          onChange={setDraftUser}
          value={draftUser}
        />
        <Field
          hint={RA_LOGIN_LABEL.keyHint}
          label={RA_LOGIN_LABEL.keyLabel}
          name="key"
          onChange={setDraftKey}
          value={draftKey}
        />

        <p
          className="font-['Actor:Regular',sans-serif] leading-[1.25] not-italic text-[15px] text-[#999]"
          data-figma-node="credentials-note"
        >
          {RA_LOGIN_LABEL.note}
        </p>

        <div className="flex gap-[12px] justify-end">
          <button
            className="border border-[#4d4d4d] border-solid cursor-pointer font-['Actor:Regular',sans-serif] leading-none not-italic px-[20px] py-[10px] rounded-[4px] text-[#999] text-[18px] transition-[scale,color] duration-150 ease-out hover:text-[#ccc] active:scale-[0.96]"
            data-figma-node="credentials-cancel"
            onClick={() => onCancel()}
            type="button"
          >
            {RA_LOGIN_LABEL.cancel}
          </button>
          <button
            className="bg-[#1a1a1a] border border-[#999] border-solid cursor-pointer font-['Actor:Regular',sans-serif] leading-none not-italic px-[20px] py-[10px] rounded-[4px] text-white text-[18px] transition-[scale,color] duration-150 ease-out hover:text-[#ccc] active:scale-[0.96]"
            data-figma-node="credentials-save"
            type="submit"
          >
            {RA_LOGIN_LABEL.save}
          </button>
        </div>
      </form>
    </div>
  )
}

export default Credentials
