# Resident Evil Classic Collection — Launcher Architecture

---

## 1. Overview

A standalone C++11 launcher/frontend for the GOG Resident Evil Bundle, inspired by the
Metal Gear Solid Master Collection UI and built on the **powerslave_ex** low-level framework.
Provides game version selection, installation validation, CRT post-processing, and a unified
achievement overlay across all three titles.

---

## 2. Repository Layout

```
re-classic-collection/
├── CMakeLists.txt
├── vcpkg.json                    # optional: vcpkg manifest
├── extern/
│   ├── powerslave_ex/            # submodule — base KEX-style engine
│   ├── angelscript/              # optional scripting
│   ├── openal-soft/              # optional audio
│   └── agar/                     # optional UI debug toolkit
├── src/
│   ├── main.cpp
│   ├── core/
│   │   ├── app.h / app.cpp       # App lifecycle, main loop
│   │   ├── thread.h              # Worker + render thread split
│   │   ├── platform.h            # Platform abstraction (Win32/Linux/macOS)
│   │   └── debug_draw.h          # KEX-style shape debug renderer
│   ├── renderer/
│   │   ├── renderer.h            # Abstract render interface
│   │   ├── gl_renderer.cpp       # OpenGL 3.3 backend
│   │   ├── render_target.h       # RT cache system
│   │   └── crt_filter.h/cpp      # CRT post-process pass
│   ├── input/
│   │   └── input_manager.h/cpp   # KB + mouse + gamepad (SDL2 / raw HID)
│   ├── audio/
│   │   └── audio_system.h/cpp    # OpenAL or XAudio2 wrapper
│   ├── ui/
│   │   ├── ui_system.h/cpp       # Custom retained-mode UI
│   │   ├── screens/
│   │   │   ├── screen_title.h       # "Classic Collection" cover select
│   │   │   ├── screen_version.h     # Version picker (RE1 / BioHazard / DC)
│   │   │   ├── screen_launch.h      # Pre-launch options + CRT toggle
│   │   │   ├── screen_install.h     # First-run install checker
│   │   │   └── screen_error.h       # Error / missing game state
│   │   └── components/
│   │       ├── game_card.h          # Cover thumbnail + hover effect
│   │       ├── version_row.h        # Banner row (RE / BioHazard / DC)
│   │       ├── sidebar_title.h      # Vertical "RESIDENT EVIL 2" label
│   │       └── achievement_hud.h    # In-overlay achievement popup
│   ├── games/
│   │   ├── game_entry.h          # Data model for a launchable version
│   │   ├── game_catalog.h/cpp    # Registry of all entries + validation
│   │   ├── game_launcher.h/cpp   # Process spawn + env inject
│   │   └── mod_loader.h/cpp      # REEnhance mod injection logic
│   ├── achievements/
│   │   ├── achievement_db.h/cpp  # JSON-backed achievement definitions
│   │   ├── achievement_hook.h    # IPC / memory-hook interface per game
│   │   └── achievement_overlay.h # Popup renderer (non-blocking)
│   ├── install/
│   │   ├── gog_detector.h/cpp    # Detect GOG install paths (registry/config)
│   │   └── install_validator.h/cpp # Per-game file manifest checker
│   └── config/
│       ├── config.h/cpp          # INI / JSON user config persistence
│       └── paths.h               # Platform path helpers
├── assets/
│   ├── fonts/
│   ├── textures/                 # UI panels, cover art (from GOG install)
│   ├── shaders/
│   │   ├── crt.vert / crt.frag   # CRT scanline + curvature shader
│   │   └── ui.vert  / ui.frag    # Textured quad UI shader
│   └── achievements/
│       └── achievements.json
└── docs/
    └── ARCHITECTURE.md
```

---

## 3. Core Systems

### 3.1 App Lifecycle (`core/app.h`)

```
App::Init()
  └─ Platform::Init()       — window, GL context
  └─ Renderer::Init()
  └─ InputManager::Init()
  └─ AudioSystem::Init()
  └─ GameCatalog::Load()    — scan GOG paths, validate installs
  └─ UISystem::PushScreen(screen_install OR screen_title)

App::Run()                  — main loop (capped 60 fps)
  ├─ [Thread: Logic]  UISystem::Update() + InputManager::Poll()
  └─ [Thread: Render] Renderer::BeginFrame()
                      UISystem::Draw()
                      CRTFilter::Apply()   (if enabled)
                      Renderer::EndFrame()
```

### 3.2 Render Target Cache

Frames are rendered to an internal RT at the target game's native resolution
(typically 640×480 or 1280×720), then upscaled and passed through the CRT
post-process before blit to the swap-chain. The RT cache holds:
- `RT_UI`       — main UI compositing surface
- `RT_GAME_PRE` — pre-process game capture (future)
- `RT_FINAL`    — post-CRT output

### 3.3 CRT Filter (`renderer/crt_filter.h`)

Configurable parameters exposed in the launcher settings:

| Parameter        | Default | Description                        |
|------------------|---------|------------------------------------|
| `scanlineIntensity` | 0.3  | Darkness of scanline bands         |
| `curvature`         | 0.08 | Screen-edge barrel distortion      |
| `rgbSplit`          | 0.002| Chromatic aberration offset        |
| `phosphorGlow`      | 0.15 | Additive glow bloom strength       |
| `noiseAmount`       | 0.02 | Per-frame grain                    |
| `enabled`           | false| Master toggle                      |

---

## 4. Game Catalog & Versions

### 4.1 Game Entry Model

```cpp
struct GameVersion {
    std::string id;           // "re1_us", "re1_jp_biohazard", "re1_dc"
    std::string displayName;  // "RESIDENT EVIL", "BIO HAZARD", "DIRECTOR'S CUT"
    std::string region;       // "US", "JP"
    std::string releaseDate;  // "30 MARCH 1996"
    std::string execRelPath;  // relative path from install root to .exe
    std::string voices;       // "ENGLISH"
    std::string subtitles;    // "ENGLISH"
    bool        hasMod;       // REEnhance available
    std::string modPath;      // path to REEnhance dll/patch
    InstallState state;       // INSTALLED | MISSING | PARTIAL
};

struct GameTitle {
    std::string           id;       // "re1", "re2", "re3"
    std::string           name;
    std::string           coverTex;
    std::vector<GameVersion> versions;
};
```

### 4.2 Titles & Versions (from GOG Bundle)

**Resident Evil 1**
- `re1_us`           — Resident Evil (July 24 1998 PC port)
- `re1_jp_biohazard` — Bio Hazard (Sega Saturn JP)
- `re1_dc`           — Resident Evil Director's Cut

**Resident Evil 2**
- `re2_us`           — Resident Evil 2 (Sept 29 1998)
- `re2_jp`           — Bio Hazard 2
- `re2_15`           — Bio Hazard 1.5 (prototype, if bundled)

**Resident Evil 3**
- `re3_us`           — Resident Evil 3: Nemesis (Nov 11 1999)
- `re3_jp`           — Bio Hazard 3: Last Escape

---

## 5. Installation Checker (First Run)

On first launch, `screen_install` is shown before the title screen.

```
InstallValidator::CheckAll()
  for each GameTitle in catalog:
    for each GameVersion:
      ├─ GOGDetector::FindInstallPath(gogGameId)   — registry / GOG DB
      ├─ Validate file manifest (SHA1 spot-check on key EXEs/assets)
      └─ Set InstallState: INSTALLED / MISSING / PARTIAL

Results displayed per-game with status icons:
  ✓  INSTALLED      — green, playable
  ⚠  PARTIAL        — yellow, some files missing, may still work
  ✗  NOT INSTALLED  — red, card greyed out, "Purchase on GOG" link shown
```

The user can re-run the check at any time from Settings.

---

## 6. Error States

| State                  | UI Behavior                                              |
|------------------------|----------------------------------------------------------|
| Game not installed     | Card greyed, padlock icon, tooltip with GOG store link   |
| Executable not found   | `screen_error` overlay: path shown, re-check button      |
| Mod files missing      | Warning banner on version row, "Play without mod" option |
| Launch failure         | `screen_error`: process exit code + log snippet          |
| Config file corrupt    | Auto-reset config, notify user                           |

---

## 7. REEnhance Mod Integration (`games/mod_loader.h`)

REEnhance for RE1/2/3 ships as a DLL or file patch overlay.

```
ModLoader::Inject(GameVersion& ver, LaunchContext& ctx)
  ├─ Verify mod files present (hash check)
  ├─ Copy/symlink mod DLLs alongside game exe  OR
  ├─ Use DLL injection via CreateRemoteThread (Windows)
  │   └─ Cross-platform: LD_PRELOAD on Linux
  └─ Pass mod config flags via env vars or INI placed next to exe
```

Launcher settings expose a per-version toggle: **Enhanced (REEnhance) / Original**.

---

## 8. Achievement System

### 8.1 Achievement DB (`achievements/achievements.json`)

```json
{
  "re1": [
    { "id": "re1_finish_jill", "name": "S.T.A.R.S. Member",
      "desc": "Complete RE1 as Jill Valentine", "icon": "jill_badge.png" },
    ...
  ]
}
```

### 8.2 Hook Strategy

The original PS1/PC games don't expose an SDK, so achievements are tracked via:

- **Memory polling** — attach to game process, poll known addresses
  (community-documented RAM maps for each version)
- **Save file parsing** — detect completion flags in save data on game exit
- **IPC pipe** — if REEnhance mod exposes an event pipe, listen for events

### 8.3 Overlay

A non-blocking `achievement_overlay` renders in the launcher's own window
when the game runs in windowed mode or on a secondary layer. The popup mimics
the original PS trophy style with a fade-in/out animation (300 ms).

---

## 9. Input

| Device   | Backend              |
|----------|----------------------|
| Keyboard | SDL2 scancode events |
| Mouse    | SDL2 relative motion |
| Gamepad  | SDL2 GameController API (XInput fallback on Win32) |

Navigation mirrors the Figma UI: D-pad / arrow keys select cards,
Enter/A confirms, Esc/B goes back, matching the on-screen hints shown in your UI.

---

## 10. Build System

```cmake
cmake_minimum_required(VERSION 3.16)
project(REClassicCollection CXX)
set(CMAKE_CXX_STANDARD 11)

find_package(SDL2   REQUIRED)
find_package(OpenGL REQUIRED)
find_package(OpenAL OPTIONAL_COMPONENTS)

add_subdirectory(extern/powerslave_ex)

add_executable(re-launcher
    src/main.cpp
    src/core/app.cpp
    src/renderer/gl_renderer.cpp
    src/renderer/crt_filter.cpp
    src/input/input_manager.cpp
    src/ui/ui_system.cpp
    src/games/game_catalog.cpp
    src/games/game_launcher.cpp
    src/games/mod_loader.cpp
    src/achievements/achievement_db.cpp
    src/install/gog_detector.cpp
    src/install/install_validator.cpp
    src/config/config.cpp
)

target_link_libraries(re-launcher
    PRIVATE powerslave_ex SDL2::SDL2 OpenGL::GL
    $<$<BOOL:${OPENAL_FOUND}>:OpenAL::OpenAL>
)
```

---

## 11. Platform Notes

| Platform | Notes |
|----------|-------|
| Windows  | Primary target. Win32 process spawn, registry GOG detection, XAudio2 optional |
| Linux    | GOG Galaxy config fallback, LD_PRELOAD mod inject, ALSA/PulseAudio via OpenAL |
| macOS    | Wine wrapper for game processes; CoreAudio via OpenAL |

---

## 12. Milestones

| # | Milestone                          | Deliverable                          |
|---|------------------------------------|--------------------------------------|
| 1 | Engine bootstrap                   | Window + GL + input loop running     |
| 2 | UI system + title screen           | Cover card navigation functional     |
| 3 | GOG detector + install checker     | First-run screen with real statuses  |
| 4 | Version picker + game launcher     | Can launch RE1/2/3 from UI           |
| 5 | REEnhance mod integration          | Toggle enhanced/original per version |
| 6 | CRT filter                         | Shader pass with settings screen     |
| 7 | Achievement system (memory hooks)  | Popup overlay for RE1/2/3            |
| 8 | Polish + error states              | All error paths covered              |