#include <glad/glad.h>

#include "renderer/texture.h"

#define STB_IMAGE_IMPLEMENTATION
#include <stb_image.h>

#include <cstdio>
#include <cstring>

Texture::Texture()
    : texId(0)
    , width(0)
    , height(0)
    , channels(0)
    , loaded(false)
{
}

Texture::~Texture()
{
    Delete();
}

bool Texture::LoadFromFile(const char* path)
{
    Delete();

    stbi_set_flip_vertically_on_load(0);

    int w = 0, h = 0, ch = 0;
    unsigned char* pixels = stbi_load(path, &w, &h, &ch, 0);
    if(!pixels)
    {
        std::fprintf(stderr, "Texture::LoadFromFile: stbi_load failed: %s\n", path ? path : "(null)");
        return false;
    }

    GLenum internal = GL_RGBA;
    GLenum format = GL_RGBA;
    if(ch == 1)
    {
        internal = GL_R8;
        format = GL_RED;
    }
    else if(ch == 2)
    {
        internal = GL_RG8;
        format = GL_RG;
    }
    else if(ch == 3)
    {
        internal = GL_RGB8;
        format = GL_RGB;
    }
    else
    {
        internal = GL_RGBA8;
        format = GL_RGBA;
        ch = 4;
    }

    glGenTextures(1, &texId);
    glBindTexture(GL_TEXTURE_2D, texId);
    glTexImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(internal), w, h, 0, format, GL_UNSIGNED_BYTE, pixels);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glBindTexture(GL_TEXTURE_2D, 0);

    stbi_image_free(pixels);

    width = w;
    height = h;
    channels = ch;
    loaded = true;
    return true;
}

bool Texture::LoadFromMemory(const byte* data, int w, int h, int ch)
{
    Delete();

    if(!data || w <= 0 || h <= 0 || ch <= 0)
        return false;

    GLenum internal = GL_RGBA8;
    GLenum format = GL_RGBA;
    if(ch == 1)
    {
        internal = GL_R8;
        format = GL_RED;
    }
    else if(ch == 2)
    {
        internal = GL_RG8;
        format = GL_RG;
    }
    else if(ch == 3)
    {
        internal = GL_RGB8;
        format = GL_RGB;
    }
    else
    {
        internal = GL_RGBA8;
        format = GL_RGBA;
    }

    glGenTextures(1, &texId);
    glBindTexture(GL_TEXTURE_2D, texId);
    glTexImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(internal), w, h, 0, format, GL_UNSIGNED_BYTE, data);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glBindTexture(GL_TEXTURE_2D, 0);

    width = w;
    height = h;
    channels = ch;
    loaded = true;
    return true;
}

void Texture::Bind(int unit) const
{
    glActiveTexture(GL_TEXTURE0 + static_cast<GLenum>(unit));
    glBindTexture(GL_TEXTURE_2D, texId);
}

void Texture::Unbind() const
{
    glBindTexture(GL_TEXTURE_2D, 0);
}

void Texture::Delete()
{
    if(texId != 0)
    {
        glDeleteTextures(1, &texId);
        texId = 0;
    }
    width = 0;
    height = 0;
    channels = 0;
    loaded = false;
}

int Texture::Width() const
{
    return width;
}

int Texture::Height() const
{
    return height;
}

GLuint Texture::ID() const
{
    return texId;
}

bool Texture::IsLoaded() const
{
    return loaded;
}

TextureManager::TextureManager()
{
}

TextureManager::~TextureManager()
{
    Shutdown();
}

TextureManager& TextureManager::Get()
{
    static TextureManager instance;
    return instance;
}

Texture* TextureManager::LoadTexture(const char* path)
{
    if(!path)
        return nullptr;

    std::string key(path);
    std::map<std::string, Texture*>::iterator it = cache.find(key);
    if(it != cache.end())
        return it->second;

    Texture* t = new Texture();
    if(!t->LoadFromFile(path))
    {
        delete t;
        return nullptr;
    }
    cache[key] = t;
    return t;
}

Texture* TextureManager::GetTexture(const char* path)
{
    if(!path)
        return nullptr;
    std::string key(path);
    std::map<std::string, Texture*>::iterator it = cache.find(key);
    if(it != cache.end())
        return it->second;
    return nullptr;
}

void TextureManager::Shutdown()
{
    for(std::map<std::string, Texture*>::iterator it = cache.begin(); it != cache.end(); ++it)
    {
        delete it->second;
    }
    cache.clear();
}
