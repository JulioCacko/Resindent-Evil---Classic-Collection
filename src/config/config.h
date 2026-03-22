#ifndef RE_CONFIG_H
#define RE_CONFIG_H

#include "core/types.h"

#include <map>
#include <string>

class Config
{
public:
    static Config& Get();

    bool Load(const std::string& filename);
    bool Save(const std::string& filename);

    std::string GetString(const std::string& key, const std::string& def = "") const;
    int GetInt(const std::string& key, int def = 0) const;
    float GetFloat(const std::string& key, float def = 0.f) const;
    bool GetBool(const std::string& key, bool def = false) const;

    void SetString(const std::string& key, const std::string& val);
    void SetInt(const std::string& key, int val);
    void SetFloat(const std::string& key, float val);
    void SetBool(const std::string& key, bool val);

    bool Has(const std::string& key) const;

private:
    Config();
    ~Config();
    Config(const Config&);
    Config& operator=(const Config&);

    std::map<std::string, std::string> values;
};

#endif
