#include "audio/audio_system.h"

#include "config/paths.h"

#include <cstdio>
#include <cstring>

AudioSystem::AudioSystem()
    : deviceId(0)
    , initialized(false)
    , masterVolume(1.f)
    , musicVolume(1.f)
    , sfxVolume(1.f)
{
    std::memset(&deviceSpec, 0, sizeof(deviceSpec));
}

AudioSystem::~AudioSystem()
{
    Shutdown();
}

AudioSystem& AudioSystem::Get()
{
    static AudioSystem instance;
    return instance;
}

void AudioSystem::Init()
{
    if (initialized)
        return;

    if (!(SDL_WasInit(SDL_INIT_AUDIO) & SDL_INIT_AUDIO))
    {
        if (SDL_InitSubSystem(SDL_INIT_AUDIO) < 0)
        {
            std::fprintf(stderr, "AudioSystem::Init: SDL_InitSubSystem(AUDIO) failed: %s\n", SDL_GetError());
            return;
        }
    }

    SDL_AudioSpec want;
    std::memset(&want, 0, sizeof(want));
    want.freq     = 44100;
    want.format   = AUDIO_S16LSB;
    want.channels = 2;
    want.samples  = 2048;
    want.callback = NULL;

    deviceId = SDL_OpenAudioDevice(NULL, 0, &want, &deviceSpec, SDL_AUDIO_ALLOW_FORMAT_CHANGE);
    if (deviceId == 0)
    {
        std::fprintf(stderr, "AudioSystem::Init: SDL_OpenAudioDevice failed: %s\n", SDL_GetError());
        return;
    }

    SDL_PauseAudioDevice(deviceId, 0);

    std::string exeDir = Paths::GetExeDirectory();
    LoadWav(Paths::Join(exeDir, "assets/audio/DECIDE.wav").c_str(), "confirm");
    LoadWav(Paths::Join(exeDir, "assets/audio/Cancel (2).wav").c_str(), "back");
    LoadWav(Paths::Join(exeDir, "assets/audio/CURSOR (2).wav").c_str(), "cursor");

    initialized = true;
}

bool AudioSystem::LoadWav(const char* path, const char* name)
{
    SDL_AudioSpec wavSpec;
    Uint8* wavBuf = NULL;
    Uint32 wavLen = 0;

    if (!SDL_LoadWAV(path, &wavSpec, &wavBuf, &wavLen))
    {
        std::fprintf(stderr, "AudioSystem::LoadWav: failed to load %s: %s\n",
            path ? path : "(null)", SDL_GetError());
        return false;
    }

    SDL_AudioCVT cvt;
    int cvtResult = SDL_BuildAudioCVT(&cvt,
        wavSpec.format, wavSpec.channels, wavSpec.freq,
        deviceSpec.format, deviceSpec.channels, deviceSpec.freq);

    WavData wd;

    if (cvtResult < 0)
    {
        std::fprintf(stderr, "AudioSystem::LoadWav: SDL_BuildAudioCVT failed for %s\n", name);
        wd.buffer.assign(wavBuf, wavBuf + wavLen);
        wd.spec = wavSpec;
    }
    else if (cvtResult == 0)
    {
        wd.buffer.assign(wavBuf, wavBuf + wavLen);
        wd.spec = deviceSpec;
    }
    else
    {
        cvt.len = static_cast<int>(wavLen);
        cvt.buf = new Uint8[static_cast<size_t>(cvt.len * cvt.len_mult)];
        std::memcpy(cvt.buf, wavBuf, wavLen);

        if (SDL_ConvertAudio(&cvt) < 0)
        {
            std::fprintf(stderr, "AudioSystem::LoadWav: SDL_ConvertAudio failed for %s\n", name);
            delete[] cvt.buf;
            wd.buffer.assign(wavBuf, wavBuf + wavLen);
            wd.spec = wavSpec;
        }
        else
        {
            size_t convertedLen = static_cast<size_t>(cvt.len_cvt);
            wd.buffer.assign(cvt.buf, cvt.buf + convertedLen);
            wd.spec = deviceSpec;
            delete[] cvt.buf;
        }
    }

    SDL_FreeWAV(wavBuf);
    sounds[std::string(name)] = wd;
    return true;
}

void AudioSystem::Shutdown()
{
    if (deviceId != 0)
    {
        SDL_CloseAudioDevice(deviceId);
        deviceId = 0;
    }
    sounds.clear();
    initialized = false;
}

void AudioSystem::PlaySound(const char* name)
{
    if (!initialized || !name || deviceId == 0)
        return;

    std::map<std::string, WavData>::iterator it = sounds.find(std::string(name));
    if (it == sounds.end())
        return;

    const WavData& wd = it->second;
    float vol = masterVolume * sfxVolume;
    if (vol <= 0.f)
        return;

    if (vol >= 1.f)
    {
        SDL_QueueAudio(deviceId, &wd.buffer[0], static_cast<Uint32>(wd.buffer.size()));
    }
    else
    {
        std::vector<Uint8> scaled(wd.buffer.size());
        SDL_MixAudioFormat(&scaled[0], &wd.buffer[0], deviceSpec.format,
            static_cast<Uint32>(wd.buffer.size()),
            static_cast<int>(vol * static_cast<float>(SDL_MIX_MAXVOLUME)));
        SDL_QueueAudio(deviceId, &scaled[0], static_cast<Uint32>(scaled.size()));
    }
}

void AudioSystem::PlayMusic(const char* /*name*/)
{
}

void AudioSystem::StopMusic()
{
}

void AudioSystem::SetMasterVolume(float v)
{
    if (v < 0.f) v = 0.f;
    if (v > 1.f) v = 1.f;
    masterVolume = v;
}

void AudioSystem::SetMusicVolume(float v)
{
    if (v < 0.f) v = 0.f;
    if (v > 1.f) v = 1.f;
    musicVolume = v;
}

void AudioSystem::SetSFXVolume(float v)
{
    if (v < 0.f) v = 0.f;
    if (v > 1.f) v = 1.f;
    sfxVolume = v;
}
