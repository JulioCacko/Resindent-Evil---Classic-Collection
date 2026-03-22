#ifndef RE_UI_SYSTEM_H
#define RE_UI_SYSTEM_H

#include "core/types.h"

#include <memory>
#include <vector>

class UIScreen;

class UISystem
{
public:
    static UISystem& Get();
    void Init();
    void Shutdown();
    void Update(float dt);
    void Draw();
    void PushScreen(UIScreen* screen);
    void PopScreen();
    void ReplaceScreen(UIScreen* screen);
    int GetScreenCount() const;

private:
    UISystem();
    ~UISystem();
    UISystem(const UISystem&);
    UISystem& operator=(const UISystem&);

    std::vector<std::unique_ptr<UIScreen> > stack;
};

#endif
