/**
 * Finding a game process by the name of its executable.
 *
 * A game the launcher spawns itself is tracked as a child process: `launch.ts` holds the
 * handle, `getGameStatus` reports it, and `killGame` signals its pid. None of that survives
 * being handed to somebody else — and that is exactly what launching through Steam means.
 * Steam is asked to start the game, Steam owns it, and the process the launcher spawned
 * (`steam.exe`) exits a moment later. So the only way to keep the launcher's running status,
 * its now-playing bar and its "quit takes the game with it" guarantee is to find the game by
 * the name of its image.
 *
 * `tasklist` rather than a native call, for the same reason the GOG detector shells out to
 * `reg query` (docs/ARCHITECTURE.md §1): the project ships no native modules, so nothing has
 * to be rebuilt per Electron or Node ABI. The command runner is injected, so the parsing and
 * the matching are unit-testable without running anything.
 *
 * **Not wired yet.** Nothing calls this module: it is the prerequisite for launching through
 * Steam, which is the change that follows. It is committed on its own because a tested
 * discovery module is a coherent reviewable unit, and fusing it with a launch-path rewrite is
 * not - so if you are reading this and no caller exists, that is why, and the work it is for
 * is `launchThroughSteam` in `launch.ts`.
 */
import { execFile } from 'node:child_process'

/** Runs a command and returns its stdout, or null when it could not be run. */
export type CommandRunner = (file: string, args: string[]) => Promise<string | null>

export interface ProcessQueryOptions {
  /** Injected in tests. Defaults to `execFile`. */
  runCommand?: CommandRunner
}

/**
 * Image names reported by `tasklist`, in the order it printed them.
 *
 * `tasklist /FO CSV /NH` writes one quoted CSV record per process:
 *
 *     "ResidentEvil.exe","12345","Console","1","12,345 K"
 *
 * The parser is deliberately narrow — first field, commas inside quotes ignored — because
 * that is all this module reads and a general CSV parser would be a lot of code to get wrong
 * for one column. A line that does not start with a quote (a header, an error message, the
 * blank line `tasklist` prints on some Windows versions) is skipped rather than guessed at.
 */
export function parseTasklistImages(stdout: string): string[] {
  const images: string[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    // Some Windows builds prefix the output with a UTF-8 BOM.
    const line = rawLine.replace(/^\uFEFF/, '').trim()
    if (!line.startsWith('"')) continue
    const match = /^"([^"]*)"/.exec(line)
    const image = match?.[1]
    if (image === undefined || image === '') continue
    if (!images.includes(image)) images.push(image)
  }
  return images
}

/** Every image name `tasklist` can see, or `[]` when it cannot be asked. */
export async function listRunningImages(options: ProcessQueryOptions = {}): Promise<string[]> {
  const run = options.runCommand ?? defaultRunCommand
  const stdout = await run('tasklist', ['/FO', 'CSV', '/NH'])
  return stdout === null ? [] : parseTasklistImages(stdout)
}

/**
 * Whether an image is running, compared the way Windows compares names.
 *
 * Case-insensitively: the catalog spells `ResidentEvil.exe` and the file system will happily
 * report `RESIDENTEVIL.EXE`, and a launcher that missed that would report a running game as
 * stopped — the one failure mode that also breaks the kill-on-quit guarantee.
 */
export function imageIsRunning(images: readonly string[], image: string): boolean {
  if (image === '') return false
  const wanted = image.toLowerCase()
  return images.some((candidate) => candidate.toLowerCase() === wanted)
}

/** Convenience for a caller that has one name and wants one answer. */
export async function isImageRunning(
  image: string,
  options: ProcessQueryOptions = {}
): Promise<boolean> {
  return imageIsRunning(await listRunningImages(options), image)
}

/**
 * The image name out of an executable path, which is what `tasklist` reports.
 *
 * A path may use either separator: the catalog's own relative paths use `/` for a Steam
 * locale folder, while a resolved absolute path on Windows uses `\`.
 */
export function imageNameOf(executablePath: string): string {
  const parts = executablePath.split(/[\\/]/)
  return parts.at(-1) ?? executablePath
}

async function defaultRunCommand(file: string, args: string[]): Promise<string | null> {
  return await new Promise<string | null>((resolveResult) => {
    execFile(file, args, { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      // A failure is "could not ask", which every caller treats as "nothing running": the
      // alternative is a launcher that cannot be closed because tasklist was unavailable.
      resolveResult(error === null ? stdout : null)
    })
  })
}
