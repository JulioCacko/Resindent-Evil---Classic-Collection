#include "achievements/achievement_overlay.h"

#include "renderer/renderer.h"
#include "ui/font.h"

#include <algorithm>

namespace
{

const float kCardW = 400.0f;
const float kCardH = 100.0f;
const float kPadX  = 12.0f;
const float kPadY  = 10.0f;
const float kBorder = 2.0f;

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

const float AchievementOverlay::FADE_IN_TIME  = 0.3f;
const float AchievementOverlay::HOLD_TIME     = 3.0f;
const float AchievementOverlay::FADE_OUT_TIME = 0.3f;

AchievementOverlay::AchievementOverlay()
{
}

AchievementOverlay::~AchievementOverlay()
{
}

AchievementOverlay& AchievementOverlay::Get()
{
    static AchievementOverlay instance;
    return instance;
}

void AchievementOverlay::ShowUnlock(const std::string& name, const std::string& description)
{
    PopupItem p;
    p.name  = name;
    p.desc  = description;
    p.timer = 0.0f;
    p.state = PopupItem::FADE_IN;
    queue_.push_back(p);
}

void AchievementOverlay::Update(float dt)
{
    if (queue_.empty())
    {
        return;
    }

    PopupItem& front = queue_[0];
    front.timer += dt;

    switch (front.state)
    {
    case PopupItem::FADE_IN:
        if (front.timer >= FADE_IN_TIME)
        {
            front.state = PopupItem::HOLD;
            front.timer = 0.0f;
        }
        break;
    case PopupItem::HOLD:
        if (front.timer >= HOLD_TIME)
        {
            front.state = PopupItem::FADE_OUT;
            front.timer = 0.0f;
        }
        break;
    case PopupItem::FADE_OUT:
        if (front.timer >= FADE_OUT_TIME)
        {
            front.state = PopupItem::DONE;
        }
        break;
    case PopupItem::DONE:
        break;
    }

    if (!queue_.empty() && queue_[0].state == PopupItem::DONE)
    {
        queue_.erase(queue_.begin());
    }
}

void AchievementOverlay::Draw()
{
    if (queue_.empty())
    {
        return;
    }

    const PopupItem& p = queue_[0];
    if (p.state == PopupItem::DONE)
    {
        return;
    }

    float alpha = 1.0f;
    if (p.state == PopupItem::FADE_IN)
    {
        alpha = FADE_IN_TIME > 0.0f ? std::min(1.0f, p.timer / FADE_IN_TIME) : 1.0f;
    }
    else if (p.state == PopupItem::FADE_OUT)
    {
        alpha = FADE_OUT_TIME > 0.0f ? std::max(0.0f, 1.0f - p.timer / FADE_OUT_TIME) : 0.0f;
    }

    const float x = static_cast<float>(DESIGN_WIDTH) - 420.0f;
    const float y = 30.0f;

    const rcolor bg =
        MulAlpha(RGBA(0x1A, 0x1A, 0x1A, 0xEE), alpha);
    const rcolor borderCol = MulAlpha(RGBA(0xD4, 0xAF, 0x37, 0xFF), alpha);
    const rcolor goldText   = MulAlpha(RGBA(0xD4, 0xAF, 0x37, 0xFF), alpha);
    const rcolor whiteText  = MulAlpha(COLOR_WHITE, alpha);
    const rcolor greyText   = MulAlpha(COLOR_GREY, alpha);

    Renderer& r = Renderer::Get();
    Font&     f = Font::Get();

    r.DrawQuad(x, y, kCardW, kCardH, bg);

    r.DrawQuad(x, y, kCardW, kBorder, borderCol);
    r.DrawQuad(x, y + kCardH - kBorder, kCardW, kBorder, borderCol);
    r.DrawQuad(x, y + kBorder, kBorder, kCardH - 2.0f * kBorder, borderCol);
    r.DrawQuad(x + kCardW - kBorder, y + kBorder, kBorder, kCardH - 2.0f * kBorder, borderCol);

    float ty = y + kPadY;
    f.DrawText("ACHIEVEMENT UNLOCKED", x + kPadX, ty, 14.f, goldText);
    ty += 18.0f;
    f.DrawText(p.name.c_str(), x + kPadX, ty, 18.f, whiteText);
    ty += 24.0f;
    f.DrawText(p.desc.c_str(), x + kPadX, ty, 14.f, greyText);
}
