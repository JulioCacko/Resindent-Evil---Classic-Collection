#ifndef RE_FONT_H
#define RE_FONT_H

#include "core/types.h"

#include <glad/glad.h>

#include <string>

class Texture;

class Font
{
public:
    static Font& Get();
    void Init();
    void Shutdown();
    void DrawText(const char* text, float x, float y, float sizePx, rcolor color);
    void DrawTextCentered(const char* text, float cx, float y, float sizePx, rcolor color);
    float MeasureText(const char* text, float sizePx) const;
    float LineHeight(float sizePx) const;

private:
    Font();
    ~Font();

    static const int NUM_SIZES   = 5;
    static const int FIRST_CHAR  = 32;
    static const int NUM_CHARS   = 96;
    static const int ATLAS_DIM   = 512;

    struct BakedSize
    {
        float       pixelHeight;
        GLuint      texId;
        void*       chardata;
        float       ascent;
        float       descent;
        float       lineGap;
    };

    int FindBestSize(float sizePx) const;

    BakedSize sizes[NUM_SIZES];
    unsigned char* fontBuffer;
    bool initialized;
};

#endif
