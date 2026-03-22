#ifndef RE_GAME_LAUNCHER_H
#define RE_GAME_LAUNCHER_H

#include "core/types.h"
#include "games/game_entry.h"

#include <string>

namespace GameLauncher
{
bool Launch(const GameVersion& version, const std::string& installPath, bool useEnhanced);
bool IsGameRunning();
int GetProcessExitCode();
void KillGame();
}

#endif
