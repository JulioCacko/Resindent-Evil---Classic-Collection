# Changelog

## Unreleased — fan release preparation

- Add grouped settings, launcher key remapping, contextual game settings and first-run recovery guidance.
- Preserve enhanced game configuration across mod switching; add reversible RE3 window-size overrides.
- Encrypt RetroAchievements credentials with Windows protection and remove secret readback.
- Fix duplicate dialogs, stale launch state, premature process untracking, and overlay cancellation races.
- Distinguish overlay connection from rendering; bound notification queues and confirm delivery from frames.
- Add redacted diagnostic export, Windows CI and an explicit owned-game test matrix.
- Remove forced fullscreen and hide unverified game CRT. Keep automatic milestones separate from manual progress.

Known blockers: inline native action remapping, complete RE1–3 gameplay evidence, physical-controller verification, two-hour sessions, clean Windows and second-PC checks. Builds remain unsigned and unpublished.

## Version policy

Keep 0.0.4 during local preparation. Assign the next version only after release gates pass; document fixes, supported configurations, limitations and validation evidence in its release notes. Publishing is a separate authorized action.
