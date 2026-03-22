#ifndef RE_GOG_DETECTOR_H
#define RE_GOG_DETECTOR_H

#include <string>

class GameCatalog;

namespace GOGDetector
{
std::string DetectInstallPath(const std::string& gogGameId);
void DetectAllGames(GameCatalog& catalog);
}

#endif
