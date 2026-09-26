/**
 * The catalog: every row the launcher can show, with the exact text the Figma
 * concept draws. This is the single source of truth for both processes — the
 * renderer renders it, the main process validates and launches from it.
 *
 * Presentation text is transcribed verbatim from the design export, including
 * its spacing quirks, because the description blocks use `whitespace-pre-wrap`
 * and therefore show doubled spaces exactly as authored. Where the concept's
 * dates disagree with the retail release history (notably RE3's "originally
 * released in 11 November 1999" on the US row) the concept's wording is kept,
 * since reproducing the concept 1:1 is the requirement. See
 * docs/DESIGN-FIDELITY.md for the reconciliation notes.
 */
import type { GameVersion, GameplayMedia, TitleId } from './types'

/** Asset keys are resolved to bundled URLs by the renderer's asset map. */
export type AssetKey = string

export interface GameVersionSeed
  extends Omit<GameVersion, 'state' | 'stateReason' | 'hasMod' | 'titleId'> {
  titleId: TitleId
}

export interface GameTitleSeed {
  id: TitleId
  name: string
  cardAsset: AssetKey
  gogGameId: string
  gogFolderName: string
  versions: GameVersionSeed[]
}

export const BACKDROP_ASSET: AssetKey = 'game/backdrop-unsplash'

const GAMEPLAY_MEDIA: Record<TitleId, GameplayMedia> = {
  // The concept shows a still for RE1, a video for RE2, and a still for RE3.
  re1: { kind: 'image', asset: 'game/gameplay-re1' },
  re2: { kind: 'video', asset: 'video/video-re2' },
  re3: { kind: 'image', asset: 'game/gameplay-re3' }
}

const RE1_DESCRIPTION = `A series of gory attacks in the area surrounding a remote biotech lab brings in S.T.A.R.S. (Special Tactics and Rescue Squad) to investigate.  On arrival, Bravo Team communications are abruptly cut off. Now it's up  to your team.

You arrive at the isolated mansion under-powered and on the run. Arm  yourself with anything you can find: knives, pistols, shotguns,  flame-throwers - search for hidden rounds to stay alive!`

const RE2_DESCRIPTION = `Raccoon City have been transformed into zombies by the T-virus, a biological weapon secretly developed by the pharmaceutical company Umbrella.  Leon S. Kennedy, a police officer on his first day of duty, and Claire Redfield, a college student looking for her brother Chris, make their way to the Raccoon Police Department. 

They discover that most of the police force have been killed, and that Chris has left town to investigate Umbrella's headquarters in Europe. They split up to look for survivors and find a way out of the city.`

const RE2_PROTO_DESCRIPTION = `BIOHAZARD 1.5 is an internal name for a Resident Evil 2 prototype which was abandoned in early 1997. Rather than releasing a game they were unhappy with, the developers took the risk of cancelling the game and developing the game again from scratch. 

Many of the aesthetics and sceneries were omitted including Elza Walker and many other characters and enemies were scrapped; however, some of the characters remained more or less similar to their official appearance.`

const RE3_DESCRIPTION = `It's been just days after the gruesome T-Virus disaster had finally ceased at the mansion's laboratory in the hills. Because of the revelations made on her journey, Jill Valentine resigned from S.T.A.R.S and attempted her escape from Raccoon City, now in shambles. But to her surprise, it was just the beginning in what seems to be a lose-lose situation after realizing her nightmares weren't over yet. `

const RE3_JP_DESCRIPTION = `It's been just days after the gruesome T-Virus disaster had finally ceased at the mansion's laboratory in the hills. 

Because of the revelations made on her journey, Jill Valentine resigned from S.T.A.R.S and attempted her escape from Raccoon City, now in shambles. But to her surprise, it was just the beginning in what seems to be a lose-lose situation after realizing her nightmares weren't over yet. `

export const TITLES: GameTitleSeed[] = [
  {
    id: 're1',
    name: 'RESIDENT EVIL',
    cardAsset: 'game/card-re1',
    gogGameId: '1580232252',
    gogFolderName: 'Resident Evil',
    versions: [
      {
        id: 're1_us',
        titleId: 're1',
        row: 0,
        displayName: 'RESIDENT EVIL',
        region: 'US',
        releaseLabel: 'July 24, 1998',
        originalRelease: 'originally released in 30 March 1996',
        boxNote: '',
        voices: 'English',
        subtitles: 'English',
        description: RE1_DESCRIPTION,
        logoWidth: 262.686,
        logoHeight: 70,
        heroAsset: 'game/hero-re1-us',
        logoAsset: 'game/logo-re1-us',
        regionAsset: 'game/region-re1-us',
        videoAsset: 'video/video-re1',
        gameplayMedia: GAMEPLAY_MEDIA.re1,
        execRelPath: 'ResidentEvil.exe',
        modExecRelPath: 'Biohazard.exe',
        modPath: 'RE-ENHANCE_RE1_v1.1_GOG',
        requiresMod: false,
        japaneseMode: false,
        launchable: true,
        unavailableReason: null,
        scenarios: [],
        defaultScenario: null
      },
      {
        id: 're1_jp',
        titleId: 're1',
        row: 1,
        displayName: 'BIO HAZARD',
        region: 'JP',
        releaseLabel: 'July 24, 1998',
        originalRelease: 'originally released in 22 March 1996',
        boxNote: '',
        voices: 'English',
        subtitles: 'Japanese',
        description: RE1_DESCRIPTION,
        logoWidth: 253.043,
        logoHeight: 70,
        heroAsset: 'game/hero-re1-jp',
        logoAsset: 'game/logo-re1-jp',
        regionAsset: 'game/region-re1-jp',
        videoAsset: 'video/video-re1-jp',
        gameplayMedia: GAMEPLAY_MEDIA.re1,
        execRelPath: 'ResidentEvil.exe',
        modExecRelPath: 'Biohazard.exe',
        modPath: 'RE-ENHANCE_RE1_v1.1_GOG',
        requiresMod: true,
        japaneseMode: true,
        launchable: true,
        unavailableReason: null,
        scenarios: [],
        defaultScenario: null
      },
      {
        id: 're1_dc',
        titleId: 're1',
        row: 2,
        displayName: "DIRECTOR'S CUT",
        region: 'US',
        releaseLabel: 'July 24, 1998',
        originalRelease: 'originally released in September 25, 1997',
        boxNote: '',
        voices: 'English',
        subtitles: 'English',
        description: RE1_DESCRIPTION,
        logoWidth: 296.819,
        logoHeight: 120,
        heroAsset: 'game/hero-re1-dc',
        logoAsset: 'game/logo-re1-dc',
        regionAsset: 'game/region-re1-dc',
        videoAsset: 'video/video-re1',
        gameplayMedia: GAMEPLAY_MEDIA.re1,
        execRelPath: 'ResidentEvil.exe',
        modExecRelPath: 'Biohazard.exe',
        modPath: 'RE-ENHANCE_RE1_v1.1_GOG',
        requiresMod: false,
        japaneseMode: false,
        launchable: true,
        unavailableReason: null,
        scenarios: [],
        defaultScenario: null
      }
    ]
  },
  {
    id: 're2',
    name: 'RESIDENT EVIL 2',
    cardAsset: 'game/card-re2',
    gogGameId: '1534123252',
    gogFolderName: 'Resident Evil 2',
    versions: [
      {
        id: 're2_leon_us',
        titleId: 're2',
        row: 0,
        displayName: 'LEON S. KENNEDY',
        region: 'US',
        releaseLabel: 'September 29, 1998',
        originalRelease: 'originally released in 21 January 1998',
        boxNote: '',
        voices: 'English',
        subtitles: 'English',
        description: RE2_DESCRIPTION,
        logoWidth: 292.817,
        logoHeight: 70,
        heroAsset: 'game/hero-re2-leon',
        logoAsset: 'game/logo-re2-leon',
        regionAsset: 'game/region-re2-leon',
        videoAsset: 'video/video-re2',
        gameplayMedia: GAMEPLAY_MEDIA.re2,
        execRelPath: 'LeonU.exe',
        modExecRelPath: 'Resident Evil 2.exe',
        modPath: 'RE-ENHANCE_RE2_v2.0.1_GOG',
        requiresMod: false,
        japaneseMode: false,
        launchable: true,
        unavailableReason: null,
        scenarios: ['leon', 'claire'],
        defaultScenario: 'leon'
      },
      {
        // The concept devotes RE2's middle row to the cancelled BIOHAZARD 1.5
        // prototype, so there is no executable behind it.
        id: 're2_proto',
        titleId: 're2',
        row: 1,
        displayName: 'BIOHAZARD 1.5',
        region: 'US',
        releaseLabel: 'September 29, 1998',
        originalRelease: '',
        boxNote: 'Planned Release IN March 1997 (Scrapped and remade.)',
        voices: 'English',
        subtitles: 'Japanese',
        description: RE2_PROTO_DESCRIPTION,
        logoWidth: 415.598,
        logoHeight: 70,
        heroAsset: 'game/hero-re2-proto',
        logoAsset: 'game/logo-re2-proto',
        regionAsset: 'game/region-re2-proto',
        videoAsset: 'video/video-re2',
        gameplayMedia: GAMEPLAY_MEDIA.re2,
        execRelPath: '',
        modExecRelPath: '',
        modPath: '',
        requiresMod: false,
        japaneseMode: false,
        launchable: false,
        unavailableReason: 'CONCEPT — NEVER RELEASED',
        scenarios: [],
        defaultScenario: null
      },
      {
        id: 're2_jp',
        titleId: 're2',
        row: 2,
        displayName: 'BIO HAZARD 2',
        region: 'JP',
        releaseLabel: 'September 29, 1998',
        originalRelease: 'originally released in 29 January 1998',
        boxNote: '',
        voices: 'English',
        subtitles: 'Japanese',
        description: RE2_DESCRIPTION,
        logoWidth: 301.739,
        logoHeight: 70,
        heroAsset: 'game/hero-re2-jp',
        logoAsset: 'game/logo-re2-jp',
        regionAsset: 'game/region-re2-jp',
        videoAsset: 'video/video-re2-jp',
        gameplayMedia: GAMEPLAY_MEDIA.re2,
        execRelPath: 'LeonU.exe',
        modExecRelPath: 'Resident Evil 2.exe',
        modPath: 'RE-ENHANCE_RE2_v2.0.1_GOG',
        requiresMod: false,
        japaneseMode: true,
        launchable: true,
        unavailableReason: null,
        scenarios: ['leon', 'claire'],
        defaultScenario: 'leon'
      }
    ]
  },
  {
    id: 're3',
    name: 'RESIDENT EVIL 3: NEMESIS',
    cardAsset: 'game/card-re3',
    gogGameId: '1266089300',
    gogFolderName: 'Resident Evil 3',
    versions: [
      {
        id: 're3_us',
        titleId: 're3',
        row: 0,
        displayName: 'RESIDENT EVIL 3',
        region: 'US',
        releaseLabel: 'September 27, 1998',
        originalRelease: 'originally released in 11 November 1999',
        boxNote: '',
        voices: 'English',
        subtitles: 'English',
        description: RE3_DESCRIPTION,
        logoWidth: 339.477,
        logoHeight: 70,
        heroAsset: 'game/hero-re3-us',
        logoAsset: 'game/logo-re3-us',
        regionAsset: 'game/region-re3-us',
        videoAsset: 'video/video-re3',
        gameplayMedia: GAMEPLAY_MEDIA.re3,
        execRelPath: 'ResidentEvil3.exe',
        modExecRelPath: 'BIOHAZARD(R) 3 PC.exe',
        modPath: 'RE-ENHANCE_RE3_v2.2_GOG',
        requiresMod: false,
        japaneseMode: false,
        launchable: true,
        unavailableReason: null,
        scenarios: [],
        defaultScenario: null
      },
      {
        id: 're3_jp',
        titleId: 're3',
        row: 1,
        displayName: 'BIO HAZARD 3: LAST ESCAPE',
        region: 'JP',
        releaseLabel: 'September 27, 1998',
        originalRelease: 'originally released in 22 September 1999',
        boxNote: '',
        voices: 'English',
        subtitles: 'Japanese',
        description: RE3_JP_DESCRIPTION,
        logoWidth: 309.668,
        logoHeight: 70,
        heroAsset: 'game/hero-re3-jp',
        logoAsset: 'game/logo-re3-jp',
        regionAsset: 'game/region-re3-jp',
        videoAsset: 'video/video-re3-jp',
        gameplayMedia: GAMEPLAY_MEDIA.re3,
        execRelPath: 'ResidentEvil3.exe',
        modExecRelPath: 'BIOHAZARD(R) 3 PC.exe',
        modPath: 'RE-ENHANCE_RE3_v2.2_GOG',
        requiresMod: false,
        japaneseMode: true,
        launchable: true,
        unavailableReason: null,
        scenarios: [],
        defaultScenario: null
      }
    ]
  }
]

/** RE2 executables per player scenario, keyed by mode-agnostic retail name. */
export const RE2_SCENARIO_EXEC: Record<'leon' | 'claire', string> = {
  leon: 'LeonU.exe',
  claire: 'ClaireU.exe'
}

/** Per-title probe used by install validation, mirroring the legacy validator. */
export const TITLE_DATA_PROBES: Record<TitleId, string[]> = {
  re1: ['USA', 'USA/Data'],
  re2: ['ClaireU.exe', 'LeonU.exe'],
  re3: ['ResidentEvil3.exe']
}

export const DEFAULT_TITLE_ID: TitleId = 're1'

/** Row counts per title, as the concept lays them out. */
export const ROW_COUNTS: Record<TitleId, number> = {
  re1: TITLES[0].versions.length,
  re2: TITLES[1].versions.length,
  re3: TITLES[2].versions.length
}

export function findTitle(id: TitleId): GameTitleSeed | undefined {
  return TITLES.find((title) => title.id === id)
}

export function findVersion(id: string): GameVersionSeed | undefined {
  for (const title of TITLES) {
    const version = title.versions.find((candidate) => candidate.id === id)
    if (version) return version
  }
  return undefined
}
