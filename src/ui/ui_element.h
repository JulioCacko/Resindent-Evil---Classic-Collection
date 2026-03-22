#ifndef RE_UI_ELEMENT_H
#define RE_UI_ELEMENT_H

#include "core/types.h"

class UIElement
{
public:
    UIElement();
    virtual ~UIElement() {}
    virtual void Update(float dt) {}
    virtual void Draw() {}
    void SetPosition(float px, float py);
    void SetSize(float w, float h);
    void SetColor(rcolor c);
    void SetAlpha(float a);
    void SetVisible(bool v);
    void SetFocused(bool f);
    float X() const { return posX; }
    float Y() const { return posY; }
    float Width() const { return sizeW; }
    float Height() const { return sizeH; }
    float Alpha() const { return alpha; }
    rcolor Color() const { return color; }
    bool IsVisible() const { return visible; }
    bool IsFocused() const { return focused; }
    bool ContainsPoint(float px, float py) const;

protected:
    float posX, posY, sizeW, sizeH, alpha;
    rcolor color;
    bool visible, focused;
};

#endif
