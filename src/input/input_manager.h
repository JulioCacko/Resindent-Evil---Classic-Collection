#ifndef RE_INPUT_MANAGER_H
#define RE_INPUT_MANAGER_H

#include "core/types.h"

#include <SDL2/SDL.h>

class App;

class InputManager
{
public:
    static InputManager& Get();

    void Init();
    void Shutdown();
    void Poll();

    bool IsKeyDown(int sdlScancode) const;
    bool IsKeyPressed(int sdlScancode) const;
    bool IsKeyReleased(int sdlScancode) const;

    bool IsMouseButtonDown(int button) const;
    int MouseX() const { return mouseX; }
    int MouseY() const { return mouseY; }

    bool IsGamepadButtonDown(int button) const;
    bool IsGamepadButtonPressed(int button) const;
    float GamepadAxis(int axis) const;

    bool LastInputWasGamepad() const { return lastWasGamepad; }

    bool NavigateUp() const;
    bool NavigateDown() const;
    bool NavigateLeft() const;
    bool NavigateRight() const;

    bool Confirm() const;
    bool Back() const;

private:
    InputManager();
    ~InputManager();
    InputManager(const InputManager&);
    InputManager& operator=(const InputManager&);

    float ApplyAxisDeadzone(float normalized) const;
    void UpdateAxesFromController();
    void OpenFirstController();
    void CloseController();

    bool keysCurrentFrame[SDL_NUM_SCANCODES];
    bool keysLastFrame[SDL_NUM_SCANCODES];

    int mouseX;
    int mouseY;
    bool mouseButtons[5];
    bool mouseButtonsLast[5];

    SDL_GameController* controller;

    bool gamepadButtons[SDL_CONTROLLER_BUTTON_MAX];
    bool gamepadButtonsLast[SDL_CONTROLLER_BUTTON_MAX];
    float gamepadAxes[SDL_CONTROLLER_AXIS_MAX];

    bool lastWasGamepad;
    float axisDeadzone;
};

#endif
