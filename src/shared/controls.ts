import type { InputAction } from './types'

export const ACTION_LABELS: Record<InputAction, string> = {
  'nav-up': 'Move up', 'nav-down': 'Move down', 'nav-left': 'Move left', 'nav-right': 'Move right',
  confirm: 'Confirm', back: 'Back / cancel', menu: 'Settings'
}
export const DEFAULT_BINDINGS: Record<InputAction, string[]> = {
  'nav-up': ['ArrowUp', 'KeyW'], 'nav-down': ['ArrowDown', 'KeyS'],
  'nav-left': ['ArrowLeft', 'KeyA'], 'nav-right': ['ArrowRight', 'KeyD'],
  confirm: ['Enter', 'KeyE', 'NumpadEnter'], back: ['Escape'], menu: ['F1']
}
export type KeyBindings = Record<InputAction, string[]>

export function validBindings(value: unknown): value is KeyBindings {
  if (typeof value !== 'object' || value === null) return false
  const map = value as Record<string, unknown>
  const seen = new Set<string>()
  for (const action of Object.keys(DEFAULT_BINDINGS)) {
    const keys = map[action]
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 3) return false
    for (const key of keys) {
      if (typeof key !== 'string' || !/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Enter|NumpadEnter|Space|Escape|F[1-9]|F1[0-2])$/.test(key) || seen.has(key)) return false
      seen.add(key)
    }
  }
  return Array.isArray(map.back) && map.back.includes('Escape')
}

export function keyLabel(code: string): string {
  return code.replace(/^Key|^Digit/, '').replace('Arrow', '').replace('NumpadEnter', 'Num Enter')
}
