#include "ui/components/input_hints.h"

#include "core/types.h"
#include "input/input_manager.h"
#include "renderer/renderer.h"
#include "ui/font.h"

namespace
{

rcolor MulAlpha(rcolor base, float alpha)
{
    if (alpha <= 0.0f)
    {
        return RGBA(0, 0, 0, 0);
    }
    if (alpha >= 1.0f)
    {
        return base;
    }
    const float a = (static_cast<float>(RGBA_A(base)) / 255.0f) * alpha;
    return RGBA(RGBA_R(base), RGBA_G(base), RGBA_B(base), static_cast<unsigned char>(a * 255.0f));
}

void DrawKeyBox(Renderer& r, Font& f, float x, float y, const char* keyText, float ax)
{
    const float kS = 32.0f;
    r.DrawQuad(x, y, kS, kS, MulAlpha(COLOR_KEY_BG, ax));
    const float tw = f.MeasureText(keyText, 10.f);
    f.DrawText(keyText, x + (kS - tw) * 0.5f, y + 8.0f, 10.f, MulAlpha(COLOR_WHITE, ax));
}

} // namespace

InputHints::InputHints()
{
    SetPosition(0.0f, static_cast<float>(DESIGN_HEIGHT) - 67.0f);
    SetSize(static_cast<float>(DESIGN_WIDTH), 67.0f);
}

void InputHints::Draw()
{
    if (!IsVisible())
    {
        return;
    }

    const float ax         = Alpha();
    Renderer&   r          = Renderer::Get();
    Font&       f          = Font::Get();
    const bool  gamepad    = InputManager::Get().LastInputWasGamepad();
    const float rowY       = static_cast<float>(DESIGN_HEIGHT) - 50.0f;
    const float iconToText = 8.0f;
    const float groupGap   = 24.0f;
    const float lbl        = 24.f;

    const char* backKey  = gamepad ? "B" : "ESC";
    const char* confKey  = gamepad ? "A" : "E";

    const float wBackLbl = f.MeasureText("BACK", lbl);
    const float wConfLbl = f.MeasureText("CONFIRM", lbl);
    const float wNavLbl  = f.MeasureText("NAVIGATE", lbl);

    const float wBack = 32.0f + iconToText + wBackLbl;
    const float wConf = 32.0f + iconToText + wConfLbl;
    const float wNav  = 64.0f + iconToText + wNavLbl;

    const float totalW = wBack + groupGap + wConf + groupGap + wNav;
    float       x      = (static_cast<float>(DESIGN_WIDTH) - totalW) * 0.5f;

    DrawKeyBox(r, f, x, rowY, backKey, ax);
    f.DrawText("BACK", x + 32.0f + iconToText, rowY + 8.0f, lbl, MulAlpha(COLOR_HINT_TEXT, ax));
    x += wBack + groupGap;

    DrawKeyBox(r, f, x, rowY, confKey, ax);
    f.DrawText("CONFIRM", x + 32.0f + iconToText, rowY + 8.0f, lbl, MulAlpha(COLOR_HINT_TEXT, ax));
    x += wConf + groupGap;

    DrawKeyBox(r, f, x, rowY, "^", ax);
    DrawKeyBox(r, f, x + 32.0f, rowY, "v", ax);
    f.DrawText("NAVIGATE", x + 64.0f + iconToText, rowY + 8.0f, lbl, MulAlpha(COLOR_HINT_TEXT, ax));
}
