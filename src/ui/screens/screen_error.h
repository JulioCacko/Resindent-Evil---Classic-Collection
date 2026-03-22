#ifndef RE_SCREEN_ERROR_H
#define RE_SCREEN_ERROR_H

#include "ui/ui_screen.h"

#include <string>

class ScreenError : public UIScreen
{
public:
    ScreenError(const std::string& errorTitle, const std::string& message);
    virtual void OnInput();
    virtual void Draw();

private:
    std::string errorTitle;
    std::string message;
};

#endif
