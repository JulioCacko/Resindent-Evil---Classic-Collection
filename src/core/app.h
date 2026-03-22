#ifndef RE_APP_H
#define RE_APP_H

#include <cstdint>

class Renderer;
class Platform;
class InputManager;
class AudioSystem;
class Config;
class UISystem;
class GameCatalog;

class App
{
public:
    static App& Get();

    bool Init(int argc, char** argv);
    void Run();
    void Shutdown();

    void Quit();
    bool IsRunning() const { return running; }
    float DeltaTime() const { return deltaTime; }
    int   FPS() const { return fps; }

private:
    App();
    ~App();
    App(const App&);
    App& operator=(const App&);

    bool     running;
    float    deltaTime;
    int      fps;
    uint64_t lastFrameTime;
};

#endif
