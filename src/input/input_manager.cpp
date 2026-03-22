#include "input/input_manager.h"

#include "core/app.h"

#include <cstring>

namespace
{
    float g_stickNavXLastFrame = 0.f;
    float g_stickNavYLastFrame = 0.f;
}

InputManager::InputManager()
    : mouseX(0)
    , mouseY(0)
    , controller(0)
    , lastWasGamepad(false)
    , axisDeadzone(0.2f)
{
    std::memset(keysCurrentFrame, 0, sizeof(keysCurrentFrame));
    std::memset(keysLastFrame, 0, sizeof(keysLastFrame));
    std::memset(mouseButtons, 0, sizeof(mouseButtons));
    std::memset(mouseButtonsLast, 0, sizeof(mouseButtonsLast));
    std::memset(gamepadButtons, 0, sizeof(gamepadButtons));
    std::memset(gamepadButtonsLast, 0, sizeof(gamepadButtonsLast));
    std::memset(gamepadAxes, 0, sizeof(gamepadAxes));
}

InputManager::~InputManager() {}

InputManager& InputManager::Get()
{
    static InputManager instance;
    return instance;
}

void InputManager::OpenFirstController()
{
    if (controller)
    {
        return;
    }
    const int num = SDL_NumJoysticks();
    for (int i = 0; i < num; ++i)
    {
        if (SDL_IsGameController(i))
        {
            controller = SDL_GameControllerOpen(i);
            break;
        }
    }
}

void InputManager::CloseController()
{
    if (controller)
    {
        SDL_GameControllerClose(controller);
        controller = 0;
    }
}

void InputManager::Init()
{
    SDL_GameControllerEventState(SDL_ENABLE);
    OpenFirstController();
}

void InputManager::Shutdown()
{
    CloseController();
}

float InputManager::ApplyAxisDeadzone(float normalized) const
{
    const float a = normalized >= 0.f ? normalized : -normalized;
    if (a < axisDeadzone)
    {
        return 0.f;
    }
    const float sign = normalized >= 0.f ? 1.f : -1.f;
    return sign * ((a - axisDeadzone) / (1.f - axisDeadzone));
}

void InputManager::UpdateAxesFromController()
{
    if (!controller)
    {
        std::memset(gamepadAxes, 0, sizeof(gamepadAxes));
        return;
    }
    for (int a = 0; a < SDL_CONTROLLER_AXIS_MAX; ++a)
    {
        const Sint16 raw = SDL_GameControllerGetAxis(controller, static_cast<SDL_GameControllerAxis>(a));
        float n = static_cast<float>(raw) / 32767.0f;
        if (n > 1.f)
        {
            n = 1.f;
        }
        if (n < -1.f)
        {
            n = -1.f;
        }
        gamepadAxes[a] = n;
    }
}

void InputManager::Poll()
{
    std::memcpy(keysLastFrame, keysCurrentFrame, sizeof(keysCurrentFrame));
    std::memcpy(mouseButtonsLast, mouseButtons, sizeof(mouseButtons));
    std::memcpy(gamepadButtonsLast, gamepadButtons, sizeof(gamepadButtons));

    g_stickNavXLastFrame = ApplyAxisDeadzone(gamepadAxes[SDL_CONTROLLER_AXIS_LEFTX]);
    g_stickNavYLastFrame = ApplyAxisDeadzone(gamepadAxes[SDL_CONTROLLER_AXIS_LEFTY]);

    SDL_Event e;
    while (SDL_PollEvent(&e))
    {
        switch (e.type)
        {
        case SDL_QUIT:
            App::Get().Quit();
            break;
        case SDL_KEYDOWN:
        case SDL_KEYUP:
            lastWasGamepad = false;
            break;
        case SDL_MOUSEMOTION:
        case SDL_MOUSEBUTTONDOWN:
        case SDL_MOUSEBUTTONUP:
        case SDL_MOUSEWHEEL:
            lastWasGamepad = false;
            break;
        case SDL_TEXTINPUT:
        case SDL_TEXTEDITING:
            lastWasGamepad = false;
            break;
        case SDL_CONTROLLERDEVICEADDED:
            if (!controller && SDL_IsGameController(e.cdevice.which))
            {
                controller = SDL_GameControllerOpen(e.cdevice.which);
            }
            lastWasGamepad = true;
            break;
        case SDL_CONTROLLERDEVICEREMOVED:
            if (controller)
            {
                SDL_Joystick* j = SDL_GameControllerGetJoystick(controller);
                if (j && static_cast<SDL_JoystickID>(e.cdevice.which) == SDL_JoystickInstanceID(j))
                {
                    SDL_GameControllerClose(controller);
                    controller = 0;
                    OpenFirstController();
                }
            }
            lastWasGamepad = true;
            break;
        case SDL_CONTROLLERBUTTONDOWN:
        case SDL_CONTROLLERBUTTONUP:
        case SDL_CONTROLLERAXISMOTION:
            lastWasGamepad = true;
            break;
        default:
            break;
        }
    }

    const Uint8* kb = SDL_GetKeyboardState(0);
    for (int i = 0; i < SDL_NUM_SCANCODES; ++i)
    {
        keysCurrentFrame[i] = kb[i] != 0;
    }

    Uint32 mouseMask = SDL_GetMouseState(&mouseX, &mouseY);
    for (int b = 0; b < 5; ++b)
    {
        const int sdlButton = b + 1;
        mouseButtons[b] = (mouseMask & SDL_BUTTON(sdlButton)) != 0;
    }

    if (controller)
    {
        for (int i = 0; i < SDL_CONTROLLER_BUTTON_MAX; ++i)
        {
            gamepadButtons[i] =
                SDL_GameControllerGetButton(controller, static_cast<SDL_GameControllerButton>(i)) != 0;
        }
    }
    else
    {
        std::memset(gamepadButtons, 0, sizeof(gamepadButtons));
    }

    UpdateAxesFromController();
}

bool InputManager::IsKeyDown(int sdlScancode) const
{
    if (sdlScancode < 0 || sdlScancode >= SDL_NUM_SCANCODES)
    {
        return false;
    }
    return keysCurrentFrame[sdlScancode];
}

bool InputManager::IsKeyPressed(int sdlScancode) const
{
    if (sdlScancode < 0 || sdlScancode >= SDL_NUM_SCANCODES)
    {
        return false;
    }
    return keysCurrentFrame[sdlScancode] && !keysLastFrame[sdlScancode];
}

bool InputManager::IsKeyReleased(int sdlScancode) const
{
    if (sdlScancode < 0 || sdlScancode >= SDL_NUM_SCANCODES)
    {
        return false;
    }
    return !keysCurrentFrame[sdlScancode] && keysLastFrame[sdlScancode];
}

bool InputManager::IsMouseButtonDown(int button) const
{
    if (button < 1 || button > 5)
    {
        return false;
    }
    return mouseButtons[button - 1];
}

bool InputManager::IsGamepadButtonDown(int button) const
{
    if (button < 0 || button >= SDL_CONTROLLER_BUTTON_MAX)
    {
        return false;
    }
    return gamepadButtons[button];
}

bool InputManager::IsGamepadButtonPressed(int button) const
{
    if (button < 0 || button >= SDL_CONTROLLER_BUTTON_MAX)
    {
        return false;
    }
    return gamepadButtons[button] && !gamepadButtonsLast[button];
}

float InputManager::GamepadAxis(int axis) const
{
    if (axis < 0 || axis >= SDL_CONTROLLER_AXIS_MAX)
    {
        return 0.f;
    }
    return ApplyAxisDeadzone(gamepadAxes[axis]);
}

bool InputManager::NavigateUp() const
{
    if (IsKeyPressed(SDL_SCANCODE_UP))
    {
        return true;
    }
    if (IsGamepadButtonPressed(SDL_CONTROLLER_BUTTON_DPAD_UP))
    {
        return true;
    }
    const float y = GamepadAxis(SDL_CONTROLLER_AXIS_LEFTY);
    return y < -0.5f && g_stickNavYLastFrame >= -0.5f;
}

bool InputManager::NavigateDown() const
{
    if (IsKeyPressed(SDL_SCANCODE_DOWN))
    {
        return true;
    }
    if (IsGamepadButtonPressed(SDL_CONTROLLER_BUTTON_DPAD_DOWN))
    {
        return true;
    }
    const float y = GamepadAxis(SDL_CONTROLLER_AXIS_LEFTY);
    return y > 0.5f && g_stickNavYLastFrame <= 0.5f;
}

bool InputManager::NavigateLeft() const
{
    if (IsKeyPressed(SDL_SCANCODE_LEFT))
    {
        return true;
    }
    if (IsGamepadButtonPressed(SDL_CONTROLLER_BUTTON_DPAD_LEFT))
    {
        return true;
    }
    const float x = GamepadAxis(SDL_CONTROLLER_AXIS_LEFTX);
    return x < -0.5f && g_stickNavXLastFrame >= -0.5f;
}

bool InputManager::NavigateRight() const
{
    if (IsKeyPressed(SDL_SCANCODE_RIGHT))
    {
        return true;
    }
    if (IsGamepadButtonPressed(SDL_CONTROLLER_BUTTON_DPAD_RIGHT))
    {
        return true;
    }
    const float x = GamepadAxis(SDL_CONTROLLER_AXIS_LEFTX);
    return x > 0.5f && g_stickNavXLastFrame <= 0.5f;
}

bool InputManager::Confirm() const
{
    return IsKeyPressed(SDL_SCANCODE_RETURN) || IsKeyPressed(SDL_SCANCODE_KP_ENTER)
        || IsGamepadButtonPressed(SDL_CONTROLLER_BUTTON_A);
}

bool InputManager::Back() const
{
    return IsKeyPressed(SDL_SCANCODE_ESCAPE) || IsGamepadButtonPressed(SDL_CONTROLLER_BUTTON_B);
}
