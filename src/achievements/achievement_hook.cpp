#include "achievements/achievement_hook.h"

#include "core/log.h"

#include <cstdio>

#if defined(RE_PLATFORM_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
// ReadProcessMemory(
//     HANDLE hProcess,
//     LPCVOID lpBaseAddress,
//     LPVOID lpBuffer,
//     SIZE_T nSize,
//     SIZE_T* lpNumberOfBytesRead);
//
// TODO: Poll known RE1 (PC) memory addresses once the target binary + version is fixed, e.g.:
//   - Example placeholder base: 0x400000 (typical 32-bit EXE load address; verify per build)
//   - Example offsets (FAKE — replace with real reverse-engineered values):
//       completion/scenario flag: base + 0x123456
//       character id / campaign:  base + 0x12345A
//   Use OpenProcess(PROCESS_VM_READ, ...) on currentPID_, then ReadProcessMemory in Update().
#endif

AchievementHook::AchievementHook()
    : currentPID_(0)
    , tracking_(false)
{
}

AchievementHook::~AchievementHook()
{
}

AchievementHook& AchievementHook::Get()
{
    static AchievementHook instance;
    return instance;
}

void AchievementHook::StartTracking(const std::string& gameId, uint32_t processId)
{
    currentGameId_ = gameId;
    currentPID_    = processId;
    tracking_      = true;

    Log::Get().Printf(
        "AchievementHook::StartTracking: would attach to gameId=%s pid=%u (memory polling stub)\n",
        gameId.c_str(), static_cast<unsigned int>(processId));

#if defined(RE_PLATFORM_WIN32)
    // HANDLE hProcess = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, FALSE,
    //     static_cast<DWORD>(processId));
    // if (!hProcess) { Log::Get().Warning("AchievementHook: OpenProcess failed\n"); }
#endif
}

void AchievementHook::StopTracking()
{
    Log::Get().Printf(
        "AchievementHook::StopTracking: stopping track for gameId=%s pid=%u\n",
        currentGameId_.c_str(), static_cast<unsigned int>(currentPID_));

#if defined(RE_PLATFORM_WIN32)
    // CloseHandle(hProcess);
#endif

    CheckSaveFiles(currentGameId_);

    currentGameId_.clear();
    currentPID_ = 0;
    tracking_   = false;
}

void AchievementHook::Update()
{
    if (!tracking_)
    {
        return;
    }

    Log::Get().DPrintf("AchievementHook::Update: stub tick gameId=%s pid=%u\n",
        currentGameId_.c_str(), static_cast<unsigned int>(currentPID_));

#if defined(RE_PLATFORM_WIN32)
    // BYTE buf[4] = {};
    // SIZE_T read = 0;
    // if (hProcess) ReadProcessMemory(hProcess, (LPCVOID)address, buf, sizeof(buf), &read);
#endif
}

bool AchievementHook::IsTracking() const
{
    return tracking_;
}

void AchievementHook::CheckSaveFiles(const std::string& gameId)
{
    Log::Get().Printf("Save file checking not yet implemented for %s\n", gameId.c_str());
}
