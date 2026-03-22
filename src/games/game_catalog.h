#ifndef RE_GAME_CATALOG_H
#define RE_GAME_CATALOG_H

#include "core/types.h"
#include "games/game_entry.h"

#include <string>
#include <vector>

class GameCatalog
{
public:
    static GameCatalog& Get();

    void Init();

    GameTitle* GetTitle(const std::string& id);
    std::vector<GameTitle>& GetAllTitles();

    void SetInstallPath(const std::string& titleId, const std::string& path);
    void SetVersionState(const std::string& titleId, const std::string& versionId, InstallState state);

private:
    GameCatalog() {}

    GameCatalog(const GameCatalog&);
    GameCatalog& operator=(const GameCatalog&);

    std::vector<GameTitle> titles_;
};

#endif
