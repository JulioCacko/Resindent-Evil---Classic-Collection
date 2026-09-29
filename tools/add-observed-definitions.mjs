/**
 * Adds the launcher-observable achievements to the shipped catalogue, once.
 *
 * Kept as a script rather than done by hand because `assets/achievements/achievements.json` holds 365 rows
 * whose formatting matters (it is read by the launcher *and* edited by players), so this inserts textually
 * before each title's closing bracket instead of parsing and re-serialising - a round trip through
 * `JSON.stringify` would rewrite all 365 rows and bury eight new ones in a 400-line diff.
 *
 * Run it only on a catalogue that does not already have these rows; it refuses to duplicate them.
 *
 * The definitions it adds are the ones the launcher can actually verify. Everything else in the file is an
 * in-game condition ("Complete the game as Jill on Standard"), and none of those can be observed from
 * outside the game - see `Achievement.observed` in `src/shared/types.ts`.
 */
import { readFile, writeFile } from 'node:fs/promises'

const CATALOGUE = 'assets/achievements/achievements.json'

/** `icon` stays empty, like every existing row: the artwork is RetroAchievements' and is fetched, not shipped. */
const ADDITIONS = {
  re1: [
    row('re1_play', 'Answer the Call', 'Play Resident Evil', { titleId: 're1' }),
    row('re1_enhanced', 'Source Material', 'Play Resident Evil with RE-Enhance injected', {
      titleId: 're1',
      mode: 'enhanced'
    })
  ],
  re2: [
    row('re2_play', 'Raccoon City', 'Play Resident Evil 2', { titleId: 're2' }),
    row('re2_leon', 'First Day on the Job', 'Play Resident Evil 2 as Leon', {
      titleId: 're2',
      scenario: 'leon'
    }),
    row('re2_claire', 'Looking for Chris', 'Play Resident Evil 2 as Claire', {
      titleId: 're2',
      scenario: 'claire'
    }),
    row('re2_enhanced', 'Source Material II', 'Play Resident Evil 2 with RE-Enhance injected', {
      titleId: 're2',
      mode: 'enhanced'
    })
  ],
  re3: [
    row('re3_play', 'The Last Escape', 'Play Resident Evil 3', { titleId: 're3' }),
    row('re3_enhanced', 'Source Material III', 'Play Resident Evil 3 with RE-Enhance injected', {
      titleId: 're3',
      mode: 'enhanced'
    })
  ]
}

function row(id, name, desc, observed) {
  return { id, name, desc, icon: '', observed }
}

/** The index of the `]` that closes the array opened at `from`, by counting depth. */
function closingBracket(text, from) {
  let depth = 0
  for (let index = from; index < text.length; index += 1) {
    const character = text[index]
    if (character === '[') depth += 1
    else if (character === ']') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  throw new Error(`unbalanced array from index ${String(from)}`)
}

const original = await readFile(CATALOGUE, 'utf8')
let text = original

for (const [titleId, rows] of Object.entries(ADDITIONS)) {
  const marker = `"${titleId}": [`
  const start = text.indexOf(marker)
  if (start < 0) throw new Error(`no "${titleId}" array in the catalogue`)

  const end = closingBracket(text, start + marker.length - 1)

  // Guard against running twice: the ids are the check, because a second copy would be a second rule for the
  // same achievement and the player would see the row twice.
  for (const entry of rows) {
    if (text.includes(`"${entry.id}"`)) throw new Error(`${entry.id} is already in the catalogue`)
  }

  // Match the file's own style: one row per line, and a comma only if the array's last entry lacks one.
  const before = text.slice(0, end).trimEnd()
  const needsComma = !before.endsWith(',')
  const inserted = rows.map((entry) => JSON.stringify(entry)).join(',\n    ')
  text = `${before}${needsComma ? ',' : ''}\n    ${inserted}\n  ${text.slice(end)}`
}

// Parse before writing: a catalogue the launcher cannot read is worse than one missing eight rows.
const parsed = JSON.parse(text)
const counts = Object.entries(parsed)
  .map(([title, rows]) => `${title}=${String(rows.length)}`)
  .join(' ')

await writeFile(CATALOGUE, text, 'utf8')
console.log(`added ${String(Object.values(ADDITIONS).flat().length)} rows; ${counts}`)
