#ifndef RE_AUDIO_SYSTEM_H
#define RE_AUDIO_SYSTEM_H

#include "core/types.h"

#include <SDL.h>

#include <map>
#include <string>
#include <vector>

class AudioSystem
{
public:
    static AudioSystem& Get();

    void Init();
    void Shutdown();

    void PlaySound(const char* name);
    void PlayMusic(const char* name);
    void StopMusic();

    void SetMasterVolume(float v);
    void SetMusicVolume(float v);
    void SetSFXVolume(float v);

private:
    AudioSystem();
    ~AudioSystem();
    AudioSystem(const AudioSystem&);
    AudioSystem& operator=(const AudioSystem&);

    struct WavData
    {
        std::vector<Uint8> buffer;
        SDL_AudioSpec spec;
    };

    bool LoadWav(const char* path, const char* name);

    SDL_AudioDeviceID deviceId;
    SDL_AudioSpec     deviceSpec;
    bool              initialized;

    std::map<std::string, WavData> sounds;

    float masterVolume;
    float musicVolume;
    float sfxVolume;
};

#endif
