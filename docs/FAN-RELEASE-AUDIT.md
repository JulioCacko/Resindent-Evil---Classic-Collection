# Fan release audit

This ledger tracks the supplied audit against the current implementation. Runtime evidence is not inferred from compilation, a live process, a pipe handshake, or fixture tests. No release is approved by this document.

| Item | Status | Disposition |
|---|---|---|
| 1 RE1 end-to-end | Awaiting runtime evidence | Payload instructions require the Japanese GOG installation. This checkout has Japanese movies but no `jpn/Data`. Repair guidance is shown; no files are downloaded or relabelled. The owner elected to keep RE1 blocked on 2026-09-28. |
| 2 RE2 launcher path | Awaiting runtime evidence | Live matrix includes Leon and Claire in Original and Enhanced modes. |
| 3 RE2 resolution | Confirmed limitation | No external resolution control is advertised as working. Native configuration route is available with RE-Enhance. |
| 4 RE3 fullscreen | Resolved by removal | Forced mode 4 was removed. Fullscreen remains hidden until window-style and geometry evidence exists. |
| 5 Automatic achievements | Resolved disclosure | Automatic launch milestones and manual checklist totals are distinguished. Milestones are awarded after successful spawn, not before. Gameplay completion is not detected. |
| 6 Unique achievement artwork | Deferred | Existing local artwork/fallbacks remain. No invented badge art or new licensing dependencies. |
| 7 Platform integration | Deferred | No Steam trophy sync or cloud saves. Existing local progress is retained. |
| 8 Original overlay | Deferred | Enhanced-mode D3D9 is the documented supported boundary. |
| 9 DXGI overlay | Deferred | Not included in this release target. |
| 10 Display UI | Partially resolved | Per-title pages and reversible RE3 window-size overrides implemented. Prior measurements support 640×480, 960×720, 1280×960 and 1600×1200. New launcher-driven geometry evidence is still required. |
| 11 Game CRT | Resolved by hiding | Removed from normal settings; live Enhanced launches do not enable it. Launcher-only CRT remains. |
| 12 Test knobs | Resolved | Commands and evidence limits documented in RELEASE-GATES.md. |
| 13 Repair flow | Resolved | First-run review, store verification guidance, settings link and re-detection controls. |
| 14 Localization | Deferred | English-first release. |
| 15 Defaults review | Resolved | First-run installation/defaults review, persisted acknowledgement. |
| 16 Relaunch flake | Awaiting runtime evidence | Fixed stale renderer exit state and premature process untracking. Stop ownership now belongs to each process. Ten-cycle acceptance remains required. |
| 17 Overlay startup | Resolved | Ten-second cancellable transport deadline; stale sessions and old sockets cannot reactivate ended games. Connection and rendering are separate states. |
| 18 Undrawn notifications | Resolved | Queues capped at 32; native notifications expire after 30 seconds without rendering. Delivery requires frame-counter evidence. Saved progress is untouched. |
| 19 Dialog ownership | Resolved | Removed duplicate App launch panel and three credential mounts. Settings, credentials and achievements no longer stack as active dialogs. |
| 20 Real controller | Awaiting runtime evidence | Synthetic controller tests pass; physical hot-plug and gameplay controls still require hardware checks. |
| 21 Hardware matrix | Awaiting runtime evidence | Clean Windows, second PC, multi-monitor and 150% DPI remain required. Fixture viewport screenshots are not hardware certification. |
| 22 Long sessions | Awaiting runtime evidence | Two-hour protocol per title below; not marked passed. |
| 23 Field diagnostics | Resolved | User-exported allowlisted diagnostics, redacted paths/URLs/credential fields. No telemetry. |
| 24 Plaintext RA key | Resolved | Windows safeStorage, encrypted persistence verification, migration tests and real Electron credential test. Public config contains status only. |
| 25 Uncommitted work | Intentional | Existing work preserved. No commit, push or publication authorized. |
| 26 CI | Implemented, not run remotely | Windows workflow includes MSVC, native builds, typecheck, unit tests, fixture E2E and unsigned packaging. |
| 27 Signing | Deferred | Local unsigned installer/plugin; no signing credentials or distribution claim. |
| 28 Release policy | Resolved | Unreleased changelog and explicit local release gates. No updater. |
| 29 Attribution/legal review | Awaiting review | Existing attribution is retained. No claim of legal clearance. |
| 30 Contradictory comments | Partially resolved | Live test was rewritten; removed obsolete immediate-untracking behavior. Remaining historic rationale is not runtime evidence. |
| 31 Documentation drift | Partially resolved | This audit and release gates supersede conflicting old claims. Architecture and design additions describe the new behavior. |

## Native remapping boundary

Launcher keyboard remapping is implemented, validated and persisted. Native game configuration can be opened through RE-Enhance and its edited config survives mod switching. **Inline game-action remapping is not complete:** RE1/RE3 `Key_Def` and RE2 `KeyDef` slot meanings still need one-change/in-game verification. No guessed keyboard/controller slots are written. Secondary bindings are not advertised for native games.

## Evidence method

The code graph has no registered project for this checkout; coverage query returned `project not found or not indexed`. Source inspection and executable checks were used. Hardware and game results must be recorded with date, build, title, mode, scenario, machine and artifact paths.
