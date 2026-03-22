#ifndef RE_UI_SCREEN_H
#define RE_UI_SCREEN_H

class UIScreen
{
public:
    virtual ~UIScreen() {}
    virtual void OnEnter() {}
    virtual void OnExit() {}
    virtual void OnInput() {}
    virtual void Update(float dt) {}
    virtual void Draw() {}
};

#endif
