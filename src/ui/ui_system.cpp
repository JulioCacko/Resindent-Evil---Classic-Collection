#include "ui/ui_system.h"

#include "ui/font.h"
#include "ui/ui_screen.h"

UISystem::UISystem() {}

UISystem::~UISystem()
{
    stack.clear();
}

UISystem& UISystem::Get()
{
    static UISystem instance;
    return instance;
}

void UISystem::Init()
{
    stack.clear();
    Font::Get().Init();
}

void UISystem::Shutdown()
{
    stack.clear();
    Font::Get().Shutdown();
}

void UISystem::Update(float dt)
{
    if (!stack.empty() && stack.back())
    {
        stack.back()->OnInput();
        stack.back()->Update(dt);
    }
}

void UISystem::Draw()
{
    for (size_t i = 0; i < stack.size(); ++i)
    {
        if (stack[i])
        {
            stack[i]->Draw();
        }
    }
}

void UISystem::PushScreen(UIScreen* screen)
{
    if (!screen)
    {
        return;
    }
    stack.push_back(std::unique_ptr<UIScreen>(screen));
    stack.back()->OnEnter();
}

void UISystem::PopScreen()
{
    if (stack.empty())
    {
        return;
    }
    if (stack.back())
    {
        stack.back()->OnExit();
    }
    stack.pop_back();
    if (!stack.empty() && stack.back())
    {
        stack.back()->OnEnter();
    }
}

void UISystem::ReplaceScreen(UIScreen* screen)
{
    if (!stack.empty())
    {
        if (stack.back())
        {
            stack.back()->OnExit();
        }
        stack.pop_back();
    }
    if (screen)
    {
        stack.push_back(std::unique_ptr<UIScreen>(screen));
        stack.back()->OnEnter();
    }
}

int UISystem::GetScreenCount() const
{
    return static_cast<int>(stack.size());
}
