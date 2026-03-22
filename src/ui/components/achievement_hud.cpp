#include "ui/components/achievement_hud.h"

#include "core/types.h"
#include "renderer/renderer.h"
#include "ui/font.h"

#include <algorithm>

namespace
{

const float kFadeIn  = 0.3f;
const float kHold    = 3.0f;
const float kFadeOut = 0.3f;

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

AchievementHUD::AchievementHUD()
    : activeIndex(-1)
{
}

void AchievementHUD::Notify(const char* name, const char* description)
{
    Popup p;
    p.name  = name ? name : "";
    p.desc  = description ? description : "";
    p.timer = 0.0f;
    p.phase = Popup::FADE_IN;
    queue.push_back(p);
    if (activeIndex < 0)
    {
        activeIndex = static_cast<int>(queue.size()) - 1;
    }
}

void AchievementHUD::Update(float dt)
{
    if (activeIndex < 0 || activeIndex >= static_cast<int>(queue.size()))
    {
        return;
    }

    Popup& p = queue[static_cast<std::size_t>(activeIndex)];
    p.timer += dt;

    switch (p.phase)
    {
    case Popup::FADE_IN:
        if (p.timer >= kFadeIn)
        {
            p.phase = Popup::HOLD;
            p.timer = 0.0f;
        }
        break;
    case Popup::HOLD:
        if (p.timer >= kHold)
        {
            p.phase = Popup::FADE_OUT;
            p.timer = 0.0f;
        }
        break;
    case Popup::FADE_OUT:
        if (p.timer >= kFadeOut)
        {
            p.phase = Popup::DONE;
        }
        break;
    case Popup::DONE:
        break;
    }

    if (p.phase != Popup::DONE)
    {
        return;
    }

    activeIndex++;
    if (activeIndex >= static_cast<int>(queue.size()))
    {
        activeIndex = -1;
        queue.clear();
    }
    else
    {
        Popup& next = queue[static_cast<std::size_t>(activeIndex)];
        next.timer = 0.0f;
        next.phase = Popup::FADE_IN;
    }
}

void AchievementHUD::Draw()
{
    if (!IsVisible())
    {
        return;
    }
    if (activeIndex < 0 || activeIndex >= static_cast<int>(queue.size()))
    {
        return;
    }

    const Popup& p = queue[static_cast<std::size_t>(activeIndex)];
    if (p.phase == Popup::DONE)
    {
        return;
    }

    float alpha = 1.0f;
    if (p.phase == Popup::FADE_IN)
    {
        alpha = kFadeIn > 0.0f ? std::min(1.0f, p.timer / kFadeIn) : 1.0f;
    }
    else if (p.phase == Popup::FADE_OUT)
    {
        alpha = kFadeOut > 0.0f ? std::max(0.0f, 1.0f - p.timer / kFadeOut) : 0.0f;
    }

    const float ax = alpha * Alpha();

    const float cardW = 400.0f;
    const float cardH = 80.0f;
    const float x     = static_cast<float>(DESIGN_WIDTH) - 420.0f;
    const float y     = 30.0f;
    const float border = 1.0f;

    Renderer& r = Renderer::Get();
    Font&     f = Font::Get();

    const rcolor bg =
        MulAlpha(RGBA(0x1A, 0x1A, 0x1A, 0xEE), ax);
    const rcolor borderCol = MulAlpha(RGBA(0xD4, 0xAF, 0x37, 0xFF), ax);
    const rcolor goldText  = MulAlpha(RGBA(0xD4, 0xAF, 0x37, 0xFF), ax);

    r.DrawQuad(x, y, cardW, cardH, bg);

    r.DrawQuad(x, y, cardW, border, borderCol);
    r.DrawQuad(x, y + cardH - border, cardW, border, borderCol);
    r.DrawQuad(x, y + border, border, cardH - 2.0f * border, borderCol);
    r.DrawQuad(x + cardW - border, y + border, border, cardH - 2.0f * border, borderCol);

    float ty = y + 10.0f;
    f.DrawText("ACHIEVEMENT UNLOCKED", x + 12.0f, ty, 14.f, goldText);
    ty += 14.0f;
    f.DrawText(p.name.c_str(), x + 12.0f, ty, 16.f, MulAlpha(COLOR_WHITE, ax));
    if (!p.desc.empty())
    {
        ty += 22.0f;
        f.DrawText(p.desc.c_str(), x + 12.0f, ty, 14.f, MulAlpha(COLOR_HINT_TEXT, ax));
    }
}
