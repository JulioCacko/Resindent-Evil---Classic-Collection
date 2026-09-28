# Architecture

`Resident Evil - Classic Collection` is a launcher for the GOG Resident Evil
Classic Bundle (RE1, RE2, RE3) with optional RE-Enhance mod support. This
document is the replacement for the old `ref.md`: it describes how the launcher is
put together, why it is put together that way, and where every piece of state
lives. It is written for someone who has to change the code, so it names the file
that owns each behaviour rather than only the behaviour.

Four files are the contract surface and should be read alongside this document:

| File | What it fixes |
|---|---|
| `src/shared/types.ts` | Every data type that crosses the process boundary |
| `src/shared/channels.ts` | Channel names, request/response map, `window.reLauncher` shape |
| `src/shared/catalog.ts` | The static catalog: 3 titles, 8 rows, the design's own display text |
| `src/main/contracts.ts`, `src/renderer/src/contracts.ts` | Frozen module and component signatures |

Nothing in this document is aspirational: every table below was read off those
files and the modules that implement them.

---

## 1. Why the runtime changed

The previous launcher was C++11 on SDL2 + OpenGL 3.3. It is gone from the working
tree but still readable with `git show HEAD:<path>`. The rewrite is Electron 44 +
React 19, and the reason is the concept, not the tooling.

| Driver | C++ / SDL2 / OpenGL | Electron + React |
|---|---|---|
| **The UI is a Figma concept** | Every screen had to be re-implemented in immediate-mode draw calls (`UISystem::Draw`, per-screen `Draw()` methods) that had to be kept in sync with the design by hand | The design's own Tailwind classes are transcribed verbatim into components, so the design and the code are the same artefact (see `docs/DESIGN-FIDELITY.md`) |
| **Controller-first** | Input, screen stack, focus and cursor were four separate mechanisms (`input_manager.cpp`, `ui_system.cpp`, per-screen `OnInput`) | Three input sources are normalised into six canonical actions, and one pure function (`resolveIntent` in `state/store.ts`) decides what each means per screen |
| **Identical rendering** | The frame was drawn into a 1920x1080 FBO and blitted up | The same 1920x1080 author space is rendered once and uniformly scaled (`stage/Stage.tsx`); every measured value stays true at any window size |
| **No native module rebuilds** | SDL2, GLAD, stb and nlohmann were vendored and built per toolchain; a Windows registry binding would have needed `electron-rebuild` and a per-ABI binary | Only three runtime dependencies (`react`, `react-dom`, `zustand`); the registry is read by running `reg query` (`detect/gog.ts`) rather than through a native binding |
| **Process management** | `CreateProcessA` with a hand-quoted command line | `child_process.spawn` with an argument array, so a path holding parentheses (`BIOHAZARD(R) 3 PC.exe`) is passed correctly without quoting |

### What the rewrite costs

These are real, and they are the trade the project accepted:

- **Bundle size.** A packaged build carries Chromium: the NSIS installer and the
  portable build (`electron-builder.yml`) are two orders of magnitude larger than
  the old ~3 MB executable. The renderer bundle itself is small; the runtime is
  not.
- **No GPU post-process pass.** The old CRT filter ran as a fragment shader over
  the finished frame (`git show HEAD:assets/shaders/crt.frag`), with per-channel
  displacement for chromatic aberration and a 4-tap phosphor blur. There is no
  equivalent inside a DOM, so `overlays/CrtOverlay.tsx` reproduces the *shape* of
  each effect with gradients, `feTurbulence` and `feDisplacementMap` — see
  §10 for exactly what is lost.
- **No frame loop.** The old launcher capped itself at 60 fps and owned its clock.
  The rewrite renders on React's schedule, so animation timings are CSS/DOM
  durations rather than frames.
- **Startup and memory.** Chromium has to boot before the first pixel; the
  launcher compensates by creating the window with the design's own
  `backgroundColor` and showing it on `ready-to-show` (`src/main/index.ts`).

What did **not** change: the catalog, the install detection rules, the mod
injection rules, the `config.ini` patching, the save format and the boot screen
rule are all the legacy behaviour, ported one function at a time. Each porting
module says so in its header and names the C++ file it came from.

---

## 2. Process split

```
┌──────────────────────── main (Node) ─────────────────────────┐
│ index.ts   window + app lifecycle, single instance, --selftest│
│ ipc.ts     the ONLY module touching ipcMain; owns singletons  │
│ paths.ts   appDir vs userData                                 │
│ logger.ts  stdout + re-log.txt, 200-line ring for the dialog  │
│ ini.ts     the game's config.ini patcher                      │
│ detect/gog.ts   install-root detection (5 stages)             │
│ validate.ts     3-probe install validation, modsAvailable     │
│ mods.ts     inject / restore the RE-Enhance overlay           │
│ launch.ts   prepare -> spawn -> track -> kill                 │
│ config-store.ts   config.json + legacy config.ini migration   │
│ achievements.ts   definitions + achievements.sav              │
│ catalog-state.ts  static catalog + disk -> CatalogSnapshot     │
└───────────────▲──────────────────────────────┬───────────────┘
                │ ipcMain.handle               │ webContents.send
        ┌───────┴──────────────────────────────▼───────┐
        │ preload/index.ts — contextBridge only         │
        │ window.reLauncher: invoke / on / once         │
        └───────▲──────────────────────────────────────┘
                │
┌───────────────┴──────────── renderer (Chromium) ──────────────┐
│ App.tsx  boot, compose, route, translate gestures              │
│ stage/Stage.tsx   1920x1080 author space, scale to fit         │
│ screens/          MainMenu, VersionSelect, Gameplay             │
│ components/       Backdrop, HelperBar, LogoBlock, GameCard,     │
│                   VersionRow, InfoPanel, Media, StatusPill      │
│ overlays/         LaunchPanel, InstallStatus, ErrorDialog,      │
│                   AchievementToast, CrtOverlay                  │
│ state/store.ts    the store: screen, cursor, config, launch     │
│ input/            actions.ts (pure), useActions, useGamepad     │
│ data/             design.ts (measured values), assets.ts, derive│
└───────────────────────────────────────────────────────────────┘
```

### Why all OS work lives in main

1. **Writability.** An NSIS install lands in `Program Files`, which a standard
   user cannot write (and Windows silently redirects into `VirtualStore` when it
   is tried). Anything the launcher *owns* — `config.json`, `achievements.sav`,
   `re-log.txt` — therefore lives in Electron's `userData`
   (`%APPDATA%\re-classic-collection`), resolved by `paths.ts`. Anything the
   *user* owns and may replace by hand — `GOG Games/`, `reenhancemods/`, the
   legacy `config.ini` and `achievements.sav` — stays beside the executable and is
   read from there.
2. **Trust.** The renderer holds third-party-free DOM but is still the least
   trusted part of the app: the window is created with `contextIsolation: true`
   and `nodeIntegration: false`, and the preload script exposes exactly one
   object, whose channels are checked against the shared tables at runtime. No
   component reaches the bridge directly; `state/store.ts` is the only caller.
3. **Blast radius.** A registry read, a directory walk, a file write and a child
   process are all things that must never be reachable from a stray script in the
   page. Keeping them on the main side means the renderer can only *ask*, through
   a handler that re-validates its payload (see `ipc.ts`: "payloads are
   untrusted").

`sandbox: false` is set for one reason: the package is `"type": "module"`, so
electron-vite emits the preload as ESM, and Electron loads an ESM preload only
without the sandbox. The preload uses nothing but `contextBridge`/`ipcRenderer`,
so nothing else is needed. The window also refuses navigation away from its own
renderer and denies popups; `shell:open-external` (http/https only) is the
intended way to leave the app.

---

## 3. Directory tree

One line per module; the parenthesised note is what it owns.

```
src/
├── shared/                      (imported by BOTH processes; no Electron, no DOM)
│   ├── types.ts                 every IPC payload and domain type
│   ├── channels.ts              channel names, InvokeMap/EventMap, ReLauncherApi
│   └── catalog.ts               the static catalog: 3 titles / 8 rows, RE2 exec map,
│                                per-title data probes, DEFAULT_TITLE_ID, ROW_COUNTS
├── main/                        (Node: the only place that touches the OS)
│   ├── index.ts                 window + lifecycle, single-instance lock, --selftest
│   ├── ipc.ts                   one handler per INVOKE_CHANNELS + event forwarding
│   ├── paths.ts                 appDir vs configDir -> MainPaths / AppPaths
│   ├── logger.ts                stdout + re-log.txt, 200-line ring for error context
│   ├── ini.ts                   line-based config.ini patcher (spacing preserved)
│   ├── detect/gog.ts            GOG install-root detection: override -> local -> registry -> roots
│   ├── detect/steam.ts          Steam root, libraries and app folders (registry + VDF + manifests)
│   ├── detect/install.ts        which store a row runs from: GOG first, then Steam
│   ├── validate.ts              3-probe validation, case-insensitive name resolution
│   ├── mods.ts                  inject/restore the RE-Enhance overlay + .mod_backup
│   ├── launch.ts                prepareLaunch -> performLaunch -> exit tracking
│   ├── config-store.ts          config.json, atomic writes, legacy ini migration
│   ├── achievements.ts          definitions + achievements.sav, unlock fan-out
│   ├── catalog-state.ts         joins the static catalog with detection + validation
│   └── contracts.ts             FROZEN signatures for all of the above
├── preload/
│   ├── index.ts                 contextBridge the ReLauncherApi, allow-list channels
│   └── index.d.ts               the global type for window.reLauncher
└── renderer/
    ├── index.html               the single HTML entry
    └── src/
        ├── main.tsx             React root + StrictMode
        ├── App.tsx              boot, compose, route, gesture -> action translation
        ├── contracts.ts         FROZEN component props, store shape, hook signatures
        ├── env.d.ts, global.d.ts  asset module types, window.reLauncher
        ├── stage/Stage.tsx      the 1920x1080 author space, scaled to fit
        ├── screens/MainMenu.tsx     the 3-card menu
        ├── screens/VersionSelect.tsx 1060px rows + 860px info panel
        ├── screens/Gameplay.tsx     the frame shown while a game runs
        ├── components/Backdrop.tsx   flipped hard-light photograph
        ├── components/HelperBar.tsx  68px bar + the key caps
        ├── components/LogoBlock.tsx  wordmark + "Classic Collection" badge
        ├── components/GameCard.tsx   380x580 cover, selected/original states
        ├── components/VersionRow.tsx 1600/740 hero row, selected/original states
        ├── components/InfoPanel.tsx  logo, date, description, meta box, video lane
        ├── components/Media.tsx      img/video primitives that degrade to nothing
        ├── components/StatusPill.tsx INSTALLED / PARTIAL / MISSING
        ├── overlays/LaunchPanel.tsx  MODE / CRT / SCENARIO / LAUNCH rows
        ├── overlays/InstallStatus.tsx first-run install gate
        ├── overlays/ErrorDialog.tsx  modal error card
        ├── overlays/AchievementToast.tsx non-blocking unlock popup
        ├── overlays/CrtOverlay.tsx   scanlines, phosphor, vignette, grain, warp
        ├── state/store.ts        zustand store: state, actions, intent resolution
        ├── input/actions.ts      pure key/pad -> InputAction tables + throttles
        ├── input/useActions.ts   keyboard wiring + pad composition (wired by App.tsx)
        ├── input/useGamepad.ts   rAF polling of the Gamepad API
        ├── audio/useSfx.ts       Web Audio cues (cursor/confirm/back)
        ├── data/design.ts        every measured value from the Figma export
        ├── data/assets.ts        asset key -> bundled URL
        ├── data/derive.ts        pure selectors (mode, scenario, canLaunch, ...)
        ├── styles/fonts.css      @font-face for Actor and its Figma-spelled alias
        │                         ('Actor:Regular')
        ├── styles/theme.css      colour tokens
        └── styles/tailwind.css   Tailwind entry
assets/                          shipped with the build
├── achievements/achievements.json   365 definitions (RE1 115 / RE2 131 / RE3 119)
├── audio/                       source WAVs, copied to the renderer by assets:sync
├── fonts/                       Actor-Regular.ttf + OFL.txt
└── videos/                      source MP4s for the info panel's video lane
media/                           the previous launcher's 1x art (logos, heroes, region art)
GOG Games/ reenhancemods/        user-provided, gitignored (see README)
tools/
├── sync-design-assets.mjs       media/ + export -> WebP in src/renderer/src/assets
├── check-fidelity.mjs           the design-drift guard (see DESIGN-FIDELITY.md)
└── e2e-probe.mjs                diagnostic: boots the built app and dumps the DOM
                                 hooks, console errors and an element's author-space
                                 box with every ancestor's. Use it when a geometry
                                 assertion fails and the spec's number alone does
                                 not say which layer introduced the offset:
                                 `node tools/e2e-probe.mjs --keys Enter --node info-panel`
docs/                            this file, DESIGN-FIDELITY.md
tests/e2e/                       Playwright specs (see playwright.config.ts)
```

---

## 4. IPC contract

Two directions, one rule each:

- **Invoke** (renderer asks, main answers): `ipcMain.handle`. The renderer calls
  `window.reLauncher.invoke(channel, payload)`. **No exception may cross the
  bridge** — every handler is wrapped, the error is logged, and the caller gets a
  value of the declared response type instead (a `LaunchResult` with `ok: false`,
  an empty list, the current config). A rejected promise would be invisible to a
  renderer that only reads the resolved value.
- **Event** (main pushes): `webContents.send`, subscribed with
  `window.reLauncher.on(channel, listener)`, which returns its own unsubscribe.
  The listener never sees the Electron event object — only the payload.

Every payload arriving from the renderer is re-validated in `ipc.ts` before it can
reach the filesystem, the registry or a child process.

### Invoke channels (20)

| Channel | Payload | Result | Notes |
|---|---|---|---|
| `catalog:get` | — | `CatalogSnapshot` | First call builds and caches the snapshot |
| `catalog:refresh` | — | `CatalogSnapshot` | Rebuilds, and pushes `catalog:changed` |
| `catalog:set-install-root` | `{ path }` | `CatalogSnapshot` | `''` clears the override; rebuilds detection |
| `modes:set` | `{ versionId, mode?, scenario? }` | `LauncherConfig` | Persists per-row mode and/or RE2 scenario |
| `config:patch` | `Partial<LauncherConfig>` | `LauncherConfig` | Shallow merge; sanitised field by field |
| `config:reset` | — | `LauncherConfig` | Defaults; also clears the install-root override |
| `launch` | `LaunchRequest` | `LaunchResult` | Serialised; a second launch is refused |
| `game:status` | — | `GameStatus` | `exitCode` is `null` while a game runs; `startedAt` is what the now-playing bar counts from |
| `game:focus` | `{ titleId, versionId }` | — | The row the renderer is showing, used to attribute an exit |
| `game:stop` | — | — | Ends the running game through the same `killGame` that `app:quit` uses |
| `achievements:list` | `{ gameId }` | `Achievement[]` | Definitions plus saved progress |
| `achievements:unlock` | `{ id }` | `Achievement \| null` | `null` for an unknown or already-unlocked id |
| `achievements:reset` | `{ gameId? }` | `Achievement[]` | Whole save when `gameId` is absent |
| `app:paths` | — | `AppPaths` | The renderer's view of the paths, without `configDir` |
| `shell:open-external` | `{ url }` | — | http/https only; anything else raises a toast |
| `shell:reveal-path` | `{ path }` | — | `shell.showItemInFolder`; a missing path raises a toast |
| `catalog:pick-install-root` | — | `string \| null` | The OS folder chooser, then the same override `catalog:set-install-root` takes; `null` is a cancel |
| `app:quit` | — | — | Stops a running game first (see §6) |
| `app:ping` | — | `{ ok: true, version }` | The authoritative app version |

### Event channels (7)

| Channel | Payload | Publisher | Consumer |
|---|---|---|---|
| `mod:progress` | `ModProgress` | `injectMod`/`removeMod` callbacks | store → the launch panel's progress readout |
| `launch:phase` | `LaunchPhase` | the launch sequence | store → the panel's busy readout (`PREPARING…` / `RESTORING…` / `PATCHING CONFIG…` / `STARTING…`) |
| `game:exit` | `GameExitEvent` | `launch.ts` exit tracking | store → returns to the version screen |
| `catalog:changed` | `CatalogSnapshot` | `catalog:refresh` | store → replaces its catalog |
| `achievement:unlock` | `Achievement` | the achievement store's fan-out | store → the achievement toast queue |
| `ui:toast` | `{ kind, title, message }` | `ipc.ts` (shell failures) | *reserved: nothing renders it yet* |
| `input:action` | `{ action }` | *reserved: nothing publishes it* | *reserved* |

The two reserved channels are part of the frozen contract; the launcher's input is
produced inside the renderer (§9), so the main process has no reason to send it
yet.

---

## 5. Catalog model

`src/shared/catalog.ts` is the single source of truth for **what exists**, and the
main process is the single source of truth for **what is on disk**. The two are
joined per snapshot by `catalog-state.ts`.

- `GameTitleSeed` / `GameVersionSeed` are the static halves. A seed deliberately
  omits `state`, `stateReason`, `hasMod` and (per row) `titleId`, all of which are
  discovered at runtime.
- `GameTitle` / `GameVersion` in `src/shared/types.ts` are the runtime shape the
  renderer receives, with those fields filled in.
- `ROW_COUNTS` (3 / 3 / 2) and `DEFAULT_TITLE_ID` (`re1`) come from the catalog,
  `findTitle` / `findVersion` are the only lookups, and `TITLE_DATA_PROBES` and
  `RE2_SCENARIO_EXEC` are shared by validation and launching so the two can never
  disagree.

### The eight rows

Region, text and executables are exactly as the design draws them
(`docs/DESIGN-FIDELITY.md` records the provenance of the strings).

| # | Title | Row | Version id | Region | Shown as | Retail exe | Enhanced exe | Mod folder |
|---|---|---|---|---|---|---|---|---|
| 1 | RESIDENT EVIL | 0 | `re1_us` | US | RESIDENT EVIL | `ResidentEvil.exe` | `Biohazard.exe` | `RE-ENHANCE_RE1_v1.1_GOG` |
| 2 | RESIDENT EVIL | 1 | `re1_jp` | JP | BIO HAZARD | `ResidentEvil.exe` | `Biohazard.exe` | `RE-ENHANCE_RE1_v1.1_GOG` |
| 3 | RESIDENT EVIL | 2 | `re1_dc` | US | DIRECTOR'S CUT | `ResidentEvil.exe` | `Biohazard.exe` | `RE-ENHANCE_RE1_v1.1_GOG` |
| 4 | RESIDENT EVIL 2 | 0 | `re2_leon_us` | US | LEON S. KENNEDY | `LeonU.exe` / `ClaireU.exe` | `Resident Evil 2.exe` | `RE-ENHANCE_RE2_v2.0.1_GOG` |
| 5 | RESIDENT EVIL 2 | 1 | `re2_proto` | US | BIOHAZARD 1.5 | *none* | *none* | — |
| 6 | RESIDENT EVIL 2 | 2 | `re2_jp` | JP | BIO HAZARD 2 | `LeonU.exe` / `ClaireU.exe` | `Resident Evil 2.exe` | `RE-ENHANCE_RE2_v2.0.1_GOG` |
| 7 | RESIDENT EVIL 3 | 0 | `re3_us` | US | RESIDENT EVIL 3 | `ResidentEvil3.exe` | `BIOHAZARD(R) 3 PC.exe` | `RE-ENHANCE_RE3_v2.2_GOG` |
| 8 | RESIDENT EVIL 3 | 1 | `re3_jp` | JP | BIO HAZARD 3: LAST ESCAPE | `ResidentEvil3.exe` | `BIOHAZARD(R) 3 PC.exe` | `RE-ENHANCE_RE3_v2.2_GOG` |

Per-row extras:

| Row | `requiresMod` | `japaneseMode` | Scenarios | `originalRelease` / `boxNote` |
|---|---|---|---|---|
| `re1_us` | no | no | — | `originally released in 30 March 1996` |
| `re1_jp` | **yes** | yes | — | `originally released in 22 March 1996` |
| `re1_dc` | no | no | — | `originally released in September 25, 1997` |
| `re2_leon_us` | no | no | `leon`, `claire` (default `leon`) | `originally released in 21 January 1998` |
| `re2_proto` | no | no | — | `boxNote: Planned Release IN March 1997 (Scrapped and remade.)` |
| `re2_jp` | no | yes | `leon`, `claire` (default `leon`) | `originally released in 29 January 1998` |
| `re3_us` | no | no | — | `originally released in 11 November 1999` |
| `re3_jp` | no | yes | — | `originally released in 22 September 1999` |

### Which install a row runs from: GOG first, then Steam

`src/main/detect/install.ts` is the single answer to "where is this row", and the rule
is **GOG preferred**. Both stores can be installed at once, and when they are, GOG is
the one the rest of the app understands: it is where the RE-Enhance overlay and the
`config.ini` the launcher patches belong. Steam is used when GOG has nothing.

The two layouts have almost nothing in common, which is why the resolver exists:

| | GOG | Steam |
|---|---|---|
| Install root | `<appDir>/GOG Games/<gogFolderName>/` | `<library>\steamapps\common\<installdir>` |
| Folder name | the title, e.g. `Resident Evil` | Valve's, e.g. `4249100_Biohazard` |
| Executables | in the install root | one complete copy per localization, in `english\`, `japanese\`, … |
| RE2 JP | `LeonU.exe` / `ClaireU.exe` + the `JapaneseEnable` flag | `LeonJ.exe` / `ClaireJ.exe` |
| RE-Enhance | yes | no — a Steam row is always `ORIGINAL` and injects nothing |

What comes out is a **game root**: the folder holding the executable *and* its data.
For GOG that is the install root; for Steam it is the locale folder, which is
self-contained (RE1's `english\` carries its own `USA\Data`). Because that subtree is
what everything downstream works against, probing, the working directory and the
`config.ini` patch all work on a Steam row unchanged.

Three facts are read from Valve rather than guessed at a folder name:

1. the Steam root, from the registry (`SteamPath` under HKCU, else `InstallPath` under
   HKLM, both spellings of the WOW64 view);
2. the libraries, from `<root>\steamapps\libraryfolders.vdf` — five drives on the
   machine this was built against;
3. the app's folder, from `appmanifest_<appid>.acf`, whose `installdir` is the
   authority. `findSteamAppDir` looks in the libraries Valve lists the app in first,
   then in every other known library, so an install Valve has not rewritten its `apps`
   block for is still found.

The three app ids are `4249100`, `4249110` and `4249120` (Resident Evil 1996, Resident
Evil 2 1998, Resident Evil 3 Nemesis 1999). Two rows have no Steam equivalent and stay
GOG-only: `re1_dc`, because the Steam app is the 1996 original rather than the
Director's Cut, and `re2_proto`, which was never released.

**Rows are resolved individually, not per title.** That is the whole reason
`GameVersion.installPath` exists alongside `GameTitle.installPath`: RE1 US resolves to
`…\english` and RE1 JP to `…\japanese`, and a title-level path could only ever describe
one of them. The title-level field is a summary for the install gate and the "where is
it" line; nothing launches from it.

### Install validation: three probes, then the RE-Enhance veto

`validate.ts` reproduces the legacy `InstallValidator::ValidateTitle` in two
steps, and the split matters for what the user is told to fix:

1. **Three probes against the disk.** `installOk` (the game root exists),
   `exeOk` (the row's executable resolves inside it), `dataOk` (the title's own
   marker from `TITLE_DATA_PROBES`: `USA/` or `USA/Data` for RE1; for RE2 one of
   `ClaireU.exe`, `LeonU.exe`, `ClaireJ.exe`, `LeonJ.exe`, because RE2's data marker
   *is* a scenario executable and a Steam Japanese copy names those differently; for
   RE3 `ResidentEvil3.exe`). Name resolution is case-insensitive because Windows is.
   Scoring is the legacy one: 3/3 → `installed`, 0/3 → `missing`, anything else →
   `partial`.
2. **The veto.** A fourth field, `modOk`, reports whether the row's *requirement*
   is met — `true` for every row except the `requiresMod` ones, which need a
   non-empty `reenhancemods/<modPath>`. `stateFromProbe` demotes a would-be
   `installed` to `missing` when `modOk` is false, exactly as the legacy code
   demoted after scoring.

Keeping the three probes truthful (rather than folding a failed mod into 0/3) is
what lets `catalog-state.ts` name the real cause: a complete RE1 JP install with no
RE-Enhance folder reports `Requires the RE-Enhance files`, not `Game folder not
found`. `derive.resolveMode` locks such a row to `enhanced`, and that targets
`modExecRelPath`, which only exists after injection — so reporting it as anything
but `missing` would offer a row that cannot run.

`needsInstallScreen(titles)` returns true when any title has no `installed`
version, which is the legacy boot rule (`App::Init` pushed the install screen when
`CatalogNeedsInstallScreen` was true in `src/core/app.cpp`).

### Why RE2's scenarios are an option and not rows

The legacy launcher listed RE2 four times: Leon US, Claire US, Leon JP, Claire JP.
The concept draws RE2 **three** rows and uses the middle one for the cancelled
BIOHAZARD 1.5 prototype. So the two player scenarios became a *property of the
row*:

- `GameVersion.scenarios` lists what a row exposes (`['leon', 'claire']` on the
  two real RE2 rows, `[]` everywhere else) and `defaultScenario` is `'leon'`.
- `RE2_SCENARIO_EXEC` maps a scenario to its retail executable
  (`LeonU.exe` / `ClaireU.exe`), which is the only thing the scenario changes in
  **original** mode. In **enhanced** mode RE-Enhance boots its own loader
  (`Resident Evil 2.exe`), so the scenario cannot be expressed through the file
  name; it is still recorded in `PreparedLaunch.scenario`, and RE-Enhance reads
  the choice from its own configuration.
- `derive.panelOptions()` only offers the SCENARIO row when a version exposes more
  than one scenario, so the row appears on RE2 and nowhere else, and
  `config.scenarios[versionId]` remembers the choice per row.

### Why BIOHAZARD 1.5 cannot be launched

`re2_proto` is a **concept row**: the game it describes was cancelled in early
1997 and never shipped, so there is no executable to run. It is not hidden,
because the concept devotes a whole screen row to it (with its own artwork,
description and note), so the row stays and carries:

- `launchable: false`,
- `unavailableReason: 'CONCEPT — NEVER RELEASED'` (drawn on the row itself),
- `execRelPath: ''` and `modExecRelPath: ''`, so nothing can be selected by
  accident,
- `boxNote: 'Planned Release IN March 1997 (Scrapped and remade.)'`, shown in the
  info panel in place of the `originally released in …` line, because
  `originalRelease` is empty.

`prepareLaunch` refuses it with `not-launchable` before it looks at the disk, the
launch panel greys the LAUNCH row out, and `derive.canLaunch` returns false. The
row's `state` still reports what the probes found — on a machine with RE2
installed that is `partial`, because the game folder and data marker are there and
the row simply names no executable — but for a concept row `catalog-state.ts`
reports `unavailableReason` as the `stateReason`: the concept note is the reason,
not the user's disk.

---

## 6. Launch pipeline

`ipc.ts` `launchSequence()` is the orchestrator; `launch.ts` owns the process.
The order matters and is the legacy order (`screen_launch.cpp` on Confirm, then
`GameLauncher::Launch`).

1. **Reject a concurrent launch.** `runLaunch` refuses when a sequence is already
   in flight, and `prepareLaunch`/`performLaunch` refuse when a game is already
   tracked: both answer `game-already-running`. The legacy launcher called
   `KillGame()` first, which silently killed the running game.
2. **Resolve the row.** `findVersion(versionId)`; the row's `titleId` must match
   the request, and `launchable` must be true. Failures: `not-launchable`.
3. **Resolve the install.** `catalog-state` already did this for the snapshot, but
   the frozen `prepareLaunch(request)` takes no dependencies, so `launch.ts`
   repeats it with the same detector and validator — one `GOG Games/` check plus
   one registry query, for the requested title only. Failures: `not-installed`
   (`Game is not installed or path is unknown.` for an empty root, the catalog's
   `stateReason` for `missing`). A `partial` install **passes**: the renderer's
   `canLaunch` accepts `installed` and `partial`, and the two sides must not
   disagree about what is playable.
4. **Choose the executable.** `chooseExecutable()`:

   | Mode | Condition | Executable |
   |---|---|---|
   | enhanced | RE-Enhance files are on disk **and** the mod executable exists | `modExecRelPath` |
   | enhanced | mod executable missing | falls back to the retail pick below |
   | original | RE2 with a scenario | `RE2_SCENARIO_EXEC[scenario]` |
   | original | anything else | `execRelPath` |

   The fallback is the departure from the legacy pick, which chose the mod
   executable and then failed the launch when it was absent.

5. **Patch the game's own `config.ini`.** `[DLL] BootConfig=0` (suppresses the
   RE-Enhance setup dialog on every boot) and `[DLL] JapaneseEnable=1|0` from the
   row's `japaneseMode`. Both patches are sequential — each one rewrites the whole
   file, so overlapping calls would lose one of the two. Failure:
   `config-unwritable`.
6. **Inject or restore the overlay** (§7), announcing `launch:phase`
   (`patching-config`, `injecting-mod`, `restoring-mod`, `spawning`) before each
   step and streaming `mod:progress` during the copy. Failures:
   `mod-inject-failed`, `mod-restore-failed`.
7. **Re-check the executable** now that the overlay is in place (the enhanced
   executable is provided by the injection). Failure: `executable-missing`.
8. **Spawn.** `child_process.spawn(executable, [], { cwd: installRoot,
   detached: false, windowsHide: false, stdio: 'ignore' })`. The working directory
   is the install root because the games load `Rofs*.dat`, `USA/` and `savedata/`
   relative to it.
9. **Track and report.** The pid is stored, `exit`/`error` settle the process
   exactly once, `lastExitCode` is updated, and `game:exit` is pushed with the
   row it is attributed to (§4). `game:status` reports `running: false` with the
   last exit code afterwards.
10. **Kill.** `killGame()` clears the tracking first and then terminates: on
    Windows `taskkill /pid <pid> /T /F` (the whole tree, because the games ship
    wrappers that start helpers such as `bio1hd.asi`/`dxcfg.exe`), with
    `process.kill` as the fallback and the only POSIX path. `app:quit` and
    `before-quit` both call it, so a game never outlives the launcher.

`LaunchResult` is a discriminated union: `{ ok: true, pid, executable,
injectedMod }` or `{ ok: false, code, message }`, where `code` is one of
`not-installed`, `not-launchable`, `executable-missing`, `config-unwritable`,
`mod-inject-failed`, `mod-restore-failed`, `spawn-failed`,
`game-already-running`. The renderer turns a failure into the error dialog and a
toast; it never sees an exception.

### Why the game is NOT embedded in the launcher window

The concept draws its Gameplay screen as a 1300x975 card, which reads as "the game runs
inside the launcher". It cannot, and this was measured rather than assumed.

`tools/probe-embed.ps1` launches a real install, finds the game's own top-level window,
reparents it into a host window the size of that card with `SetParent`, strips
`WS_CAPTION`/`WS_THICKFRAME`, fits it to the client area, and then checks whether the
window survived and is still drawing. Run against this machine's RE1 install
(`Biohazard.exe`, the RE-Enhance build), with its loader dialog dismissed:

| Measurement | Result |
|---|---|
| The game's window | class `BIOHAZARD`, title `RESIDENT EVIL® PC`, 1286x989 |
| `SetParent` return | `0x1000C` — and yet `GetParent` is `0` *immediately* after |
| `GetParent` after 5 s | `0` — still top-level |
| Style after re-apply | `0x12CA0000`, i.e. `WS_CAPTION` back, no `WS_CHILD` |
| Watchdog re-applying at 4 Hz for 8 s | `SetParent` re-applied **33 times out of 33 samples**, style likewise |
| Window recreated | 0 times — it does not rebuild the window, it refuses |

So the game re-asserts its own top-level status, caption and geometry in its window
procedure, continuously, without ever recreating the window. It also refuses the
resize: asked for 1300x975 it stays 1280x960. A watchdog cannot win that race, because
the loser of each round is a window that must be usable between rounds — the game would
flicker between embedded and not, and any frame spent as a child of the launcher is a
frame the wrapper may have stopped presenting to.

Two other things the probe established, which shape the launch flow:

- **The first window is not the game.** RE-Enhance's loader opens a `#32770` dialog
  titled "MOD SELECTION" (with a combobox and, on some runs, no standard button) and the
  game only starts once it is dismissed. A launcher that waited for "the main window"
  would wait on a dialog it cannot drive.
- **The retail executable can fail on its own.** `ResidentEvil.exe` — the file
  RE-Enhance did *not* overwrite, per its own `.mod_backup/manifest.txt` — exited with
  `0xC0000409` (a stack-buffer-overrun fast-fail) when started with `BootConfig = 0`.
  That is the game's business, not the launcher's, but it is why ORIGINAL mode on this
  title is reported as-is rather than assumed to work.

The launcher therefore **yields to the game** instead of containing it, and that is what
"press play" does:

1. The spawn succeeds, and main calls `IpcOptions.onGameLaunched` with the configured
   `launchWindowMode`. `minimise` (the default) minimises the window; `stay` leaves it on
   the now-playing surface. `index.ts` owns that window, which is why the hook exists
   rather than `ipc.ts` reaching for a `BrowserWindow` it should not hold.
2. The renderer is already on the Gameplay screen, and the card now carries a **now-playing
   bar**: a red dot, `NOW PLAYING` or `NOT RUNNING`, the row's name, an elapsed `mm:ss`
   counted from `GameStatus.startedAt` (main's clock, so a window reload cannot desync it),
   and a `STOP GAME` button.
3. The bar's `STOP GAME` calls `game:stop`, which runs the same `killGame` that
   `app:quit` does. The status is *not* set to stopped optimistically: main is the only
   thing that knows the process is gone and it answers with `game:exit`.
4. On `game:exit` the window comes back — restored, shown and focused, but only if *this*
   launcher put it aside, so a user who minimised it themselves does not have it pop up
   when a game they started elsewhere ends.

Two details earn their own note:

- **`GameExitEvent.requested`.** The launcher's own kill is `taskkill /F`, i.e. exit code
  1, which is indistinguishable from a crash. Without that flag the renderer reported the
  user's own STOP as "GAME EXITED WITH AN ERROR — RESIDENT EVIL stopped unexpectedly (exit
  code 1)", and the first Escape then dismissed that dialog instead of going back. The live
  spec asserts both halves now: no dialog after STOP, and one Back returns to the list.
- **`GameStatus.startedAt`** is set by main when it spawns, and cleared with the exit. The
  renderer counts from it rather than from its own mount time.

### In-game CRT: what the launcher can and cannot do about it

The launcher draws its CRT filter in its own window, so it has never applied to a game that
renders in its own — and §6 is the measurement showing those windows cannot be reparented or
reliably repositioned. The game's *own* tools can, though, and both live in files the
launcher already writes before every launch:

| Setting | File, section | On | Off | Titles |
|---|---|---|---|---|
| RetroMode | config.ini, [DLL] | 1 |   | all three (RE-Enhance ships it) |
| ScalingMode | dgVoodoo.conf, [General] | stretched_4_3_crt | centered | RE1 only (only its payload ships the file) |

Both are written from the one inGameCrt setting, and both are put back to **the payload's
own defaults** when it is off —   and centered, which is what RE-Enhance and dgVoodoo ship
— so turning the setting off really turns it off rather than leaving a previous launch's
effect in place. The patches are deliberately excluded from the config-unwritable decision:
a retail install has no [DLL] section and no dgVoodoo.conf, and that is not a reason to
refuse to launch it.

**What is not established, and is recorded rather than glossed:** what RetroMode = 1
actually renders. No readme, comment or config in any of the three payloads documents it, and
	ools/probe-crt.ps1 - which launches the game, dismisses the loader dialog and scores the
frame's row-alternation for a scanline signature - found **no measurable difference** between
RetroMode = 0 and RetroMode = 1 (score 0.55 in both). That measurement is weak by
construction: without input automation the only frames reachable are RE1's opening movie, which
is dark (mean 20-28 of 255), and a scanline effect is multiplicative, so a black frame cannot
show one either way. ScalingMode = stretched_4_3_crt has not been measured at all.

So the plumbing is real and verified (unit tests assert the exact rows and values written, in
order, for both the on and off cases); the *visual* result needs one human looking at the game
with the setting on. Treat the feature as unconfirmed until someone does.

### The settings surface

`overlays/Settings.tsx`, reached from a `SETTINGS` row the panel now carries directly above
LAUNCH. The concept has no settings frame, so this is an addition (docs/DESIGN-FIDELITY.md
§7.1), and it is placed behind a panel row rather than a key or a new helper-bar group
specifically so the three designed screens stay pixel-identical at rest.

Twelve rows, all of them live: CRT and its four values, the three volumes, `launchWindowMode`,
the install-root override, re-scan, and reset. There is deliberately no Apply/Cancel pair — a
settings screen that can be left in a state that differs from what is saved is a second, worse
source of truth — so every change goes straight through `config:patch` and the sanitised answer
from main is what the surface then draws. The increments live once, in `SETTINGS_STEP`, because
the store applies the step and the surface renders the readout and two copies of a step size is
exactly how a display ends up disagreeing with the value it shows.

Reset asks twice. The confirmation is local component state rather than a store field: it lives
only as long as the cursor stays on that row, and moving away clears it.

Two details worth naming:

- **`catalog:pick-install-root`** exists so that a "change install folder" action can mean what
  it says. The OS chooser is opened by main, which then writes the override and rebuilds the
  catalog, so a cancelled dialog cannot leave a half-applied setting behind. It also makes the
  Install Status screen's `CHANGE INSTALL FOLDER` label truthful, which it was not before.
- **Rows follow the pointer with `onMouseMove`, not `onMouseEnter`.** Enter fires when a row
  appears *under* a stationary pointer, so opening the surface while the mouse happened to rest
  over it moved the cursor before the first keypress, and the keyboard's first arrow then acted
  on a row nobody chose. A browser only sends `mousemove` for real movement, which is exactly
  the rule wanted. The e2e spec caught this: it asserted a change to the CRT row and the
  diagnostic showed the cursor sitting on `setting-window`.

---

## 7. Mod injection and restore

`mods.ts` overlays `<appDir>/reenhancemods/<modPath>` onto the game's install root
and can put the install back exactly as it was. The legacy `mod_loader.cpp` copied
files and skipped `readme`/`changelog`, but its `RemoveMod` only logged "restore
from backup is not yet implemented"; this is the missing half.

### Injecting

1. Validate the inputs: install root must exist and be a directory, the mod source
   must exist and be a directory, and `modPath` must be a single safe relative
   name (no `..`, no drive letter, no absolute path).
2. If `.mod_backup/manifest.txt` already exists, **undo the previous injection
   first** (`removeMod`) and ignore its progress. This keeps the new backups
   capturing retail originals instead of already-injected files.
3. Walk the source tree twice: once to count (`filesTotal`) and once to act. The
   walk is depth-first with entries sorted by name, so the manifest is
   deterministic. Files whose *name* contains `readme` or `changelog` are skipped
   and are not counted. Directory symlinks/junctions are never entered (`lstat`).
4. Per file, in this order: if the destination exists, copy it to
   `.mod_backup/<same relative path>` (with `COPYFILE_EXCL`, so a backup from an
   earlier crashed run — which is closer to the original — is never overwritten),
   then copy the mod file over it, then append the relative path to the manifest.
5. Flush the manifest every 128 lines and once more on **every** exit path,
   including failure and abort, so whatever was copied is always restorable.
6. `AbortSignal` is honoured between files; an abort returns
   `{ ok: false, message: 'aborted: n of m …' }` with the copies so far still
   described by the manifest.

### Restoring

For every manifest entry: restore from `.mod_backup/<relative>` when a backup
exists, otherwise delete the file (it was mod-only and had nothing to back up),
then remove the whole `.mod_backup` tree. With no manifest, a stray `.mod_backup`
is removed and the call succeeds trivially — that is what lets an interrupted
injection retry. Empty directories left behind by deleted mod-only files are
deliberately **not** pruned: pruning could delete a directory the mod did not
create, and an empty directory is harmless.

### `.mod_backup/manifest.txt`

```
<install root>/
├── .mod_backup/
│   ├── manifest.txt          one install-relative path per line, '/'-separated
│   ├── ResidentEvil.exe      a copy of the retail file that was overwritten
│   └── USA/Data/Rofs1.dat    path mirrored exactly, so restore is a copy back
└── …                          the injected files themselves
```

- UTF-8, LF endings, one relative path per line, POSIX separators.
- No header, no metadata, no version field: the file *is* the list of files the
  injection touched.
- A BOM and CRLF are tolerated on read; blank lines are ignored; every entry is
  re-validated as a safe relative path before it is used, because the manifest is
  user-editable and `removeMod` deletes files.

`hasBackup(installPath)` reports whether `.mod_backup/` exists at all — the
directory, not the manifest — so a run that crashed between its first backup and
the first flush still reads as "not clean".

---

## 8. Files the launcher reads and writes

`paths.ts` is the authority; this table is a map of it.

| Purpose | Path | Written by | Format |
|---|---|---|---|
| Launcher settings | `<userData>/config.json` | `config-store.ts` | JSON, `LauncherConfig` |
| Achievement progress | `<userData>/achievements.sav` | `achievements.ts` | `id=1\|<iso>` lines |
| Log | `<userData>/re-log.txt` | `logger.ts` | `[YYYY-MM-DD HH:MM:SS] [WARN] message` |
| Legacy settings (read only) | `<appDir>/config.ini` | the old launcher | key = value, optional `[section]` |
| Legacy progress (read only) | `<appDir>/achievements.sav` | the old launcher | same as above |
| Achievement definitions | `<appDir>/assets/achievements/achievements.json`, then `<userData>/achievements.json` | shipped + optional user override | `{ "re1": [ … ], "re2": [ … ], "re3": [ … ] }` |
| Game installs | `<appDir>/GOG Games/<gogFolderName>/` | GOG (user-provided) | the retail install |
| RE-Enhance overlays | `<appDir>/reenhancemods/<modPath>/` | the user | the mod's own tree |
| Injection state | `<install root>/.mod_backup/` | `mods.ts` | see §7 |

`<userData>` is Electron's `userData`, i.e. `%APPDATA%\re-classic-collection`
(`name` from `package.json` + Electron's own rule). `<appDir>` is the folder holding
the executable: `dirname(process.execPath)` when packaged — *not*
`process.resourcesPath`, which is one level below and would hide `GOG Games/` — and
the repository root in development.

### Settings keys and defaults

| Key | Type | Default | Meaning |
|---|---|---|---|
| `crtEnabled` | bool | `false` | Draw the CRT overlay |
| `scanlineIntensity` | number | `0.3` | Darkening of each scanline |
| `curvature` | number | `0.08` | Barrel-warp strength (0 disables the warp filter) |
| `crtVignette` | number | `0.35` | Edge darkening |
| `crtGrain` | number | `0.04` | Noise opacity |
| `masterVolume` | number | `1` | Master audio level |
| `sfxVolume` | number | `1` | UI cue level |
| `musicVolume` | number | `1` | Music level (reserved) |
| `lastSelectedTitle` | `TitleId` | `re1` | Which card the main menu opens on |
| `modes` | `{ [versionId]: 'enhanced' \| 'original' }` | `{}` | Per-row launch mode; missing = detected |
| `scenarios` | `{ [versionId]: 'leon' \| 'claire' }` | `{}` | Per-row RE2 scenario; missing = row default |
| `gogPathOverride` | string | `''` | Explicit GOG root; `''` = auto-detect |
| `keepLauncherVisible` | bool | `true` | Keep the window up while a game runs |

Writes are atomic (temp file + rename in the same directory) and a write failure
is logged rather than thrown, so a read-only profile keeps working with the
in-memory value. Unknown keys in the file are dropped on read, and every field is
type-checked: a malformed value falls back to its default instead of propagating.

### Legacy migration, once

`config-store.load()` reads `config.json` first. If it does not exist (or is
unreadable), the legacy `<appDir>/config.ini` is parsed and mapped onto the
defaults, and the JSON is written immediately — so the migration happens exactly
once and later starts never look at the ini again.

| Legacy key (either spelling) | Field | Coercion |
|---|---|---|
| `display.crt_enabled` / `crt_enabled` | `crtEnabled` | `1/true/yes/on` → true, `0/false/no/off` → false |
| `display.scanline_intensity` / `scanline_intensity` | `scanlineIntensity` | `strtof`-like numeric prefix |
| `display.curvature` / `curvature` | `curvature` | same |
| `display.crt_vignette` / `display.vignette` / `vignette` | `crtVignette` | same |
| `display.crt_grain` / `display.noise_amount` / `noise_amount` | `crtGrain` | same |
| `audio.master_volume` / `master_volume` | `masterVolume` | same |
| `audio.sfx_volume` / `sfx_volume` | `sfxVolume` | same |
| `audio.music_volume` / `music_volume` | `musicVolume` | same |
| `game.last_selected` / `last_selected` / `last_selected_title` | `lastSelectedTitle` | only a known title id survives |
| `gog_path_override` / `game.gog_path_override` | `gogPathOverride` | a matching pair of quotes is stripped |
| `keep_launcher_visible` / `display.keep_launcher_visible` | `keepLauncherVisible` | boolean vocabulary |

The achievement store does the same: it reads `<userData>/achievements.sav`; if
that is missing it applies the legacy `<appDir>/achievements.sav` and immediately
writes it to the new location. A save can only ever *set* rows the current
definitions know about — an id from a different catalog is ignored rather than
resurrected.

### Definitions and progress formats

```jsonc
// assets/achievements/achievements.json — the bundled baseline
{
  "re1": [ { "id": "re1_001", "name": "A Member of S.T.A.R.S.", "desc": "Complete the game as Jill on Standard", "icon": "" } ],
  "re2": [ /* … */ ],
  "re3": [ /* … */ ]
}
```

The last *readable* file wins: the bundled JSON, then
`<appDir>/assets/achievements/achievements.json`, then
`<userData>/achievements.json`. An override that cannot be parsed, is not an
object keyed by `re1|re2|re3`, or yields no rows at all is ignored, so a truncated
override can never wipe the catalog.

```
# Resident Evil Classic Collection - achievement progress
re1_001=1|2025-03-04T18:22:09.114Z
re1_002=0|
```

- Line format `id=<flag>|<date>`; flag `1/true/yes` unlocked, `0/false/no` locked.
- A locked row has an empty date; an unlocked row without one is stamped with
  `new Date().toISOString()` when it is read.
- `#` and `;` comment lines, blank lines and malformed rows are skipped; a
  duplicate id keeps the last row.
- Unlocking persists **before** listeners are notified, so quitting right after
  the toast cannot lose the unlock.

---

## 9. Input pipeline

Three sources, one vocabulary, one interpreter:

```
keyboard (events)  ─┐
gamepad  (rAF poll) ─┼─► InputAction (6) ─► store.handleAction ─► resolveIntent ─► intent
mouse    (DOM)      ─┘        ▲                                        │
                     input/actions.ts, useActions, useGamepad          ▼
                                                              the screen's action
```

- **`input/actions.ts` is pure** (no React, no DOM globals, no timers), so every
  rule is unit-testable in the Node test environment.
- **Keyboard**: arrows and WASD are bound by `KeyboardEvent.code` (physical
  position, so WASD keeps its cross shape on AZERTY/QWERTZ), `Enter` and
  `NumpadEnter` confirm, `KeyE` also confirms, `Escape` (and the legacy `Esc`
  spelling) goes back.
- **Gamepad**: standard mapping — D-pad buttons 12–15, button 0 confirm, button 1
  back, plus the left stick through a 0.5 deadzone with rising-edge detection and
  a horizontal tie-break on a diagonal push.
- **Throttling**: keyboard auto-repeat 140 ms, pad 220 ms. Only repeats are
  throttled, never a discrete press, and the two devices are locked apart briefly
  so one gesture cannot arrive twice.
- **`useActions`** composes the keyboard and gamepad halves and is wired **once**,
  by `App.tsx` — a screen that wired it as well would double-dispatch every
  event. It owns the timing rules, suppresses the browser defaults the launcher
  takes over (arrows, Enter) and forwards the canonical action untouched.

The store then decides what an action *means* (`resolveIntent` in `state/store.ts`),
and `handleAction` is the only thing that performs the result — so the rules and
the effects cannot drift apart.

| Screen | Left / Right | Up / Down | Confirm | Back |
|---|---|---|---|---|
| Main menu | move between cards (clamped) | — | open the selected title | quit the launcher |
| Game Version (panel closed) | move rows | move rows (wraps) | open the launch panel | back to the main menu |
| Game Version (panel open) | change the highlighted option | move options | LAUNCH row → start; other rows → change the value | close the panel |
| Gameplay | — | — | — | back to the version list |
| Install Status | — | — | continue to the main menu | — |
| Error dialog | — | — | dismiss | dismiss |

A handled action always plays its cue (`cursor` / `confirm` / `back`); an action
the screen does not answer is silent, because feedback for a keypress that did
nothing would be a lie. While a launch is in flight the panel becomes a readout:
Confirm is inert, Back stays live so the user is never trapped.

---

## 10. The CRT overlay

The concept has no CRT frame — the Figma canvas is flat `#0F0F0F` — so
`overlays/CrtOverlay.tsx` comes from the implementation it replaces, and each
layer is documented against the shader it stands in for
(`git show HEAD:assets/shaders/crt.frag`, `git show HEAD:src/renderer/crt_filter.cpp`).

| Layer | Driven by | Implementation | What the shader did |
|---|---|---|---|
| Scanlines | `scanlineIntensity` | `repeating-linear-gradient`, one dark band per 2 device pixels | `sin(uv.y * resolution.y * PI)` — the same period |
| Phosphor mask | fixed | a finer perpendicular gradient at 8% | a 4-tap blur (`uPhosphorGlow`), which has no cheap DOM counterpart |
| Vignette | `crtVignette` | `radial-gradient`, flat to 55% then darkening to the frame edge | no shader equivalent; only the strength is defined |
| Grain | `crtGrain` | inline `feTurbulence` with a contrast-stretch, jittered by a 900 ms `steps(1,end)` keyframe | hashed `uTime` into per-frame noise |
| Curvature | `curvature` | `feDisplacementMap` driven by two ramps and a radial falloff, at roughly a third of the shader's strength | per-channel displacement of its own framebuffer (`uRGBSplit`), i.e. chromatic aberration |

Two structural facts are worth knowing before touching it:

- The overlay is `fixed inset-0 z-[100]` and `pointer-events-none`. It is not a
  render pass and it never participates in layout; because the stage is a
  transformed element, `fixed` still tracks it.
- Grain sits **outside** the warp filter on purpose: displacing a static noise
  field changes nothing visible, and nesting a full-stage turbulence filter inside
  a displacement filter doubles the cost of the only animated part.
- Chromatic aberration is the one effect that is simply not reproduced: three
  full-stage filters per frame would be prohibitively expensive and ruinous for
  text rendering.

---

## 11. Build, test and guards

| Command | What it runs |
|---|---|
| `pnpm dev` | `electron-vite dev` — main, preload and renderer with HMR |
| `pnpm compile` | `electron-vite build` into `out/` |
| `pnpm typecheck` | `tsc -p tsconfig.node.json`, `tsconfig.web.json` and `tsconfig.e2e.json` |
| `pnpm test` | `vitest run`, Node environment, `src/**/*.test.ts` and `tools/**/*.test.mjs` |
| `pnpm test:e2e` | `pnpm compile` then `playwright test` over `tests/e2e/`: `geometry.spec.ts` (design measurements), `interaction.spec.ts` (keyboard + gamepad flow), `fonts.spec.ts` (the design's font families actually resolve) |
| `pnpm check:fidelity` | `node tools/check-fidelity.mjs` — the design-drift guard |
| `pnpm build` | typecheck, compile, then `electron-builder --win` (NSIS + portable) |
| `pnpm build:dir` | compile, then an unpacked build in `release/` |

Two design decisions in the build are load-bearing:

- `electron.vite.config.ts` rewrites the export's `figma:asset/<hash>.png`
  specifiers to the copied design assets, so the vendored Figma JSX is never
  edited. `tools/sync-design-assets.mjs` writes the map it resolves through
  (`src/renderer/src/assets/design-map.json`).
- Vite emits design art as real files under `art/`, videos under `video/`, fonts
  under `font/` and audio under `audio/` with stable names, so a packaged build can
  be inspected and the fidelity tooling can address the same files.

**The design export is not in this repository**, and neither `tsconfig` project covers it.
It is the author's working material from the design tool: verbatim export output that
imports `figma:asset/…` specifiers and uses `React.CSSProperties` casts which would fail a
strict typecheck. It sits at `.ref/designref/` (gitignored) as a *reference*, never as a
dependency — the app imports nothing from it, and `pnpm check:fidelity` is the only thing
that reads it. In a clone that guard reports that it verified nothing, rather than passing
quietly: see `docs/DESIGN-FIDELITY.md` §1.
