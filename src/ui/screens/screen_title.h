#ifndef RE_SCREEN_TITLE_H
#define RE_SCREEN_TITLE_H

#include "ui/ui_screen.h"

#include "core/types.h"

#include <cstddef>
#include <memory>
#include <vector>

class Texture;

class ScreenTitle : public UIScreen
{
public:
    ScreenTitle();
    virtual ~ScreenTitle();
    virtual void OnEnter();
    virtual void OnInput();
    virtual void Update(float dt);
    virtual void Draw();

private:
    size_t selectedIndex;
    std::vector<std::unique_ptr<Texture> > coverTextures;
    std::unique_ptr<Texture> logoTexture;
    std::unique_ptr<Texture> bgTexture;

    float fadeAlpha;
    float cardScales[3];
    float cardGlows[3];
    float transitionTimer;
    bool  transitioning;
    int   transitionTarget;
};

#endif
