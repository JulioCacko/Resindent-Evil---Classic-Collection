#include <glad/glad.h>

#include "renderer/render_target.h"

#include <cstdio>

RenderTarget::RenderTarget()
    : fboId(0)
    , texId(0)
    , rboId(0)
    , width(0)
    , height(0)
    , viewportSaved(false)
{
    savedViewport[0] = 0;
    savedViewport[1] = 0;
    savedViewport[2] = 0;
    savedViewport[3] = 0;
}

RenderTarget::~RenderTarget()
{
    Delete();
}

bool RenderTarget::Init(int w, int h, bool withDepth)
{
    Delete();

    if(w <= 0 || h <= 0)
        return false;

    width = w;
    height = h;

    glGenFramebuffers(1, &fboId);
    glBindFramebuffer(GL_FRAMEBUFFER, fboId);

    glGenTextures(1, &texId);
    glBindTexture(GL_TEXTURE_2D, texId);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texId, 0);

    if(withDepth)
    {
        glGenRenderbuffers(1, &rboId);
        glBindRenderbuffer(GL_RENDERBUFFER, rboId);
        glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, w, h);
        glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, rboId);
        glBindRenderbuffer(GL_RENDERBUFFER, 0);
    }

    GLenum bufs[1] = { GL_COLOR_ATTACHMENT0 };
    glDrawBuffers(1, bufs);

    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if(status != GL_FRAMEBUFFER_COMPLETE)
    {
        std::fprintf(stderr, "RenderTarget::Init: framebuffer incomplete (0x%x)\n", static_cast<unsigned int>(status));
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        Delete();
        return false;
    }

    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glBindTexture(GL_TEXTURE_2D, 0);
    return true;
}

void RenderTarget::Bind()
{
    glGetIntegerv(GL_VIEWPORT, savedViewport);
    viewportSaved = true;
    glBindFramebuffer(GL_FRAMEBUFFER, fboId);
    glViewport(0, 0, width, height);
}

void RenderTarget::Unbind()
{
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    if(viewportSaved)
    {
        glViewport(savedViewport[0], savedViewport[1], savedViewport[2], savedViewport[3]);
        viewportSaved = false;
    }
}

void RenderTarget::Delete()
{
    if(rboId != 0)
    {
        glDeleteRenderbuffers(1, &rboId);
        rboId = 0;
    }
    if(texId != 0)
    {
        glDeleteTextures(1, &texId);
        texId = 0;
    }
    if(fboId != 0)
    {
        glDeleteFramebuffers(1, &fboId);
        fboId = 0;
    }
    width = 0;
    height = 0;
}

void RenderTarget::BindTexture(int unit) const
{
    glActiveTexture(GL_TEXTURE0 + static_cast<GLenum>(unit));
    glBindTexture(GL_TEXTURE_2D, texId);
}

int RenderTarget::Width() const
{
    return width;
}

int RenderTarget::Height() const
{
    return height;
}

GLuint RenderTarget::FBOID() const
{
    return fboId;
}

GLuint RenderTarget::TexID() const
{
    return texId;
}
