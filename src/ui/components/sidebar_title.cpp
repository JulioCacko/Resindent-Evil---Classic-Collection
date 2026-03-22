#include "ui/components/sidebar_title.h"

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

void SidebarTitle::SetTitle(const char* t)
{
    title = t ? t : "";
}

void SidebarTitle::Draw()
{
    if (!IsVisible() || title.empty())
    {
        return;
    }

    const float sizePx      = 20.f;
    const float charHeight  = sizePx;
    const float spacing     = charHeight * 0.8f;
    const float textAlpha   = 0.7f * Alpha();
    const rcolor drawCol    = MulAlpha(COLOR_WHITE, textAlpha);

    Font& f = Font::Get();

    const std::size_t n = title.size();
    const float       totalH =
        n > 0 ? (static_cast<float>(n - 1) * spacing + charHeight) : 0.0f;
    float y0 = Y() + (Height() - totalH) * 0.5f;

    for (std::size_t i = 0; i < n; ++i)
    {
        char        buf[2] = { title[i], '\0' };
        const float cw     = f.MeasureText(buf, sizePx);
        const float cx     = X() + (Width() - cw) * 0.5f;
        f.DrawText(buf, cx, y0, sizePx, drawCol);
        y0 += spacing;
    }
}
