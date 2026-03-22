#include "ui/ui_element.h"

UIElement::UIElement()
    : posX(0.f)
    , posY(0.f)
    , sizeW(100.f)
    , sizeH(100.f)
    , alpha(1.f)
    , color(COLOR_WHITE)
    , visible(true)
    , focused(false)
{
}

void UIElement::SetPosition(float px, float py)
{
    posX = px;
    posY = py;
}

void UIElement::SetSize(float w, float h)
{
    sizeW = w;
    sizeH = h;
}

void UIElement::SetColor(rcolor c)
{
    color = c;
}

void UIElement::SetAlpha(float a)
{
    alpha = a;
}

void UIElement::SetVisible(bool v)
{
    visible = v;
}

void UIElement::SetFocused(bool f)
{
    focused = f;
}

bool UIElement::ContainsPoint(float px, float py) const
{
    return px >= posX && px < posX + sizeW && py >= posY && py < posY + sizeH;
}
