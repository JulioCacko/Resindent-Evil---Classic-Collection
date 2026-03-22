#ifndef RE_PLATFORM_H
#define RE_PLATFORM_H

struct SDL_Window;
typedef void* SDL_GLContext;

class Platform
{
public:
    static Platform& Get();

    bool Init(const char* title, int width, int height, bool windowed);
    void Shutdown();

    void SwapBuffers();
    void SetWindowTitle(const char* title);
    void GetWindowSize(int& w, int& h) const;

    SDL_Window* GetWindow() const { return window; }
    bool          IsWindowed() const { return bWindowed; }

private:
    Platform();
    ~Platform();
    Platform(const Platform&);
    Platform& operator=(const Platform&);

    SDL_Window*   window;
    SDL_GLContext glContext;
    int           videoWidth;
    int           videoHeight;
    bool          bWindowed;
};

#endif
