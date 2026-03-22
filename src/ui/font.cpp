#include "ui/font.h"

#include "config/paths.h"
#include "renderer/renderer.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <vector>

#define STB_TRUETYPE_IMPLEMENTATION
#include "stb_truetype.h"

static const float BAKED_SIZES[] = { 16.f, 20.f, 24.f, 32.f, 48.f };

Font::Font()
    : fontBuffer(0)
    , initialized(false)
{
    std::memset(sizes, 0, sizeof(sizes));
}

Font::~Font()
{
    Shutdown();
}

Font& Font::Get()
{
    static Font instance;
    return instance;
}

void Font::Init()
{
    if (initialized)
        return;

    std::string fontPath = Paths::Join(Paths::GetExeDirectory(), "assets/fonts/Actor-Regular.ttf");
    FILE* fp = std::fopen(fontPath.c_str(), "rb");
    if (!fp)
    {
        std::fprintf(stderr, "Font::Init: cannot open %s\n", fontPath.c_str());
        return;
    }

    std::fseek(fp, 0, SEEK_END);
    long fileSize = std::ftell(fp);
    std::fseek(fp, 0, SEEK_SET);

    if (fileSize <= 0)
    {
        std::fclose(fp);
        return;
    }

    fontBuffer = new unsigned char[static_cast<size_t>(fileSize)];
    size_t readBytes = std::fread(fontBuffer, 1, static_cast<size_t>(fileSize), fp);
    std::fclose(fp);

    if (static_cast<long>(readBytes) != fileSize)
    {
        delete[] fontBuffer;
        fontBuffer = 0;
        return;
    }

    stbtt_fontinfo fontInfo;
    if (!stbtt_InitFont(&fontInfo, fontBuffer, 0))
    {
        std::fprintf(stderr, "Font::Init: stbtt_InitFont failed\n");
        delete[] fontBuffer;
        fontBuffer = 0;
        return;
    }

    for (int i = 0; i < NUM_SIZES; ++i)
    {
        BakedSize& bs = sizes[i];
        bs.pixelHeight = BAKED_SIZES[i];

        stbtt_bakedchar* cdata = new stbtt_bakedchar[NUM_CHARS];
        bs.chardata = cdata;

        std::vector<unsigned char> bitmap(static_cast<size_t>(ATLAS_DIM * ATLAS_DIM), 0);

        stbtt_BakeFontBitmap(fontBuffer, 0, bs.pixelHeight,
            &bitmap[0], ATLAS_DIM, ATLAS_DIM,
            FIRST_CHAR, NUM_CHARS, cdata);

        float scale = stbtt_ScaleForPixelHeight(&fontInfo, bs.pixelHeight);
        int asc, desc, lg;
        stbtt_GetFontVMetrics(&fontInfo, &asc, &desc, &lg);
        bs.ascent  = static_cast<float>(asc) * scale;
        bs.descent = static_cast<float>(desc) * scale;
        bs.lineGap = static_cast<float>(lg) * scale;

        glGenTextures(1, &bs.texId);
        glBindTexture(GL_TEXTURE_2D, bs.texId);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RED, ATLAS_DIM, ATLAS_DIM, 0,
            GL_RED, GL_UNSIGNED_BYTE, &bitmap[0]);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

        GLint swizzle[] = { GL_ONE, GL_ONE, GL_ONE, GL_RED };
        glTexParameteriv(GL_TEXTURE_2D, GL_TEXTURE_SWIZZLE_RGBA, swizzle);

        glBindTexture(GL_TEXTURE_2D, 0);
    }

    initialized = true;
}

void Font::Shutdown()
{
    for (int i = 0; i < NUM_SIZES; ++i)
    {
        if (sizes[i].texId)
        {
            glDeleteTextures(1, &sizes[i].texId);
            sizes[i].texId = 0;
        }
        if (sizes[i].chardata)
        {
            delete[] static_cast<stbtt_bakedchar*>(sizes[i].chardata);
            sizes[i].chardata = 0;
        }
    }
    if (fontBuffer)
    {
        delete[] fontBuffer;
        fontBuffer = 0;
    }
    initialized = false;
}

int Font::FindBestSize(float sizePx) const
{
    int best = 0;
    float bestDiff = std::fabs(sizes[0].pixelHeight - sizePx);
    for (int i = 1; i < NUM_SIZES; ++i)
    {
        float diff = std::fabs(sizes[i].pixelHeight - sizePx);
        if (diff < bestDiff)
        {
            bestDiff = diff;
            best = i;
        }
    }
    return best;
}

float Font::MeasureText(const char* text, float sizePx) const
{
    if (!text || !initialized)
        return 0.f;

    int idx = FindBestSize(sizePx);
    const BakedSize& bs = sizes[idx];
    const stbtt_bakedchar* cdata = static_cast<const stbtt_bakedchar*>(bs.chardata);
    float scaleFactor = sizePx / bs.pixelHeight;

    float xPos = 0.f;
    for (const char* p = text; *p; ++p)
    {
        unsigned char ch = static_cast<unsigned char>(*p);
        if (ch < FIRST_CHAR || ch >= FIRST_CHAR + NUM_CHARS)
            continue;

        const stbtt_bakedchar& bc = cdata[ch - FIRST_CHAR];
        xPos += bc.xadvance * scaleFactor;
    }

    return xPos;
}

float Font::LineHeight(float sizePx) const
{
    if (!initialized)
        return sizePx;

    int idx = FindBestSize(sizePx);
    const BakedSize& bs = sizes[idx];
    float scaleFactor = sizePx / bs.pixelHeight;
    return (bs.ascent - bs.descent + bs.lineGap) * scaleFactor;
}

void Font::DrawText(const char* text, float x, float y, float sizePx, rcolor color)
{
    if (!text || !initialized)
        return;

    int idx = FindBestSize(sizePx);
    const BakedSize& bs = sizes[idx];
    const stbtt_bakedchar* cdata = static_cast<const stbtt_bakedchar*>(bs.chardata);
    float scaleFactor = sizePx / bs.pixelHeight;

    Renderer& r = Renderer::Get();

    float curX = x;
    float baseY = y + bs.ascent * scaleFactor;

    for (const char* p = text; *p; ++p)
    {
        unsigned char ch = static_cast<unsigned char>(*p);
        if (ch == '\n')
        {
            curX = x;
            baseY += (bs.ascent - bs.descent + bs.lineGap) * scaleFactor;
            continue;
        }

        if (ch < FIRST_CHAR || ch >= FIRST_CHAR + NUM_CHARS)
            continue;

        stbtt_aligned_quad q;
        float tmpX = curX / scaleFactor;
        float tmpY = baseY / scaleFactor;
        stbtt_GetBakedQuad(
            const_cast<stbtt_bakedchar*>(cdata),
            ATLAS_DIM, ATLAS_DIM,
            ch - FIRST_CHAR,
            &tmpX, &tmpY, &q, 1);

        float qx0 = q.x0 * scaleFactor;
        float qy0 = q.y0 * scaleFactor;
        float qx1 = q.x1 * scaleFactor;
        float qy1 = q.y1 * scaleFactor;

        r.DrawGlyphQuad(bs.texId, qx0, qy0, qx1 - qx0, qy1 - qy0,
            q.s0, q.t0, q.s1, q.t1, color);

        curX = tmpX * scaleFactor;
    }
}

void Font::DrawTextCentered(const char* text, float cx, float y, float sizePx, rcolor color)
{
    if (!text)
        return;
    float w = MeasureText(text, sizePx);
    DrawText(text, cx - w * 0.5f, y, sizePx, color);
}
