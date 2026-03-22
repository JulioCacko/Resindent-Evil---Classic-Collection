#include "install/install_validator.h"

#include "config/paths.h"
#include "games/game_catalog.h"
#include "games/game_entry.h"

#include "core/types.h"

#include <vector>

#ifdef RE_PLATFORM_WIN32
#include <windows.h>
#else
#include <dirent.h>
#endif

namespace
{
bool DirHasAnyFile(const std::string& dirPath)
{
#ifdef RE_PLATFORM_WIN32
    std::string pattern = Paths::Join(dirPath, "*");
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA(pattern.c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE)
    {
        return false;
    }
    bool any = false;
    do
    {
        const char* name = fd.cFileName;
        if (name[0] == '.' && (name[1] == 0 || (name[1] == '.' && name[2] == 0)))
        {
            continue;
        }
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)
        {
            any = true;
            break;
        }
        any = true;
        break;
    } while (FindNextFileA(h, &fd));
    FindClose(h);
    return any;
#else
    DIR* d = opendir(dirPath.c_str());
    if (!d)
    {
        return false;
    }
    struct dirent* ent;
    bool any = false;
    while ((ent = readdir(d)) != 0)
    {
        const char* name = ent->d_name;
        if (name[0] == '.' && (name[1] == 0 || (name[1] == '.' && name[2] == 0)))
        {
            continue;
        }
        any = true;
        break;
    }
    closedir(d);
    return any;
#endif
}

bool Re1DataOk(const std::string& installPath)
{
    if (Paths::DirExists(Paths::Join(installPath, "USA")))
    {
        return true;
    }
    if (Paths::DirExists(Paths::Join(installPath, "USA\\Data")))
    {
        return true;
    }
    return false;
}

bool Re2DataOk(const std::string& installPath)
{
    if (Paths::FileExists(Paths::Join(installPath, "ClaireU.exe")))
    {
        return true;
    }
    if (Paths::FileExists(Paths::Join(installPath, "LeonU.exe")))
    {
        return true;
    }
    return false;
}

bool Re3DataOk(const std::string& installPath)
{
    return Paths::FileExists(Paths::Join(installPath, "ResidentEvil3.exe"));
}

bool ExtraDataOk(const std::string& titleId, const std::string& installPath)
{
    if (titleId == "re1")
    {
        return Re1DataOk(installPath);
    }
    if (titleId == "re2")
    {
        return Re2DataOk(installPath);
    }
    if (titleId == "re3")
    {
        return Re3DataOk(installPath);
    }
    return false;
}
} // namespace

void InstallValidator::ValidateTitle(GameTitle& title)
{
    for (size_t i = 0; i < title.versions.size(); ++i)
    {
        GameVersion& v = title.versions[i];

        bool installOk = !title.installPath.empty() && Paths::DirExists(title.installPath);
        bool exeOk = false;
        if (installOk)
        {
            exeOk = Paths::FileExists(Paths::Join(title.installPath, v.execRelPath));
        }
        bool dataOk = false;
        if (installOk)
        {
            dataOk = ExtraDataOk(title.id, title.installPath);
        }

        const int passed = (installOk ? 1 : 0) + (exeOk ? 1 : 0) + (dataOk ? 1 : 0);
        if (passed == 3)
        {
            v.state = InstallState::INSTALLED;
        }
        else if (passed == 0)
        {
            v.state = InstallState::MISSING;
        }
        else
        {
            v.state = InstallState::PARTIAL;
        }
    }
}

void InstallValidator::ValidateAll(GameCatalog& catalog)
{
    std::vector<GameTitle>& titles = catalog.GetAllTitles();
    for (size_t i = 0; i < titles.size(); ++i)
    {
        ValidateTitle(titles[i]);
    }
}

void InstallValidator::ValidateMods(GameCatalog& catalog, const std::string& modBasePath)
{
    std::vector<GameTitle>& titles = catalog.GetAllTitles();
    for (size_t ti = 0; ti < titles.size(); ++ti)
    {
        GameTitle& t = titles[ti];
        for (size_t vi = 0; vi < t.versions.size(); ++vi)
        {
            GameVersion& v = t.versions[vi];
            if (!v.hasMod)
            {
                continue;
            }
            if (v.modPath.empty())
            {
                v.hasMod = false;
                continue;
            }
            std::string modDir = Paths::Join(modBasePath, v.modPath);
            if (!Paths::DirExists(modDir) || !DirHasAnyFile(modDir))
            {
                v.hasMod = false;
            }
        }
    }
}
