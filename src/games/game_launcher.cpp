#include "games/game_launcher.h"

#include "config/paths.h"

#include "core/types.h"

#include <cstdio>
#include <cstring>
#include <vector>

#ifdef RE_PLATFORM_WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <errno.h>
#include <signal.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace
{
#ifdef RE_PLATFORM_WIN32
HANDLE g_hProcess = 0;
HANDLE g_hThread = 0;
DWORD g_exitCode = 0;
bool g_exitValid = false;
#else
pid_t g_childPid = -1;
int g_exitCode = 0;
bool g_exitValid = false;
#endif

void CloseProcessHandles()
{
#ifdef RE_PLATFORM_WIN32
    if (g_hThread)
    {
        CloseHandle(g_hThread);
        g_hThread = 0;
    }
    if (g_hProcess)
    {
        CloseHandle(g_hProcess);
        g_hProcess = 0;
    }
#endif
}
} // namespace

bool GameLauncher::Launch(const GameVersion& version, const std::string& installPath, bool useEnhanced)
{
    if (installPath.empty() || version.execRelPath.empty())
    {
        return false;
    }

    std::string relExe = version.execRelPath;
    if (useEnhanced && version.hasMod && !version.modExecRelPath.empty())
    {
        relExe = version.modExecRelPath;
    }

    std::string exePath = Paths::Join(installPath, relExe);
    if (!Paths::FileExists(exePath))
    {
        std::fprintf(stderr, "GameLauncher::Launch: executable not found: %s\n", exePath.c_str());
        return false;
    }

#ifdef RE_PLATFORM_WIN32
    KillGame();

    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    std::memset(&si, 0, sizeof(si));
    std::memset(&pi, 0, sizeof(pi));
    si.cb = sizeof(si);

    std::string cmdLine = std::string("\"") + exePath + std::string("\"");
    std::vector<char> mutableCmd(cmdLine.begin(), cmdLine.end());
    mutableCmd.push_back(0);

    BOOL ok = CreateProcessA(
        exePath.c_str(),
        &mutableCmd[0],
        0,
        0,
        FALSE,
        0,
        0,
        installPath.c_str(),
        &si,
        &pi);
    if (!ok)
    {
        DWORD err = GetLastError();
        std::fprintf(
            stderr,
            "GameLauncher::Launch: CreateProcessA failed, GetLastError=%lu\n",
            static_cast<unsigned long>(err));
        return false;
    }

    g_hProcess = pi.hProcess;
    g_hThread = pi.hThread;
    g_exitValid = false;
    return true;
#else
    KillGame();

    pid_t pid = fork();
    if (pid < 0)
    {
        std::fprintf(stderr, "GameLauncher::Launch: fork failed, errno=%d\n", errno);
        return false;
    }
    if (pid == 0)
    {
        if (chdir(installPath.c_str()) != 0)
        {
            _exit(127);
        }
        execl(exePath.c_str(), exePath.c_str(), reinterpret_cast<char*>(0));
        _exit(127);
    }

    g_childPid = pid;
    g_exitValid = false;
    return true;
#endif
}

bool GameLauncher::IsGameRunning()
{
#ifdef RE_PLATFORM_WIN32
    if (!g_hProcess)
    {
        return false;
    }
    DWORD wait = WaitForSingleObject(g_hProcess, 0);
    if (wait == WAIT_TIMEOUT)
    {
        return true;
    }
    if (wait == WAIT_OBJECT_0)
    {
        DWORD code = 0;
        if (GetExitCodeProcess(g_hProcess, &code))
        {
            g_exitCode = code;
            g_exitValid = true;
        }
        CloseProcessHandles();
    }
    return false;
#else
    if (g_childPid < 0)
    {
        return false;
    }
    int status = 0;
    pid_t r = waitpid(g_childPid, &status, WNOHANG);
    if (r == 0)
    {
        return true;
    }
    if (r == g_childPid)
    {
        if (WIFEXITED(status))
        {
            g_exitCode = WEXITSTATUS(status);
        }
        else
        {
            g_exitCode = -1;
        }
        g_exitValid = true;
        g_childPid = -1;
        return false;
    }
    return false;
#endif
}

int GameLauncher::GetProcessExitCode()
{
    if (!g_exitValid)
    {
        return -1;
    }
#ifdef RE_PLATFORM_WIN32
    return static_cast<int>(g_exitCode);
#else
    return g_exitCode;
#endif
}

void GameLauncher::KillGame()
{
#ifdef RE_PLATFORM_WIN32
    if (g_hProcess)
    {
        TerminateProcess(g_hProcess, 1);
    }
    CloseProcessHandles();
    g_exitValid = false;
#else
    if (g_childPid > 0)
    {
        kill(g_childPid, SIGTERM);
        waitpid(g_childPid, 0, 0);
        g_childPid = -1;
    }
    g_exitValid = false;
#endif
}
