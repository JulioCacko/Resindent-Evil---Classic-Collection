#include "ui/screens/screen_error.h"

#include "audio/audio_system.h"
#include "input/input_manager.h"
#include "renderer/renderer.h"
#include "ui/font.h"
#include "ui/ui_system.h"

#include <sstream>
#include <string>
#include <vector>

namespace
{

void WrapText(const std::string& text, float maxW, float scale, Font& f, std::vector<std::string>* lines)
{
    lines->clear();
    if (text.empty())
    {
        lines->push_back("");
        return;
    }
    std::istringstream iss(text);
    std::string        word;
    std::string        line;
    while (iss >> word)
    {
        std::string trial = line.empty() ? word : line + " " + word;
        if (f.MeasureText(trial.c_str(), scale) <= maxW)
        {
            line = trial;
        }
        else
        {
            if (!line.empty())
            {
                lines->push_back(line);
            }
            if (f.MeasureText(word.c_str(), scale) <= maxW)
            {
                line = word;
            }
            else
            {
                lines->push_back(word);
                line.clear();
            }
        }
    }
    if (!line.empty())
    {
        lines->push_back(line);
    }
}

void DrawHintsError()
{
    Font&       f       = Font::Get();
    Renderer& r       = Renderer::Get();
    const bool  pad     = InputManager::Get().LastInputWasGamepad();
    const float rowY    = static_cast<float>(DESIGN_HEIGHT) - 50.f;
    const float lbl     = 24.f;
    const float iconToText = 8.f;
    const float groupGap = 24.f;

    const char* backKey = pad ? "B" : "ESC";
    const char* confKey = pad ? "A" : "E";

    const float wBackLbl = f.MeasureText("DISMISS", lbl);
    const float wConfLbl = f.MeasureText("DISMISS", lbl);

    const float wBack = 32.f + iconToText + wBackLbl;
    const float wConf = 32.f + iconToText + wConfLbl;

    const float totalW = wBack + groupGap + wConf;
    float       x      = (static_cast<float>(DESIGN_WIDTH) - totalW) * 0.5f;

    auto keyBox = [&](float bx, const char* keyText) {
        const float kS = 32.f;
        r.DrawQuad(bx, rowY, kS, kS, COLOR_KEY_BG);
        const float tw = f.MeasureText(keyText, 10.f);
        f.DrawText(keyText, bx + (kS - tw) * 0.5f, rowY + 8.f, 10.f, COLOR_WHITE);
    };

    keyBox(x, backKey);
    f.DrawText("DISMISS", x + 32.f + iconToText, rowY + 8.f, lbl, COLOR_HINT_TEXT);
    x += wBack + groupGap;

    keyBox(x, confKey);
    f.DrawText("DISMISS", x + 32.f + iconToText, rowY + 8.f, lbl, COLOR_HINT_TEXT);
}

} // namespace

ScreenError::ScreenError(const std::string& et, const std::string& msg)
    : errorTitle(et)
    , message(msg)
{
}

void ScreenError::OnInput()
{
    InputManager& in = InputManager::Get();
    if (in.Confirm() || in.Back())
    {
        AudioSystem::Get().PlaySound("back");
        UISystem::Get().PopScreen();
    }
}

void ScreenError::Draw()
{
    Renderer& r = Renderer::Get();
    Font&     f = Font::Get();

    r.DrawQuad(0.f, 0.f, static_cast<float>(DESIGN_WIDTH), static_cast<float>(DESIGN_HEIGHT), RGBA(0, 0, 0, 0xC0));

    const float cardW = 920.f;
    const float cardH = 480.f;
    const float cx    = (static_cast<float>(DESIGN_WIDTH) - cardW) * 0.5f;
    const float cy    = (static_cast<float>(DESIGN_HEIGHT) - cardH) * 0.5f;

    r.DrawQuad(cx - 6.f, cy - 6.f, cardW + 12.f, cardH + 12.f, COLOR_CARD_BORDER);
    r.DrawQuad(cx, cy, cardW, cardH, RGBA(0x1A, 0x1A, 0x1A, 0xFF));

    f.DrawTextCentered(errorTitle.c_str(), static_cast<float>(DESIGN_WIDTH) * 0.5f, cy + 48.f, 24.f, COLOR_RED);

    std::vector<std::string> lines;
    const float              maxW = cardW - 80.f;
    const float              scale = 20.f;
    WrapText(message, maxW, scale, f, &lines);

    float ly = cy + 140.f;
    for (size_t i = 0; i < lines.size(); ++i)
    {
        const float lw = f.MeasureText(lines[i].c_str(), scale);
        f.DrawText(lines[i].c_str(), cx + (cardW - lw) * 0.5f, ly, scale, COLOR_WHITE);
        ly += f.LineHeight(scale) + 6.f;
    }

    DrawHintsError();
}
