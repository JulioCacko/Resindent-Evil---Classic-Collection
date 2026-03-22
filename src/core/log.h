#ifndef RE_LOG_H
#define RE_LOG_H

#include <cstdarg>
#include <cstdio>

class Log
{
public:
    static Log& Get();

    void Init();
    void Shutdown();

    void Printf(const char* fmt, ...);
    void Warning(const char* fmt, ...);
    void Error(const char* fmt, ...);
    void DPrintf(const char* fmt, ...);

private:
    Log();
    ~Log();
    Log(const Log&);
    Log& operator=(const Log&);

    void WriteLineV(const char* prefix, const char* fmt, va_list args);

    FILE* logFile;
    bool    initialized;
};

#endif
