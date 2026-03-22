#include "ui/screens/screen_launch.h"

#include "audio/audio_system.h"
#include "config/paths.h"
#include "games/game_entry.h"
#include "games/game_launcher.h"
#include "games/mod_loader.h"
#include "input/input_manager.h"
#include "renderer/crt_filter.h"
#include "renderer/renderer.h"
#include "renderer/texture.h"
#include "ui/font.h"
#include "ui/screens/screen_error.h"
#include "ui/ui_system.h"

#include <string>

namespace
{

static float Clamp01(float v) { return v < 0.f ? 0.f : (v > 1.f ? 1.f : v); }

rcolor MulAlpha(rcolor base, float a)
{
    if (a <= 0.f) return RGBA(0, 0, 0, 0);
    if (a >= 1.f) return base;
    float na = (static_cast<float>(RGBA_A(base)) / 255.f) * a;
    return RGBA(RGBA_R(base), RGBA_G(base), RGBA_B(base), static_cast<byte>(na * 255.f));
}

void DrawHelperBarLaunch()
{
    Font& f = Font::Get();
    Renderer& r = Renderer::Get();
    const float W = static_cast<float>(DESIGN_WIDTH);
    const float barY = static_cast<float>(DESIGN_HEIGHT) - 68.f;
    const float iconToText = 10.f;
    const float groupGap = 32.f;
    const float fontSize = 20.f;
    const float keyY = barY + 20.f;
    const float iconW = 28.f;
    const float iconH = 28.f;

    auto drawKeyCap = [&](float kx, float ky, const char* label) {
        r.DrawQuad(kx, ky, iconW, iconH, RGBA(0x2A, 0x2A, 0x2A, 0xDD));
        r.DrawBorder(kx, ky, iconW, iconH, 1.f, RGBA(0x44, 0x44, 0x44, 0xAA));
        float tw = f.MeasureText(label, 11.f);
        f.DrawText(label, kx + (iconW - tw) * 0.5f, ky + 7.f, 11.f, COLOR_WHITE);
    };

    const float wBackLbl = f.MeasureText("Back", fontSize);
    const float wConfLbl = f.MeasureText("Confirm", fontSize);
    const float wChgLbl  = f.MeasureText("Change", fontSize);

    const float wBack = iconW + iconToText + wBackLbl;
    const float wConf = iconW + iconToText + wConfLbl;
    const float wChg  = iconW * 2.f + 4.f + iconToText + wChgLbl;
    const float totalW = wBack + groupGap + wConf + groupGap + wChg;
    float x = (W - totalW) * 0.5f;

    drawKeyCap(x, keyY, "Esc");
    f.DrawText("Back", x + iconW + iconToText, keyY + 5.f, fontSize, COLOR_HINT_TEXT);
    x += wBack + groupGap;

    drawKeyCap(x, keyY, "E");
    f.DrawText("Confirm", x + iconW + iconToText, keyY + 5.f, fontSize, COLOR_HINT_TEXT);
    x += wConf + groupGap;

    drawKeyCap(x, keyY, "<");
    drawKeyCap(x + iconW + 4.f, keyY, ">");
    f.DrawText("Change", x + iconW * 2.f + 4.f + iconToText, keyY + 5.f, fontSize, COLOR_HINT_TEXT);
}

} // namespace

ScreenLaunch::ScreenLaunch(GameTitle* t, int vi)
    : title(t)
    , versionIndex(vi)
    , optionIndex(0)
    , useEnhanced(true)
    , crtEnabled(false)
    , fadeAlpha(0.f)
{
}

void ScreenLaunch::OnEnter()
{
    optionIndex = 0;
    fadeAlpha = 0.f;
    crtEnabled = CRTFilter::Get().IsEnabled();

    std::string exeDir = Paths::GetExeDirectory();
    bgTexture.reset(new Texture());
    if (!bgTexture->LoadFromFile(Paths::Join(exeDir, "media/main_bg.png").c_str()))
        bgTexture.reset();

    if (title && versionIndex >= 0 && versionIndex < static_cast<int>(title->versions.size()))
    {
        const GameVersion& v = title->versions[static_cast<size_t>(versionIndex)];
        useEnhanced = v.hasMod;
    }
    else
    {
        useEnhanced = false;
    }
}

void ScreenLaunch::OnInput()
{
    if (!title || versionIndex < 0 || versionIndex >= static_cast<int>(title->versions.size()))
        return;

    GameVersion& v = title->versions[static_cast<size_t>(versionIndex)];
    InputManager& in = InputManager::Get();
    AudioSystem& audio = AudioSystem::Get();

    if (in.NavigateUp())
    {
        optionIndex = (optionIndex + 2) % 3;
        audio.PlaySound("cursor");
    }
    if (in.NavigateDown())
    {
        optionIndex = (optionIndex + 1) % 3;
        audio.PlaySound("cursor");
    }

    if (optionIndex == 0 && v.hasMod)
    {
        if (in.NavigateLeft() || in.NavigateRight())
        {
            useEnhanced = !useEnhanced;
            audio.PlaySound("cursor");
        }
    }

    if (optionIndex == 1)
    {
        if (in.NavigateLeft() || in.NavigateRight())
        {
            crtEnabled = !crtEnabled;
            CRTFilter::Get().SetEnabled(crtEnabled);
            audio.PlaySound("cursor");
        }
    }

    if (in.Back())
    {
        audio.PlaySound("back");
        UISystem::Get().PopScreen();
        return;
    }

    if (in.Confirm() && optionIndex == 2)
    {
        audio.PlaySound("confirm");
        if (title->installPath.empty())
        {
            UISystem::Get().PushScreen(new ScreenError("LAUNCH FAILED", "Game is not installed or path is unknown."));
            return;
        }
        if (useEnhanced && v.hasMod)
        {
            const std::string modRoot = Paths::Join(Paths::GetExeDirectory(), "reenhancemods");
            if (!ModLoader::InjectMod(v, title->installPath, modRoot))
            {
                UISystem::Get().PushScreen(
                    new ScreenError("MOD INSTALL FAILED", "Could not copy enhancement files. Check reenhancemods folder."));
                return;
            }
        }
        if (!GameLauncher::Launch(v, title->installPath, useEnhanced))
        {
            UISystem::Get().PushScreen(new ScreenError("LAUNCH FAILED", "Could not start the game executable."));
            return;
        }
        UISystem::Get().PopScreen();
    }
}

void ScreenLaunch::Update(float dt)
{
    fadeAlpha = Clamp01(fadeAlpha + dt * 3.5f);
}

void ScreenLaunch::Draw()
{
    Renderer& r = Renderer::Get();
    Font& f = Font::Get();
    const float W = static_cast<float>(DESIGN_WIDTH);
    const float H = static_cast<float>(DESIGN_HEIGHT);
    const float alpha = fadeAlpha;

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

    if (!title || versionIndex < 0 || versionIndex >= static_cast<int>(title->versions.size()))
    {
        f.DrawTextCentered("INVALID GAME", W * 0.5f, 400.f, 32.f, COLOR_RED);
        DrawHelperBarLaunch();
        return;
    }

    GameVersion& v = title->versions[static_cast<size_t>(versionIndex)];

    // Title area
    f.DrawTextCentered("Launch Options", W * 0.5f, 100.f, 40.f, MulAlpha(COLOR_WHITE, alpha));

    std::string subtitle = title->name + "  /  " + v.displayName;
    f.DrawTextCentered(subtitle.c_str(), W * 0.5f, 160.f, 18.f, MulAlpha(COLOR_HINT_TEXT, alpha));

    // Options panel
    const float panelW = 720.f;
    const float panelX = (W - panelW) * 0.5f;
    float panelY = 260.f;
    const float panelH = 300.f;
    r.DrawQuad(panelX, panelY, panelW, panelH, MulAlpha(RGBA(0x14, 0x14, 0x14, 0xDD), alpha));
    r.DrawBorder(panelX, panelY, panelW, panelH, 1.f, MulAlpha(RGBA(0x44, 0x44, 0x44, 0x66), alpha));

    const float rowH = 56.f;
    const float rowGap = 8.f;
    const float optX = panelX + 24.f;
    const float optW = panelW - 48.f;
    float optY = panelY + 20.f;

    auto drawOptionRow = [&](int idx, const char* label, const char* value) {
        bool sel = (optionIndex == idx);
        float ry = optY + static_cast<float>(idx) * (rowH + rowGap);

        if (sel)
        {
            r.DrawQuad(optX, ry, optW, rowH, MulAlpha(RGBA(0xFF, 0xFF, 0xFF, 0x10), alpha));
            r.DrawBorder(optX, ry, optW, rowH, 1.f, MulAlpha(RGBA(0x66, 0x66, 0x66, 0xFF), alpha));
        }

        rcolor textCol = sel ? MulAlpha(COLOR_WHITE, alpha) : MulAlpha(COLOR_HINT_TEXT, alpha);
        f.DrawText(label, optX + 20.f, ry + 16.f, 22.f, textCol);

        float valW = f.MeasureText(value, 22.f);
        f.DrawText(value, optX + optW - 20.f - valW, ry + 16.f, 22.f, textCol);
    };

    const char* modeVal = (!v.hasMod) ? "ORIGINAL" : (useEnhanced ? "ENHANCED" : "ORIGINAL");
    drawOptionRow(0, "Mode", modeVal);

    const char* crtVal = crtEnabled ? "ON" : "OFF";
    drawOptionRow(1, "CRT Filter", crtVal);

    // Launch button
    float launchY = optY + 2.f * (rowH + rowGap) + 24.f;
    bool launchSel = (optionIndex == 2);
    const float btnW = 220.f;
    const float btnH = 50.f;
    float btnX = panelX + (panelW - btnW) * 0.5f;

    rcolor btnBg = launchSel ? MulAlpha(RGBA(0x00, 0xBB, 0x44, 0xFF), alpha) : MulAlpha(RGBA(0x2A, 0x2A, 0x2A, 0xFF), alpha);
    r.DrawQuad(btnX, launchY, btnW, btnH, btnBg);
    r.DrawBorder(btnX, launchY, btnW, btnH, 1.f,
        launchSel ? MulAlpha(RGBA(0x00, 0xFF, 0x55, 0xFF), alpha) : MulAlpha(RGBA(0x44, 0x44, 0x44, 0xFF), alpha));

    rcolor launchTextCol = launchSel ? MulAlpha(COLOR_WHITE, alpha) : MulAlpha(COLOR_HINT_TEXT, alpha);
    f.DrawTextCentered("LAUNCH", panelX + panelW * 0.5f, launchY + 13.f, 22.f, launchTextCol);

    DrawHelperBarLaunch();
}
