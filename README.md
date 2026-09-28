# Resident Evil - Classic Collection

A desktop launcher/frontend for the **GOG Resident Evil Classic Bundle** (RE1, RE2,
RE3), rebuilt as an Electron + React application around a 1:1 recreation of the
Figma concept — the same UI the original Metal Gear Solid Master Collection-inspired
design called for, now driven by the design's own measured values instead of by
hand-written draw calls. It launches all three titles with optional RE-Enhance mod
support, per-version regional variants, RE2's player scenarios, a CRT filter and an
achievement system.

**Fan Concept by Julio CACKO**

---

## What this is

This is the second incarnation of the concept. The first was a C++11 / SDL2 /
OpenGL launcher built around a fixed 1920x1080 offscreen framebuffer; that
implementation has been replaced by Electron 44 + React 19 + Vite 7 + Tailwind CSS
v4 + TypeScript, so the concept's own Tailwind classes could be transcribed into
components rather than re-implemented as immediate-mode draw calls. Everything the
launcher *does* — install detection, validation, RE-Enhance injection and restore,
`config.ini` patching, the save format, the boot-to-install-status rule — is
behaviourally the same as before, ported one function at a time from the code it
replaces. What is new is how it is *drawn*, and how carefully that drawing is
guarded: see `docs/DESIGN-FIDELITY.md` and `pnpm check:fidelity`.

`docs/ARCHITECTURE.md` is the full tour: the process split, the IPC contract, the
catalog, the launch pipeline, the mod algorithm, the config and save formats and the
input pipeline.

---

## Features

- **Unified game selection** — three cover cards on a fixed 1920x1080 stage, scaled
  to fit any window without reflowing a single measured value
- **Version picker** — 8 rows across three titles: regional variants (US / JP),
  Director's Cut, RE2's two player scenarios as a per-row option, and the concept's
  BIOHAZARD 1.5 row kept for documentation
- **RE-Enhance integration** — enhanced/original mode per row, automatic file
  injection with a reversible backup, correct executable switching, and pre-launch
  `config.ini` patching so the RE-Enhance setup dialog never appears
- **Achievements** — 365 definitions (RE1 115, RE2 131, RE3 119) with progress saved
  in the old launcher's own format, so existing unlocks carry over
- **GOG and Steam auto-detection** — GOG first (local `GOG Games/`, then the Windows
  registry, then the usual roots, with an explicit override), then Steam (its registry
  entry, every library in `libraryfolders.vdf`, and each app's own `appmanifest`), so
  a title installed from either store is found
- **Gamepad, keyboard and mouse** — three input sources normalised into one set of six
  actions, with on-screen key hints per screen
- **CRT filter** — scanlines, phosphor mask, vignette, grain and barrel curvature,
  all configurable
- **Settings screen** — CRT, volumes, what the window does when a game starts, where the
  games are (with the OS folder chooser and a re-scan) and a reset, reached from the launch
  panel's SETTINGS row
- **No native modules** — nothing to rebuild per Electron version or per ABI

---

## Requirements

### Development

| Requirement | Version | Why |
|---|---|---|
| Node.js | **20.19+ or 22.12+** (Vite 7's floor) | Build tooling |
| pnpm | 9+ | The lockfile is `pnpm-lock.yaml`; `pnpm-workspace.yaml` is present |
| Windows | 10 or 11, x64 | The only packaged target (`electron-builder.yml`); the code paths for macOS/Linux exist but are untested |

Install with `pnpm install`; nothing else has to be built or downloaded.

### Runtime Dependencies (Not Included in Repository)

The following are **not** in this repository, for copyright reasons, and must be
provided locally. Both folders are gitignored.

| What | Where it goes | How to obtain |
|---|---|---|
| The Resident Evil Classic Bundle, **GOG or Steam** | GOG: `GOG Games/` next to the launcher, or anywhere the launcher can detect. Steam: install it normally and the launcher finds it | Purchase from GOG.com or Steam |
| RE-Enhance mods (optional) | `reenhancemods/` next to the launcher | From their respective authors (see Credits) |
| The concept's textures (optional, only to re-run `pnpm assets:sync`) | `assets/textures/` | **Included in the repository.** Figma's own exports for the eight info-panel logos and the main-menu lockup. Their converted copies are committed under `src/renderer/src/assets/`, so a clone builds without them |

### GOG or Steam

Both are supported and **GOG wins when you have both** — it is where the RE-Enhance
overlay and the `config.ini` the launcher patches belong. Steam is used when GOG has
nothing for that row.

Steam's layout is very different: each localization is a *complete copy* of the game
in its own folder, so a row's install root is the localization folder itself —
`4249100_Biohazard\english` for RE1 US and `…\japanese` for RE1 JP, which is why the
two rows of one title can live in two places. The row then runs the executable Steam
ships there, and RE2's Japanese copy names its executables `LeonJ.exe` / `ClaireJ.exe`
rather than the `LeonU.exe` / `ClaireU.exe` a GOG install uses.

Two consequences worth knowing:

- **RE-Enhance is a GOG feature.** The launcher injects nothing into a Steam install,
  so a Steam row always launches in ORIGINAL mode. If you have applied RE-Enhance to
  a Steam copy yourself, the language executable you would run is already the patched
  one.
- **Two rows have no Steam equivalent** and stay GOG-only: DIRECTOR'S CUT (Steam's RE1
  app is the 1996 original) and BIOHAZARD 1.5, which was never released.

---

## Quick start

```bash
pnpm install        # dependencies
pnpm assets:sync    # build the bundled art from media/ and the design export
pnpm dev            # run the launcher (main + preload + renderer, with HMR)
```

`pnpm assets:sync` is not optional on a fresh clone: the art the renderer imports is
generated into `src/renderer/src/assets/`, not committed.

### Building

```bash
pnpm build          # typecheck -> compile -> Windows installer + portable exe (release/)
pnpm build:dir      # compile -> unpacked build only (release/win-unpacked/)
pnpm start          # preview a compiled build with electron-vite
```

`pnpm build` produces an NSIS installer and a portable executable, both x64. The
build output lands in `release/`.

### Where the game folders must live

Both folders belong **beside the executable you double-click** — the launcher's own
directory, not `resources/`:

```
Resident Evil - Classic Collection.exe   (or the repo root, when running from source)
GOG Games/
├── Resident Evil/          RE1   -> ResidentEvil.exe, USA/, config.ini
├── Resident Evil 2/        RE2   -> LeonU.exe, ClaireU.exe, config.ini
└── Resident Evil 3/        RE3   -> ResidentEvil3.exe, config.ini
reenhancemods/              (optional)
├── RE-ENHANCE_RE1_v1.1_GOG/
├── RE-ENHANCE_RE2_v2.0.1_GOG/
└── RE-ENHANCE_RE3_v2.2_GOG/
```

The subfolder names are exact. Detection order is: an explicit install root
override → `GOG Games/<folder>` beside the launcher → the GOG registry entry for the
title → `C:\GOG Games`, `C:\Program Files (x86)\GOG Games`, `D:\GOG Games`. Every
stage only wins if the directory actually exists, and a mod folder is only "available"
if it exists and holds at least one entry.

---

## Game catalog

Eight rows, three titles. The **Release shown** column is the date the concept draws
on the row; **Originally released** is the concept's own `originally released in …`
line, reproduced verbatim (`docs/DESIGN-FIDELITY.md` §7.3).

### Resident Evil (GOG id `1580232252`, folder `Resident Evil`)

| # | Row | Region | Release shown | Originally released | Retail executable | Mod support |
|---|---|---|---|---|---|---|
| 0 | RESIDENT EVIL | US | July 24, 1998 | 30 March 1996 | `ResidentEvil.exe` | RE-Enhance v1.1 (`Biohazard.exe`) |
| 1 | BIO HAZARD | JP | July 24, 1998 | 22 March 1996 | `ResidentEvil.exe` | **Requires** RE-Enhance v1.1 (`JapaneseEnable`) |
| 2 | DIRECTOR'S CUT | US | July 24, 1998 | September 25, 1997 | `ResidentEvil.exe` | RE-Enhance v1.1 (`Biohazard.exe`) |

### Resident Evil 2 (GOG id `1534123252`, folder `Resident Evil 2`)

| # | Row | Region | Release shown | Originally released | Retail executable | Mod support |
|---|---|---|---|---|---|---|
| 0 | LEON S. KENNEDY | US | September 29, 1998 | 21 January 1998 | `LeonU.exe` / `ClaireU.exe` (scenario) | RE-Enhance v2.0.1 (`Resident Evil 2.exe`) |
| 1 | BIOHAZARD 1.5 | US | September 29, 1998 | *never released* | — | — |
| 2 | BIO HAZARD 2 | JP | September 29, 1998 | 29 January 1998 | `LeonU.exe` / `ClaireU.exe` (scenario) | RE-Enhance v2.0.1 (`Resident Evil 2.exe`) |

> **Row 1 cannot be launched.** BIOHAZARD 1.5 is the internal name of the Resident Evil
> 2 prototype that was cancelled in early 1997 and rebuilt from scratch. The concept
> devotes a row to it — with its own artwork, description and the note *"Planned
> Release IN March 1997 (Scrapped and remade.)"* — so the row is kept and labelled
> `CONCEPT — NEVER RELEASED`. It has no executable, its LAUNCH row is disabled, and
> the launcher refuses it with `not-launchable` before it touches the disk.

### Resident Evil 3 (GOG id `1266089300`, folder `Resident Evil 3`)

| # | Row | Region | Release shown | Originally released | Retail executable | Mod support |
|---|---|---|---|---|---|---|
| 0 | RESIDENT EVIL 3 | US | September 27, 1998 | 11 November 1999 | `ResidentEvil3.exe` | RE-Enhance v2.2 (`BIOHAZARD(R) 3 PC.exe`) |
| 1 | BIO HAZARD 3: LAST ESCAPE | JP | September 27, 1998 | 22 September 1999 | `ResidentEvil3.exe` | RE-Enhance v2.2 (`BIOHAZARD(R) 3 PC.exe`) |

### The two player scenarios

RE2's Leon and Claire are not separate rows: the row carries both, and the launch
panel offers a **SCENARIO** option on RE2 only. In original mode it selects the
executable (`LeonU.exe` / `ClaireU.exe`); in enhanced mode RE-Enhance boots its own
loader and reads the choice from its own configuration, so the launcher passes the
scenario along and starts `Resident Evil 2.exe`.

### Enhanced mode

When a row is set to **ENHANCED**, the launcher injects the RE-Enhance tree over the
retail install (backing up every file it is about to overwrite), then starts the
mod's executable. Switching back to **ORIGINAL** restores the backups and deletes the
files the mod added. Rows without a RE-Enhance folder on disk are locked to ORIGINAL,
and RE1 JP is locked to ENHANCED because `JapaneseEnable` needs the RE-Enhance DLL.

---

## Controls

Keyboard, mouse and gamepad all produce the same six actions, and each screen
interprets them the way the design's helper bar promises.

| Screen | Left / Right | Up / Down | Confirm | Back |
|---|---|---|---|---|
| **Main menu** | move between the three cards | — | open the selected title | quit the launcher |
| **Game Version** | move between rows | move between rows (wraps) | open the launch panel | back to the main menu |
| **Launch panel** | ↑↓ move rows; ←→ change the highlighted value | move rows | start the game (on LAUNCH) / change the value | close the panel |
| **Gameplay** | — | — | — | back to the version list |
| **Install Status** | — | — | continue to the main menu | — |
| **Error dialog** | — | — | dismiss | dismiss |

| Input | Binding |
|---|---|
| Keyboard | Arrow keys or **WASD** to navigate; **Enter**, **Numpad Enter** or **E** to confirm; **Esc** to go back |
| Mouse | Hover a card or row to select it, click to activate it; the dialog dismisses on a click |
| Gamepad | D-pad or left stick (0.5 deadzone) to navigate; **A** to confirm; **B** to go back |

Repeats are throttled: 140 ms for a held key, 220 ms for the pad, and the two devices
are briefly locked apart so one gesture cannot arrive twice.

---

## Configuration

Settings live in a JSON file the launcher owns, **not** beside the executable
(`Program Files` is not writable for a standard user):

```
%APPDATA%\re-classic-collection\config.json
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `crtEnabled` | boolean | `false` | Draw the CRT overlay |
| `scanlineIntensity` | number | `0.3` | Scanline darkening |
| `curvature` | number | `0.08` | Barrel curvature (`0` disables the warp) |
| `crtVignette` | number | `0.35` | Edge darkening |
| `crtGrain` | number | `0.04` | Noise amount |
| `masterVolume` | number | `1` | Master audio level |
| `sfxVolume` | number | `1` | UI cue level |
| `musicVolume` | number | `1` | Reserved |
| `lastSelectedTitle` | `"re1" \| "re2" \| "re3"` | `"re1"` | Which card the menu opens on |
| `modes` | object | `{}` | Per-version `enhanced` / `original`; a missing entry uses the detected state |
| `scenarios` | object | `{}` | Per-version `leon` / `claire`; a missing entry uses the row's default |
| `gogPathOverride` | string | `""` | Explicit GOG root; empty means auto-detect |
| `keepLauncherVisible` | boolean | `true` | Keep the launcher window up while a game runs |

Writes are atomic (temp file + rename) and a failed write is logged rather than
fatal, so a read-only profile keeps working for the session. Malformed values fall
back to their defaults instead of breaking the launcher.

**Upgrading from the old launcher:** the first run reads the legacy
`config.ini` beside the executable and migrates it once — `[display] crt_enabled`,
`scanline_intensity`, `curvature`, `vignette` / `noise_amount`, `[audio]
master_volume`, `[game] last_selected` and `gog_path_override` are all recognised in
both their section-qualified and bare spellings, using the old tolerant boolean and
numeric parsing. The full mapping is in `docs/ARCHITECTURE.md` §8. The old file is
only ever read, never written.

---

## Achievements

365 definitions ship with the launcher: **115** for RE1, **131** for RE2 and **119**
for RE3, in `assets/achievements/achievements.json`:

```json
{
  "re1": [
    { "id": "re1_001", "name": "A Member of S.T.A.R.S.", "desc": "Complete the game as Jill on Standard", "icon": "" }
  ],
  "re2": [ "... 131 entries ..." ],
  "re3": [ "... 119 entries ..." ]
}
```

You can override or extend it without rebuilding, because the last readable file in
this order wins:

1. the bundled `assets/achievements/achievements.json` (baseline),
2. `<launcher folder>/assets/achievements/achievements.json` (shipped loose by the
   installer),
3. `%APPDATA%\re-classic-collection\achievements.json` (yours — this one wins).

An override that cannot be parsed, is not keyed by `re1`/`re2`/`re3`, or yields no
achievements at all is ignored, so a truncated file can never wipe the list.

Progress is saved in the **old launcher's own format**, so existing unlocks carry
over:

```
%APPDATA%\re-classic-collection\achievements.sav

# Resident Evil Classic Collection - achievement progress
re1_001=1|2025-03-04T18:22:09.114Z
re1_002=0|
```

One line per achievement, `id=<flag>|<date>`: `1` unlocked, `0` locked, and a locked
row carries no date. Blank lines, `#`/`;` comments and malformed rows are skipped; a
duplicate id keeps the last row. On first run the launcher adopts a legacy
`achievements.sav` found beside the executable and writes it to the new location
exactly once. Only ids the current definitions know about are applied, so a save from
a different catalog cannot resurrect a row that no longer exists.

---

## Media and the asset pipeline

`pnpm assets:sync` (`tools/sync-design-assets.mjs`) produces every image, video and
sound the renderer imports. It is a build step, not a manual one, and it is the only
thing that writes into `src/renderer/src/assets/`.

- **Sources.** The eight info-panel logos and the main-menu badge come from
  `assets/textures/` — the concept's own texture exports, named the way Figma names
  layers (`Game=1, Type=Default.png`, `main-logo.png`). Each logo has the exact aspect
  ratio of the box the design draws it in (`Game=1, Type=Default` is 409x109 against a
  262.686x70 box) and is about 1.55x the `media/` file of the same art, so the
  textures win. Heroes and region art come from `media/`, the art the previous
  launcher shipped, verified as the 1x twin of the export's @2x/@4x originals by
  dimension. The assets the export has and neither of those folders covers — the
  Unsplash backdrop, the three cover portraits, the two gameplay stills — come from
  `.ref/designref/src/assets/`.
- **The badge.** It is cropped out of `main-logo.png` rather than re-typeset: the sync
  finds the lockup's lowest opaque band, trims the drop shadow Figma flattened into the
  texture (the CSS one from the export is drawn instead) and reports the rectangle it
  used, which is also recorded in the manifest. See `docs/DESIGN-FIDELITY.md` §7.2.
- **Re-encoding.** Everything becomes WebP (`sharp`) so the renderer stays small;
  heroes are resized to 1600 wide and region art to 1068 wide, and the logos are kept
  at native size because each one's pixel width already equals its design box. Videos
  are copied verbatim (re-encoding a trailer costs quality for no real saving), and so
  are the three WAV cues and the Actor font.
- **Records.** `src/renderer/src/assets/MANIFEST.json` lists every output with its
  source path, size and — for the badge — the crop rectangle; `design-map.json` maps
  the export's `figma:asset/<hash>` specifiers to converted files. Neither is
  hand-edited.
- `node tools/sync-design-assets.mjs --check` reports what would be missing without
  writing anything.
- `node tools/inspect-image.mjs <file.png>` reports what a texture actually is: its
  alpha bounding box and the bands of red / grey-white content inside it. That is how
  the badge's crop was established rather than guessed.

The input folders are `media/`, `assets/textures/`, `.ref/designref/src/assets/` and
`assets/` (`assets/videos`, `assets/audio`, `assets/fonts`); the renderer never reads
any of them at runtime — it reads the generated files under
`src/renderer/src/assets/`.

---

## Testing

```bash
pnpm test           # unit tests (vitest, Node environment)
pnpm test:watch     # the same, in watch mode
pnpm typecheck      # tsc over the main/preload, renderer and e2e projects
pnpm compile        # build main, preload and renderer into out/
pnpm test:e2e       # compile, then run the Playwright specs from tests/e2e/
pnpm check:fidelity # the design-drift guard: the live UI vs the Figma export
```

### The one spec that starts a game

`pnpm test:e2e` is hermetic: every spec replaces the main process's `launch` handler
so that no test can start an executable, and points the app at a throwaway fixture.
That leaves one path untested — the real one — so `tests/e2e/live-launch.spec.ts`
covers it and is skipped unless you ask for it:

```powershell
pnpm compile
$env:RE_LIVE_LAUNCH = '1'; npx playwright test tests/e2e/live-launch.spec.ts
```

It runs against your real application directory, so it probes your actual
`GOG Games/` install, injects the RE-Enhance overlay, starts the game, checks the
launcher tracks it, and then quits the launcher to prove the game is killed rather
than orphaned. The spec's *profile* is redirected to a temp directory so it is
repeatable; the game and the mod injection are not, and are not meant to be. It
force-kills anything it started on the way out, including a failure midway.

`pnpm check:fidelity` is the one to run after touching any component, any measured
value or the catalog: it reads the vendored Figma export and fails if a design class
string, measured number, gradient stop or mask offset is no longer present in the
renderer. It verifies the vendored copy is still byte-identical to
`.ref/designref/src/imports/`, and it can run in `--strict` mode, which also fails
when a value has moved to a different file. The three-step fidelity procedure — the
guard, the Playwright geometry spec and the human side-by-side against the export —
is written up in `docs/DESIGN-FIDELITY.md` §8.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **Game not detected** | The launcher boots to Install Status and shows where each title was expected. Put `GOG Games/<exact folder name>/` beside the executable, or install through GOG so the registry entry exists, or set `gogPathOverride` in `config.json` to the folder that *contains* `Resident Evil/` |
| **Install Status says PARTIAL** | The install root was found but a probe failed — the row lists the reason (`Executable not found`, `Game data incomplete`). Re-verify the GOG install files |
| **The RE-Enhance setup dialog appears on launch** | The game's own `config.ini` could not be patched. Check the install folder is writable; the launcher writes `[DLL] BootConfig=0` before every launch |
| **Wrong language / US-JP mix-up** | Language is driven by `[DLL] JapaneseEnable`, set from the row you launched. Launch the JP row for Japanese, the US row for English |
| **Mods are not applied** | `reenhancemods/` must be beside the executable with the exact folder names in *Where the game folders must live*. A row with no mod folder is locked to ORIGINAL mode |
| **Enhanced mode starts the retail game** | The row's mod executable was not found after injection, so the launcher fell back to retail instead of failing the launch. Re-download the RE-Enhance release for that title |
| **The wrong executable / a second launch refused** | One game at a time is deliberate: a second launch answers `game-already-running` instead of silently killing the running game. Close the game (or quit the launcher, which stops it) first |
| **Files left behind after switching to ORIGINAL** | Restoring removes the mod's files and the `.mod_backup/` folder. Empty directories the mod created are deliberately left in place; a stray `.mod_backup/` without a manifest is cleaned up on the next injection |
| **No sound** | Audio starts only after a real gesture (browser policy). Press a key or click once; then check `sfxVolume` and `masterVolume` in `config.json` |
| **CRT filter looks wrong / too strong** | `scanlineIntensity`, `curvature`, `crtVignette` and `crtGrain` are all live settings. Set `curvature` to `0` to disable the warp filter |
| **Art or videos are missing after a fresh clone** | `pnpm assets:sync` has not run. It generates everything under `src/renderer/src/assets/` |
| **The window is smaller than 1920x1080** | The launcher renders a fixed 1920x1080 canvas and scales it to fit, letterboxing the remainder. Nothing reflows; a 1920x1080 window simply shows it at 1:1 |
| **Where are the logs?** | `%APPDATA%\re-classic-collection\re-log.txt` (also stdout in development). `RE_LOG_LEVEL=debug` turns on debug lines |

---

## Credits

- **Concept & Development**: Julio CACKO
- **RE-Enhance mods**: Classic REbirth, Seamless HD Project, TeamX HD
- **Game art and trailers**: CAPCOM CO., LTD. — used here as a fan concept
- **Actor typeface**: released under the SIL Open Font License; see
  `assets/fonts/OFL.txt`
- **Engine reference for the original implementation**: `powerslave_ex` (KEX engine)

---

## Legal notice

This is a **fan concept**. It is not affiliated with, endorsed by or sponsored by
CAPCOM CO., LTD.

Resident Evil, BIOHAZARD and all related names, characters, artwork and trademarks
are the property of CAPCOM CO., LTD. All game assets, logos, cover art and trailer
footage belong to their respective owners.

**This repository ships no copyrighted game files.** The `GOG Games/` folder, the
`reenhancemods/` folder and the development-only `.ref/` reference tree are all
gitignored and must be supplied by the user. What the repository contains is
launcher source code, the concept's own generated art (derived from the design
export), and achievement definitions.

One typeface is bundled and it is redistributable: **Actor** (SIL OFL 1.1, licence at
`assets/fonts/OFL.txt`), which sets the entire interface. The concept's other face —
the one it draws `Classic Collection` in — is Peter Jonca's **"Resident Evil Classic
Game Font"** (CC BY-ND 3.0), which is *not* redistributed here because its download
requires a DeviantArt login. No font is needed for it either way: the badge renders
the designer's own cropped texture (`assets/textures/main-logo.png`), so the lettering
is exact without shipping anyone else's file. If you use his font in your own work,
credit Peter Jonca.
