#ifndef RE_SIDEBAR_TITLE_H
#define RE_SIDEBAR_TITLE_H

#include "ui/ui_element.h"

#include <string>

class SidebarTitle : public UIElement
{
public:
    void SetTitle(const char* t);
    void Draw() override;

private:
    std::string title;
};

#endif
