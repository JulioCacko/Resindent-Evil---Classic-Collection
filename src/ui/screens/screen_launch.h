#ifndef RE_SCREEN_LAUNCH_H
#define RE_SCREEN_LAUNCH_H

#include "ui/ui_screen.h"

#include "core/types.h"

#include <memory>

class GameTitle;
class Texture;

class ScreenLaunch : public UIScreen
{
public:
    ScreenLaunch(GameTitle* title, int versionIndex);
    virtual void OnEnter();
    virtual void OnInput();
    virtual void Update(float dt);
    virtual void Draw();

private:
    GameTitle* title;
    int        versionIndex;
    int        optionIndex;
    bool       useEnhanced;
    bool       crtEnabled;

    std::unique_ptr<Texture> bgTexture;
    float fadeAlpha;
};

#endif
