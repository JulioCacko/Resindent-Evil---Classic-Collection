#ifndef RE_ACHIEVEMENT_DB_H
#define RE_ACHIEVEMENT_DB_H

#include "core/types.h"

#include <map>
#include <string>
#include <vector>

struct Achievement
{
    std::string id;
    std::string gameId;
    std::string name;
    std::string desc;
    std::string icon;
    bool        unlocked;
    std::string unlockDate;
};

class AchievementDB
{
public:
    static AchievementDB& Get();

    void Init();

    void LoadProgress(const std::string& savePath);
    void SaveProgress(const std::string& savePath);

    std::vector<Achievement*> GetAchievements(const std::string& gameId);
    Achievement*               GetAchievement(const std::string& id);

    void UnlockAchievement(const std::string& id);
    bool IsUnlocked(const std::string& id) const;

    int GetUnlockedCount(const std::string& gameId) const;
    int GetTotalCount(const std::string& gameId) const;

private:
    AchievementDB();
    ~AchievementDB();
    AchievementDB(const AchievementDB&);
    AchievementDB& operator=(const AchievementDB&);

    void Clear();
    void RegisterAchievement(const Achievement& def);
    void LoadHardcodedDefinitions();
    bool TryLoadJsonFile(const std::string& path);

    void ApplySaveLine(const std::string& line);
    void RebuildIdIndex();

    std::vector<Achievement>           achievements_;
    std::map<std::string, std::size_t> idToIndex_;
    std::string                        activeSavePath_;
};

#endif
