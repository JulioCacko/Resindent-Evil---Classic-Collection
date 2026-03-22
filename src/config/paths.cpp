#include "config/paths.h"

#include <cerrno>
#include <cstdint>
#include <string>

#if defined(RE_PLATFORM_WIN32)
#include <Windows.h>
#include <Shlwapi.h>
#include <direct.h>
#elif defined(RE_PLATFORM_LINUX)
#include <unistd.h>
#include <sys/stat.h>
#include <limits.h>
#elif defined(RE_PLATFORM_MACOS)
#include <mach-o/dyld.h>
#include <limits.h>
#include <sys/stat.h>
#endif

namespace Paths
{
    namespace
    {
        bool EndsWithSlash(const std::string& s)
        {
            if (s.empty())
            {
                return false;
            }
            const char c = s[s.size() - 1];
            return c == '/' || c == '\\';
        }
    }

    void NormalizePath(std::string& path)
    {
        for (std::size_t i = 0; i < path.size(); ++i)
        {
            if (path[i] == '\\')
            {
                path[i] = '/';
            }
        }
    }

    std::string JoinPath(const std::string& a, const std::string& b)
    {
        if (a.empty())
        {
            return b;
        }
        if (b.empty())
        {
            return a;
        }
        if (EndsWithSlash(a))
        {
            return a + b;
        }
        return a + "/" + b;
    }

    std::string GetExeDirectory()
    {
#if defined(RE_PLATFORM_WIN32)
        char path[MAX_PATH];
        const DWORD n = GetModuleFileNameA(0, path, MAX_PATH);
        if (n == 0 || n >= MAX_PATH)
        {
            return std::string();
        }
        if (!PathRemoveFileSpecA(path))
        {
            return std::string();
        }
        std::string out(path);
        NormalizePath(out);
        return out;
#elif defined(RE_PLATFORM_LINUX)
        char buf[PATH_MAX];
        const ssize_t len = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
        if (len <= 0)
        {
            return std::string();
        }
        buf[len] = '\0';
        std::string full(buf);
        const std::size_t pos = full.find_last_of("/\\");
        if (pos == std::string::npos)
        {
            return std::string();
        }
        std::string dir = full.substr(0, pos);
        NormalizePath(dir);
        return dir;
#elif defined(RE_PLATFORM_MACOS)
        char buf[PATH_MAX];
        uint32_t size = sizeof(buf);
        if (_NSGetExecutablePath(buf, &size) != 0)
        {
            return std::string();
        }
        std::string full(buf);
        const std::size_t pos = full.find_last_of("/\\");
        if (pos == std::string::npos)
        {
            return std::string();
        }
        std::string dir = full.substr(0, pos);
        NormalizePath(dir);
        return dir;
#else
        return std::string();
#endif
    }

    std::string GetConfigDirectory()
    {
        return GetExeDirectory();
    }

    std::string GetAssetsDirectory()
    {
        return JoinPath(GetExeDirectory(), "assets");
    }

    std::string GetFileName(const std::string& path)
    {
        const std::size_t p = path.find_last_of("/\\");
        if (p == std::string::npos)
        {
            return path;
        }
        return path.substr(p + 1);
    }

    std::string GetFileExtension(const std::string& path)
    {
        const std::string base = GetFileName(path);
        const std::size_t dot = base.find_last_of('.');
        if (dot == std::string::npos || dot == base.size() - 1)
        {
            return std::string();
        }
        return base.substr(dot);
    }

#if defined(RE_PLATFORM_WIN32)
    bool FileExists(const std::string& path)
    {
        const DWORD a = GetFileAttributesA(path.c_str());
        if (a == INVALID_FILE_ATTRIBUTES)
        {
            return false;
        }
        return (a & FILE_ATTRIBUTE_DIRECTORY) == 0;
    }

    bool DirectoryExists(const std::string& path)
    {
        const DWORD a = GetFileAttributesA(path.c_str());
        if (a == INVALID_FILE_ATTRIBUTES)
        {
            return false;
        }
        return (a & FILE_ATTRIBUTE_DIRECTORY) != 0;
    }
#else
    bool FileExists(const std::string& path)
    {
        struct stat st;
        if (stat(path.c_str(), &st) != 0)
        {
            return false;
        }
        return S_ISREG(st.st_mode);
    }

    bool DirectoryExists(const std::string& path)
    {
        struct stat st;
        if (stat(path.c_str(), &st) != 0)
        {
            return false;
        }
        return S_ISDIR(st.st_mode);
    }
#endif

    bool EnsureDirTree(const std::string& path)
    {
        if (path.empty())
        {
            return false;
        }
        std::string p = path;
#if defined(RE_PLATFORM_WIN32)
        for (std::size_t i = 0; i < p.size(); ++i)
        {
            if (p[i] == '/')
            {
                p[i] = '\\';
            }
        }
#endif
        for (std::size_t i = 0; i <= p.size(); ++i)
        {
            if (i == p.size() || p[i] == '\\' || p[i] == '/')
            {
                if (i < 1)
                {
                    continue;
                }
                std::string part = p.substr(0, i);
#if defined(RE_PLATFORM_WIN32)
                if (part.size() == 2 && part[1] == ':')
                {
                    continue;
                }
                if (_mkdir(part.c_str()) != 0)
                {
                    if (errno != EEXIST && !DirectoryExists(part))
                    {
                        return false;
                    }
                }
#elif defined(RE_PLATFORM_LINUX) || defined(RE_PLATFORM_MACOS)
                if (part == "/" || part.empty())
                {
                    continue;
                }
                if (mkdir(part.c_str(), 0755) != 0)
                {
                    if (errno != EEXIST && !DirectoryExists(part))
                    {
                        return false;
                    }
                }
#else
                (void)part;
                return false;
#endif
            }
        }
        return DirectoryExists(p);
    }
}
