# Resident Evil - Classic Collection

A standalone C++11 launcher/frontend for the GOG Resident Evil Classic Bundle (RE1, RE2, RE3). Inspired by the Metal Gear Solid Master Collection UI, this launcher provides a unified interface for launching all three classic Resident Evil titles with optional RE-Enhance mod support.

**Fan Concept by Julio CACKO**

---

## Features

- **Unified Game Selection** -- Browse all three Resident Evil titles from a single polished interface with animated card selection and dark grunge aesthetic
- **Version Picker** -- Choose between regional variants (US, JP, Director's Cut) for each title with hero artwork and game descriptions
- **RE-Enhance Mod Integration** -- Toggle between original and enhanced modes with automatic mod file injection and correct executable switching
- **CRT Post-Processing** -- Optional scanline + curvature + chromatic aberration shader for authentic retro feel
- **Achievement System** -- JSON-backed achievement definitions with save progress tracking
- **GOG Auto-Detection** -- Automatically finds GOG installations via Windows registry
- **Gamepad Support** -- Full controller navigation with on-screen button hints
- **Smooth Animations** -- Fade-in transitions, card scale effects, glow interpolation, and SmoothStep screen transitions

---

## Requirements

### Build Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| CMake | >= 3.16 | Build system |
| SDL2 | latest | Window, input, audio backend |
| OpenGL | 3.3+ | GPU rendering |
| vcpkg | latest | Package manager (optional) |
| MSVC / GCC / Clang | C++11 | Compiler |

### Runtime Dependencies (Not Included in Repository)

The following are **not included** in this repository due to copyright and must be provided by the user:

- **GOG Resident Evil Bundle** -- Install RE1, RE2, RE3 via GOG. Place installs in a `GOG Games/` folder next to the launcher, or let the launcher auto-detect via the Windows registry.
- **RE-Enhance mods** (optional) -- Download from their respective sources and place in a `reenhancemods/` folder next to the launcher.

---

## Building

### Windows (MSVC + vcpkg)

```bash
# Clone the repository
git clone <repo-url> "Resident Evil - Classic Collection"
cd "Resident Evil - Classic Collection"

# Configure with vcpkg toolchain
cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=[vcpkg-root]/scripts/buildsystems/vcpkg.cmake

# Build
cmake --build build --config Release
```

The output executable is at `build/Release/re-launcher.exe`.

### Windows (Visual Studio)

1. Open the project folder in Visual Studio
2. CMake will auto-configure via `CMakeLists.txt`
3. Select `re-launcher` as the startup target
4. Build and run (F5)

### Linux

```bash
# Install dependencies
sudo apt install libsdl2-dev libgl-dev

# Build
cmake -B build -S .
cmake --build build
```

---

## What's in the Repository

```
Resident Evil - Classic Collection/
|-- CMakeLists.txt              # Build configuration
|-- vcpkg.json                  # vcpkg manifest (SDL2)
|-- .gitignore                  # Excludes copyrighted / generated content
|-- README.md                   # This file
|-- ref.md                      # Architecture reference document
|
|-- src/                        # All launcher source code (C++11)
|   |-- main.cpp                # Entry point
|   |-- core/                   # App lifecycle, platform, logging
|   |   |-- app.cpp/h           # Main loop (60fps, SDL event pump)
|   |   |-- platform.cpp/h      # SDL2 window + OpenGL 3.3 context
|   |   |-- log.cpp/h           # Debug logging to file/stdout
|   |   +-- types.h             # Common types, color macros, design constants
|   |-- renderer/               # OpenGL 3.3 rendering backend
|   |   |-- renderer.cpp/h      # Quad drawing, textures, border, inner glow
|   |   |-- shader.cpp/h        # GLSL shader program management
|   |   |-- texture.cpp/h       # Image loading via stb_image
|   |   |-- render_target.cpp/h # FBO render targets (RT_UI, RT_FINAL)
|   |   +-- crt_filter.cpp/h    # CRT scanline post-process shader
|   |-- input/                  # Input handling
|   |   +-- input_manager.cpp/h # Keyboard + gamepad via SDL2
|   |-- audio/                  # Sound system
|   |   +-- audio_system.cpp/h  # WAV playback for UI sound effects
|   |-- ui/                     # User interface
|   |   |-- ui_system.cpp/h     # Screen stack manager (push/pop/replace)
|   |   |-- ui_screen.h         # Base screen interface (virtual methods)
|   |   |-- ui_element.cpp/h    # UI element base class
|   |   |-- font.cpp/h          # TTF font rendering via stb_truetype
|   |   |-- screens/
|   |   |   |-- screen_title.*     # Main menu -- 3-card game selection
|   |   |   |-- screen_version.*   # Version picker (US/JP/DC variants)
|   |   |   |-- screen_launch.*    # Launch options (mode + CRT toggle)
|   |   |   |-- screen_install.*   # First-run installation status
|   |   |   +-- screen_error.*     # Error overlay dialog
|   |   +-- components/
|   |       |-- game_card.*        # Cover art card with glow effect
|   |       |-- version_row.*      # Version selection row
|   |       |-- sidebar_title.*    # Sidebar label
|   |       |-- input_hints.*      # Bottom bar key/button hints
|   |       +-- achievement_hud.*  # Achievement popup renderer
|   |-- games/                  # Game management
|   |   |-- game_catalog.cpp/h  # Game/version registry with all metadata
|   |   |-- game_entry.h        # GameVersion + GameTitle data models
|   |   |-- game_launcher.cpp/h # Process spawning (CreateProcess / fork)
|   |   +-- mod_loader.cpp/h    # RE-Enhance mod file copy/injection
|   |-- install/                # Installation detection
|   |   |-- gog_detector.cpp/h  # GOG registry/config path lookup
|   |   +-- install_validator.* # File manifest validation
|   |-- achievements/           # Achievement system
|   |   |-- achievement_db.*    # JSON achievement definitions + progress
|   |   |-- achievement_hook.*  # Memory/save file hooks per game
|   |   +-- achievement_overlay.* # Non-blocking popup renderer
|   +-- config/                 # Configuration
|       |-- config.cpp/h        # INI config persistence
|       +-- paths.cpp/h         # Cross-platform path helpers
|
|-- assets/                     # Runtime assets (shipped with build)
|   |-- shaders/
|   |   |-- ui.vert / ui.frag   # Textured-quad UI shader
|   |   +-- crt.vert / crt.frag # CRT post-process shader
|   |-- fonts/                  # Actor font (OFL license)
|   +-- achievements/
|       +-- achievements.json   # Achievement definitions for RE1/2/3
|
|-- media/                      # UI images (cover art, logos, backgrounds)
|   +-- main_bg.png             # Dark grunge background texture
|
+-- extern/                     # Vendored third-party (header-only / small)
    |-- glad/                   # OpenGL 3.3 loader
    |-- stb/                    # stb_image + stb_truetype
    +-- nlohmann/               # JSON for Modern C++
```

### Not in the Repository (`.gitignore`)

These folders are excluded from version control and must be provided locally:

| Folder | Reason | How to Obtain |
|--------|--------|---------------|
| `GOG Games/` | Copyrighted game installs | Purchase and install from GOG.com |
| `.ref/` | Third-party reference code (powerslave_ex, design mockups) | Internal development reference |
| `.agent/` | AI agent transcripts | Auto-generated during development |
| `reenhancemods/` | Copyrighted mod binaries | Download from mod authors |
| `build/` | CMake build output | Generated by `cmake --build` |
| `vcpkg_installed/` | vcpkg package cache | Generated by vcpkg |

---

## Game Catalog

### Resident Evil 1

| Version | Executable | Region | Release Date | Mod Support |
|---------|-----------|--------|--------------|-------------|
| Resident Evil | `ResidentEvil.exe` | US | July 24, 1998 | RE-Enhance v1.1 |
| Bio Hazard | `Biohazard.exe` | JP | March 22, 1996 | -- |
| Director's Cut | `ResidentEvil.exe` | US | September 25, 1997 | RE-Enhance v1.1 |

### Resident Evil 2

| Version | Executable | Region | Release Date | Mod Support |
|---------|-----------|--------|--------------|-------------|
| Resident Evil 2 | `LeonU.exe` | US | September 29, 1998 | RE-Enhance v2.0.1 |
| Bio Hazard 2 | `LeonU.exe` | JP | January 29, 1998 | -- |

### Resident Evil 3

| Version | Executable | Region | Release Date | Mod Support |
|---------|-----------|--------|--------------|-------------|
| Resident Evil 3 | `ResidentEvil3.exe` | US | September 27, 1998 | RE-Enhance v2.2 |
| Bio Hazard 3: Last Escape | `ResidentEvil3.exe` | JP | November 11, 1999 | -- |

### RE-Enhance Mod Executables

When enhanced mode is active, the launcher uses different executables as required by the mods:

| Game | Standard Executable | Enhanced Executable |
|------|--------------------|--------------------|
| RE1 | `ResidentEvil.exe` | `Biohazard.exe` |
| RE2 | `LeonU.exe` | `Resident Evil 2.exe` |
| RE3 | `ResidentEvil3.exe` | `BIOHAZARD(R) 3 PC.exe` |

---

## Controls

| Action | Keyboard | Gamepad |
|--------|----------|---------|
| Navigate | Arrow Keys / WASD | D-Pad / Left Stick |
| Confirm | Enter / E | A |
| Back | Escape | B |
| Change Option | Left / Right | D-Pad Left / Right |

---

## Configuration

Settings are stored in `config.ini` next to the executable:

```ini
[display]
crt_enabled=0
scanline_intensity=0.3
curvature=0.08

[audio]
master_volume=1.0

[game]
last_selected=re1
```

---

## RE-Enhance Mod Setup

1. Download the RE-Enhance mods for your games from their official sources:
   - [RE1 -- Classic REbirth](https://classicrebirth.com/index.php/downloads/resident-evil-classic-rebirth/)
   - [RE2 -- Classic REbirth](https://classicrebirth.com/index.php/downloads/resident-evil-2-classic-rebirth/)
   - [RE3 -- Classic Rebirth](https://classicrebirth.com/index.php/downloads/resident-evil-3-classic-rebirth/)
2. Place them in a `reenhancemods/` folder next to the launcher with these exact directory names:
   - `RE-ENHANCE_RE1_v1.1_GOG/`
   - `RE-ENHANCE_RE2_v2.0.1_GOG/`
   - `RE-ENHANCE_RE3_v2.2_GOG/`
3. In the launcher, select a game version and set **Mode** to **ENHANCED**
4. The launcher will automatically:
   - Copy mod files into the game install directory
   - Launch the correct mod-specific executable

> **Note:** RE-Enhance for RE2 and RE3 requires the GOG games to be installed with the **Japanese language option**. See each mod's readme for details.

---

## Architecture

The launcher follows a singleton-based architecture inspired by the KEX engine (powerslave_ex):

| System | Responsibility |
|--------|---------------|
| **App** | Main lifecycle: Init -> Run (60fps capped loop) -> Shutdown |
| **Platform** | SDL2 window creation + OpenGL 3.3 context |
| **Renderer** | Orthographic 2D rendering at 1920x1080 design resolution, FBO-based upscale |
| **UISystem** | Screen stack with push/pop/replace + per-screen input/update/draw |
| **InputManager** | Unified keyboard + gamepad input with navigation helpers |
| **AudioSystem** | WAV sound effect playback via SDL2 audio |
| **GameCatalog** | Registry of all game titles, versions, and install paths |
| **GOGDetector** | Windows registry lookup for GOG install paths |
| **ModLoader** | File-copy mod injection from `reenhancemods/` to game directory |
| **AchievementDB** | JSON-backed achievement definitions with binary save progress |

### Render Pipeline

```
App::Run()  (60fps)
  |
  +-- InputManager::Poll()
  +-- UISystem::Update(dt)        -- animations, transitions
  +-- AchievementOverlay::Update(dt)
  |
  +-- Renderer::BeginFrame()
  |     +-- Bind RT_UI (1920x1080 FBO)
  |     +-- glClear
  |
  +-- UISystem::Draw()            -- all screens in stack order
  +-- AchievementOverlay::Draw()
  |
  +-- Renderer::EndFrame()
  |     +-- CRTFilter::Apply()    -- RT_UI -> RT_FINAL (if enabled)
  |     +-- glBlitFramebuffer     -- upscale to window resolution
  |
  +-- Platform::SwapBuffers()
```

---

## Media Assets

The `media/` folder should contain UI images referenced by the launcher. Currently included:

- `main_bg.png` -- Dark grunge background texture used on all screens

The following are referenced by the game catalog but must be provided by the user (from GOG install artwork or custom assets):

| File | Used By |
|------|---------|
| `mainlogo.png` | Title screen header logo |
| `game_re1_version_default.png` | RE1 cover card + hero image |
| `game_re1_version_jp.png` | Bio Hazard hero image |
| `game_re1_version_alt.png` | Director's Cut hero image |
| `game_re2_version_default.png` | RE2 cover card + hero image |
| `game_re2_version_jp.png` | Bio Hazard 2 hero image |
| `game_re3_version_default.png` | RE3 cover card + hero image |
| `game_re3_version_jp.png` | Bio Hazard 3 hero image |
| `RE1Logo.png` | RE1 game logo (version picker) |
| `game_2_type_default.png` | RE2 game logo (version picker) |
| `game_3_type_default.png` | RE3 game logo (version picker) |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Game not detected | Verify GOG installation; check `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\{id}` registry keys |
| RE2/RE3 opens settings dialog | Update to latest code -- launcher now uses game executables directly (`LeonU.exe`, `ResidentEvil3.exe`) instead of GOG's config launchers |
| Mods not loading | Ensure `reenhancemods/` folder is next to the launcher exe with correct subfolder names |
| Enhanced mode wrong exe | The launcher switches to mod-specific executables (`Biohazard.exe`, `Resident Evil 2.exe`, `BIOHAZARD(R) 3 PC.exe`) automatically |
| Black screen on launch | Verify OpenGL 3.3 driver support; check that `assets/shaders/` contains `ui.vert`, `ui.frag` |
| Missing cover art | Place game cover/hero images in `media/` folder (see Media Assets section above) |
| No sound effects | Place WAV files in `assets/audio/` (`DECIDE.wav`, `Cancel (2).wav`, `CURSOR (2).wav`) |
| Build fails on vcpkg | Run `vcpkg install sdl2:x64-windows` or use the manifest mode with `-DCMAKE_TOOLCHAIN_FILE` |

---

## Credits

- **Concept & Development**: Julio CACKO
- **RE-Enhance Mods**: Classic REbirth, Seamless HD Project, TeamX HD
- **Engine Reference**: powerslave_ex (KEX engine)
- **Games**: CAPCOM CO., LTD. 1996-1999

---

## License

This is a fan project / concept. Resident Evil is a registered trademark of CAPCOM CO., LTD.
All game assets, trademarks, and copyrighted content belong to their respective owners.
This repository contains only the launcher source code and does not distribute any copyrighted game files.
