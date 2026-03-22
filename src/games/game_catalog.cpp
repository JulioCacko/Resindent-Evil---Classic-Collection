#include "games/game_catalog.h"

GameCatalog& GameCatalog::Get()
{
    static GameCatalog instance;
    return instance;
}

void GameCatalog::Init()
{
    titles_.clear();

    {
        GameTitle re1;
        re1.id = "re1";
        re1.name = "RESIDENT EVIL";
        re1.coverTexPath = "media/game_re1_version_default.png";
        re1.logoImagePath = "media/RE1Logo.png";
        re1.gogGameId = "1580232252";
        re1.installPath.clear();

        GameVersion v1;
        v1.id = "re1_us";
        v1.displayName = "RESIDENT EVIL";
        v1.region = "US";
        v1.releaseDate = "July 24, 1998";
        v1.execRelPath = "ResidentEvil.exe";
        v1.modExecRelPath = "Biohazard.exe";
        v1.voices = "ENGLISH";
        v1.subtitles = "ENGLISH";
        v1.hasMod = true;
        v1.modPath = "RE-ENHANCE_RE1_v1.1_GOG";
        v1.heroImagePath = "media/game_re1_version_default.png";
        v1.description =
            "A series of gory attacks in the area surrounding a remote biotech lab brings in "
            "S.T.A.R.S. (Special Tactics and Rescue Squad) to investigate. On arrival, Bravo Team "
            "communications are abruptly cut off. Now it's up to your team.\n\n"
            "You arrive at the isolated mansion under-powered and on the run. Arm yourself with "
            "anything you can find: knives, pistols, shotguns, flame-throwers - search for hidden "
            "rounds to stay alive!";
        v1.state = InstallState::MISSING;

        GameVersion v2;
        v2.id = "re1_jp_biohazard";
        v2.displayName = "BIO HAZARD";
        v2.region = "JP";
        v2.releaseDate = "March 22, 1996";
        v2.execRelPath = "Biohazard.exe";
        v2.modExecRelPath.clear();
        v2.voices = "JAPANESE";
        v2.subtitles = "JAPANESE";
        v2.hasMod = false;
        v2.modPath.clear();
        v2.heroImagePath = "media/game_re1_version_jp.png";
        v2.description =
            "The original Japanese release of Bio Hazard, featuring uncut content and "
            "the classic survival horror experience as first envisioned.";
        v2.state = InstallState::MISSING;

        GameVersion v3;
        v3.id = "re1_dc";
        v3.displayName = "DIRECTOR'S CUT";
        v3.region = "US";
        v3.releaseDate = "September 25, 1997";
        v3.execRelPath = "ResidentEvil.exe";
        v3.modExecRelPath = "Biohazard.exe";
        v3.voices = "ENGLISH";
        v3.subtitles = "ENGLISH";
        v3.hasMod = true;
        v3.modPath = "RE-ENHANCE_RE1_v1.1_GOG";
        v3.heroImagePath = "media/game_re1_version_alt.png";
        v3.description =
            "The Director's Cut adds new arrange modes, a playable epilogue, and refined pacing "
            "through the Spencer Mansion incident.";
        v3.state = InstallState::MISSING;

        re1.versions.push_back(v1);
        re1.versions.push_back(v2);
        re1.versions.push_back(v3);
        titles_.push_back(re1);
    }

    {
        GameTitle re2;
        re2.id = "re2";
        re2.name = "RESIDENT EVIL 2";
        re2.coverTexPath = "media/game_re2_version_default.png";
        re2.logoImagePath = "media/game_2_type_default.png";
        re2.gogGameId = "1534123252";
        re2.installPath.clear();

        GameVersion v1;
        v1.id = "re2_us";
        v1.displayName = "RESIDENT EVIL 2";
        v1.region = "US";
        v1.releaseDate = "September 29, 1998";
        v1.execRelPath = "LeonU.exe";
        v1.modExecRelPath = "Resident Evil 2.exe";
        v1.voices = "ENGLISH";
        v1.subtitles = "ENGLISH";
        v1.hasMod = true;
        v1.modPath = "RE-ENHANCE_RE2_v2.0.1_GOG";
        v1.heroImagePath = "media/game_re2_version_default.png";
        v1.description =
            "Raccoon City have been transformed into zombies by the T-virus, a biological weapon "
            "secretly developed by the pharmaceutical company Umbrella. Leon S. Kennedy, a police "
            "officer on his first day of duty, and Claire Redfield, a college student looking for "
            "her brother Chris, make their way to the Raccoon Police Department.\n\n"
            "They discover that most of the police force have been killed, and that Chris has left "
            "town to investigate Umbrella's headquarters in Europe. They split up to look for "
            "survivors and find a way out of the city.";
        v1.state = InstallState::MISSING;

        GameVersion v2;
        v2.id = "re2_jp";
        v2.displayName = "BIO HAZARD 2";
        v2.region = "JP";
        v2.releaseDate = "January 29, 1998";
        v2.execRelPath = "LeonU.exe";
        v2.modExecRelPath.clear();
        v2.voices = "JAPANESE";
        v2.subtitles = "JAPANESE";
        v2.hasMod = false;
        v2.modPath.clear();
        v2.heroImagePath = "media/game_re2_version_jp.png";
        v2.description =
            "The original Japanese release of Bio Hazard 2, featuring the dual-scenario "
            "system with Leon and Claire.";
        v2.state = InstallState::MISSING;

        re2.versions.push_back(v1);
        re2.versions.push_back(v2);
        titles_.push_back(re2);
    }

    {
        GameTitle re3;
        re3.id = "re3";
        re3.name = "RESIDENT EVIL 3: NEMESIS";
        re3.coverTexPath = "media/game_re3_version_default.png";
        re3.logoImagePath = "media/game_3_type_default.png";
        re3.gogGameId = "1266089300";
        re3.installPath.clear();

        GameVersion v1;
        v1.id = "re3_us";
        v1.displayName = "RESIDENT EVIL 3";
        v1.region = "US";
        v1.releaseDate = "September 27, 1998";
        v1.execRelPath = "ResidentEvil3.exe";
        v1.modExecRelPath = "BIOHAZARD(R) 3 PC.exe";
        v1.voices = "ENGLISH";
        v1.subtitles = "ENGLISH";
        v1.hasMod = true;
        v1.modPath = "RE-ENHANCE_RE3_v2.2_GOG";
        v1.heroImagePath = "media/game_re3_version_default.png";
        v1.description =
            "It's been just days after the gruesome T-Virus disaster had finally ceased at the "
            "mansion's laboratory in the hills. Because of the revelations made on her journey, "
            "Jill Valentine resigned from S.T.A.R.S and attempted her escape from Raccoon City, "
            "now in shambles. But to her surprise, it was just the beginning in what seems to be "
            "a lose-lose situation after realizing her nightmares weren't over yet.";
        v1.state = InstallState::MISSING;

        GameVersion v2;
        v2.id = "re3_jp";
        v2.displayName = "BIO HAZARD 3: LAST ESCAPE";
        v2.region = "JP";
        v2.releaseDate = "November 11, 1999";
        v2.execRelPath = "ResidentEvil3.exe";
        v2.modExecRelPath.clear();
        v2.voices = "JAPANESE";
        v2.subtitles = "JAPANESE";
        v2.hasMod = false;
        v2.modPath.clear();
        v2.heroImagePath = "media/game_re3_version_jp.png";
        v2.description =
            "The original Japanese release, Bio Hazard 3: Last Escape, with Jill's "
            "desperate fight against the Nemesis.";
        v2.state = InstallState::MISSING;

        re3.versions.push_back(v1);
        re3.versions.push_back(v2);
        titles_.push_back(re3);
    }
}

GameTitle* GameCatalog::GetTitle(const std::string& id)
{
    for (size_t i = 0; i < titles_.size(); ++i)
    {
        if (titles_[i].id == id)
        {
            return &titles_[i];
        }
    }
    return 0;
}

std::vector<GameTitle>& GameCatalog::GetAllTitles()
{
    return titles_;
}

void GameCatalog::SetInstallPath(const std::string& titleId, const std::string& path)
{
    GameTitle* t = GetTitle(titleId);
    if (t)
    {
        t->installPath = path;
    }
}

void GameCatalog::SetVersionState(const std::string& titleId, const std::string& versionId, InstallState state)
{
    GameTitle* t = GetTitle(titleId);
    if (!t)
    {
        return;
    }
    for (size_t i = 0; i < t->versions.size(); ++i)
    {
        if (t->versions[i].id == versionId)
        {
            t->versions[i].state = state;
            return;
        }
    }
}
