#ifndef RE_VERSION_ROW_H
#define RE_VERSION_ROW_H

#include "core/types.h"
#include "ui/ui_element.h"

#include <string>

class VersionRow : public UIElement
{
public:
    VersionRow(float x, float y, float w, float h);
    void SetVersionName(const char* name);
    void SetRegion(const char* r);
    void SetDate(const char* d);
    void SetSelected(bool sel);
    void SetState(InstallState s);
    void Draw() override;

private:
    std::string versionName;
    std::string region;
    std::string date;
    bool        selected;
    InstallState state;
};

#endif
