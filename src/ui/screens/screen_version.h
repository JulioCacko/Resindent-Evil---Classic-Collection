#ifndef RE_SCREEN_VERSION_H
#define RE_SCREEN_VERSION_H

#include "ui/ui_screen.h"

#include "core/types.h"

#include <memory>
#include <vector>

class GameTitle;
class Texture;

class ScreenVersion : public UIScreen
{
public:
    explicit ScreenVersion(GameTitle* title);
    virtual ~ScreenVersion();
    virtual void OnEnter();
    virtual void OnInput();
    virtual void Update(float dt);
    virtual void Draw();

private:
    GameTitle* title;
    int        selectedVersion;
    std::vector<std::unique_ptr<Texture> > heroTextures;
    std::unique_ptr<Texture> logoTexture;
    std::unique_ptr<Texture> bgTexture;
    std::unique_ptr<Texture> sideArtTexture;

    float fadeAlpha;
    float versionGlows[8];
    float transitionTimer;
    bool  transitioning;
};

#endif
