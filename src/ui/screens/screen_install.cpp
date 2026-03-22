#include "ui/screens/screen_install.h"

#include "audio/audio_system.h"
#include "games/game_catalog.h"
#include "games/game_entry.h"
#include "input/input_manager.h"
#include "renderer/renderer.h"
#include "ui/font.h"
#include "ui/screens/screen_title.h"
#include "ui/ui_system.h"

#include <cstring>
#include <string>
#include <vector>

namespace
{

const char* TitleLineStatus(const GameTitle& t)
{
    bool anyInstalled = false;
    bool allInstalled = !t.versions.empty();
    for (size_t i = 0; i < t.versions.size(); ++i)
    {
        if (t.versions[i].state == InstallState::INSTALLED)
        {
            anyInstalled = true;
        }
        else
        {
            allInstalled = false;
        }
    }
    if (t.versions.empty())
    {
        return "MISSING";
    }
    if (allInstalled)
    {
        return "INSTALLED";
    }
    if (anyInstalled)
    {
        return "PARTIAL";
    }
    return "MISSING";
}

rcolor StatusToColor(const char* s)
{
    if (std::strcmp(s, "INSTALLED") == 0)
    {
        return COLOR_GREEN;
    }
    if (std::strcmp(s, "PARTIAL") == 0)
    {
        return COLOR_YELLOW;
    }
    return COLOR_RED;
}

void DrawHintsInstall()
{
    Font&       f       = Font::Get();
    Renderer& r       = Renderer::Get();
    const bool  pad     = InputManager::Get().LastInputWasGamepad();
    const float rowY    = static_cast<float>(DESIGN_HEIGHT) - 50.f;
    const float lbl     = 24.f;
    const float iconToText = 8.f;

    const char* confKey = pad ? "A" : "E";
    const float wConfLbl = f.MeasureText("CONTINUE", lbl);
    const float totalW   = 32.f + iconToText + wConfLbl;
    float       x        = (static_cast<float>(DESIGN_WIDTH) - totalW) * 0.5f;

    const float kS = 32.f;
    r.DrawQuad(x, rowY, kS, kS, COLOR_KEY_BG);
    const float tw = f.MeasureText(confKey, 10.f);
    f.DrawText(confKey, x + (kS - tw) * 0.5f, rowY + 8.f, 10.f, COLOR_WHITE);
    f.DrawText("CONTINUE", x + 32.f + iconToText, rowY + 8.f, lbl, COLOR_HINT_TEXT);
}

} // namespace

void ScreenInstall::OnInput()
{
    if (InputManager::Get().Confirm())
    {
        AudioSystem::Get().PlaySound("confirm");
        UISystem::Get().PopScreen();
        UISystem::Get().PushScreen(new ScreenTitle());
    }
}

void ScreenInstall::Draw()
{
    Renderer& r = Renderer::Get();
    Font&     f = Font::Get();

    r.DrawQuad(0.f, 0.f, static_cast<float>(DESIGN_WIDTH), static_cast<float>(DESIGN_HEIGHT), COLOR_BG);

    f.DrawTextCentered("INSTALLATION STATUS", static_cast<float>(DESIGN_WIDTH) * 0.5f, 80.f, 32.f, COLOR_WHITE);
    f.DrawTextCentered(
        "Verify your GOG installs. You can continue even if some titles are missing.",
        static_cast<float>(DESIGN_WIDTH) * 0.5f,
        140.f,
        20.f,
        COLOR_GREY);

    std::vector<GameTitle>& titles = GameCatalog::Get().GetAllTitles();
    float                   y      = 260.f;
    for (size_t i = 0; i < titles.size(); ++i)
    {
        GameTitle& t = titles[i];
        r.DrawQuad(120.f, y, 1680.f, 100.f, RGBA(0x1A, 0x1A, 0x1A, 0xFF));
        r.DrawQuad(120.f, y, 1680.f, 3.f, COLOR_CARD_BORDER);

        f.DrawText(t.name.c_str(), 160.f, y + 28.f, 20.f, COLOR_WHITE);

        const char* st = TitleLineStatus(t);
        const float sw = f.MeasureText(st, 20.f);
        f.DrawText(st, 1800.f - sw - 120.f, y + 32.f, 20.f, StatusToColor(st));

        y += 120.f;
    }

    DrawHintsInstall();
}
