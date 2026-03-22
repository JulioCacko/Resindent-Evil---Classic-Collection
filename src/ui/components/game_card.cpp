#include "ui/components/game_card.h"

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

} // namespace

GameCard::GameCard(float x, float y, float w, float h)
    : titleText()
    , state(InstallState::MISSING)
    , selected(false)
{
    SetPosition(x, y);
    SetSize(w, h);
}

void GameCard::SetTitle(const char* name)
{
    titleText = name ? name : "";
}

void GameCard::SetStatus(InstallState s)
{
    state = s;
}

void GameCard::SetSelected(bool sel)
{
    selected = sel;
}

void GameCard::Draw()
{
    if (!IsVisible())
    {
        return;
    }

    const float ax = Alpha();
    Renderer& r = Renderer::Get();
    Font&     f = Font::Get();

    const float gx = X() - 4.0f;
    const float gy = Y() - 4.0f;
    const float gw = Width() + 8.0f;
    const float gh = Height() + 8.0f;

    if (selected)
    {
        r.DrawQuad(gx, gy, gw, gh, MulAlpha(RGBA(0xFF, 0xFF, 0xFF, 0x30), ax));
    }

    r.DrawQuad(X(), Y(), Width(), Height(), MulAlpha(RGBA(0x1A, 0x1A, 0x1A, 0xFF), ax));

    if (state == InstallState::MISSING)
    {
        r.DrawQuad(X(), Y(), Width(), Height(), MulAlpha(RGBA(0x00, 0x00, 0x00, 0xAA), ax));
    }

    const rcolor borderCol = selected ? MulAlpha(COLOR_WHITE, ax) : MulAlpha(COLOR_CARD_BORDER, ax);
    const float  t         = 2.0f;
    r.DrawQuad(X(), Y(), Width(), t, borderCol);
    r.DrawQuad(X(), Y() + Height() - t, Width(), t, borderCol);
    r.DrawQuad(X(), Y(), t, Height(), borderCol);
    r.DrawQuad(X() + Width() - t, Y(), t, Height(), borderCol);

    const float titleY = Y() + Height() - 60.0f;
    f.DrawTextCentered(titleText.c_str(), X() + Width() * 0.5f, titleY, 20.f, MulAlpha(COLOR_WHITE, ax));

    const char* statusStr = "INSTALLED";
    rcolor      statusCol = COLOR_GREEN;
    switch (state)
    {
    case InstallState::INSTALLED:
        statusStr = "INSTALLED";
        statusCol = COLOR_GREEN;
        break;
    case InstallState::PARTIAL:
        statusStr = "PARTIAL";
        statusCol = COLOR_YELLOW;
        break;
    case InstallState::MISSING:
        statusStr = "MISSING";
        statusCol = COLOR_RED;
        break;
    }

    const float statusY = Y() + Height() - 28.0f;
    f.DrawTextCentered(statusStr, X() + Width() * 0.5f, statusY, 16.f, MulAlpha(statusCol, ax));
}
