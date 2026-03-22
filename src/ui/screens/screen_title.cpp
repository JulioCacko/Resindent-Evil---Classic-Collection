#include "ui/screens/screen_title.h"

#include "audio/audio_system.h"
#include "config/paths.h"
#include "games/game_catalog.h"
#include "input/input_manager.h"
#include "renderer/renderer.h"
#include "renderer/texture.h"
#include "ui/font.h"
#include "ui/screens/screen_version.h"
#include "ui/ui_system.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

namespace
{

static float Lerp(float a, float b, float t) { return a + (b - a) * t; }
static float Clamp01(float v) { return v < 0.f ? 0.f : (v > 1.f ? 1.f : v); }
static float SmoothStep(float t) { return t * t * (3.f - 2.f * t); }

rcolor MulAlpha(rcolor base, float a)
{
    if (a <= 0.f) return RGBA(0, 0, 0, 0);
    if (a >= 1.f) return base;
    float na = (static_cast<float>(RGBA_A(base)) / 255.f) * a;
    return RGBA(RGBA_R(base), RGBA_G(base), RGBA_B(base), static_cast<byte>(na * 255.f));
}

void DrawHelperBar()
{
    Font& f = Font::Get();
    Renderer& r = Renderer::Get();
    const float W = static_cast<float>(DESIGN_WIDTH);
    const float barY = static_cast<float>(DESIGN_HEIGHT) - 68.f;
    const float iconToText = 10.f;
    const float groupGap = 32.f;
    const float fontSize = 20.f;

    const float wNavLbl  = f.MeasureText("Navigate", fontSize);
    const float wConfLbl = f.MeasureText("Confirm", fontSize);
    const float wBackLbl = f.MeasureText("Back", fontSize);

    const float iconW = 28.f;
    const float iconH = 28.f;
    const float wNav  = iconW * 2.f + 4.f + iconToText + wNavLbl;
    const float wConf = iconW + iconToText + wConfLbl;
    const float wBack = iconW + iconToText + wBackLbl;

    const float totalW = wNav + groupGap + wConf + groupGap + wBack;
    float x = (W - totalW) * 0.5f;
    const float keyY = barY + 20.f;

    auto drawKeyCap = [&](float kx, float ky, const char* label) {
        r.DrawQuad(kx, ky, iconW, iconH, RGBA(0x2A, 0x2A, 0x2A, 0xDD));
        r.DrawBorder(kx, ky, iconW, iconH, 1.f, RGBA(0x44, 0x44, 0x44, 0xAA));
        float tw = f.MeasureText(label, 11.f);
        f.DrawText(label, kx + (iconW - tw) * 0.5f, ky + 7.f, 11.f, COLOR_WHITE);
    };

    drawKeyCap(x, keyY, "<");
    drawKeyCap(x + iconW + 4.f, keyY, ">");
    f.DrawText("Navigate", x + iconW * 2.f + 4.f + iconToText, keyY + 5.f, fontSize, COLOR_HINT_TEXT);
    x += wNav + groupGap;

    drawKeyCap(x, keyY, "E");
    f.DrawText("Confirm", x + iconW + iconToText, keyY + 5.f, fontSize, COLOR_HINT_TEXT);
    x += wConf + groupGap;

    drawKeyCap(x, keyY, "Esc");
    f.DrawText("Back", x + iconW + iconToText, keyY + 5.f, fontSize, COLOR_HINT_TEXT);
}

} // namespace

ScreenTitle::ScreenTitle()
    : selectedIndex(0)
    , fadeAlpha(0.f)
    , transitionTimer(0.f)
    , transitioning(false)
    , transitionTarget(-1)
{
    for (int i = 0; i < 3; ++i)
    {
        cardScales[i] = 1.f;
        cardGlows[i] = 0.f;
    }
}

ScreenTitle::~ScreenTitle() {}

void ScreenTitle::OnEnter()
{
    selectedIndex = 0;
    coverTextures.clear();
    logoTexture.reset();
    bgTexture.reset();
    fadeAlpha = 0.f;
    transitioning = false;
    transitionTimer = 0.f;

    for (int i = 0; i < 3; ++i)
    {
        cardScales[i] = 1.f;
        cardGlows[i] = 0.f;
    }

    std::string exeDir = Paths::GetExeDirectory();

    std::string bgPath = Paths::Join(exeDir, "media/main_bg.png");
    bgTexture.reset(new Texture());
    if (!bgTexture->LoadFromFile(bgPath.c_str()))
        bgTexture.reset();

    std::string logoPath = Paths::Join(exeDir, "media/mainlogo.png");
    logoTexture.reset(new Texture());
    if (!logoTexture->LoadFromFile(logoPath.c_str()))
        logoTexture.reset();

    std::vector<GameTitle>& titles = GameCatalog::Get().GetAllTitles();
    const size_t n = std::min<size_t>(3, titles.size());
    for (size_t i = 0; i < n; ++i)
    {
        std::string texPath = Paths::Join(exeDir, titles[i].coverTexPath);
        std::unique_ptr<Texture> tex(new Texture());
        if (tex->LoadFromFile(texPath.c_str()))
            coverTextures.push_back(std::move(tex));
        else
            coverTextures.push_back(std::unique_ptr<Texture>());
    }
}

void ScreenTitle::OnInput()
{
    if (transitioning) return;

    std::vector<GameTitle>& titles = GameCatalog::Get().GetAllTitles();
    if (titles.empty()) return;
    const size_t n = std::min<size_t>(3, titles.size());

    InputManager& in = InputManager::Get();
    AudioSystem& audio = AudioSystem::Get();
    if (in.NavigateLeft())
    {
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : n - 1;
        audio.PlaySound("cursor");
    }
    if (in.NavigateRight())
    {
        selectedIndex = (selectedIndex + 1) % n;
        audio.PlaySound("cursor");
    }
    if (in.Confirm())
    {
        audio.PlaySound("confirm");
        transitioning = true;
        transitionTimer = 0.f;
        transitionTarget = static_cast<int>(selectedIndex);
    }
}

void ScreenTitle::Update(float dt)
{
    const float animSpeed = 8.f;
    fadeAlpha = Clamp01(fadeAlpha + dt * 3.f);

    for (int i = 0; i < 3; ++i)
    {
        float targetScale = (static_cast<size_t>(i) == selectedIndex) ? 1.0f : 0.92f;
        float targetGlow  = (static_cast<size_t>(i) == selectedIndex) ? 1.0f : 0.0f;
        cardScales[i] += (targetScale - cardScales[i]) * Clamp01(dt * animSpeed);
        cardGlows[i]  += (targetGlow  - cardGlows[i])  * Clamp01(dt * animSpeed);
    }

    if (transitioning)
    {
        transitionTimer += dt * 2.5f;
        if (transitionTimer >= 1.f)
        {
            transitioning = false;
            transitionTimer = 0.f;
            std::vector<GameTitle>& titles = GameCatalog::Get().GetAllTitles();
            if (transitionTarget >= 0 && transitionTarget < static_cast<int>(titles.size()))
            {
                UISystem::Get().PushScreen(new ScreenVersion(&titles[transitionTarget]));
            }
        }
    }
}

void ScreenTitle::Draw()
{
    Renderer& r = Renderer::Get();
    Font& f = Font::Get();
    const float W = static_cast<float>(DESIGN_WIDTH);
    const float H = static_cast<float>(DESIGN_HEIGHT);
    const float alpha = fadeAlpha * (transitioning ? (1.f - SmoothStep(transitionTimer)) : 1.f);

    // -- Background --
    if (bgTexture && bgTexture->IsLoaded())
    {
        float imgW = static_cast<float>(bgTexture->Width());
        float imgH = static_cast<float>(bgTexture->Height());
        float aspect = imgW / imgH;
        float drawW = W;
        float drawH = W / aspect;
        if (drawH < H) { drawH = H; drawW = H * aspect; }
        float ox = (W - drawW) * 0.5f;
        float oy = (H - drawH) * 0.5f;
        r.DrawTexture(bgTexture.get(), ox, oy, drawW, drawH, MulAlpha(COLOR_WHITE, alpha));
    }
    else
    {
        r.DrawQuad(0.f, 0.f, W, H, MulAlpha(COLOR_BG, alpha));
    }

    // -- Logo --
    const float logoAreaH = 200.f;
    const float logoTopPad = 48.f;
    if (logoTexture && logoTexture->IsLoaded())
    {
        float logoW = static_cast<float>(logoTexture->Width());
        float logoH = static_cast<float>(logoTexture->Height());
        float scale = (logoAreaH - 40.f) / logoH;
        if (logoW * scale > 640.f) scale = 640.f / logoW;
        float drawW = logoW * scale;
        float drawH = logoH * scale;
        float lx = (W - drawW) * 0.5f;
        float ly = logoTopPad + (logoAreaH - 40.f - drawH) * 0.5f;
        r.DrawTexture(logoTexture.get(), lx, ly, drawW, drawH, MulAlpha(COLOR_WHITE, alpha));
    }

    // -- "Classic Collection" subtitle badge --
    const float subtitleY = logoTopPad + logoAreaH - 28.f;
    const float subFontSize = 24.f;
    const float subW = f.MeasureText("Classic Collection", subFontSize);
    const float badgePadX = 20.f;
    const float badgePadY = 6.f;
    float badgeX = (W - subW - badgePadX * 2.f) * 0.5f;
    r.DrawQuad(badgeX, subtitleY, subW + badgePadX * 2.f, subFontSize + badgePadY * 2.f,
        MulAlpha(RGBA(0x60, 0x63, 0x6A, 0xCC), alpha));
    r.DrawBorder(badgeX, subtitleY, subW + badgePadX * 2.f, subFontSize + badgePadY * 2.f,
        1.f, MulAlpha(RGBA(0x80, 0x83, 0x8A, 0x88), alpha));
    f.DrawTextCentered("Classic Collection", W * 0.5f, subtitleY + badgePadY, subFontSize,
        MulAlpha(RGBA(0xF7, 0xF8, 0xFA, 0xFF), alpha));

    // -- Game cards --
    std::vector<GameTitle>& titles = GameCatalog::Get().GetAllTitles();
    const size_t n = std::min<size_t>(3, titles.size());

    const float baseCardW = 340.f;
    const float baseCardH = 480.f;
    const float gap = 40.f;
    const float totalCardsW = static_cast<float>(n) * baseCardW + static_cast<float>(n > 0 ? n - 1 : 0) * gap;
    const float startX = (W - totalCardsW) * 0.5f;
    const float cardTop = subtitleY + subFontSize + badgePadY * 2.f + 40.f;

    for (size_t i = 0; i < n; ++i)
    {
        float sc = i < 3 ? cardScales[i] : 1.f;
        float glow = i < 3 ? cardGlows[i] : 0.f;
        bool sel = (i == selectedIndex);

        float cardW = baseCardW * sc;
        float cardH = baseCardH * sc;
        float baseX = startX + static_cast<float>(i) * (baseCardW + gap);
        float cx = baseX + (baseCardW - cardW) * 0.5f;
        float cy = cardTop + (baseCardH - cardH) * 0.5f;

        // Card background
        r.DrawQuad(cx, cy, cardW, cardH, MulAlpha(RGBA(0x14, 0x14, 0x14, 0xFF), alpha));

        // Cover image
        if (i < coverTextures.size() && coverTextures[i] && coverTextures[i]->IsLoaded())
        {
            r.PushScissor(cx, cy, cardW, cardH);
            Texture* cover = coverTextures[i].get();
            float imgAspect = static_cast<float>(cover->Width()) / static_cast<float>(cover->Height());
            float drawW = cardW;
            float drawH = cardW / imgAspect;
            if (drawH < cardH) { drawH = cardH; drawW = cardH * imgAspect; }
            float ox = cx + (cardW - drawW) * 0.5f;
            float oy = cy + (cardH - drawH) * 0.5f;
            r.DrawTexture(cover, ox, oy, drawW, drawH, MulAlpha(COLOR_WHITE, alpha));
            r.PopScissor();
        }

        // Dim overlay for non-selected
        if (!sel)
        {
            r.DrawQuad(cx, cy, cardW, cardH, MulAlpha(RGBA(0x0F, 0x0F, 0x0F, 0xAA), alpha));
        }

        // Border
        float borderAlpha = sel ? 0.7f : 0.3f;
        r.DrawBorder(cx - 1.f, cy - 1.f, cardW + 2.f, cardH + 2.f,
            sel ? 2.f : 1.f,
            MulAlpha(RGBA(0x66, 0x66, 0x66, 0xFF), alpha * borderAlpha));

        // Glow effect for selected card
        if (glow > 0.01f)
        {
            r.DrawInnerGlow(cx, cy, cardW, cardH, 48.f * glow,
                MulAlpha(RGBA(0xFF, 0xFF, 0xFF, 0x50), alpha * glow));
        }
    }

    // -- Copyright --
    const float copyY = cardTop + baseCardH + 24.f;
    f.DrawTextCentered(
        "\xC2\xA9 CAPCOM CO.,LTD. 1996, 2025 ALL RIGHTS RESERVED. FAN CONCEPT JULIO CACKO",
        W * 0.5f, copyY, 16.f, MulAlpha(RGBA(0x88, 0x88, 0x88, 0xFF), alpha));

    // -- Bottom helper bar --
    DrawHelperBar();
}
