#ifndef RE_ACHIEVEMENT_OVERLAY_H
#define RE_ACHIEVEMENT_OVERLAY_H

#include "core/types.h"

#include <string>
#include <vector>

class AchievementOverlay
{
public:
    static AchievementOverlay& Get();

    void ShowUnlock(const std::string& name, const std::string& description);
    void Update(float dt);
    void Draw();

private:
    AchievementOverlay();
    ~AchievementOverlay();
    AchievementOverlay(const AchievementOverlay&);
    AchievementOverlay& operator=(const AchievementOverlay&);

    struct PopupItem
    {
        std::string name;
        std::string desc;
        float       timer;
        enum State
        {
            FADE_IN,
            HOLD,
            FADE_OUT,
            DONE
        } state;
    };

    std::vector<PopupItem> queue_;

    static const float FADE_IN_TIME;
    static const float HOLD_TIME;
    static const float FADE_OUT_TIME;
};

#endif
