#include "core/app.h"
#include "core/log.h"
#include "core/types.h"

#if defined(RE_PLATFORM_WIN32) && defined(_MSC_VER) && !defined(_DEBUG)
#include <windows.h>
#endif

int main(int argc, char** argv)
{
#if defined(RE_PLATFORM_WIN32) && defined(_MSC_VER) && !defined(_DEBUG)
    __try
    {
#endif
        if (!App::Get().Init(argc, argv))
        {
            return 1;
        }
        App::Get().Run();
        App::Get().Shutdown();
#if defined(RE_PLATFORM_WIN32) && defined(_MSC_VER) && !defined(_DEBUG)
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        const unsigned int code = static_cast<unsigned int>(GetExceptionCode());
        Log::Get().Printf("Unhandled SEH exception: 0x%08X\n", code);
        return 1;
    }
#endif
    return 0;
}
