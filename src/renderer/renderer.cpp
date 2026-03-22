#include <glad/glad.h>

#include "renderer/renderer.h"

#include "renderer/crt_filter.h"
#include "renderer/texture.h"

#include <cstdio>
#include <cstring>

static void ColorToFloat(rcolor c, float* out4)
{
    out4[0] = static_cast<float>(RGBA_R(c)) / 255.0f;
    out4[1] = static_cast<float>(RGBA_G(c)) / 255.0f;
    out4[2] = static_cast<float>(RGBA_B(c)) / 255.0f;
    out4[3] = static_cast<float>(RGBA_A(c)) / 255.0f;
}

Renderer::Renderer()
    : quadVAO(0)
    , quadVBO(0)
{
    std::memset(orthoMatrix, 0, sizeof(orthoMatrix));
}

Renderer::~Renderer()
{
    Shutdown();
}

Renderer& Renderer::Get()
{
    static Renderer instance;
    return instance;
}

void Renderer::BuildOrtho(float w, float h)
{
    if(w <= 0.0f || h <= 0.0f)
        return;

    std::memset(orthoMatrix, 0, sizeof(orthoMatrix));
    orthoMatrix[0] = 2.0f / w;
    orthoMatrix[5] = -2.0f / h;
    orthoMatrix[10] = -1.0f;
    orthoMatrix[12] = -1.0f;
    orthoMatrix[13] = 1.0f;
    orthoMatrix[14] = 0.0f;
    orthoMatrix[15] = 1.0f;
}

bool Renderer::Init()
{
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);

    float bg[4];
    ColorToFloat(COLOR_BG, bg);
    glClearColor(bg[0], bg[1], bg[2], bg[3]);

    uiShader.Init();
    if(!uiShader.Load("assets/shaders/ui.vert", "assets/shaders/ui.frag"))
    {
        std::fprintf(stderr, "Renderer::Init: failed to load UI shader\n");
        return false;
    }

    if(!rtUI.Init(DESIGN_WIDTH, DESIGN_HEIGHT, false))
        return false;
    if(!rtFinal.Init(DESIGN_WIDTH, DESIGN_HEIGHT, false))
        return false;

    if(!CRTFilter::Get().Init())
        std::fprintf(stderr, "Renderer::Init: CRT shader failed (CRT disabled until fixed)\n");

    SetOrtho(static_cast<float>(DESIGN_WIDTH), static_cast<float>(DESIGN_HEIGHT));

    glGenVertexArrays(1, &quadVAO);
    glGenBuffers(1, &quadVBO);
    glBindVertexArray(quadVAO);
    glBindBuffer(GL_ARRAY_BUFFER, quadVBO);
    glBufferData(GL_ARRAY_BUFFER, sizeof(float) * 9u * 6u, NULL, GL_DYNAMIC_DRAW);

    const GLsizei stride = static_cast<GLsizei>(sizeof(float) * 9u);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, stride, reinterpret_cast<const void*>(0));
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, stride, reinterpret_cast<const void*>(sizeof(float) * 3u));
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, stride, reinterpret_cast<const void*>(sizeof(float) * 5u));

    glBindVertexArray(0);
    glBindBuffer(GL_ARRAY_BUFFER, 0);

    return true;
}

void Renderer::Shutdown()
{
    CRTFilter::Get().Shutdown();

    if(quadVBO != 0)
    {
        glDeleteBuffers(1, &quadVBO);
        quadVBO = 0;
    }
    if(quadVAO != 0)
    {
        glDeleteVertexArrays(1, &quadVAO);
        quadVAO = 0;
    }

    rtUI.Delete();
    rtFinal.Delete();
    uiShader.Delete();
}

void Renderer::BeginFrame()
{
    rtUI.Bind();
    float bg[4];
    ColorToFloat(COLOR_BG, bg);
    glClearColor(bg[0], bg[1], bg[2], bg[3]);
    glClear(GL_COLOR_BUFFER_BIT);
}

void Renderer::EndFrame()
{
    rtUI.Unbind();

    CRTFilter& crt = CRTFilter::Get();
    GLuint readFbo = rtUI.FBOID();
    if(crt.IsEnabled() && crt.IsShaderReady())
    {
        crt.Apply(rtUI, rtFinal);
        readFbo = rtFinal.FBOID();
    }

    GLint vp[4];
    glGetIntegerv(GL_VIEWPORT, vp);
    const int dstW = vp[2];
    const int dstH = vp[3];

    glBindFramebuffer(GL_READ_FRAMEBUFFER, readFbo);
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
    glBlitFramebuffer(
        0, 0, DESIGN_WIDTH, DESIGN_HEIGHT,
        0, 0, dstW, dstH,
        GL_COLOR_BUFFER_BIT,
        GL_LINEAR);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

void Renderer::SetOrtho(float w, float h)
{
    BuildOrtho(w, h);
}

void Renderer::FillQuadVerts(float x, float y, float qw, float qh,
    float u0, float v0, float u1, float v1, rcolor color, float* v)
{
    float c[4];
    ColorToFloat(color, c);

    const float z = 0.0f;

    float* p = v;
    p[0] = x;
    p[1] = y;
    p[2] = z;
    p[3] = u0;
    p[4] = v0;
    p[5] = c[0];
    p[6] = c[1];
    p[7] = c[2];
    p[8] = c[3];
    p += 9;

    p[0] = x + qw;
    p[1] = y;
    p[2] = z;
    p[3] = u1;
    p[4] = v0;
    p[5] = c[0];
    p[6] = c[1];
    p[7] = c[2];
    p[8] = c[3];
    p += 9;

    p[0] = x;
    p[1] = y + qh;
    p[2] = z;
    p[3] = u0;
    p[4] = v1;
    p[5] = c[0];
    p[6] = c[1];
    p[7] = c[2];
    p[8] = c[3];
    p += 9;

    p[0] = x + qw;
    p[1] = y;
    p[2] = z;
    p[3] = u1;
    p[4] = v0;
    p[5] = c[0];
    p[6] = c[1];
    p[7] = c[2];
    p[8] = c[3];
    p += 9;

    p[0] = x + qw;
    p[1] = y + qh;
    p[2] = z;
    p[3] = u1;
    p[4] = v1;
    p[5] = c[0];
    p[6] = c[1];
    p[7] = c[2];
    p[8] = c[3];
    p += 9;

    p[0] = x;
    p[1] = y + qh;
    p[2] = z;
    p[3] = u0;
    p[4] = v1;
    p[5] = c[0];
    p[6] = c[1];
    p[7] = c[2];
    p[8] = c[3];
}

void Renderer::DrawQuad(float x, float y, float w, float h, rcolor color)
{
    float verts[9 * 6];
    FillQuadVerts(x, y, w, h, 0.0f, 0.0f, 1.0f, 1.0f, color, verts);

    uiShader.Bind();
    uiShader.SetUniform("uProjection", orthoMatrix);
    uiShader.SetUniform("uUseTexture", 0);
    glBindVertexArray(quadVAO);
    glBindBuffer(GL_ARRAY_BUFFER, quadVBO);
    glBufferSubData(GL_ARRAY_BUFFER, 0, sizeof(verts), verts);
    glDrawArrays(GL_TRIANGLES, 0, 6);
    glBindVertexArray(0);
    uiShader.Unbind();
}

void Renderer::DrawTexture(Texture* tex, float x, float y, float w, float h, rcolor color)
{
    if(!tex || !tex->IsLoaded())
        return;
    DrawTextureRegion(tex, x, y, w, h, 0.0f, 0.0f, 1.0f, 1.0f, color);
}

void Renderer::DrawTextureRegion(Texture* tex, float x, float y, float w, float h,
    float u0, float v0, float u1, float v1, rcolor color)
{
    if(!tex || !tex->IsLoaded())
        return;

    float verts[9 * 6];
    FillQuadVerts(x, y, w, h, u0, v0, u1, v1, color, verts);

    uiShader.Bind();
    uiShader.SetUniform("uProjection", orthoMatrix);
    uiShader.SetUniform("uUseTexture", 1);
    tex->Bind(0);
    uiShader.SetUniform("uTexture", 0);

    glBindVertexArray(quadVAO);
    glBindBuffer(GL_ARRAY_BUFFER, quadVBO);
    glBufferSubData(GL_ARRAY_BUFFER, 0, sizeof(verts), verts);
    glDrawArrays(GL_TRIANGLES, 0, 6);
    glBindVertexArray(0);

    tex->Unbind();
    uiShader.Unbind();
}

void Renderer::DrawGlyphQuad(GLuint glTexId, float x, float y, float w, float h,
    float u0, float v0, float u1, float v1, rcolor color)
{
    if(glTexId == 0)
        return;

    float verts[9 * 6];
    FillQuadVerts(x, y, w, h, u0, v0, u1, v1, color, verts);

    uiShader.Bind();
    uiShader.SetUniform("uProjection", orthoMatrix);
    uiShader.SetUniform("uUseTexture", 1);

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, glTexId);
    uiShader.SetUniform("uTexture", 0);

    glBindVertexArray(quadVAO);
    glBindBuffer(GL_ARRAY_BUFFER, quadVBO);
    glBufferSubData(GL_ARRAY_BUFFER, 0, sizeof(verts), verts);
    glDrawArrays(GL_TRIANGLES, 0, 6);
    glBindVertexArray(0);

    glBindTexture(GL_TEXTURE_2D, 0);
    uiShader.Unbind();
}

void Renderer::DrawBorder(float x, float y, float w, float h, float t, rcolor color)
{
    DrawQuad(x, y, w, t, color);
    DrawQuad(x, y + h - t, w, t, color);
    DrawQuad(x, y + t, t, h - 2.f * t, color);
    DrawQuad(x + w - t, y + t, t, h - 2.f * t, color);
}

void Renderer::DrawInnerGlow(float x, float y, float w, float h, float glowSize, rcolor color)
{
    const int steps = 16;
    const float baseA = static_cast<float>(RGBA_A(color)) / 255.f;
    const byte cr = static_cast<byte>(RGBA_R(color));
    const byte cg = static_cast<byte>(RGBA_G(color));
    const byte cb = static_cast<byte>(RGBA_B(color));
    const float t = glowSize / static_cast<float>(steps);
    for (int i = 0; i < steps; ++i)
    {
        float frac = static_cast<float>(i) / static_cast<float>(steps);
        float inset = frac * glowSize;
        float falloff = (1.f - frac);
        falloff = falloff * falloff * falloff;
        float a = baseA * falloff;
        if (a < 0.004f) continue;
        rcolor c = RGBA(cr, cg, cb, static_cast<byte>(a * 255.f));
        DrawBorder(x + inset, y + inset, w - 2.f * inset, h - 2.f * inset, t, c);
    }
}

void Renderer::PushScissor(float x, float y, float w, float h)
{
    glEnable(GL_SCISSOR_TEST);
    int sy = static_cast<int>(static_cast<float>(DESIGN_HEIGHT) - y - h);
    glScissor(static_cast<int>(x), sy, static_cast<int>(w), static_cast<int>(h));
}

void Renderer::PopScissor()
{
    glDisable(GL_SCISSOR_TEST);
}

ShaderProgram& Renderer::GetUIShader()
{
    return uiShader;
}

RenderTarget& Renderer::GetRTUI()
{
    return rtUI;
}

RenderTarget& Renderer::GetRTFinal()
{
    return rtFinal;
}
