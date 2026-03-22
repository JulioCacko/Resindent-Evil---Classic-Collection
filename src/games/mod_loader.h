#ifndef RE_MOD_LOADER_H
#define RE_MOD_LOADER_H

#include "core/types.h"
#include "games/game_entry.h"

#include <string>

namespace ModLoader
{
bool InjectMod(const GameVersion& version, const std::string& installPath, const std::string& modBasePath);
bool RemoveMod(const GameVersion& version, const std::string& installPath);
bool IsModInstalled(const std::string& installPath, const std::string& modIndicatorFile);
}

#endif
