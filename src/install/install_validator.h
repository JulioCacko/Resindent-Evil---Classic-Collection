#ifndef RE_INSTALL_VALIDATOR_H
#define RE_INSTALL_VALIDATOR_H

#include <string>

class GameCatalog;
struct GameTitle;

namespace InstallValidator
{
void ValidateTitle(GameTitle& title);
void ValidateAll(GameCatalog& catalog);
void ValidateMods(GameCatalog& catalog, const std::string& modBasePath);
}

#endif
