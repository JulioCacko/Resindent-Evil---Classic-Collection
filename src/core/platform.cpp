#include "core/platform.h"
#include "core/log.h"

#include <SDL.h>
#include <glad/glad.h>

Platform::Platform()
    : window(nullptr)
    , glContext(nullptr)
    , videoWidth(0)
    , videoHeight(0)
    , bWindowed(true)
{
}

Platform::~Platform()
{
    Shutdown();
}

Platform& Platform::Get()
{
    static Platform instance;
    return instance;
}

bool Platform::Init(const char* title, int width, int height, bool windowed)
{
    videoWidth  = width;
    videoHeight = height;
    bWindowed   = windowed;

    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMECONTROLLER | SDL_INIT_TIMER) != 0)
    {
        Log::Get().Error("SDL_Init failed: %s\n", SDL_GetError());
        return false;
    }

    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
    SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
    SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);

    Uint32 flags = SDL_WINDOW_OPENGL | SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE;
    if (!windowed)
    {
        flags |= SDL_WINDOW_FULLSCREEN_DESKTOP;
    }

    window = SDL_CreateWindow(
        title,
        SDL_WINDOWPOS_CENTERED,
        SDL_WINDOWPOS_CENTERED,
        width,
        height,
        flags);
    if (!window)
    {
        Log::Get().Error("SDL_CreateWindow failed: %s\n", SDL_GetError());
        return false;
    }

    glContext = SDL_GL_CreateContext(window);
    if (!glContext)
    {
        Log::Get().Error("SDL_GL_CreateContext failed: %s\n", SDL_GetError());
        SDL_DestroyWindow(window);
        window = nullptr;
        return false;
    }

    SDL_GL_MakeCurrent(window, glContext);

    if (SDL_GL_SetSwapInterval(1) != 0)
    {
        Log::Get().Warning("SDL_GL_SetSwapInterval failed: %s\n", SDL_GetError());
    }

    if (!gladLoadGLLoader(reinterpret_cast<GLADloadproc>(SDL_GL_GetProcAddress)))
    {
        Log::Get().Error("gladLoadGLLoader failed.\n");
        return false;
    }

    int w = 0;
    int h = 0;
    SDL_GetWindowSize(window, &w, &h);
    videoWidth  = w;
    videoHeight = h;

    return true;
}

void Platform::Shutdown()
{
    if (glContext)
    {
        SDL_GL_DeleteContext(glContext);
        glContext = nullptr;
    }
    if (window)
    {
        SDL_DestroyWindow(window);
        window = nullptr;
    }
    SDL_Quit();
}

void Platform::SwapBuffers()
{
    if (window)
    {
        SDL_GL_SwapWindow(window);
    }
}

void Platform::SetWindowTitle(const char* title)
{
    if (window && title)
    {
        SDL_SetWindowTitle(window, title);
    }
}

void Platform::GetWindowSize(int& w, int& h) const
{
    if (window)
    {
        SDL_GetWindowSize(window, &w, &h);
    }
    else
    {
        w = videoWidth;
        h = videoHeight;
    }
}
