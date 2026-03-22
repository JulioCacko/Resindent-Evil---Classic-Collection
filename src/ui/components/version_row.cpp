#include "ui/components/version_row.h"

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

VersionRow::VersionRow(float x, float y, float w, float h)
    : versionName()
    , region()
    , date()
    , selected(false)
    , state(InstallState::MISSING)
{
    SetPosition(x, y);
    SetSize(w, h);
}

void VersionRow::SetVersionName(const char* name)
{
    versionName = name ? name : "";
}

void VersionRow::SetRegion(const char* r)
{
    region = r ? r : "";
}

void VersionRow::SetDate(const char* d)
{
    date = d ? d : "";
}

void VersionRow::SetSelected(bool sel)
{
    selected = sel;
}

void VersionRow::SetState(InstallState s)
{
    state = s;
}

void VersionRow::Draw()
{
    if (!IsVisible())
    {
        return;
    }

    const float ax = Alpha();
    Renderer& r = Renderer::Get();
    Font&     f = Font::Get();

    r.DrawQuad(X(), Y(), Width(), Height(), MulAlpha(COLOR_BG, ax));

    if (selected)
    {
        r.DrawQuad(X() + 2.0f, Y() + 2.0f, Width() - 4.0f, Height() - 4.0f,
            MulAlpha(RGBA(0xFF, 0xFF, 0xFF, 0x15), ax));
    }
    else
    {
        r.DrawQuad(X(), Y(), Width(), Height(), MulAlpha(RGBA(0x0F, 0x0F, 0x0F, 0x99), ax));
    }

    const rcolor borderCol = selected ? MulAlpha(COLOR_WHITE, ax) : MulAlpha(COLOR_CARD_BORDER, ax);
    const float  b         = 1.0f;
    r.DrawQuad(X(), Y(), Width(), b, borderCol);
    r.DrawQuad(X(), Y() + Height() - b, Width(), b, borderCol);
    r.DrawQuad(X(), Y(), b, Height(), borderCol);
    r.DrawQuad(X() + Width() - b, Y(), b, Height(), borderCol);

    const float textY = Y() + Height() * 0.5f - 20.0f;
    f.DrawText(versionName.c_str(), X() + 24.0f, textY, 24.f, MulAlpha(COLOR_WHITE, ax));

    const float dateW = f.MeasureText(date.c_str(), 16.f);
    f.DrawText(date.c_str(), X() + Width() - 24.0f - dateW, textY, 16.f, MulAlpha(COLOR_GREY, ax));

    const float badgePad = 8.0f;
    const float badgeW   = f.MeasureText(region.c_str(), 14.f) + badgePad * 2.0f;
    const float badgeH   = 8.0f * 1.0f + 6.0f;
    const float badgeX   = X() + Width() - badgeW - 12.0f;
    const float badgeY   = Y() + 8.0f;

    r.DrawQuad(badgeX, badgeY, badgeW, badgeH, MulAlpha(RGBA(0x2A, 0x2A, 0x2A, 0xFF), ax));
    const float regionTextW = f.MeasureText(region.c_str(), 14.f);
    f.DrawText(region.c_str(), badgeX + (badgeW - regionTextW) * 0.5f, badgeY + 3.0f, 14.f,
        MulAlpha(COLOR_WHITE, ax));
}
