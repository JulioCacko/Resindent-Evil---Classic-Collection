/**
 * The launcher's half of the window-hosting contract.
 *
 * Every case here is one the launcher has to survive rather than one it would like: a missing helper, a
 * helper that answers with nothing, a helper that answers with a shape nobody expects, a rectangle that
 * cannot be a window, and a game that has not opened its window yet. Each of them ends in
 * `positioned: false` with a reason, because a launcher that refused to run a game because it could not
 * *move its window* would be worse than one that shows it slightly in the wrong place.
 */
import { describe, expect, it } from 'vitest'

import {
  parseHostResult,
  positionArguments,
  positionGameWindow,
  releaseArguments,
  releaseGameWindow,
  resolveWindowHostScript
} from './host-window'

/** A helper answer, as `resources/window-host.ps1` prints it. */
const POSITIONED = JSON.stringify({
  ok: true,
  action: 'position',
  found: true,
  handle: '0x1C0FD4',
  class: 'BIOHAZARD',
  title: 'RESIDENT EVIL® PC',
  moved: true,
  requested: { x: 310, y: 52, width: 1300, height: 975 },
  client: { width: 1300, height: 975 },
  window: { x: 308, y: 40, width: 1304, height: 1000 },
  taskbar: false
})

const NOT_FOUND = JSON.stringify({
  ok: true,
  action: 'position',
  found: false,
  reason: 'no game-sized window for that process'
})

const SCRIPT = 'C:\\app\\window-host.ps1'

function runnerReturning(...lines: (string | null)[]): {
  calls: string[][]
  runner: (args: string[]) => Promise<string | null>
} {
  const calls: string[][] = []
  let index = 0
  return {
    calls,
    runner: (args) => {
      calls.push(args)
      const value = lines[Math.min(index, lines.length - 1)] ?? null
      index += 1
      return Promise.resolve(value)
    }
  }
}

describe('parseHostResult', () => {
  it('reads the single JSON object the helper prints', () => {
    expect(parseHostResult(POSITIONED)?.['class']).toBe('BIOHAZARD')
  })

  it('finds it after PowerShell noise', () => {
    // PowerShell can print warnings or progress before its own output; the launcher must not care.
    const noisy = `WARNING: something\n${POSITIONED}\n`
    expect(parseHostResult(noisy)?.['handle']).toBe('0x1C0FD4')
  })

  it('returns null for empty output, for prose, and for JSON that is not an object', () => {
    expect(parseHostResult('')).toBeNull()
    expect(parseHostResult('no such window')).toBeNull()
    expect(parseHostResult('[1,2,3]')).toBeNull()
    expect(parseHostResult(null)).toBeNull()
  })
})

describe('positionArguments', () => {
  const rect = { x: 310, y: 52, width: 1300, height: 975 }

  it('passes the rectangle through as whole numbers', () => {
    const args = positionArguments({ processId: 4242, rect }, SCRIPT)
    expect(args).toContain('-Action')
    expect(args).toContain('position')
    expect(args).toContain('-ProcessId')
    expect(args).toContain('4242')
    expect(args?.join(' ')).toContain('-X 310 -Y 52 -Width 1300 -Height 975')
  })

  it('rounds a fractional rectangle rather than refusing it', () => {
    // The stage scale makes these fractional; a window coordinate is an integer.
    const args = positionArguments({ processId: 1, rect: { x: 310.4, y: 51.6, width: 1300.5, height: 975.2 } }, SCRIPT)
    expect(args?.join(' ')).toContain('-X 310 -Y 52 -Width 1301 -Height 975')
  })

  it('adds -Taskbar only when asked', () => {
    expect(positionArguments({ processId: 1, rect }, SCRIPT)?.join(' ')).not.toContain('-Taskbar')
    expect(positionArguments({ processId: 1, rect, taskbar: true }, SCRIPT)?.join(' ')).toContain('-Taskbar')
  })

  it('refuses a rectangle that cannot be a window', () => {
    expect(positionArguments({ processId: 1, rect: { ...rect, width: 8 } }, SCRIPT)).toBeNull()
    expect(positionArguments({ processId: 1, rect: { ...rect, height: 0 } }, SCRIPT)).toBeNull()
    expect(positionArguments({ processId: 1, rect: { ...rect, x: Number.NaN } }, SCRIPT)).toBeNull()
  })

  it('refuses a process id that is not one', () => {
    expect(positionArguments({ processId: 0, rect }, SCRIPT)).toBeNull()
    expect(positionArguments({ processId: -4, rect }, SCRIPT)).toBeNull()
    expect(positionArguments({ processId: 1.5, rect }, SCRIPT)).toBeNull()
  })
})

describe('releaseArguments', () => {
  it('asks for a release for that process', () => {
    expect(releaseArguments(4242, SCRIPT)?.join(' ')).toContain('-Action release -ProcessId 4242')
  })

  it('refuses a process id that is not one', () => {
    expect(releaseArguments(0, SCRIPT)).toBeNull()
  })
})

describe('positionGameWindow', () => {
  const rect = { x: 310, y: 52, width: 1300, height: 975 }

  it('reports the window it moved, with its client size', async () => {
    const { runner, calls } = runnerReturning(POSITIONED)
    const outcome = await positionGameWindow({ processId: 4242, rect }, { runner, scriptPath: SCRIPT })
    expect(outcome.positioned).toBe(true)
    expect(outcome.window?.class).toBe('BIOHAZARD')
    expect(outcome.window?.clientWidth).toBe(1300)
    expect(outcome.window?.windowX).toBe(308)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.join(' ')).toContain('-File C:\\app\\window-host.ps1')
  })

  it('treats "no window yet" as an ordinary answer rather than a failure', async () => {
    // RE1's loader replaces its window partway through starting, so this is the common case early on.
    const { runner } = runnerReturning(NOT_FOUND)
    const outcome = await positionGameWindow({ processId: 4242, rect }, { runner, scriptPath: SCRIPT })
    expect(outcome.positioned).toBe(false)
    expect(outcome.reason).toBe('no game-sized window for that process')
  })

  it('does not throw when the helper cannot be run', async () => {
    const { runner } = runnerReturning(null)
    const outcome = await positionGameWindow({ processId: 4242, rect }, { runner, scriptPath: SCRIPT })
    expect(outcome).toEqual({ positioned: false, window: null, reason: 'helper-failed' })
  })

  it('does not throw when the helper answers with nonsense', async () => {
    const { runner } = runnerReturning('{"ok":false}')
    const outcome = await positionGameWindow({ processId: 4242, rect }, { runner, scriptPath: SCRIPT })
    expect(outcome.positioned).toBe(false)
    expect(outcome.window).toBeNull()
  })

  it('never runs the helper for a rectangle it cannot use', async () => {
    const { runner, calls } = runnerReturning(POSITIONED)
    const outcome = await positionGameWindow({ processId: 1, rect: { ...rect, width: 0 } }, { runner, scriptPath: SCRIPT })
    expect(outcome.reason).toBe('bad-rectangle')
    expect(calls, 'the helper was not asked').toHaveLength(0)
  })
})

describe('releaseGameWindow', () => {
  it('reports true when the helper answered', async () => {
    const { runner } = runnerReturning('{"ok":true,"action":"release","found":true}')
    expect(await releaseGameWindow(4242, { runner, scriptPath: SCRIPT })).toBe(true)
  })

  it('reports false when nothing answered, rather than throwing on the way out', async () => {
    const { runner } = runnerReturning(null)
    expect(await releaseGameWindow(4242, { runner, scriptPath: SCRIPT })).toBe(false)
  })
})

describe('resolveWindowHostScript', () => {
  it('returns an override without touching the disk', () => {
    expect(resolveWindowHostScript('C:\\somewhere\\window-host.ps1')).toBe('C:\\somewhere\\window-host.ps1')
  })

  it('finds the shipped script in a working tree', () => {
    // The repository really has it, which is the one case worth asserting against the filesystem: if
    // `resources/window-host.ps1` is renamed, this test is what says so.
    expect(resolveWindowHostScript()).toContain('window-host.ps1')
  })
})
