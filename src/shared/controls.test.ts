import { expect, it } from 'vitest'
import { DEFAULT_BINDINGS, validBindings } from './controls'

it('accepts defaults and rejects collisions, missing actions, and removal of the escape path', () => {
  expect(validBindings(DEFAULT_BINDINGS)).toBe(true)
  expect(validBindings({ ...DEFAULT_BINDINGS, confirm: ['KeyW'] })).toBe(false)
  expect(validBindings({ ...DEFAULT_BINDINGS, menu: [] })).toBe(false)
  expect(validBindings({ ...DEFAULT_BINDINGS, back: ['KeyB'] })).toBe(false)
  expect(validBindings({ ...DEFAULT_BINDINGS, menu: ['F3'] })).toBe(true)
})
