# Local release gates

Status: **NOT RELEASE READY**. Passing fixture tests does not satisfy owned-game, hardware, remapping, or soak requirements.

## Automated checks

Run with Node 24+, pnpm 11.4.0, CMake and the MSVC x86 toolchain:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build:overlay
pnpm test
pnpm check:fidelity --strict
pnpm test:e2e
pnpm build
```

`build` creates unsigned local NSIS and portable artifacts and never publishes. Test-generated files belong in `test-results*`, not the release. CI runs fixture E2E only; proprietary games/mods are not uploaded.

## Owned-game matrix

Close games before testing. These tests launch owned binaries and exercise real mod injection/restoration. Back up saves and configuration before a broad installation matrix. No game files are downloaded.

```powershell
$env:RE_LIVE_LAUNCH = '1'
$env:RE_LIVE_CYCLES = '10'
pnpm exec playwright test tests/e2e/live-launch.spec.ts --output=test-results-live
```

Optional `RE_LIVE_CASE` accepts `re1-main-original`, `re1-main-enhanced`, `re2-leon-original`, `re2-leon-enhanced`, `re2-claire-original`, `re2-claire-enhanced`, `re3-main-original`, or `re3-main-enhanced`. `RE_LIVE_CYCLES=1` is a smoke check, never ten-cycle acceptance. Unset these variables after a run. Missing installation data fails an enabled case; filtering or disabling cases is reported as skipped.

The matrix asserts live game windows, observed D3D9 presents in Enhanced mode, stop completion, and repeated launches. Screenshots refuse capture when the game is not foreground. Captured menus or intro footage do not prove playable gameplay. The launcher Stop button terminates the process; additionally verify a normal exit through each game's menu.

`pnpm probe:overlay -- -Dir <install> -Exe <executable>` is the standalone overlay probe. Its `-Inspect` flag reports windows without drawing evidence; `-WaitSeconds` controls the startup observation window. The synthetic test host accepts `--plugin <asi-path> --d3d9 --window --seconds <seconds> --delay <milliseconds> --frames <count>`. It has no `--output` option. `RE_OVERLAY_CAPTURE=1` captures composed cards under the temporary overlay directory; `RE_OVERLAY_LOG=1` enables native logs. Synthetic tests are not owned-game evidence.

`RE_LIVE_VERIFY_DISPLAY=1` asserts RE3 client geometry while cycling the four window sizes. Blank screenshots are rejected using image entropy. Enhanced capture reads the D3D9 render target with RE_GAME_FRAME_CAPTURE=1; it does not depend on desktop focus. This diagnostic is off during normal play.

## Manual gates (all required)

- RE1, RE2 Leon, RE2 Claire and RE3: reach actual gameplay, move, interact, save/load, exit normally, relaunch. Repeat for every advertised launch mode.
- RE1 repair: follow the RE-Enhance payload readme's Japanese GOG installation requirement. Verify through GOG; then re-detect. Do not rename/copy unrelated localisation folders as a substitute.
- RE3 display: select each offered size, launch, measure the client rectangle, disable the override, and verify the captured original value returns. Fullscreen remains unavailable until measured separately.
- Native remapping: change one action through the game's configuration, capture the before/after bytes, restart, and verify the action. Repeat across keyboard, controller, title, mode and RE2 scenario. Only then expose direct action slots.
- Real controller: navigation, hot-plug, reconnect, focus, confirm/back, remapped prompts and native gameplay controls.
- Each title: two hours of actual play, recording start/end, crashes, overlay behavior, memory growth, focus recovery and save integrity. A sleeping launcher is not soak evidence.
- Close the launcher during preparation and during gameplay; verify no orphaned processes, readable backup manifests, and recoverable configuration.
- Screens: 1280×720, 1920×1080, 150% system DPI, multiple monitors, reduced motion, keyboard-only operation, dialog containment and focus return.
- Install and launch the unsigned package on clean Windows; then perform a game smoke test on a second PC. Record GPU, monitor and Windows version.
- Review bundled assets, RA attribution and DISCLAIMER.md before distributing. This is an unofficial, non-commercial launcher requiring owned games.

Record pass/fail plus evidence for every gate. Any missing gate keeps the release blocked. No signing, updater, platform trophies or cloud services are included.
