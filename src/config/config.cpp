#include "config/config.h"

#include "config/paths.h"

#include <cctype>
#include <cstdlib>
#include <fstream>
#include <sstream>

namespace
{
    std::string Trim(const std::string& s)
    {
        std::size_t start = 0;
        while (start < s.size() && std::isspace(static_cast<unsigned char>(s[start])))
        {
            ++start;
        }
        std::size_t end = s.size();
        while (end > start && std::isspace(static_cast<unsigned char>(s[end - 1])))
        {
            --end;
        }
        return s.substr(start, end - start);
    }

    bool ParseBoolString(const std::string& s, bool& out)
    {
        std::string lower;
        lower.reserve(s.size());
        for (std::size_t i = 0; i < s.size(); ++i)
        {
            lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(s[i]))));
        }
        if (lower == "1" || lower == "true" || lower == "yes" || lower == "on")
        {
            out = true;
            return true;
        }
        if (lower == "0" || lower == "false" || lower == "no" || lower == "off")
        {
            out = false;
            return true;
        }
        return false;
    }
}

Config::Config() {}

Config::~Config() {}

Config& Config::Get()
{
    static Config instance;
    return instance;
}

bool Config::Load(const std::string& filename)
{
    const std::string full = Paths::JoinPath(Paths::GetConfigDirectory(), filename);
    std::ifstream in(full.c_str());
    if (!in)
    {
        return false;
    }

    values.clear();
    std::string currentSection;
    std::string line;
    while (std::getline(in, line))
    {
        const std::string trimmed = Trim(line);
        if (trimmed.empty() || trimmed[0] == '#')
        {
            continue;
        }
        if (trimmed.size() >= 2 && trimmed[0] == '[' && trimmed[trimmed.size() - 1] == ']')
        {
            currentSection = Trim(trimmed.substr(1, trimmed.size() - 2));
            continue;
        }
        const std::size_t eq = trimmed.find('=');
        if (eq == std::string::npos)
        {
            continue;
        }
        std::string key = Trim(trimmed.substr(0, eq));
        std::string val = Trim(trimmed.substr(eq + 1));
        if (key.empty())
        {
            continue;
        }
        if (!currentSection.empty())
        {
            key = currentSection + "." + key;
        }
        values[key] = val;
    }
    return true;
}

bool Config::Save(const std::string& filename)
{
    const std::string full = Paths::JoinPath(Paths::GetConfigDirectory(), filename);
    std::ofstream out(full.c_str());
    if (!out)
    {
        return false;
    }
    for (std::map<std::string, std::string>::const_iterator it = values.begin(); it != values.end(); ++it)
    {
        out << it->first << " = " << it->second << "\n";
    }
    return true;
}

std::string Config::GetString(const std::string& key, const std::string& def) const
{
    const std::map<std::string, std::string>::const_iterator it = values.find(key);
    if (it == values.end())
    {
        return def;
    }
    return it->second;
}

int Config::GetInt(const std::string& key, int def) const
{
    const std::string s = GetString(key, "");
    if (s.empty())
    {
        return def;
    }
    char* end = 0;
    const long v = std::strtol(s.c_str(), &end, 10);
    if (end == s.c_str())
    {
        return def;
    }
    return static_cast<int>(v);
}

float Config::GetFloat(const std::string& key, float def) const
{
    const std::string s = GetString(key, "");
    if (s.empty())
    {
        return def;
    }
    char* end = 0;
    const float v = std::strtof(s.c_str(), &end);
    if (end == s.c_str())
    {
        return def;
    }
    return v;
}

bool Config::GetBool(const std::string& key, bool def) const
{
    const std::string s = GetString(key, "");
    if (s.empty())
    {
        return def;
    }
    bool b = def;
    if (ParseBoolString(s, b))
    {
        return b;
    }
    return def;
}

void Config::SetString(const std::string& key, const std::string& val)
{
    values[key] = val;
}

void Config::SetInt(const std::string& key, int val)
{
    std::ostringstream oss;
    oss << val;
    values[key] = oss.str();
}

void Config::SetFloat(const std::string& key, float val)
{
    std::ostringstream oss;
    oss << val;
    values[key] = oss.str();
}

void Config::SetBool(const std::string& key, bool val)
{
    values[key] = val ? "true" : "false";
}

bool Config::Has(const std::string& key) const
{
    return values.find(key) != values.end();
}
