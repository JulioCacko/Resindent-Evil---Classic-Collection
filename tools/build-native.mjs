/**
 * build-native.mjs — builds the overlay's native artifacts and proves they are the kind
 * of binary that can actually be loaded.
 *
 * The native half of this project has two failure modes that are both silent at runtime:
 *
 *   - **The wrong bitness.** The ASI loader in every one of these installs is
 *     `Ultimate-ASI-Loader-x86`, and the games are 1998 32-bit builds, so a 64-bit plugin
 *     is simply never loaded. It does not error, it does not appear, and the diagnosis a
 *     person would reach for is "the loader does not work". So the machine type of the
 *     finished artifact is asserted here, from the file, not inferred from the flags that
 *     were passed in.
 *   - **A runtime dependency that is not there.** The plugin is dropped into a game folder
 *     with nothing else beside it, so a default `/MD` build that wants a Visual C++
 *     redistributable would load on the developer's machine and fail on a clean one. The
 *     import table is checked for `VCRUNTIME`/`MSVCP`/`ucrtbase` for the same reason.
 *
 * Usage:
 *
 *     node tools/build-native.mjs                       # the gate probe
 *     node tools/build-native.mjs --project native/overlay --out resources/re_classic_overlay.asi
 *     node tools/build-native.mjs --config Debug
 *
 * Everything here is a *build* tool: it is invoked by `pnpm build:overlay` and by the gate
 * runner, and it is never part of the shipped app.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

/**
 * The gate probe is the default because it is the first thing that has to be built.
 *
 * Its artifact stays under `native/_gate/` rather than in `resources/`: the probe is
 * throwaway, and `resources/` is what the packaging step ships beside the executable, so
 * only the real plugin (`resources/re_classic_overlay.asi`) belongs there.
 */
const DEFAULTS = {
  project: 'native/_gate',
  out: 'native/_gate/re_overlay_gate.asi',
  config: 'Release',
  /** What the finished artifact is called; the test host is an `.exe`. */
  ext: '.asi'
}

function parseArguments(argv) {
  const options = { ...DEFAULTS, clean: false }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name === '--project' && value !== undefined) { options.project = value; index += 1; continue }
    if (name === '--out' && value !== undefined) { options.out = value; index += 1; continue }
    if (name === '--config' && value !== undefined) { options.config = value; index += 1; continue }
    if (name === '--ext' && value !== undefined) { options.ext = value.startsWith('.') ? value : `.${value}`; index += 1; continue }
    if (name === '--clean') { options.clean = true; continue }
    throw new Error(`unrecognised argument: ${name}`)
  }
  return options
}

const options = parseArguments(process.argv.slice(2))
const projectDir = resolve(repoRoot, options.project)
const outputPath = resolve(repoRoot, options.out)
const buildDir = join(projectDir, 'build')

if (!existsSync(join(projectDir, 'CMakeLists.txt'))) {
  throw new Error(`no CMakeLists.txt in ${projectDir}`)
}

// ---------------------------------------------------------------------------
// toolchain discovery
// ---------------------------------------------------------------------------

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== '' && existsSync(candidate)) return candidate
  }
  return null
}

function findOnPath(executable) {
  try {
    const where = execFileSync('where.exe', [executable], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const first = where.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '')
    return first === undefined ? null : first
  } catch {
    return null
  }
}

/**
 * `vswhere` is the supported way to find a Visual Studio install, and it is the one piece
 * of the toolchain that is reliably at a fixed path on any machine that has any VS at all.
 */
const VSWHERE = firstExisting([
  process.env.VSWHERE,
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
  'C:\\Program Files\\Microsoft Visual Studio\\Installer\\vswhere.exe'
])

function visualStudio() {
  if (VSWHERE === null) return null
  try {
    const stdout = execFileSync(VSWHERE, [
      '-latest', '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath'
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const path = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '')
    return path === undefined ? null : path
  } catch {
    return null
  }
}

const vsPath = visualStudio()

/** The newest MSVC toolset under an install, for `dumpbin`. */
function msvcTools(dirName) {
  if (vsPath === null) return null
  const root = join(vsPath, 'VC', 'Tools', 'MSVC')
  if (!existsSync(root)) return null
  const versions = readdirSync(root).sort().reverse()
  for (const version of versions) {
    const candidate = join(root, version, 'bin', dirName)
    if (existsSync(candidate)) return candidate
  }
  return null
}

const cmake = firstExisting([process.env.CMAKE, 'C:\\Program Files\\CMake\\bin\\cmake.exe', findOnPath('cmake')])
if (cmake === null) {
  throw new Error(
    'cmake was not found. Install CMake (or set CMAKE) — the native overlay is built with it, ' +
    'the same way the pre-rewrite launcher was.'
  )
}
if (vsPath === null) {
  throw new Error(
    'Visual Studio with the C++ workload was not found by vswhere. The overlay plugin is a native ' +
    '32-bit DLL; install "Desktop development with C++" or set VSWHERE to a vswhere.exe that can see it.'
  )
}

const hostTools = msvcTools(join('Hostx64', 'x64'))
const dumpbin = hostTools === null ? null : join(hostTools, 'dumpbin.exe')
if (dumpbin === null || !existsSync(dumpbin)) {
  throw new Error(`dumpbin.exe was not found under ${vsPath}; the artifact's machine type cannot be verified`)
}

// ---------------------------------------------------------------------------
// configure + build
// ---------------------------------------------------------------------------

function run(executable, args, label) {
  process.stdout.write(`\n[build-native] ${label}\n  ${executable} ${args.join(' ')}\n`)
  try {
    execFileSync(executable, args, { cwd: repoRoot, stdio: 'inherit' })
  } catch (error) {
    throw new Error(`${label} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (options.clean && existsSync(buildDir)) {
  rmSync(buildDir, { recursive: true, force: true })
}

/*
 * `-A Win32` is passed on every configure, and the project's own CMakeLists refuses a
 * 64-bit configuration as well — the flag because it is what the VS generator needs, the
 * project check because it holds whatever generator someone else uses.
 */
run(cmake, [
  '-S', projectDir,
  '-B', buildDir,
  '-G', 'Visual Studio 17 2022',
  '-A', 'Win32'
], 'configure (32-bit, Visual Studio 17 2022)')

run(cmake, ['--build', buildDir, '--config', options.config], `build (${options.config})`)

// ---------------------------------------------------------------------------
// find, verify and install the artifact
// ---------------------------------------------------------------------------

function findArtifact(directory, extension, depth = 0) {
  if (depth > 4 || !existsSync(directory)) return null
  const entries = readdirSync(directory, { withFileTypes: true })
  const direct = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
  if (direct !== undefined) return join(directory, direct.name)
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const nested = findArtifact(join(directory, entry.name), extension, depth + 1)
    if (nested !== null) return nested
  }
  return null
}

const artifact =
  findArtifact(join(buildDir, options.config), options.ext) ?? findArtifact(buildDir, options.ext)
if (artifact === null) {
  throw new Error(`the build produced no ${options.ext} under ${buildDir}`)
}

const headers = execFileSync(dumpbin, ['/headers', artifact], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const machineLine = headers.split(/\r?\n/).find((line) => /machine\s*\(/i.test(line)) ?? ''
if (!/14C/i.test(machineLine)) {
  throw new Error(
    `the artifact is not 32-bit: "${machineLine.trim()}". The ASI loader in these installs is ` +
    'Ultimate-ASI-Loader-x86, so a 64-bit plugin would never be loaded and would never report why.'
  )
}

const imports = execFileSync(dumpbin, ['/dependents', artifact], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const runtimeImport = imports.split(/\r?\n/).find((line) => /(vcruntime|msvcp|ucrtbase)/i.test(line))
if (runtimeImport !== undefined) {
  throw new Error(
    `the artifact imports "${runtimeImport.trim()}". It is dropped into a game folder with no ` +
    'redistributable beside it, so the plugin must be built with the static CRT (/MT).'
  )
}

mkdirSync(dirname(outputPath), { recursive: true })
copyFileSync(artifact, outputPath)
const size = statSync(outputPath).size

/*
 * The plugin's typeface is part of its artifact set, so it is copied here rather than committed a
 * second time.
 *
 * The renderer's copy (`src/renderer/src/assets/font/Actor-Regular.ttf`) is the source of truth: it is
 * what the launcher's own toast is set in, and the in-game toast is the same design, so shipping a
 * second copy by hand would be two files that could silently drift apart. The plugin needs it *beside
 * itself* because it loads the face privately with `Gdiplus::PrivateFontCollection::AddFontFile`.
 */
if (options.project === 'native/overlay') {
  const fontSource = join(repoRoot, 'src', 'renderer', 'src', 'assets', 'font', 'Actor-Regular.ttf')
  const fontTarget = join(repoRoot, 'resources', 'Actor-Regular.ttf')
  if (!existsSync(fontSource)) {
    throw new Error(`the bundled typeface is missing at ${fontSource}; the toast would fall back to Arial`)
  }
  copyFileSync(fontSource, fontTarget)
  process.stdout.write(`  typeface : ${fontTarget} (${String(statSync(fontTarget).size)} bytes)\n`)
}

process.stdout.write(
  `\n[build-native] ok\n` +
  `  artifact : ${outputPath}\n` +
  `  size     : ${size} bytes\n` +
  `  machine  : ${machineLine.trim()}\n` +
  `  imports  : ${imports.split(/\r?\n/).filter((line) => /\.dll/i.test(line)).map((line) => line.trim()).join(', ')}\n`
)
