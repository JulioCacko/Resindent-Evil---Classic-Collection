#ifndef RE_RENDER_TARGET_H
#define RE_RENDER_TARGET_H

#include "core/types.h"

#include <glad/glad.h>

class RenderTarget
{
public:
    RenderTarget();
    ~RenderTarget();

    bool Init(int width, int height, bool withDepth = false);
    void Bind();
    void Unbind();
    void Delete();

    void BindTexture(int unit = 0) const;

    int Width() const;
    int Height() const;
    GLuint FBOID() const;
    GLuint TexID() const;

private:
    GLuint fboId;
    GLuint texId;
    GLuint rboId;
    int width;
    int height;
    GLint savedViewport[4];
    bool viewportSaved;
};

#endif
