/**
 * Line-based INI patcher for each game's own `config.ini`.
 *
 * Every launch rewrites exactly two rows of `<install>/config.ini`: `[DLL]
 * JapaneseEnable` selects the language file set for the version being launched
 * and `[DLL] BootConfig = 0` suppresses the RE-Enhance setup dialog (README.md,
 * "Language / Version Selection"). That file belongs to the game and to the mod,
 * not to this launcher, so the only acceptable edit is the narrowest one: one
 * value changes and every other byte — comments, blank lines, key casing,
 * `[DLL]` versus `[dll]`, CRLF endings — stays exactly where it was. A row that
 * is not there yet is appended; nothing is ever reordered, re-printed or
 * reformatted.
 *
 * This is the TypeScript port of the anonymous-namespace helpers of the removed
 * C++ launcher (`TrimMatch`, `StrEqualsI`, `LineLooksLikeSectionHeader`,
 * `LineIsSection`, `LineMatchesKey`, `ReplaceValueAfterEquals`, `WriteIniLines`
 * and `PatchIniValue`), which is why it is line-oriented rather than a
 * parse/serialize round trip. A round trip would have to decide how to print the
 * rows it never touched, and every such decision is a chance to hand the game a
 * file it can no longer read.
 *
 * The exported signatures mirror the frozen `patchIniValue` / `patchIniFile`
 * declarations in `contracts.ts`. Nothing is imported from that file on purpose:
 * it holds types and ambient `declare`s only, so importing from it here would
 * pull in a module that emits no runtime code.
 *
 * `section` is the bare section name, without brackets: `'DLL'`, not `'[DLL]'`.
 */
import { readFile, writeFile } from 'node:fs/promises'

/**
 * Whitespace allowed around a name when *matching*: the `std::isspace()` set
 * minus `'\n'`, which can never appear inside a line because lines are split on
 * it. `'\r'` is included deliberately — in a CRLF file it is the last character
 * of the line as we hold it, and trimming it is what lets a `key = value\r` row
 * match at all.
 */
const TRIM_LEADING = /^[ \t\f\v\r]+/
const TRIM_TRAILING = /[ \t\f\v\r]+$/

/**
 * Whitespace allowed between `=` and the value. `'\r'` is deliberately absent
 * here: a CR directly after the `=` is that line's newline rather than spacing,
 * and treating it as spacing would move the newline in front of the new value.
 */
const VALUE_LEADING = /^[ \t\f\v]*/
const VALUE_TRAILING = /[ \t\f\v\r]*$/

/** Drops leading and trailing match-whitespace. Used only to compare names. */
function TrimMatch(text: string): string {
  return text.replace(TRIM_LEADING, '').replace(TRIM_TRAILING, '')
}

/** Folds `A`-`Z` to lower case and leaves every other code unit untouched. */
function foldAscii(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code
}

/**
 * ASCII case-insensitive equality, mirroring the C++ `StrEqualsI`.
 *
 * The fold is hand-rolled instead of using `String#toLowerCase` because
 * lower-casing is locale-sensitive (a Turkish locale folds `I` to a dotless
 * `\u0131`), and this launcher must match `JapaneseEnable` the same way on every
 * machine — which is also what a byte comparison in C++ did.
 */
function StrEqualsI(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (foldAscii(left.charCodeAt(index)) !== foldAscii(right.charCodeAt(index))) {
      return false
    }
  }
  return true
}

/**
 * `[Section]` — the brackets have to be the first and last characters once the
 * line is trimmed, which is what keeps a comment such as `; [DLL]` or `# [DLL]`
 * from looking like a header: those lines start with `;` / `#`, not `[`.
 */
function LineLooksLikeSectionHeader(line: string): boolean {
  const trimmed = TrimMatch(line)
  return trimmed.length >= 2 && trimmed.startsWith('[') && trimmed.endsWith(']')
}

/**
 * The line opens the named section, ignoring case and surrounding space, so
 * `[ dll ]` matches `'DLL'`. The caller's name is trimmed as well because it may
 * come straight out of configuration data.
 */
function LineIsSection(line: string, section: string): boolean {
  if (!LineLooksLikeSectionHeader(line)) {
    return false
  }
  const trimmed = TrimMatch(line)
  return StrEqualsI(TrimMatch(trimmed.slice(1, -1)), TrimMatch(section))
}

/**
 * The line assigns *this* key: leading indentation, trailing spaces/tabs/CR and
 * letter case are ignored, and the key name must match in full, so patching
 * `Japanese` can never touch `JapaneseEnable`.
 *
 * Comment lines are rejected first, so a commented-out `; JapaneseEnable = 1` or
 * `#BootConfig = 1` is never mistaken for the row being patched.
 */
function LineMatchesKey(line: string, key: string): boolean {
  const trimmed = TrimMatch(line)
  if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
    return false
  }
  const equals = line.indexOf('=')
  if (equals < 0) {
    return false
  }
  return StrEqualsI(TrimMatch(line.slice(0, equals)), TrimMatch(key))
}

/**
 * Swaps the text after the first `=` for `value`, and nothing else.
 *
 * Everything before the `=` (indentation included) and the whitespace that
 * separated the old value from it are kept, so `JapaneseEnable =  1` becomes
 * `JapaneseEnable =  0`; collapsing it to `JapaneseEnable =0` would reformat a
 * row the user may have aligned by hand.
 *
 * The trailing run of spaces/tabs/CR is kept too. On a CRLF file that `\r` is
 * the row's newline — lines are split on `'\n'` alone — so dropping it would
 * silently rewrite one row with an LF ending in the middle of a CRLF file.
 */
function ReplaceValueAfterEquals(line: string, value: string): string {
  const equals = line.indexOf('=')
  if (equals < 0) {
    // Unreachable from PatchIniValue, which only calls this after LineMatchesKey
    // has found an '='; kept so the helper stands on its own.
    return line
  }
  const afterEquals = line.slice(equals + 1)
  const leadingMatch = VALUE_LEADING.exec(afterEquals)
  const leading = leadingMatch ? leadingMatch[0] : ''
  const oldValueEnd = afterEquals.slice(leading.length)
  const trailingMatch = VALUE_TRAILING.exec(oldValueEnd)
  const trailing = trailingMatch ? trailingMatch[0] : ''
  return `${line.slice(0, equals + 1)}${leading}${value}${trailing}`
}

/**
 * Joins lines back into file text. The split used `'\n'` alone, so every `'\r'`
 * the file had is still inside its own line and survives untouched — which is
 * how a CRLF file round-trips without a single explicit newline conversion.
 */
function WriteIniLines(lines: string[]): string {
  return lines.join('\n')
}

/**
 * Applies one `section` / `key` = `value` patch to ini text and returns the whole
 * file, byte-identical apart from that one value.
 *
 * Resolution order, as in the legacy patcher:
 *  1. the first row of the first matching section that carries the key is
 *     rewritten in place;
 *  2. a matching section without that key gets `KEY = VALUE` at the end of the
 *     section — directly before the next section header, or at EOF;
 *  3. with no matching section at all, `[SECTION]` followed by `KEY = VALUE` is
 *     appended at the end of the file.
 *
 * The row added in cases 2 and 3 is printed as `key = value` with single spaces
 * because there is no existing formatting to preserve, and it is written with
 * the file's own line ending so a CRLF `config.ini` does not end up with two
 * different endings in it.
 */
export function patchIniValue(contents: string, section: string, key: string, value: string): string {
  // Split on '\n' only: a '\r' stays at the end of its own line, so untouched
  // lines are reproduced exactly by WriteIniLines.
  const lines = contents.split('\n')
  const lineSuffix = contents.includes('\r\n') ? '\r' : ''

  let headerIndex = -1
  let sectionEndIndex = -1
  let keyIndex = -1
  let insideSection = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (LineLooksLikeSectionHeader(line)) {
      if (!insideSection && LineIsSection(line, section)) {
        headerIndex = index
        insideSection = true
        continue
      }
      if (insideSection) {
        // The first header after ours is where our section ends. Nothing past it
        // belongs to this section, so a same-named key there is not a match.
        sectionEndIndex = index
        break
      }
      continue
    }
    if (insideSection && LineMatchesKey(line, key)) {
      keyIndex = index
      break
    }
  }

  if (keyIndex >= 0) {
    lines[keyIndex] = ReplaceValueAfterEquals(lines[keyIndex], value)
    return WriteIniLines(lines)
  }

  const row = `${key} = ${value}${lineSuffix}`
  const insertion = headerIndex >= 0 ? [row] : [`[${section}]${lineSuffix}`, row]

  let insertAt: number
  if (headerIndex >= 0 && sectionEndIndex >= 0) {
    // End of the section: the index of the header that closes it.
    insertAt = sectionEndIndex
  } else {
    // A file ending in a newline splits into a trailing '' element. Inserting
    // before that element is what keeps the newline last, instead of leaving a
    // blank line behind the row we just added.
    const lastIndex = lines.length - 1
    insertAt = lines[lastIndex] === '' ? lastIndex : lines.length
  }

  lines.splice(insertAt, 0, ...insertion)
  return WriteIniLines(lines)
}

/**
 * Reads `filePath` if it is there, patches one value and writes it back.
 *
 * The file is created when absent: the game writes its config on first run, and
 * the launcher's patch must not be the thing that fails because of that. The
 * result always ends in a newline, using whichever ending the file already had.
 *
 * Every failure is reported as `false` instead of a thrown error, because launch
 * preparation turns that into the `config-unwritable` failure the UI already
 * knows how to explain; a launcher that cannot write a config must never take
 * the game down with an unhandled rejection.
 */
export async function patchIniFile(
  filePath: string,
  section: string,
  key: string,
  value: string
): Promise<boolean> {
  let contents = ''
  try {
    contents = await readFile(filePath, 'utf8')
  } catch (error) {
    if (!isMissingFile(error)) {
      // A directory, a denied read, a malformed path: we cannot know what we
      // would be overwriting, so refuse rather than truncate a file we could not
      // read. The write below would most likely fail anyway.
      return false
    }
  }

  const patched = patchIniValue(contents, section, key, value)
  const output = patched.endsWith('\n')
    ? patched
    : `${patched}${contents.includes('\r\n') ? '\r\n' : '\n'}`

  try {
    await writeFile(filePath, output, 'utf8')
    return true
  } catch {
    return false
  }
}

/** `ENOENT` test that works on an `unknown` thrown value without casting. */
function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
