#include "core/log.h"
#include "core/types.h"

#include <SDL.h>

#include <ctime>
#include <cstdio>
#include <cstring>

static const char* kLogFileName = "re-launcher.log";

Log::Log()
    : logFile(nullptr)
    , initialized(false)
{
}

Log::~Log()
{
    Shutdown();
}

Log& Log::Get()
{
    static Log instance;
    return instance;
}

void Log::Init()
{
    if (initialized)
    {
        return;
    }
    logFile = std::fopen(kLogFileName, "a");
    if (!logFile)
    {
        std::fprintf(stderr, "Log: could not open %s for append.\n", kLogFileName);
    }
    initialized = true;
    Printf("--- Log session start ---\n");
}

void Log::Shutdown()
{
    if (!initialized)
    {
        return;
    }
    if (logFile)
    {
        std::fflush(logFile);
        std::fclose(logFile);
        logFile = nullptr;
    }
    initialized = false;
}

void Log::WriteLineV(const char* prefix, const char* fmt, va_list args)
{
    std::time_t t = std::time(nullptr);
    char      timeBuf[64];
    if (std::strftime(timeBuf, sizeof(timeBuf), "%Y-%m-%d %H:%M:%S", std::localtime(&t)) == 0)
    {
        timeBuf[0] = '\0';
    }

    std::fprintf(stdout, "[%s] %s", timeBuf, prefix);
    va_list ap2;
    va_copy(ap2, args);
    std::vfprintf(stdout, fmt, ap2);
    va_end(ap2);
    std::fflush(stdout);

    if (logFile)
    {
        std::fprintf(logFile, "[%s] %s", timeBuf, prefix);
        va_copy(ap2, args);
        std::vfprintf(logFile, fmt, ap2);
        va_end(ap2);
        std::fflush(logFile);
    }
}

void Log::Printf(const char* fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    WriteLineV("", fmt, args);
    va_end(args);
}

void Log::Warning(const char* fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    WriteLineV("[WARN] ", fmt, args);
    va_end(args);
}

void Log::Error(const char* fmt, ...)
{
    char    buf[4096];
    va_list args;
    va_start(args, fmt);
    std::vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);

    std::fprintf(stderr, "%s", buf);
    std::fflush(stderr);
    if (logFile)
    {
        std::fputs(buf, logFile);
        std::fflush(logFile);
    }

    SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, "Resident Evil - Classic Collection", buf, nullptr);
    std::exit(1);
}

void Log::DPrintf(const char* fmt, ...)
{
#if defined(NDEBUG) && !defined(RE_FORCE_DEBUG_LOG)
    (void)fmt;
#else
    va_list args;
    va_start(args, fmt);
    WriteLineV("[DBG] ", fmt, args);
    va_end(args);
#endif
}
