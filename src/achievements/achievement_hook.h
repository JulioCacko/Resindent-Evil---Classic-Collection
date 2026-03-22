#ifndef RE_ACHIEVEMENT_HOOK_H
#define RE_ACHIEVEMENT_HOOK_H

#include "core/types.h"

#include <string>

class AchievementHook
{
public:
    static AchievementHook& Get();

    void StartTracking(const std::string& gameId, uint32_t processId);
    void StopTracking();
    void Update();
    bool IsTracking() const;

private:
    AchievementHook();
    ~AchievementHook();
    AchievementHook(const AchievementHook&);
    AchievementHook& operator=(const AchievementHook&);

    void CheckSaveFiles(const std::string& gameId);

    std::string currentGameId_;
    uint32_t    currentPID_;
    bool        tracking_;
};

#endif
