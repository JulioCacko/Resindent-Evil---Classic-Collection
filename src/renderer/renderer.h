#ifndef RE_RENDERER_H
#define RE_RENDERER_H

#include "core/types.h"

#include "renderer/render_target.h"
#include "renderer/shader.h"

#include <glad/glad.h>

class Texture;

class Renderer
{
public:
    static Renderer& Get();

    bool Init();
    void Shutdown();

    void BeginFrame();
    void EndFrame();

    void SetOrtho(float w, float h);

    void DrawQuad(float x, float y, float w, float h, rcolor color);
    void DrawTexture(Texture* tex, float x, float y, float w, float h, rcolor color = COLOR_WHITE);
    void DrawTextureRegion(Texture* tex, float x, float y, float w, float h,
        float u0, float v0, float u1, float v1, rcolor color = COLOR_WHITE);
    void DrawGlyphQuad(GLuint glTexId, float x, float y, float w, float h,
        float u0, float v0, float u1, float v1, rcolor color);
    void DrawBorder(float x, float y, float w, float h, float thickness, rcolor color);
    void DrawInnerGlow(float x, float y, float w, float h, float glowSize, rcolor color);
    void PushScissor(float x, float y, float w, float h);
    void PopScissor();

    ShaderProgram& GetUIShader();
    RenderTarget& GetRTUI();
    RenderTarget& GetRTFinal();

private:
    Renderer();
    ~Renderer();
    Renderer(const Renderer&);
    Renderer& operator=(const Renderer&);

    void BuildOrtho(float w, float h);
    void FillQuadVerts(float x, float y, float qw, float qh,
        float u0, float v0, float u1, float v1, rcolor color, float* out54);

    ShaderProgram uiShader;
    RenderTarget rtUI;
    RenderTarget rtFinal;
    GLuint quadVAO;
    GLuint quadVBO;
    float orthoMatrix[16];
};

#endif
