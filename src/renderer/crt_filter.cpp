#include <glad/glad.h>

#include "renderer/crt_filter.h"

#include <cstdio>

CRTFilter::CRTFilter()
    : fsTriVAO(0)
    , time(0.0f)
    , enabled(false)
    , scanlineIntensity(0.3f)
    , curvature(0.08f)
    , rgbSplit(0.002f)
    , phosphorGlow(0.15f)
    , noiseAmount(0.02f)
{
}

CRTFilter::~CRTFilter()
{
    Shutdown();
}

CRTFilter& CRTFilter::Get()
{
    static CRTFilter instance;
    return instance;
}

bool CRTFilter::Init()
{
    crtShader.Init();
    if(!crtShader.Load("assets/shaders/crt.vert", "assets/shaders/crt.frag"))
    {
        std::fprintf(stderr, "CRTFilter::Init: failed to load CRT shader\n");
        return false;
    }

    glGenVertexArrays(1, &fsTriVAO);
    glBindVertexArray(fsTriVAO);
    glBindVertexArray(0);

    return true;
}

void CRTFilter::Apply(RenderTarget& source, RenderTarget& dest)
{
    if(!crtShader.IsLoaded())
        return;

    time += 0.016f;

    dest.Bind();

    glDisable(GL_DEPTH_TEST);
    glDisable(GL_BLEND);

    crtShader.Bind();
    source.BindTexture(0);
    crtShader.SetUniform("uScreenTexture", 0);
    crtShader.SetUniform("uResolution", static_cast<float>(source.Width()), static_cast<float>(source.Height()));
    crtShader.SetUniform("uTime", time);
    crtShader.SetUniform("uScanlineIntensity", scanlineIntensity);
    crtShader.SetUniform("uCurvature", curvature);
    crtShader.SetUniform("uRGBSplit", rgbSplit);
    crtShader.SetUniform("uPhosphorGlow", phosphorGlow);
    crtShader.SetUniform("uNoiseAmount", noiseAmount);

    glBindVertexArray(fsTriVAO);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    glBindVertexArray(0);

    crtShader.Unbind();

    glBindTexture(GL_TEXTURE_2D, 0);

    dest.Unbind();

    glEnable(GL_BLEND);
}

void CRTFilter::Shutdown()
{
    if(fsTriVAO != 0)
    {
        glDeleteVertexArrays(1, &fsTriVAO);
        fsTriVAO = 0;
    }
    crtShader.Delete();
}

void CRTFilter::SetEnabled(bool on)
{
    enabled = on;
}

bool CRTFilter::IsEnabled() const
{
    return enabled;
}

bool CRTFilter::IsShaderReady() const
{
    return crtShader.IsLoaded();
}
