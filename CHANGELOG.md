# Changelog

## 0.0.5 — 2026-09-28

- Add grouped settings, launcher key remapping, contextual game settings and first-run recovery guidance.
- Preserve enhanced game configuration across mod switching; add reversible RE3 window-size overrides.
- Encrypt RetroAchievements credentials with Windows protection and remove secret readback.
- Fix duplicate dialogs, stale launch state, premature process untracking, and overlay cancellation races.
- Distinguish overlay connection from rendering; bound notification queues and confirm delivery from frames.
- Add redacted diagnostic export, Windows CI and an explicit owned-game test matrix.
- Remove forced fullscreen and hide unverified game CRT. Keep automatic milestones separate from manual progress.
- Stop inferring an RE2 character milestone from a launcher preference: Original mode selects the player executable, Enhanced selects in game.
- Keep the focused settings row, the input device and the surface the player came from across dialogs.
- Record an overlayed file in the mod manifest before it is overwritten, so an interrupted injection can no longer lose a retail original.

Known blockers: RE1 Enhanced requires the Japanese GOG installation and this tree has no `jpn/Data`; inline native action remapping; complete RE1–3 gameplay evidence; physical-controller verification; two-hour sessions; clean Windows and second-PC checks. Builds remain unsigned.

## Version policy

0.0.5 was assigned and published with the blockers above still open, at the owner's direction, and its release notes say so rather than implying the gates passed. Assign later versions only after the gates close, and document fixes, supported configurations, limitations and validation evidence in each release's notes.
