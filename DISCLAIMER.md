# Legal notice, disclaimers and takedown policy

This document exists so that anyone — a user, a store, or a rights holder — can see
exactly what this project is, what it is not, where its content came from, and what
happens if someone wants something removed. It is written to be accurate rather than
reassuring: where the project *does* carry material that belongs to someone else, that
is stated plainly and listed.

**Last reviewed:** 2026-09-28.

---

## 1. It is an unofficial fan project, and it is unaffiliated

`Resident Evil - Classic Collection` is an **unofficial launcher application**: a
desktop front end for games the user already owns, built by Julio CACKO ("the author").
It is made by a fan of the games, and it is not a product of the companies that make or
sell them.

It is **not** affiliated with, authorised by, endorsed by, sponsored by, approved by,
or in any way connected to:

- **Capcom Co., Ltd.** — owner of the *Resident Evil* / *Biohazard* franchise;
- **GOG sp. z o.o.** (CD Projekt group) — the store this launcher is built to work with;
- **Valve Corporation / Steam**;
- the authors of **RE-Enhance**, **Classic REbirth**, **dgVoodoo** or any other mod or
  wrapper the launcher can work alongside.

Nothing here is official, licensed, or a product of any of those companies. No one at
any of those companies has reviewed, approved or contributed to it.

## 2. Not a game, and it ships no game

This repository contains **none** of the following, and never will:

- game engine code, source or binaries;
- game executables, ROMs, ISOs or installers;
- game data files (`.DAT`, `.EMD`, `.PLD`, room files, archives);
- decryption keys, DRM circumvention, or anything that unlocks paid content;
- cracks, patches that defeat copy protection, or bundled mod payloads.

The launcher **cannot run any game on its own.** It is a front end: it detects an
existing installation that *you* already own and bought, and starts it. The folders it
needs for that — `GOG Games/` and `reenhancemods/` — are deliberately excluded from
version control (`.gitignore`) and are never distributed here, by design and for
copyright reasons. Without your own copy of the games, the launcher opens, explains
that nothing is installed, and does nothing else.

It also does **not** modify your games unless you ask it to: mod injection, the
`config.ini` patch and the file restore all happen only when you press the button, and
the injection is reversible through a backup manifest the launcher writes. It never
touches a game it did not start.

## 3. Non-commercial

This project is free. There is no paid version, no donation gate, no advertising, no
telemetry, no licence check, and nothing is sold or monetised in any way. It gives no
one access to anything they would otherwise have to pay for. It exists as a portfolio
and study piece.

## 4. Trademarks

*Resident Evil*, *Biohazard*, *Biohazard 2*, *Biohazard 3: Last Escape*, *Director's
Cut*, the character names used in the catalogue (S.T.A.R.S., Jill Valentine, Leon S.
Kennedy, Claire Redfield, Nemesis), and the associated logos and wordmarks are
**trademarks of Capcom Co., Ltd.** They appear here for **identification and
description only** — to say which game a button starts, and to reproduce the design's own
text. Their appearance is not a claim of ownership, sponsorship or
endorsement, and this project claims no rights in any of them.

The project's own name is descriptive: it identifies which games the launcher is for.

## 5. Copyright in the content, stated accurately

There are three different kinds of content here, and they are not the same:

| Content | Whose it is | Where it is |
|---|---|---|
| The **launcher's code** — Electron/React/TypeScript sources, tooling, tests, docs | The author's own work | `src/`, `tools/`, `tests/`, `docs/` |
| The **user interface** — layout, measurements, typography choices, the "Classic Collection" lockup, its text | The author's own design work, implemented from his own design file | `src/renderer/src/data/design.ts` and the derived assets below |
| **Franchise artwork and media** — cover art, promotional art, the game wordmarks, the trailers, and the UI sound effects | **© Capcom Co., Ltd.**, used to present the games | `src/renderer/src/assets/game/`, `…/video/`, `…/audio/` — see §6 |

**The third row is the honest problem, and it is stated here rather than glossed
over.** This application — and therefore this repository — reproduces promotional
artwork, wordmarks, trailer footage and sound effects from the games, because the whole
point of a launcher is to present those games. A disclaimer does not change who owns that material
or make its presence here lawful in every jurisdiction.

### What the project claims, and what it does not

It claims **no** rights in the franchise material, and asserts **no** licence over it —
in particular, the project's own source licence (see §9) does **not** extend to it. It
does not assert fair use, fair dealing or any other defence as a matter of entitlement;
it simply describes what the material is, where it came from, and how to have it
removed (§7).

## 6. Where each asset came from

Every converted asset is produced by `pnpm assets:sync` from a source folder, and
`src/renderer/src/assets/MANIFEST.json` records that mapping in full. In summary:

| Shipped asset | Source it was converted from | Rights |
|---|---|---|
| `game/backdrop-unsplash.webp` | the design export (an Unsplash photograph used in the mock-up) | Unsplash licence |
| `game/card-re{1,2,3}.webp` | the design export | franchise cover art — © Capcom |
| `game/hero-*.webp` (8) | the design export | franchise promotional art — © Capcom |
| `game/lane-*.webp` (8) | the design export, all eight info-panel lanes including `Frame219` | franchise artwork — © Capcom |
| `game/logo-*.webp` (8) | the author's own design exports (`assets/textures/`) | game wordmarks — © Capcom |
| `game/gameplay-re{1,3}.webp` | the design export | franchise artwork — © Capcom |
| `video/*.mp4` (6) | the author's `assets/videos/` (publicly released trailers) | trailer footage — © Capcom |
| `audio/{confirm,back,cursor}.wav` | the author's `assets/audio/` (UI cues from the games) | © Capcom |
| `font/Actor-Regular.ttf` | the open-source **Actor** typeface, by Mário Gonçalves / TypeTogether | **SIL Open Font Licence 1.1** — redistributable |
| everything above | the design export (kept beside the working tree, gitignored) | as above |

Third-party components are used under their own licences and are **not** re-licensed
here: Electron (MIT), React (MIT), Vite (MIT), Tailwind CSS (MIT), Zustand (MIT), the
Actor font (OFL 1.1), and — only if the user installs them themselves — RE-Enhance and
any graphics wrapper, which are **not** included in this repository or in the released
builds.

## 7. Takedown policy

If you are a rights holder, or acting for one, and you want something in this
repository or in its released builds changed or removed, you do not need a formal
DMCA notice to get action — a message is enough:

- **Contact:** open an issue at <https://github.com/JulioCacko/Resindent-Evil---Classic-Collection/issues>,
  or contact the maintainer through that GitHub account.
- **What happens:** the maintainer will **comply promptly and without argument**.
  Material will be removed from the repository, from the released builds, or both, and
  — where it is feasible — replaced by a mechanism that lets users supply their own
  copy of that file locally. The git history will be rewritten if that is what removal
  requires.
- **No counter-notice by default.** This project is a hobby piece. It is not worth
  anyone's time to litigate, and the maintainer will not file a counter-notice to keep
  material in place unless the request is plainly mistaken about what the file is —
  and even then, only after replying to the requester first.
- **If you send a formal DMCA notice** under 17 U.S.C. §512, address it to the
  maintainer's designated agent. **The author must fill this in before relying on the
  safe harbour: a designated agent with the U.S. Copyright Office is not registered
  for this project yet.** Until it is, treat this project as *not* claiming §512 safe
  harbour, and use the GitHub route above.

The fastest possible outcome, and the one the maintainer prefers: name the file or the
feature, and it goes.

## 8. What this notice does and does not do

Plainly, because the opposite is often implied by documents like this one:

- **It does not grant immunity.** A disclaimer cannot make someone else's material
  lawful, and it does not stop a platform (GitHub, a store, a host) from
  removing content on a complaint, or suspend a repeat-infringer process.
- **It does help with the things that actually matter in practice:** it shows the
  project is non-commercial, unaffiliated, ships no game content, is willing to comply
  immediately, and has documented where every asset came from. Those are the facts a
  person deciding whether to send a notice, and a platform deciding how to act on one,
  actually weigh.
- **It is not legal advice.** The author is not a lawyer. If this project ever matters
  commercially, or if it receives a notice, the correct next step is a lawyer — not
  this file.

## 9. Licence

The **source code** in this repository is the author's own work. No licence is granted
for the franchise material described in §5 and §6, and none is asserted over it. A
`LICENSE` file, if and when one is added, will cover the code only and will say so
explicitly.

Until then: reading, cloning and building for personal use is fine; redistributing the
franchise artwork bundled with it is not something this project can authorise, because
it does not own it.
