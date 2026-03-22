#ifndef RE_CRT_FILTER_H
#define RE_CRT_FILTER_H

#include "core/types.h"

#include "renderer/render_target.h"
#include "renderer/shader.h"

#include <glad/glad.h>

class CRTFilter
{
public:
    static CRTFilter& Get();

    bool Init();
    void Apply(RenderTarget& source, RenderTarget& dest);
    void Shutdown();

    void SetEnabled(bool on);
    bool IsEnabled() const;
    bool IsShaderReady() const;

    float scanlineIntensity;
    float curvature;
    float rgbSplit;
    float phosphorGlow;
    float noiseAmount;

private:
    CRTFilter();
    ~CRTFilter();
    CRTFilter(const CRTFilter&);
    CRTFilter& operator=(const CRTFilter&);

    ShaderProgram crtShader;
    GLuint fsTriVAO;
    float time;
    bool enabled;
};

#endif
