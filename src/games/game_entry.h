#ifndef RE_GAME_ENTRY_H
#define RE_GAME_ENTRY_H

#include "core/types.h"

#include <string>
#include <vector>

struct GameVersion
{
    std::string id;             // "re1_us", "re1_jp_biohazard", "re1_dc"
    std::string displayName;   // "RESIDENT EVIL", "BIO HAZARD", "DIRECTOR'S CUT"
    std::string region;        // "US", "JP"
    std::string releaseDate;   // "30 MARCH 1996"
    std::string execRelPath;   // relative path from install root to .exe
    std::string modExecRelPath; // exe to use when RE-Enhance mod is active
    std::string voices;        // "ENGLISH"
    std::string subtitles;     // "ENGLISH"
    bool        hasMod;        // REEnhance available
    std::string modPath;       // path to REEnhance dll/patch
    std::string description;   // game description text
    std::string heroImagePath; // hero/cover image for version select
    InstallState state;
};

struct GameTitle
{
    std::string              id;            // "re1", "re2", "re3"
    std::string              name;          // "RESIDENT EVIL"
    std::string              coverTexPath;  // path to cover art texture (main menu card)
    std::string              logoImagePath; // per-game logo image
    std::string              gogGameId;     // GOG game ID string
    std::string              installPath;   // detected install path
    std::vector<GameVersion> versions;
};

#endif
