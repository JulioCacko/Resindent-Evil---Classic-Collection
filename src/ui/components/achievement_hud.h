#ifndef RE_ACHIEVEMENT_HUD_H
#define RE_ACHIEVEMENT_HUD_H

#include "ui/ui_element.h"

#include <string>
#include <vector>

class AchievementHUD : public UIElement
{
public:
    AchievementHUD();

    struct Popup
    {
        std::string name;
        std::string desc;
        float       timer;
        enum Phase
        {
            FADE_IN,
            HOLD,
            FADE_OUT,
            DONE
        } phase;
    };

    void Notify(const char* name, const char* description);
    void Update(float dt) override;
    void Draw() override;

private:
    std::vector<Popup> queue;
    int                activeIndex;
};

#endif
