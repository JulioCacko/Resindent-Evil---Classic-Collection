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
  createGameWindowHost,
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

describe('createGameWindowHost', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 }

  /** A host wired to fakes, with the clock under the test's control. */
  function makeHost(options: {
    processId?: number
    bounds?: { x: number; y: number; width: number; height: number } | null
    answers?: (string | null)[]
  } = {}): {
    host: ReturnType<typeof createGameWindowHost>
    calls: string[][]
    fire: () => void
    cleared: () => number
  } {
    const calls: string[][] = []
    const answers = options.answers ?? [POSITIONED]
    let index = 0
    let handler: (() => void) | null = null
    let cleared = 0
    const host = createGameWindowHost({
      scriptPath: SCRIPT,
      runner: (args) => {
        calls.push(args)
        const value = answers[Math.min(index, answers.length - 1)] ?? null
        index += 1
        return Promise.resolve(value)
      },
      bounds: () => (options.bounds === undefined ? bounds : options.bounds),
      processId: () => options.processId ?? 4242,
      setInterval: (fn) => {
        handler = fn
        return 'timer'
      },
      clearInterval: () => {
        cleared += 1
      }
    })
    return { host, calls, fire: () => handler?.(), cleared: () => cleared }
  }

  it('places the window once immediately and then on every tick', async () => {
    const { host, calls, fire } = makeHost()
    host.start()
    await Promise.resolve()
    expect(calls.length, 'placed at once, without waiting an interval').toBeGreaterThanOrEqual(1)
    const before = calls.length
    fire()
    await Promise.resolve()
    expect(calls.length).toBeGreaterThan(before)
    await host.stop()
  })

  it('does nothing while no game is tracked', async () => {
    const { host, calls } = makeHost({ processId: 0 })
    const outcome = await host.tick()
    expect(outcome.reason).toBe('no-game')
    expect(calls).toHaveLength(0)
  })

  it('does nothing when the launcher has no usable bounds', async () => {
    const { host, calls } = makeHost({ bounds: null })
    expect((await host.tick()).reason).toBe('no-bounds')
    expect(calls).toHaveLength(0)
  })

  it('keeps asking while the game has no window yet, which is the common case', async () => {
    // RE1's loader replaces its window partway through starting, so "not found yet" must not stop the
    // host: the next tick finds the second window.
    const { host } = makeHost({ answers: [NOT_FOUND, NOT_FOUND, POSITIONED] })
    expect((await host.tick()).positioned).toBe(false)
    expect((await host.tick()).positioned).toBe(false)
    expect((await host.tick()).positioned).toBe(true)
  })

  it('releases on stop, and clears the interval exactly once', async () => {
    const { host, calls, cleared } = makeHost({ answers: [POSITIONED, '{"ok":true,"action":"release","found":true}'] })
    host.start()
    await Promise.resolve()
    await host.stop()
    expect(cleared()).toBe(1)
    expect(host.running).toBe(false)
    expect(calls.some((args) => args.includes('release')), 'a release was asked for').toBe(true)
    await host.stop()
    expect(cleared(), 'stopping twice does not clear twice').toBe(1)
  })

  it('does not throw when the helper cannot be run at all', async () => {
    const { host } = makeHost({ answers: [null] })
    await expect(host.tick()).resolves.toEqual({ positioned: false, window: null, reason: 'helper-failed' })
  })
})