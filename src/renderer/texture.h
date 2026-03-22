#ifndef RE_TEXTURE_H
#define RE_TEXTURE_H

#include "core/types.h"

#include <glad/glad.h>

#include <map>
#include <string>

class Texture
{
public:
    Texture();
    ~Texture();

    bool LoadFromFile(const char* path);
    bool LoadFromMemory(const byte* data, int width, int height, int channels);

    void Bind(int unit = 0) const;
    void Unbind() const;
    void Delete();

    int Width() const;
    int Height() const;
    GLuint ID() const;
    bool IsLoaded() const;

private:
    GLuint texId;
    int width;
    int height;
    int channels;
    bool loaded;
};

class TextureManager
{
public:
    static TextureManager& Get();

    Texture* LoadTexture(const char* path);
    Texture* GetTexture(const char* path);
    void Shutdown();

private:
    TextureManager();
    ~TextureManager();
    TextureManager(const TextureManager&);
    TextureManager& operator=(const TextureManager&);

    std::map<std::string, Texture*> cache;
};

#endif
