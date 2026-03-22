#ifndef RE_PATHS_H
#define RE_PATHS_H

#include "core/types.h"

#include <string>

namespace Paths
{
    std::string GetExeDirectory();
    std::string GetConfigDirectory();
    std::string GetAssetsDirectory();

    std::string JoinPath(const std::string& a, const std::string& b);
    /** Same as JoinPath; alias used by install / mod code. */
    inline std::string Join(const std::string& a, const std::string& b) { return JoinPath(a, b); }
    bool FileExists(const std::string& path);
    bool DirectoryExists(const std::string& path);
    /** Alias for DirectoryExists. */
    inline bool DirExists(const std::string& path) { return DirectoryExists(path); }
    void NormalizePath(std::string& path);
    std::string GetFileName(const std::string& path);
    std::string GetFileExtension(const std::string& path);
    bool EnsureDirTree(const std::string& path);
}

#endif
