#include "games/mod_loader.h"

#include "config/paths.h"
#include "core/log.h"
#include "core/types.h"

#include <cctype>
#include <cstdio>
#include <cstring>
#include <string>

#ifdef RE_PLATFORM_WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace
{
std::string ToLowerAscii(std::string s)
{
    for (size_t i = 0; i < s.size(); ++i)
    {
        unsigned char c = static_cast<unsigned char>(s[i]);
        if (c < 128)
        {
            s[i] = static_cast<char>(std::tolower(c));
        }
    }
    return s;
}

bool ShouldSkipFileByName(const std::string& fileName)
{
    std::string lower = ToLowerAscii(fileName);
    if (lower.find("readme") != std::string::npos)
    {
        return true;
    }
    if (lower.find("changelog") != std::string::npos)
    {
        return true;
    }
    return false;
}

std::string ParentDir(const std::string& filePath)
{
    size_t pos = filePath.find_last_of("\\/");
    if (pos == std::string::npos)
    {
        return std::string();
    }
    return filePath.substr(0, pos);
}

bool CopyFileBinary(const std::string& src, const std::string& dst)
{
    std::string parent = ParentDir(dst);
    if (!parent.empty() && !Paths::DirExists(parent))
    {
        if (!Paths::EnsureDirTree(parent))
        {
            return false;
        }
    }

    FILE* in = std::fopen(src.c_str(), "rb");
    if (!in)
    {
        return false;
    }
    FILE* out = std::fopen(dst.c_str(), "wb");
    if (!out)
    {
        std::fclose(in);
        return false;
    }

    unsigned char buf[64 * 1024];
    size_t n = 0;
    while ((n = std::fread(buf, 1, sizeof(buf), in)) > 0)
    {
        if (std::fwrite(buf, 1, n, out) != n)
        {
            std::fclose(in);
            std::fclose(out);
            return false;
        }
    }
    if (std::ferror(in))
    {
        std::fclose(in);
        std::fclose(out);
        return false;
    }
    std::fclose(in);
    std::fclose(out);
    return true;
}

#ifdef RE_PLATFORM_WIN32
bool IsDirectoryAttr(DWORD attr)
{
    return (attr & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

bool CopyTreeWin32(const std::string& srcDir, const std::string& dstRoot)
{
    std::string pattern = Paths::Join(srcDir, "*");
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA(pattern.c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE)
    {
        return false;
    }
    bool ok = true;
    do
    {
        const char* name = fd.cFileName;
        if (name[0] == '.' && (name[1] == 0 || (name[1] == '.' && name[2] == 0)))
        {
            continue;
        }
        std::string fullSrc = Paths::Join(srcDir, name);
        std::string fullDst = Paths::Join(dstRoot, name);
        if (IsDirectoryAttr(fd.dwFileAttributes))
        {
            if (!CopyTreeWin32(fullSrc, fullDst))
            {
                ok = false;
            }
        }
        else
        {
            if (ShouldSkipFileByName(name))
            {
                continue;
            }
            if (!CopyFileBinary(fullSrc, fullDst))
            {
                ok = false;
            }
        }
    } while (FindNextFileA(h, &fd));
    FindClose(h);
    return ok;
}
#else
bool IsDirPath(const std::string& fullPath)
{
    struct stat st;
    if (stat(fullPath.c_str(), &st) != 0)
    {
        return false;
    }
    return S_ISDIR(st.st_mode);
}

bool CopyTreePosix(const std::string& srcDir, const std::string& dstRoot)
{
    DIR* d = opendir(srcDir.c_str());
    if (!d)
    {
        return false;
    }
    bool ok = true;
    struct dirent* ent;
    while ((ent = readdir(d)) != 0)
    {
        const char* name = ent->d_name;
        if (name[0] == '.' && (name[1] == 0 || (name[1] == '.' && name[2] == 0)))
        {
            continue;
        }
        std::string fullSrc = Paths::Join(srcDir, name);
        std::string fullDst = Paths::Join(dstRoot, name);
        if (IsDirPath(fullSrc))
        {
            if (!CopyTreePosix(fullSrc, fullDst))
            {
                ok = false;
            }
        }
        else
        {
            if (ShouldSkipFileByName(name))
            {
                continue;
            }
            if (!CopyFileBinary(fullSrc, fullDst))
            {
                ok = false;
            }
        }
    }
    closedir(d);
    return ok;
}
#endif
} // namespace

bool ModLoader::InjectMod(const GameVersion& version, const std::string& installPath, const std::string& modBasePath)
{
    if (version.modPath.empty() || installPath.empty() || modBasePath.empty())
    {
        return false;
    }

    std::string modSrc = Paths::Join(modBasePath, version.modPath);
    if (!Paths::DirExists(modSrc))
    {
        return false;
    }

#ifdef RE_PLATFORM_WIN32
    return CopyTreeWin32(modSrc, installPath);
#else
    return CopyTreePosix(modSrc, installPath);
#endif
}

bool ModLoader::RemoveMod(const GameVersion& version, const std::string& installPath)
{
    (void)version;
    (void)installPath;
    Log::Get().Warning("ModLoader::RemoveMod: restore from backup is not yet implemented.\n");
    return true;
}

bool ModLoader::IsModInstalled(const std::string& installPath, const std::string& modIndicatorFile)
{
    if (installPath.empty() || modIndicatorFile.empty())
    {
        return false;
    }
    std::string p = Paths::Join(installPath, modIndicatorFile);
    return Paths::FileExists(p);
}
