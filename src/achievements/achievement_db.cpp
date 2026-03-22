#include "achievements/achievement_db.h"

#include "core/log.h"

#include <cctype>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <sstream>

namespace
{

std::string CurrentIsoTimestamp()
{
    const std::time_t t = std::time(0);
    std::tm           tmBuf;
#if defined(_WIN32) || defined(WIN32)
    localtime_s(&tmBuf, &t);
#else
    localtime_r(&t, &tmBuf);
#endif
    char buf[64];
    if (std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &tmBuf) == 0)
    {
        return "1970-01-01T00:00:00";
    }
    return std::string(buf);
}

void TrimInPlace(std::string& s)
{
    while (!s.empty() && (s[0] == ' ' || s[0] == '\t' || s[0] == '\r' || s[0] == '\n'))
    {
        s.erase(0, 1);
    }
    while (!s.empty())
    {
        const char c = s[s.size() - 1];
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n')
        {
            s.erase(s.size() - 1, 1);
        }
        else
        {
            break;
        }
    }
}

bool ReadWholeFile(const std::string& path, std::string& out)
{
    std::ifstream f(path.c_str(), std::ios::in | std::ios::binary);
    if (!f)
    {
        return false;
    }
    std::ostringstream ss;
    ss << f.rdbuf();
    out = ss.str();
    return true;
}

void SkipWs(const std::string& s, std::size_t& i)
{
    while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i])))
    {
        ++i;
    }
}

bool Expect(const std::string& s, std::size_t& i, char c)
{
    SkipWs(s, i);
    if (i >= s.size() || s[i] != c)
    {
        return false;
    }
    ++i;
    return true;
}

bool ParseString(const std::string& s, std::size_t& i, std::string& out)
{
    SkipWs(s, i);
    if (i >= s.size() || s[i] != '"')
    {
        return false;
    }
    ++i;
    out.clear();
    while (i < s.size())
    {
        const char c = s[i];
        if (c == '"')
        {
            ++i;
            return true;
        }
        if (c == '\\' && i + 1 < s.size())
        {
            ++i;
            out.push_back(s[i]);
            ++i;
            continue;
        }
        out.push_back(c);
        ++i;
    }
    return false;
}

bool ParseAchievementObject(const std::string& s, std::size_t& i, Achievement& a)
{
    SkipWs(s, i);
    if (i >= s.size() || s[i] != '{')
    {
        return false;
    }
    ++i;

    Achievement tmp;
    tmp.unlocked    = false;
    tmp.unlockDate.clear();

    for (;;)
    {
        SkipWs(s, i);
        if (i < s.size() && s[i] == '}')
        {
            ++i;
            a = tmp;
            return true;
        }

        std::string key;
        if (!ParseString(s, i, key))
        {
            return false;
        }
        if (!Expect(s, i, ':'))
        {
            return false;
        }

        if (key == "id")
        {
            if (!ParseString(s, i, tmp.id))
            {
                return false;
            }
        }
        else if (key == "name")
        {
            if (!ParseString(s, i, tmp.name))
            {
                return false;
            }
        }
        else if (key == "desc")
        {
            if (!ParseString(s, i, tmp.desc))
            {
                return false;
            }
        }
        else if (key == "icon")
        {
            if (!ParseString(s, i, tmp.icon))
            {
                return false;
            }
        }
        else
        {
            std::string ignored;
            if (!ParseString(s, i, ignored))
            {
                return false;
            }
        }

        SkipWs(s, i);
        if (i < s.size() && s[i] == ',')
        {
            ++i;
            continue;
        }
        if (i < s.size() && s[i] == '}')
        {
            ++i;
            a = tmp;
            return true;
        }
        return false;
    }
}

bool ParseAchievementArray(const std::string& s, std::size_t& i, const std::string& gameId,
    std::vector<Achievement>& out)
{
    SkipWs(s, i);
    if (i >= s.size() || s[i] != '[')
    {
        return false;
    }
    ++i;

    for (;;)
    {
        SkipWs(s, i);
        if (i < s.size() && s[i] == ']')
        {
            ++i;
            return true;
        }

        Achievement a;
        a.gameId   = gameId;
        a.unlocked = false;
        if (!ParseAchievementObject(s, i, a))
        {
            return false;
        }
        out.push_back(a);

        SkipWs(s, i);
        if (i < s.size() && s[i] == ',')
        {
            ++i;
            continue;
        }
        if (i < s.size() && s[i] == ']')
        {
            ++i;
            return true;
        }
        return false;
    }
}

bool ParseRoot(const std::string& s, std::vector<Achievement>& out)
{
    std::size_t i = 0;
    SkipWs(s, i);
    if (i >= s.size() || s[i] != '{')
    {
        return false;
    }
    ++i;

    for (;;)
    {
        SkipWs(s, i);
        if (i < s.size() && s[i] == '}')
        {
            ++i;
            return true;
        }

        std::string gameKey;
        if (!ParseString(s, i, gameKey))
        {
            return false;
        }
        if (gameKey != "re1" && gameKey != "re2" && gameKey != "re3")
        {
            return false;
        }
        if (!Expect(s, i, ':'))
        {
            return false;
        }
        if (!ParseAchievementArray(s, i, gameKey, out))
        {
            return false;
        }

        SkipWs(s, i);
        if (i < s.size() && s[i] == ',')
        {
            ++i;
            continue;
        }
        if (i < s.size() && s[i] == '}')
        {
            ++i;
            return true;
        }
        return false;
    }
}

} // namespace

AchievementDB::AchievementDB()
{
}

AchievementDB::~AchievementDB()
{
}

AchievementDB& AchievementDB::Get()
{
    static AchievementDB instance;
    return instance;
}

void AchievementDB::Clear()
{
    achievements_.clear();
    idToIndex_.clear();
}

void AchievementDB::RebuildIdIndex()
{
    idToIndex_.clear();
    for (std::size_t i = 0; i < achievements_.size(); ++i)
    {
        idToIndex_[achievements_[i].id] = i;
    }
}

void AchievementDB::RegisterAchievement(const Achievement& def)
{
    achievements_.push_back(def);
}

void AchievementDB::LoadHardcodedDefinitions()
{
    Clear();

    const Achievement re1[] = {
        {"re1_001", "re1", "A Member of S.T.A.R.S.", "Complete the game as Jill on Standard", "", false,
            ""},
        {"re1_002", "re1", "Future Boulder Puncher", "Complete the game as Chris on Standard", "", false,
            ""},
        {"re1_005", "re1", "In and Out, Three Hours",
            "Complete the game in less than 3 hours on Standard", "", false, ""},
        {"re1_018", "re1", "Did Someone Say Boom?", "Obtain the grenade launcher as Jill on Standard", "",
            false, ""},
        {"re1_025", "re1", "The Master of Unlocking", "Open all the Helmet Doors as Jill on Standard", "",
            false, ""},
        {"re1_062", "re1", "At Least It Wasn't Nemesis", "Kill the first Tyrant in the Laboratory as Jill on Standard",
            "", false, ""},
        {"re1_074", "re1", "Time for Boomstick Action", "Obtain the Shotgun as Chris on Standard", "", false,
            ""},
        {"re1_088", "re1", "It's Time to Be a Hero!",
            "Begin Rebecca's journey to save Chris from snake poison", "", false, ""},
        {"re1_109", "re1", "Wesker's a Pushover, Isn't He?", "Kill Tyrant in Laboratory as Chris", "", false,
            ""},
        {"re1_115", "re1", "Piers Won't Be Happy about This", "Escape alone as Chris", "", false, ""},
    };

    const Achievement re2[] = {
        {"re2_001", "re2", "Meat Is No Substitute", "Complete the Tofu Survivor scenario", "", false, ""},
        {"re2_016", "re2", "Tough Break, Pal",
            "Leon-A: Eliminate the zombies in the gun shop and obtain Kendo's shotgun", "", false, ""},
        {"re2_052", "re2", "Party's Over",
            "Leon-A: Get to work and meet your boss, Marvin Branagh", "", false, ""},
        {"re2_058", "re2", "Night of the Living Claire",
            "Leon-A: Reunite with Claire in the S.T.A.R.S. Office", "", false, ""},
        {"re2_059", "re2", "Girl Talk", "Leon-A: Chase down the shooter and make her talk", "", false, ""},
        {"re2_062", "re2", "Mr. Death", "Complete the 4th Survivor scenario", "", false, ""},
        {"re2_077", "re2", "It's Over", "Complete Leon-A", "", false, ""},
        {"re2_084", "re2", "I'm Sorry...", "Leon-A: Put a friend out of his misery", "", false, ""},
        {"re2_093", "re2", "Documentary", "Find all files in Scenario A", "", false, ""},
        {"re2_131", "re2", "A Cut Above the Rest",
            "Defeat G-Type 4 in the Laboratory Cargo Room using only the knife", "", false, ""},
    };

    const Achievement re3[] = {
        {"re3_001", "re3", "I'm Getting Tired of You!",
            "Kill Nemesis six times or make him drop his item (Hard | No Mercs. Unlocks)", "", false, ""},
        {"re3_011", "re3", "We Dino Crisis Now!", "Play as Regina (Hard)", "", false, ""},
        {"re3_027", "re3", "Burn, Baby, Burn",
            "In the Barricaded Back Passage, open the closed door (Hard | No Mercs. Unlocks)", "", false,
            ""},
        {"re3_028", "re3", "Time To Clean the Streets",
            "In the Barricaded Back Passage, kill all the zombies without leaving the room before you use the Lighter (Hard | No Mercs. Unlocks)",
            "", false, ""},
        {"re3_029", "re3", "Grade Hunter", "Get an A rank in the mercenaries mini game", "", false, ""},
        {"re3_073", "re3", "I'M NOT LEAVING",
            "Try to speak with the crazy guy in the container (Hard | No Mercs. Unlocks)", "", false, ""},
        {"re3_075", "re3", "Say Hi to My New Friend", "Obtain the Shotgun (Hard | No Mercs. Unlocks)", "",
            false, ""},
        {"re3_104", "re3", "The Soldier", "Unlock the 8th Epilogue", "", false, ""},
        {"re3_112", "re3", "Master of Unlocking", "Obtain the Lockpick (Hard | No Mercs. Unlocks)", "", false,
            ""},
        {"re3_119", "re3", "I Need To Start Another Run Quickly",
            "Beat the game in under 3 hours (Hard | No Mercs. Unlocks)", "", false, ""},
    };

    for (std::size_t i = 0; i < ARRLEN(re1); ++i)
    {
        RegisterAchievement(re1[i]);
    }
    for (std::size_t i = 0; i < ARRLEN(re2); ++i)
    {
        RegisterAchievement(re2[i]);
    }
    for (std::size_t i = 0; i < ARRLEN(re3); ++i)
    {
        RegisterAchievement(re3[i]);
    }

    RebuildIdIndex();
}

bool AchievementDB::TryLoadJsonFile(const std::string& path)
{
    std::string text;
    if (!ReadWholeFile(path, text))
    {
        return false;
    }

    if (text.size() >= 3u && static_cast<unsigned char>(text[0]) == 0xEFu
        && static_cast<unsigned char>(text[1]) == 0xBBu && static_cast<unsigned char>(text[2]) == 0xBFu)
    {
        text.erase(0, 3);
    }

    std::vector<Achievement> parsed;
    if (!ParseRoot(text, parsed))
    {
        Log::Get().Warning("AchievementDB: failed to parse JSON: %s\n", path.c_str());
        return false;
    }

    if (parsed.empty())
    {
        return false;
    }

    Clear();
    for (std::size_t i = 0; i < parsed.size(); ++i)
    {
        parsed[i].unlocked    = false;
        parsed[i].unlockDate.clear();
        RegisterAchievement(parsed[i]);
    }
    RebuildIdIndex();
    return true;
}

void AchievementDB::Init()
{
    static const char kJsonPath[] = "assets/achievements/achievements.json";
    if (!TryLoadJsonFile(kJsonPath))
    {
        LoadHardcodedDefinitions();
    }
}

void AchievementDB::ApplySaveLine(const std::string& lineRaw)
{
    std::string line = lineRaw;
    TrimInPlace(line);
    if (line.empty() || line[0] == '#' || line[0] == ';')
    {
        return;
    }

    const std::size_t eq = line.find('=');
    if (eq == std::string::npos)
    {
        return;
    }

    std::string id    = line.substr(0, eq);
    std::string value = line.substr(eq + 1);
    TrimInPlace(id);
    TrimInPlace(value);

    std::map<std::string, std::size_t>::iterator it = idToIndex_.find(id);
    if (it == idToIndex_.end())
    {
        return;
    }

    Achievement& a = achievements_[it->second];

    const std::size_t bar = value.find('|');
    std::string       flagPart;
    std::string       datePart;
    if (bar == std::string::npos)
    {
        flagPart = value;
    }
    else
    {
        flagPart = value.substr(0, bar);
        datePart = value.substr(bar + 1);
        TrimInPlace(flagPart);
        TrimInPlace(datePart);
    }

    if (flagPart == "1" || flagPart == "true" || flagPart == "yes")
    {
        a.unlocked = true;
    }
    else if (flagPart == "0" || flagPart == "false" || flagPart == "no")
    {
        a.unlocked    = false;
        a.unlockDate.clear();
        return;
    }
    else
    {
        return;
    }

    if (!datePart.empty())
    {
        a.unlockDate = datePart;
    }
    else if (a.unlocked)
    {
        a.unlockDate = CurrentIsoTimestamp();
    }
}

void AchievementDB::LoadProgress(const std::string& savePath)
{
    activeSavePath_ = savePath;

    for (std::size_t i = 0; i < achievements_.size(); ++i)
    {
        achievements_[i].unlocked    = false;
        achievements_[i].unlockDate.clear();
    }

    std::ifstream f(savePath.c_str(), std::ios::in);
    if (!f)
    {
        return;
    }

    std::string line;
    while (std::getline(f, line))
    {
        ApplySaveLine(line);
    }
}

void AchievementDB::SaveProgress(const std::string& savePath)
{
    activeSavePath_ = savePath;

    std::FILE* f = std::fopen(savePath.c_str(), "wb");
    if (!f)
    {
        Log::Get().Warning("AchievementDB: could not write save file: %s\n", savePath.c_str());
        return;
    }

    std::fprintf(f, "# Resident Evil Classic Collection - achievement progress\n");
    for (std::size_t i = 0; i < achievements_.size(); ++i)
    {
        const Achievement& a = achievements_[i];
        if (a.unlocked)
        {
            std::fprintf(f, "%s=1|%s\n", a.id.c_str(), a.unlockDate.c_str());
        }
        else
        {
            std::fprintf(f, "%s=0|\n", a.id.c_str());
        }
    }
    std::fclose(f);
}

std::vector<Achievement*> AchievementDB::GetAchievements(const std::string& gameId)
{
    std::vector<Achievement*> out;
    for (std::size_t i = 0; i < achievements_.size(); ++i)
    {
        if (achievements_[i].gameId == gameId)
        {
            out.push_back(&achievements_[i]);
        }
    }
    return out;
}

Achievement* AchievementDB::GetAchievement(const std::string& id)
{
    std::map<std::string, std::size_t>::iterator it = idToIndex_.find(id);
    if (it == idToIndex_.end())
    {
        return 0;
    }
    return &achievements_[it->second];
}

void AchievementDB::UnlockAchievement(const std::string& id)
{
    Achievement* a = GetAchievement(id);
    if (!a || a->unlocked)
    {
        return;
    }
    a->unlocked    = true;
    a->unlockDate = CurrentIsoTimestamp();

    if (!activeSavePath_.empty())
    {
        SaveProgress(activeSavePath_);
    }
}

bool AchievementDB::IsUnlocked(const std::string& id) const
{
    std::map<std::string, std::size_t>::const_iterator it = idToIndex_.find(id);
    if (it == idToIndex_.end())
    {
        return false;
    }
    return achievements_[it->second].unlocked;
}

int AchievementDB::GetUnlockedCount(const std::string& gameId) const
{
    int n = 0;
    for (std::size_t i = 0; i < achievements_.size(); ++i)
    {
        if (achievements_[i].gameId == gameId && achievements_[i].unlocked)
        {
            ++n;
        }
    }
    return n;
}

int AchievementDB::GetTotalCount(const std::string& gameId) const
{
    int n = 0;
    for (std::size_t i = 0; i < achievements_.size(); ++i)
    {
        if (achievements_[i].gameId == gameId)
        {
            ++n;
        }
    }
    return n;
}
