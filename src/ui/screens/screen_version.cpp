#include "ui/screens/screen_version.h"

#include "audio/audio_system.h"
#include "config/paths.h"
#include "games/game_entry.h"
#include "input/input_manager.h"
#include "renderer/renderer.h"
#include "renderer/texture.h"
#include "ui/font.h"
#include "ui/screens/screen_launch.h"
#include "ui/ui_system.h"

#include <algorithm>
#include <cmath>
#include <sstream>
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

void WrapText(const std::string& text, float maxW, float sizePx, Font& f, std::vector<std::string>& out)
{
    out.clear();
    if (text.empty()) { out.push_back(""); return; }

    std::string current;
    for (size_t i = 0; i < text.size(); ++i)
    {
        if (text[i] == '\n')
        {
            out.push_back(current);
            current.clear();
            continue;
        }
        current += text[i];
    }
    if (!current.empty()) out.push_back(current);

    std::vector<std::string> wrapped;
    for (size_t p = 0; p < out.size(); ++p)
    {
        if (out[p].empty()) { wrapped.push_back(""); continue; }
        std::istringstream iss(out[p]);
        std::string word, line;
        while (iss >> word)
        {
            std::string trial = line.empty() ? word : line + " " + word;
            if (f.MeasureText(trial.c_str(), sizePx) <= maxW)
                line = trial;
            else
            {
                if (!line.empty()) wrapped.push_back(line);
                line = word;
            }
        }
        if (!line.empty()) wrapped.push_back(line);
    }
    out = wrapped;
}

void DrawHelperBarVersion()
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

    const float wNavLbl  = f.MeasureText("Navigate", fontSize);
    const float wConfLbl = f.MeasureText("Confirm", fontSize);
    const float wBackLbl = f.MeasureText("Back", fontSize);

    const float wNav  = iconW * 2.f + 4.f + iconToText + wNavLbl;
    const float wConf = iconW + iconToText + wConfLbl;
    const float wBack = iconW + iconToText + wBackLbl;
    const float totalW = wNav + groupGap + wConf + groupGap + wBack;
    float x = (W - totalW) * 0.5f;

    drawKeyCap(x, keyY, "^");
    drawKeyCap(x + iconW + 4.f, keyY, "v");
    f.DrawText("Navigate", x + iconW * 2.f + 4.f + iconToText, keyY + 5.f, fontSize, COLOR_HINT_TEXT);
    x += wNav + groupGap;

    drawKeyCap(x, keyY, "E");
    f.DrawText("Confirm", x + iconW + iconToText, keyY + 5.f, fontSize, COLOR_HINT_TEXT);
    x += wConf + groupGap;

    drawKeyCap(x, keyY, "Esc");
    f.DrawText("Back", x + iconW + iconToText, keyY + 5.f, fontSize, COLOR_HINT_TEXT);
}

} // namespace

ScreenVersion::ScreenVersion(GameTitle* t)
    : title(t)
    , selectedVersion(0)
    , fadeAlpha(0.f)
    , transitionTimer(0.f)
    , transitioning(false)
{
    for (int i = 0; i < 8; ++i) versionGlows[i] = 0.f;
}

ScreenVersion::~ScreenVersion() {}

void ScreenVersion::OnEnter()
{
    selectedVersion = 0;
    heroTextures.clear();
    logoTexture.reset();
    bgTexture.reset();
    sideArtTexture.reset();
    fadeAlpha = 0.f;
    transitioning = false;
    transitionTimer = 0.f;
    for (int i = 0; i < 8; ++i) versionGlows[i] = 0.f;

    if (!title) return;
    std::string exeDir = Paths::GetExeDirectory();

    std::string bgPath = Paths::Join(exeDir, "media/main_bg.png");
    bgTexture.reset(new Texture());
    if (!bgTexture->LoadFromFile(bgPath.c_str()))
        bgTexture.reset();

    std::string logoPath = Paths::Join(exeDir, title->logoImagePath);
    logoTexture.reset(new Texture());
    if (!logoTexture->LoadFromFile(logoPath.c_str()))
        logoTexture.reset();

    for (size_t i = 0; i < title->versions.size(); ++i)
    {
        std::string heroPath = Paths::Join(exeDir, title->versions[i].heroImagePath);
        std::unique_ptr<Texture> tex(new Texture());
        if (tex->LoadFromFile(heroPath.c_str()))
            heroTextures.push_back(std::move(tex));
        else
            heroTextures.push_back(std::unique_ptr<Texture>());
    }
}

void ScreenVersion::OnInput()
{
    if (!title || title->versions.empty()) return;
    if (transitioning) return;

    InputManager& in = InputManager::Get();
    AudioSystem& audio = AudioSystem::Get();
    const int nv = static_cast<int>(title->versions.size());

    if (in.NavigateUp())
    {
        selectedVersion = (selectedVersion - 1 + nv) % nv;
        audio.PlaySound("cursor");
    }
    if (in.NavigateDown())
    {
        selectedVersion = (selectedVersion + 1) % nv;
        audio.PlaySound("cursor");
    }
    if (in.Confirm())
    {
        audio.PlaySound("confirm");
        transitioning = true;
        transitionTimer = 0.f;
    }
    if (in.Back())
    {
        audio.PlaySound("back");
        UISystem::Get().PopScreen();
    }
}

void ScreenVersion::Update(float dt)
{
    fadeAlpha = Clamp01(fadeAlpha + dt * 3.5f);

    const int nv = title ? static_cast<int>(title->versions.size()) : 0;
    for (int i = 0; i < 8 && i < nv; ++i)
    {
        float target = (i == selectedVersion) ? 1.f : 0.f;
        versionGlows[i] += (target - versionGlows[i]) * Clamp01(dt * 8.f);
    }

    if (transitioning)
    {
        transitionTimer += dt * 2.5f;
        if (transitionTimer >= 1.f)
        {
            transitioning = false;
            transitionTimer = 0.f;
            if (title)
                UISystem::Get().PushScreen(new ScreenLaunch(title, selectedVersion));
        }
    }
}

void ScreenVersion::Draw()
{
    if (!title) return;

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

    const float leftW = 1060.f;
    const float rightW = W - leftW;
    const float padX = 40.f;
    const float topPad = 48.f;
    const float bottomPad = 80.f;

    // -- Left panel header --
    f.DrawText("Game Version", padX, topPad, 28.f, MulAlpha(COLOR_CCC, alpha));

    // -- Version rows --
    const int nv = static_cast<int>(title->versions.size());
    const float listTop = topPad + 56.f;
    const float listBottom = H - bottomPad;
    const float listH = listBottom - listTop;
    const float vGap = 14.f;
    const float totalGaps = nv > 1 ? static_cast<float>(nv - 1) * vGap : 0.f;
    float rowH = nv > 0 ? (listH - totalGaps) / static_cast<float>(nv) : 200.f;
    if (rowH > 260.f) rowH = 260.f;

    for (int i = 0; i < nv; ++i)
    {
        float ry = listTop + static_cast<float>(i) * (rowH + vGap);
        float rx = padX;
        float rw = leftW - padX * 2.f;
        bool sel = (i == selectedVersion);
        float glow = (i < 8) ? versionGlows[i] : 0.f;

        // Row background
        r.DrawQuad(rx, ry, rw, rowH, MulAlpha(RGBA(0x14, 0x14, 0x14, 0xDD), alpha));

        // Hero image
        if (i < static_cast<int>(heroTextures.size()) && heroTextures[static_cast<size_t>(i)] &&
            heroTextures[static_cast<size_t>(i)]->IsLoaded())
        {
            r.PushScissor(rx, ry, rw, rowH);
            Texture* heroTex = heroTextures[static_cast<size_t>(i)].get();
            float imgAspect = static_cast<float>(heroTex->Width()) / static_cast<float>(heroTex->Height());
            float drawW = rw;
            float drawH = rw / imgAspect;
            if (drawH < rowH) { drawH = rowH; drawW = rowH * imgAspect; }
            float ox = rx + (rw - drawW) * 0.5f;
            float oy = ry + (rowH - drawH) * 0.5f;
            r.DrawTexture(heroTex, ox, oy, drawW, drawH, MulAlpha(COLOR_WHITE, alpha));
            r.PopScissor();
        }

        // Dim overlay for non-selected
        if (!sel)
        {
            r.DrawQuad(rx, ry, rw, rowH, MulAlpha(RGBA(0x0F, 0x0F, 0x0F, 0xAA), alpha));
        }

        // Border
        float borderAlpha = sel ? 0.7f : 0.3f;
        r.DrawBorder(rx - 1.f, ry - 1.f, rw + 2.f, rowH + 2.f,
            sel ? 2.f : 1.f,
            MulAlpha(RGBA(0x66, 0x66, 0x66, 0xFF), alpha * borderAlpha));

        // Glow
        if (glow > 0.01f)
        {
            r.DrawInnerGlow(rx, ry, rw, rowH, 36.f * glow,
                MulAlpha(RGBA(0xFF, 0xFF, 0xFF, 0x40), alpha * glow));
        }
    }

    // -- Right panel: Game info --
    const float rightX = leftW;
    const float infoPadX = 36.f;
    const float infoX = rightX + infoPadX;
    const float infoW = rightW - infoPadX * 2.f;

    // Semi-transparent panel background
    r.DrawQuad(rightX, 0.f, rightW, H, MulAlpha(RGBA(0x0A, 0x0A, 0x0A, 0xCC), alpha));

    // Hero image at top of right panel
    const float heroAreaH = 400.f;
    int selIdx = selectedVersion >= 0 && selectedVersion < nv ? selectedVersion : 0;
    if (selIdx < static_cast<int>(heroTextures.size()) && heroTextures[static_cast<size_t>(selIdx)] &&
        heroTextures[static_cast<size_t>(selIdx)]->IsLoaded())
    {
        r.PushScissor(rightX, 0.f, rightW, heroAreaH);
        Texture* hero = heroTextures[static_cast<size_t>(selIdx)].get();
        float imgAspect = static_cast<float>(hero->Width()) / static_cast<float>(hero->Height());
        float drawW = rightW;
        float drawH = rightW / imgAspect;
        if (drawH < heroAreaH) { drawH = heroAreaH; drawW = heroAreaH * imgAspect; }
        float ox = rightX + (rightW - drawW) * 0.5f;
        r.DrawTexture(hero, ox, 0.f, drawW, drawH, MulAlpha(COLOR_WHITE, alpha));
        r.PopScissor();
    }

    // Gradient fade over hero
    for (int gi = 0; gi < 16; ++gi)
    {
        float frac = static_cast<float>(gi) / 16.f;
        float gY = heroAreaH - 160.f + frac * 160.f;
        float smoothFrac = frac * frac;
        byte ga = static_cast<byte>(smoothFrac * 220.f);
        r.DrawQuad(rightX, gY, rightW, 10.f, MulAlpha(RGBA(0x0A, 0x0A, 0x0A, ga), alpha));
    }
    r.DrawQuad(rightX, heroAreaH, rightW, H - heroAreaH, MulAlpha(RGBA(0x0A, 0x0A, 0x0A, 0xCC), alpha));

    float infoY = heroAreaH + 8.f;

    // Game logo
    if (logoTexture && logoTexture->IsLoaded())
    {
        float logoW = static_cast<float>(logoTexture->Width());
        float logoH = static_cast<float>(logoTexture->Height());
        float scale = 60.f / logoH;
        if (logoW * scale > 280.f) scale = 280.f / logoW;
        r.DrawTexture(logoTexture.get(), infoX, infoY, logoW * scale, logoH * scale,
            MulAlpha(COLOR_WHITE, alpha));
        infoY += logoH * scale + 12.f;
    }
    else
    {
        f.DrawText(title->name.c_str(), infoX, infoY, 28.f, MulAlpha(COLOR_WHITE, alpha));
        infoY += 40.f;
    }

    // Release date
    if (selIdx < nv)
    {
        GameVersion& v = title->versions[static_cast<size_t>(selIdx)];
        f.DrawText(v.releaseDate.c_str(), infoX, infoY, 28.f, MulAlpha(COLOR_WHITE, alpha));
        infoY += 40.f;

        // Description
        std::vector<std::string> descLines;
        WrapText(v.description, infoW, 18.f, f, descLines);
        for (size_t li = 0; li < descLines.size(); ++li)
        {
            f.DrawText(descLines[li].c_str(), infoX, infoY, 18.f,
                MulAlpha(RGBA(0xDD, 0xDD, 0xDD, 0xFF), alpha));
            infoY += f.LineHeight(18.f) + 3.f;
        }
        infoY += 16.f;

        // Info box
        const float boxH = 72.f;
        float boxY = infoY;
        if (boxY + boxH > H - bottomPad)
            boxY = H - bottomPad - boxH;

        r.DrawQuad(infoX, boxY, infoW, boxH, MulAlpha(RGBA(0x14, 0x14, 0x14, 0xEE), alpha));
        r.DrawBorder(infoX, boxY, infoW, boxH, 1.f,
            MulAlpha(RGBA(0x44, 0x44, 0x44, 0x66), alpha));

        std::string relLine = "ORIGINALLY RELEASED IN  " + v.releaseDate;
        f.DrawText(relLine.c_str(), infoX + 16.f, boxY + 14.f, 14.f,
            MulAlpha(RGBA(0xCC, 0xCC, 0xCC, 0xFF), alpha));

        std::string voiceLine = "VOICES:  " + v.voices + "  |  SUBTITLES:  " + v.subtitles;
        f.DrawText(voiceLine.c_str(), infoX + 16.f, boxY + 38.f, 14.f,
            MulAlpha(RGBA(0xCC, 0xCC, 0xCC, 0xFF), alpha));
    }

    DrawHelperBarVersion();
}
