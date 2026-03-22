#include "install/gog_detector.h"

#include "config/config.h"
#include "config/paths.h"
#include "games/game_catalog.h"

#include "core/types.h"

#include <string>
#include <vector>

#if defined(RE_PLATFORM_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <Windows.h>
#endif

namespace
{
std::string GogIdToFolderName(const std::string& gogGameId)
{
    if (gogGameId == "1580232252")
    {
        return "Resident Evil";
    }
    if (gogGameId == "1534123252")
    {
        return "Resident Evil 2";
    }
    if (gogGameId == "1266089300")
    {
        return "Resident Evil 3";
    }
    return std::string();
}

#if defined(RE_PLATFORM_WIN32)
std::string ReadRegistryValuePath(HKEY root, const std::string& subkey)
{
    HKEY hKey = 0;
    LONG rc = RegOpenKeyExA(root, subkey.c_str(), 0, KEY_READ, &hKey);
    if (rc != ERROR_SUCCESS)
    {
        return std::string();
    }

    char   buf[4096];
    DWORD  bufSize = sizeof(buf);
    DWORD  type    = 0;
    rc = RegQueryValueExA(hKey, "path", 0, &type, reinterpret_cast<LPBYTE>(buf), &bufSize);
    RegCloseKey(hKey);
    if (rc != ERROR_SUCCESS || (type != REG_SZ && type != REG_EXPAND_SZ))
    {
        return std::string();
    }
    if (bufSize == 0)
    {
        return std::string();
    }
    size_t len = bufSize;
    if (len > 0 && buf[len - 1] == 0)
    {
        --len;
    }
    return std::string(buf, len);
}

std::string ReadRegistryPathWow64Node(const std::string& gogGameId)
{
    std::string subkey = std::string("SOFTWARE\\WOW6432Node\\GOG.com\\Games\\") + gogGameId;
    return ReadRegistryValuePath(HKEY_LOCAL_MACHINE, subkey);
}

std::string ReadRegistryPathGogCom(const std::string& gogGameId)
{
    std::string subkey = std::string("SOFTWARE\\GOG.com\\Games\\") + gogGameId;
    HKEY        hKey   = 0;
    LONG        rc     = RegOpenKeyExA(HKEY_LOCAL_MACHINE, subkey.c_str(), 0, KEY_READ | KEY_WOW64_64KEY, &hKey);
    if (rc != ERROR_SUCCESS)
    {
        rc = RegOpenKeyExA(HKEY_LOCAL_MACHINE, subkey.c_str(), 0, KEY_READ, &hKey);
    }
    if (rc != ERROR_SUCCESS)
    {
        return std::string();
    }
    char   buf[4096];
    DWORD  bufSize = sizeof(buf);
    DWORD  type    = 0;
    rc = RegQueryValueExA(hKey, "path", 0, &type, reinterpret_cast<LPBYTE>(buf), &bufSize);
    RegCloseKey(hKey);
    if (rc != ERROR_SUCCESS || (type != REG_SZ && type != REG_EXPAND_SZ))
    {
        return std::string();
    }
    if (bufSize == 0)
    {
        return std::string();
    }
    size_t len = bufSize;
    if (len > 0 && buf[len - 1] == 0)
    {
        --len;
    }
    return std::string(buf, len);
}

std::string ProbeCommonRoots(const std::string& gogGameId)
{
    const char* roots[] = {
        "C:\\GOG Games\\",
        "C:\\Program Files (x86)\\GOG Games\\",
        "D:\\GOG Games\\",
    };
    std::string folder = GogIdToFolderName(gogGameId);
    if (folder.empty())
    {
        return std::string();
    }
    for (size_t i = 0; i < sizeof(roots) / sizeof(roots[0]); ++i)
    {
        std::string candidate = Paths::Join(std::string(roots[i]), folder);
        if (Paths::DirExists(candidate))
        {
            return candidate;
        }
    }
    return std::string();
}
#endif
} // namespace

std::string GOGDetector::DetectInstallPath(const std::string& gogGameId)
{
#if defined(RE_PLATFORM_WIN32)
    if (gogGameId.empty())
    {
        return std::string();
    }
    std::string p = ReadRegistryPathWow64Node(gogGameId);
    if (!p.empty() && Paths::DirExists(p))
    {
        return p;
    }
    p = ReadRegistryPathGogCom(gogGameId);
    if (!p.empty() && Paths::DirExists(p))
    {
        return p;
    }
    p = ProbeCommonRoots(gogGameId);
    if (!p.empty())
    {
        return p;
    }
#else
    (void)gogGameId;
#endif
    return std::string();
}

void GOGDetector::DetectAllGames(GameCatalog& catalog)
{
    Config& cfg = Config::Get();
    if (cfg.Has("gog_path_override"))
    {
        std::string base = cfg.GetString("gog_path_override", "");
        if (!base.empty() && Paths::DirExists(base))
        {
            std::vector<GameTitle>& titles = catalog.GetAllTitles();
            for (size_t i = 0; i < titles.size(); ++i)
            {
                std::string folder = GogIdToFolderName(titles[i].gogGameId);
                if (folder.empty())
                {
                    catalog.SetInstallPath(titles[i].id, "");
                    continue;
                }
                std::string candidate = Paths::Join(base, folder);
                if (Paths::DirExists(candidate))
                {
                    catalog.SetInstallPath(titles[i].id, candidate);
                }
                else
                {
                    catalog.SetInstallPath(titles[i].id, "");
                }
            }
            return;
        }
    }

    std::vector<GameTitle>& titles = catalog.GetAllTitles();
    for (size_t i = 0; i < titles.size(); ++i)
    {
        if (titles[i].gogGameId.empty())
        {
            continue;
        }
        const std::string path = DetectInstallPath(titles[i].gogGameId);
        if (!path.empty())
        {
            catalog.SetInstallPath(titles[i].id, path);
        }
    }
}
