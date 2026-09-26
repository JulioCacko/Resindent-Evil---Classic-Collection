/**
 * Unit tests for the achievement store.
 *
 * Everything runs in a plain Node process against a temp directory: no
 * Electron, no real profile, and no dependency on the 2200-line bundled
 * catalog. Definitions come from a small inline fixture written to disk, which
 * is also what proves an override file replaces the bundled default.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Achievement } from '@shared/types'

import { createAchievementStore, parseProgressFile, serializeProgressFile } from './achievements'

/**
 * Repeated literally rather than imported from the module: this test pins the
 * bytes the removed `achievement_db.cpp` wrote, so a change to the constant in
 * the implementation has to be a conscious change here too.
 */
const LEGACY_HEADER = '# Resident Evil Classic Collection - achievement progress'

/** `new Date().toISOString()` shape, asserted without freezing the clock. */
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * Stand-in for `assets/achievements/achievements.json`: four rows across the
 * three titles, so per-game scoping is observable.
 */
const DEFINITIONS_FIXTURE = `{
  "re1": [
    { "id": "re1_001", "name": "Fixture: A Member of S.T.A.R.S.", "desc": "Jill, Standard", "icon": "" },
    { "id": "re1_002", "name": "Fixture: Future Boulder Puncher", "desc": "Chris, Standard", "icon": "" }
  ],
  "re2": [
    { "id": "re2_001", "name": "Fixture: Meat Is No Substitute", "desc": "Tofu Survivor", "icon": "" }
  ],
  "re3": [
    { "id": "re3_001", "name": "Fixture: Grade Hunter", "desc": "A rank in Mercenaries", "icon": "" }
  ]
}
`

/**
 * A save in the exact shape the legacy `SaveProgress` produced (header, then
 * `id=1|<date>` / `id=0|`, LF endings), with two ids the fixture does not
 * define so the unknown-id rule can be asserted.
 */
const RECORDED_SAVE =
  [
    LEGACY_HEADER,
    're1_001=1|2024-03-11T21:04:07',
    're1_002=0|',
    're1_005=1|2024-03-12T08:15:44',
    're1_018=0|',
    're1_062=1|2024-03-19T17:22:51',
    're1_074=0|',
    're2_001=1|2024-03-14T20:10:02',
    're2_016=0|',
    're3_001=0|',
    're1_999=1|2024-05-02T00:00:00',
    ''
  ].join('\n')

/** A hand-edited copy: comments, padding, alternate flags and junk lines. */
const HAND_EDITED_SAVE =
  [
    '; hand-edited save',
    '',
    '# another comment',
    're1_001 = 1|2024-03-11T21:04:07',
    're1_002=true|2024-03-12T08:15:44',
    're1_005=yes|2024-03-12T08:15:44',
    're1_018=TRUE|2024-03-13T00:00:00',
    'this line has no separator',
    '=1|2024-05-01T00:00:00',
    're1_074=1|',
    're1_088=no|2024-04-03T00:00:00',
    're1_109=false|',
    're1_115=maybe',
    ''
  ].join('\n')

function unlockedIds(progress: Map<string, { unlocked: boolean; date: string }>): string[] {
  return Array.from(progress)
    .filter(([, entry]) => entry.unlocked)
    .map(([id]) => id)
}

let dir = ''
let definitionsPath = ''
let progressPath = ''
let legacyProgressPath = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 're-achievements-'))
  definitionsPath = join(dir, 'definitions.json')
  progressPath = join(dir, 'achievements.sav')
  legacyProgressPath = join(dir, 'legacy-achievements.sav')
  await writeFile(definitionsPath, DEFINITIONS_FIXTURE, 'utf8')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

function makeStore(definitionsPaths: string[] = [definitionsPath]) {
  return createAchievementStore({ progressPath, legacyProgressPath, definitionsPaths })
}

/** The four fixture rows in definition order, used to assert the saved bytes. */
function expectedSave(rows: ReadonlyArray<[string, string]>): string {
  return [LEGACY_HEADER, ...rows.map(([id, value]) => `${id}=${value}`), ''].join('\n')
}

describe('parseProgressFile', () => {
  it('reads a recorded legacy save and keeps the unlocked set and its timestamps', () => {
    const progress = parseProgressFile(RECORDED_SAVE)

    expect(unlockedIds(progress)).toEqual([
      're1_001',
      're1_005',
      're1_062',
      're2_001',
      're1_999'
    ])
    expect(progress.get('re1_001')).toEqual({ unlocked: true, date: '2024-03-11T21:04:07' })
    expect(progress.get('re1_062')).toEqual({ unlocked: true, date: '2024-03-19T17:22:51' })
    expect(progress.get('re2_001')).toEqual({ unlocked: true, date: '2024-03-14T20:10:02' })

    // A locked row is `id=0|`, so its date column is empty rather than a value.
    expect(progress.get('re1_002')).toEqual({ unlocked: false, date: '' })
    expect(progress.get('re3_001')).toEqual({ unlocked: false, date: '' })

    // The header is a `#` comment, so it never becomes an entry of its own.
    expect(progress.size).toBe(10)
  })

  it('ignores comments, blank lines, padding-free junk and rows with no id', () => {
    const progress = parseProgressFile(HAND_EDITED_SAVE)

    // `TRUE` is not a legacy flag (the C++ compared literals case-sensitively),
    // the separator-less line and the id-less line are junk, and `maybe` is not
    // a flag at all.
    expect(Array.from(progress.keys())).toEqual([
      're1_001',
      're1_002',
      're1_005',
      're1_074',
      're1_088',
      're1_109'
    ])
    // Whitespace around `=` and `|` is trimmed, as in the legacy `TrimInPlace`.
    expect(progress.get('re1_001')).toEqual({ unlocked: true, date: '2024-03-11T21:04:07' })
  })

  it('treats 1, true and yes as unlocked and 0, false and no as locked', () => {
    const progress = parseProgressFile(HAND_EDITED_SAVE)

    expect(progress.get('re1_002')).toEqual({ unlocked: true, date: '2024-03-12T08:15:44' })
    expect(progress.get('re1_005')).toEqual({ unlocked: true, date: '2024-03-12T08:15:44' })
    expect(progress.get('re1_088')).toEqual({ unlocked: false, date: '' })
    expect(progress.get('re1_109')).toEqual({ unlocked: false, date: '' })
    expect(progress.has('re1_018')).toBe(false)
    expect(progress.has('re1_115')).toBe(false)
  })

  it('stamps an unlocked row that carries no date, keeping the date column meaningful', () => {
    const progress = parseProgressFile(HAND_EDITED_SAVE)

    const entry = progress.get('re1_074')
    expect(entry?.unlocked).toBe(true)
    expect(entry?.date).toMatch(ISO_PATTERN)
  })

  it('keeps the last row when an id appears twice, like the line-by-line loader', () => {
    const progress = parseProgressFile(
      `${LEGACY_HEADER}\nre1_001=1|2024-03-11T21:04:07\nre1_001=0|\n`
    )

    expect(progress.get('re1_001')).toEqual({ unlocked: false, date: '' })
  })

  it('reads CRLF saves the same way it reads LF saves', () => {
    const lf = parseProgressFile(HAND_EDITED_SAVE)
    const crlf = parseProgressFile(HAND_EDITED_SAVE.replaceAll('\n', '\r\n'))

    expect(Array.from(crlf.keys())).toEqual(Array.from(lf.keys()))
    expect(unlockedIds(crlf)).toEqual(unlockedIds(lf))
    expect(crlf.get('re1_001')).toEqual({ unlocked: true, date: '2024-03-11T21:04:07' })
  })
})

describe('serializeProgressFile', () => {
  const rows: Achievement[] = [
    {
      id: 're1_001',
      gameId: 're1',
      name: 'Fixture: A Member of S.T.A.R.S.',
      desc: 'Jill, Standard',
      icon: '',
      unlocked: true,
      unlockDate: '2024-03-11T21:04:07.123Z'
    },
    {
      id: 're1_002',
      gameId: 're1',
      name: 'Fixture: Future Boulder Puncher',
      desc: 'Chris, Standard',
      icon: '',
      unlocked: false,
      unlockDate: ''
    }
  ]

  it('writes the legacy header and one id=flag|date row per achievement, LF-terminated', () => {
    expect(serializeProgressFile(rows)).toBe(
      `${LEGACY_HEADER}\nre1_001=1|2024-03-11T21:04:07.123Z\nre1_002=0|\n`
    )
  })

  it('writes only the header for an empty store, matching the legacy writer', () => {
    expect(serializeProgressFile([])).toBe(`${LEGACY_HEADER}\n`)
  })

  it('round-trips through parseProgressFile', () => {
    const text = serializeProgressFile(rows)
    const progress = parseProgressFile(text)

    expect(progress.get('re1_001')).toEqual({
      unlocked: true,
      date: '2024-03-11T21:04:07.123Z'
    })
    expect(progress.get('re1_002')).toEqual({ unlocked: false, date: '' })

    const rebuilt: Achievement[] = Array.from(progress, ([id, entry]) => ({
      id,
      gameId: 're1',
      name: '',
      desc: '',
      icon: '',
      unlocked: entry.unlocked,
      unlockDate: entry.date
    }))
    expect(serializeProgressFile(rebuilt)).toBe(text)
  })
})

describe('createAchievementStore', () => {
  it('loads definitions from the override file, replacing the bundled catalog', async () => {
    const store = makeStore()
    await store.init()

    expect(store.all().map((achievement) => achievement.id)).toEqual([
      're1_001',
      're1_002',
      're2_001',
      're3_001'
    ])
    expect(store.list('re1').map((achievement) => achievement.id)).toEqual(['re1_001', 're1_002'])
    expect(store.get('re1_001')?.name).toBe('Fixture: A Member of S.T.A.R.S.')
    expect(store.get('re1_001')?.gameId).toBe('re1')
    // A row that only exists in the bundled 2200-line file is gone: the override
    // is a replacement, not a merge.
    expect(store.get('re2_131')).toBeNull()
  })

  it('lets a later definitions file override an earlier one', async () => {
    const laterPath = join(dir, 'later.json')
    await writeFile(
      laterPath,
      '{ "re3": [ { "id": "re3_900", "name": "Later", "desc": "", "icon": "" } ] }',
      'utf8'
    )

    const store = makeStore([definitionsPath, laterPath])
    await store.init()

    expect(store.all().map((achievement) => achievement.id)).toEqual(['re3_900'])
    expect(store.list('re1')).toEqual([])
  })

  it('keeps the previous definitions when an override is unreadable', async () => {
    const brokenPath = join(dir, 'broken.json')
    await writeFile(brokenPath, '{ "re1": [ { "id": "re1_001", ', 'utf8')
    const foreignKeyPath = join(dir, 'foreign.json')
    await writeFile(foreignKeyPath, '{ "re4": [] }', 'utf8')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const bundled = makeStore([])
    const truncated = makeStore([brokenPath])
    const foreignKey = makeStore([foreignKeyPath])
    await Promise.all([bundled.init(), truncated.init(), foreignKey.init()])

    const bundledIds = bundled.all().map((achievement) => achievement.id)
    expect(bundledIds.length).toBeGreaterThan(0)
    expect(truncated.all().map((achievement) => achievement.id)).toEqual(bundledIds)
    expect(foreignKey.all().map((achievement) => achievement.id)).toEqual(bundledIds)
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })

  it('applies progress from the live save file', async () => {
    await writeFile(
      progressPath,
      `${LEGACY_HEADER}\nre1_001=1|2024-03-11T21:04:07\nre1_002=0|\n`,
      'utf8'
    )

    const store = makeStore()
    await store.init()

    expect(store.get('re1_001')).toMatchObject({
      unlocked: true,
      unlockDate: '2024-03-11T21:04:07'
    })
    expect(store.get('re1_002')?.unlocked).toBe(false)
    expect(store.get('re1_002')?.unlockDate).toBe('')
  })

  it('migrates a legacy save on first run and never reads it again', async () => {
    await writeFile(legacyProgressPath, RECORDED_SAVE, 'utf8')

    const store = makeStore()
    await store.init()

    expect(store.get('re1_001')).toMatchObject({
      unlocked: true,
      unlockDate: '2024-03-11T21:04:07'
    })
    expect(store.get('re2_001')?.unlocked).toBe(true)
    // Unknown ids in the legacy file are ignored by the store, which is where
    // the catalog is known.
    expect(store.get('re1_999')).toBeNull()
    expect(store.get('re1_005')).toBeNull()

    // Only the ids the definitions actually contain survive the migration.
    expect(await readFile(progressPath, 'utf8')).toBe(
      expectedSave([
        ['re1_001', '1|2024-03-11T21:04:07'],
        ['re1_002', '0|'],
        ['re2_001', '1|2024-03-14T20:10:02'],
        ['re3_001', '0|']
      ])
    )

    // The new save is authoritative now: a later legacy file must be ignored.
    await writeFile(legacyProgressPath, `${LEGACY_HEADER}\nre1_002=1|2025-01-01T00:00:00\n`, 'utf8')
    const reopened = makeStore()
    await reopened.init()

    expect(reopened.get('re1_001')?.unlocked).toBe(true)
    expect(reopened.get('re1_002')?.unlocked).toBe(false)
  })

  it('ignores save rows whose id is not in the definitions', async () => {
    await writeFile(
      progressPath,
      `${LEGACY_HEADER}\nre1_999=1|2024-05-02T00:00:00\nre1_001=1|2024-03-11T21:04:07\n`,
      'utf8'
    )

    const store = makeStore()
    await store.init()

    expect(store.all().map((achievement) => achievement.id)).toEqual([
      're1_001',
      're1_002',
      're2_001',
      're3_001'
    ])
    expect(store.get('re1_999')).toBeNull()
    expect(await store.unlock('re1_999')).toBeNull()
  })

  it('persists an unlock, fires listeners exactly once and is idempotent', async () => {
    const store = makeStore()
    await store.init()

    const seen: Achievement[] = []
    const unsubscribe = store.onUnlock((achievement) => seen.push(achievement))

    const unlocked = await store.unlock('re1_001')
    const unlockDate = unlocked?.unlockDate ?? ''
    expect(unlocked?.unlocked).toBe(true)
    expect(unlockDate).toMatch(ISO_PATTERN)
    expect(seen.map((achievement) => achievement.id)).toEqual(['re1_001'])

    // A second call is a silent no-op: no extra write, no extra notification.
    expect(await store.unlock('re1_001')).toBeNull()
    expect(seen).toHaveLength(1)

    expect(await readFile(progressPath, 'utf8')).toBe(
      expectedSave([
        ['re1_001', `1|${unlockDate}`],
        ['re1_002', '0|'],
        ['re2_001', '0|'],
        ['re3_001', '0|']
      ])
    )

    unsubscribe()
    expect(await store.unlock('re1_002')).not.toBeNull()
    expect(seen).toHaveLength(1)

    // A fresh store on the same profile sees the persisted unlock.
    const reopened = makeStore()
    await reopened.init()
    expect(reopened.get('re1_001')).toMatchObject({ unlocked: true, unlockDate })
    expect(reopened.get('re1_002')?.unlocked).toBe(true)
  })

  it('hands out copies so a caller cannot mutate the store state', async () => {
    const store = makeStore()
    await store.init()

    const listed = store.list('re1')
    expect(listed[0].id).toBe('re1_001')
    listed[0].unlocked = true
    listed[0].unlockDate = '1999-01-01T00:00:00.000Z'

    expect(store.get('re1_001')?.unlocked).toBe(false)
    expect(store.all()[0].unlockDate).toBe('')
  })

  it('resets one game and leaves the others untouched', async () => {
    const store = makeStore()
    await store.init()
    await store.unlock('re1_001')
    await store.unlock('re2_001')
    await store.unlock('re3_001')

    const cleared = await store.reset('re1')

    // The whole cleared scope comes back, in its new locked state.
    expect(cleared.map((achievement) => achievement.id)).toEqual(['re1_001', 're1_002'])
    expect(cleared.every((achievement) => !achievement.unlocked && achievement.unlockDate === '')).toBe(
      true
    )

    expect(store.get('re1_001')?.unlocked).toBe(false)
    expect(store.get('re2_001')?.unlocked).toBe(true)
    expect(store.get('re3_001')?.unlocked).toBe(true)

    // The reset is on disk, and the untouched games keep their timestamps.
    const saved = parseProgressFile(await readFile(progressPath, 'utf8'))
    expect(saved.get('re1_001')).toEqual({ unlocked: false, date: '' })
    expect(saved.get('re2_001')?.unlocked).toBe(true)
    expect(saved.get('re2_001')?.date).toMatch(ISO_PATTERN)
    expect(saved.get('re3_001')?.unlocked).toBe(true)
  })

  it('resets every game when no game is given', async () => {
    const store = makeStore()
    await store.init()
    await store.unlock('re1_001')
    await store.unlock('re2_001')

    const cleared = await store.reset()

    expect(cleared.map((achievement) => achievement.id)).toEqual([
      're1_001',
      're1_002',
      're2_001',
      're3_001'
    ])
    expect(store.all().every((achievement) => !achievement.unlocked)).toBe(true)
    expect(await readFile(progressPath, 'utf8')).not.toContain('=1|')
  })

  it('is safe to initialise twice and keeps an in-session unlock that could not be written', async () => {
    // `blocked` is a regular file, so creating the save directory fails and the
    // unlock only lives in memory; a second init() must not reload from disk.
    const blocked = join(dir, 'blocked')
    await writeFile(blocked, 'not a directory', 'utf8')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const store = createAchievementStore({
      progressPath: join(blocked, 'achievements.sav'),
      legacyProgressPath,
      definitionsPaths: [definitionsPath]
    })

    await store.init()
    expect(await store.unlock('re1_001')).not.toBeNull()
    expect(warnSpy).toHaveBeenCalled()

    await store.init()

    expect(store.all()).toHaveLength(4)
    expect(store.get('re1_001')?.unlocked).toBe(true)
  })
})
