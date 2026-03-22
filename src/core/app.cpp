#include "core/app.h"
#include "core/log.h"
#include "core/platform.h"
#include "core/types.h"

#include "achievements/achievement_db.h"
#include "achievements/achievement_overlay.h"
#include "audio/audio_system.h"
#include "config/config.h"
#include "config/paths.h"
#include "games/game_catalog.h"
#include "input/input_manager.h"
#include "install/gog_detector.h"
#include "install/install_validator.h"
#include "renderer/renderer.h"
#include "ui/screens/screen_install.h"
#include "ui/screens/screen_title.h"
#include "ui/ui_system.h"

#include <SDL.h>

namespace
{
bool CatalogNeedsInstallScreen(GameCatalog& catalog)
{
    std::vector<GameTitle>& titles = catalog.GetAllTitles();
    for (size_t ti = 0; ti < titles.size(); ++ti)
    {
        const GameTitle& t = titles[ti];
        if (t.installPath.empty())
        {
            return true;
        }
        bool anyInstalled = false;
        for (size_t vi = 0; vi < t.versions.size(); ++vi)
        {
            if (t.versions[vi].state == InstallState::INSTALLED)
            {
                anyInstalled = true;
                break;
            }
        }
        if (!anyInstalled)
        {
            return true;
        }
    }
    return false;
}
} // namespace

App::App()
    : running(false)
    , deltaTime(0.f)
    , fps(0)
    , lastFrameTime(0)
{
}

App::~App()
{
}

App& App::Get()
{
    static App instance;
    return instance;
}

bool App::Init(int argc, char** argv)
{
    (void)argc;
    (void)argv;

    Log::Get().Init();

    if (!Platform::Get().Init("Resident Evil - Classic Collection", DESIGN_WIDTH, DESIGN_HEIGHT, true))
    {
        Log::Get().Printf("Platform::Init failed.\n");
        Log::Get().Shutdown();
        return false;
    }

    if (!Renderer::Get().Init())
    {
        Log::Get().Printf("Renderer::Init failed.\n");
        Renderer::Get().Shutdown();
        Platform::Get().Shutdown();
        Log::Get().Shutdown();
        return false;
    }

    InputManager::Get().Init();
    AudioSystem::Get().Init();
    Config::Get().Load("config.ini");
    UISystem::Get().Init();

    GameCatalog::Get().Init();
    GOGDetector::DetectAllGames(GameCatalog::Get());
    InstallValidator::ValidateAll(GameCatalog::Get());

    AchievementDB::Get().Init();
    AchievementDB::Get().LoadProgress(Paths::JoinPath(Paths::GetConfigDirectory(), "achievements.sav"));

    if (CatalogNeedsInstallScreen(GameCatalog::Get()))
    {
        UISystem::Get().PushScreen(new ScreenInstall());
    }
    else
    {
        UISystem::Get().PushScreen(new ScreenTitle());
    }

    running       = true;
    lastFrameTime = SDL_GetPerformanceCounter();
    deltaTime     = 0.f;
    fps           = 0;
    return true;
}

void App::Run()
{
    const uint64_t perfFreq = SDL_GetPerformanceFrequency();

    while (running)
    {
        const uint64_t frameStart = SDL_GetPerformanceCounter();
        const float    frameSeconds =
            static_cast<float>(static_cast<double>(frameStart - lastFrameTime) / static_cast<double>(perfFreq));
        lastFrameTime = frameStart;
        deltaTime     = frameSeconds;
        if (deltaTime > 0.0001f)
        {
            fps = static_cast<int>(1.0f / deltaTime);
        }

        InputManager::Get().Poll();
        UISystem::Get().Update(deltaTime);
        AchievementOverlay::Get().Update(deltaTime);
        Renderer::Get().BeginFrame();
        UISystem::Get().Draw();
        AchievementOverlay::Get().Draw();
        Renderer::Get().EndFrame();
        Platform::Get().SwapBuffers();

        const uint64_t frameEnd   = SDL_GetPerformanceCounter();
        const double   elapsedSec = static_cast<double>(frameEnd - frameStart) / static_cast<double>(perfFreq);
        const double   targetSec  = 1.0 / 60.0;
        if (elapsedSec < targetSec)
        {
            const Uint32 delayMs = static_cast<Uint32>((targetSec - elapsedSec) * 1000.0);
            if (delayMs > 0)
            {
                SDL_Delay(delayMs);
            }
        }
    }
}

void App::Shutdown()
{
    AchievementDB::Get().SaveProgress(Paths::JoinPath(Paths::GetConfigDirectory(), "achievements.sav"));
    UISystem::Get().Shutdown();
    AudioSystem::Get().Shutdown();
    InputManager::Get().Shutdown();
    Renderer::Get().Shutdown();
    Platform::Get().Shutdown();
    Log::Get().Shutdown();
}

void App::Quit()
{
    running = false;
}
