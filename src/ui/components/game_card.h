#ifndef RE_GAME_CARD_H
#define RE_GAME_CARD_H

#include "core/types.h"
#include "ui/ui_element.h"

#include <string>

class GameCard : public UIElement
{
public:
    GameCard(float x, float y, float w, float h);
    void SetTitle(const char* name);
    void SetStatus(InstallState state);
    void SetSelected(bool sel);
    void Draw() override;

private:
    std::string titleText;
    InstallState state;
    bool selected;
};

#endif
