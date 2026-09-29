/*
 * gate.cpp — the Phase 0 feasibility probe, built as an ASI plugin.
 *
 * THIS FILE IS THROWAWAY. It exists to answer three questions with measurements rather
 * than assumptions, before a single line of real overlay code is written:
 *
 *   1. Does the Ultimate ASI Loader that RE-Enhance installs actually load a `*.asi`
 *      that the launcher put in the game folder? (The loader identifies itself as
 *      "Ultimate-ASI-Loader-x86" in every install's `dinput8.dll` / `dsound.dll`, but
 *      that is its *name*, not an observation of it loading anything of ours.)
 *   2. What is the presentation chain at runtime, with full module paths? Static
 *      analysis says RE1 and RE2 reach D3D11 through dgVoodoo and RE3 imports d3d9
 *      directly; only the running process can confirm which of those modules are
 *      actually loaded, and from which folder.
 *   3. Does the plugin stay loaded and alive for the whole session?
 *
 * What it deliberately does NOT do: hook anything, patch any code, touch the game's
 * memory or files, or draw. A probe that can break the game cannot be trusted to
 * measure it. Presenting is measured from outside, by `tools/gate-run.ps1`, which
 * screen-captures the game window with the same `CopyFromScreen`/`GetPixel` primitive
 * `tools/probe-crt.ps1` and `tools/probe-embed3.ps1` already use.
 *
 * Every line it writes goes to `%TEMP%\re-overlay-gate\`, one file set per process, so
 * the game install is left exactly as it was found.
 *
 * Plain C, fixed buffers and no C++ runtime: the plugin is compiled /MT with no
 * exceptions, so a failure to allocate can never unwind through the loader lock.
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

/** How often the worker samples the loaded modules and the heartbeat. */
#define GATE_TICK_MS 2000
/** How long the worker keeps sampling before it writes a "still here" final line. */
#define GATE_MAX_TICKS 600
/** A window smaller than this is not the game (the loader's dialogs are #32770). */
#define GATE_MIN_WINDOW 200

static HMODULE g_self = NULL;
static HANDLE g_thread = NULL;
static volatile LONG g_stop = 0;

/* ------------------------------------------------------------------ output */

/**
 * The log directory: `%TEMP%\re-overlay-gate\`.
 *
 * TEMP rather than the install, because a probe must not leave anything behind in a
 * game folder — and because the install's own files are what the launcher backs up and
 * restores, so an unexpected file there would be mistaken for mod content.
 */
static BOOL gate_dir(char* out, size_t size)
{
  char temp[MAX_PATH];
  DWORD got = GetTempPathA((DWORD)sizeof(temp), temp);
  if (got == 0 || got > sizeof(temp)) return FALSE;
  _snprintf_s(out, size, _TRUNCATE, "%sre-overlay-gate", temp);

  /* CreateDirectoryA fails with ERROR_ALREADY_EXISTS on every run after the first,
     which is success for this purpose. */
  if (!CreateDirectoryA(out, NULL))
  {
    DWORD error = GetLastError();
    if (error != ERROR_ALREADY_EXISTS) return FALSE;
  }
  return TRUE;
}

/** `<dir>\<exe>.<pid>.<suffix>` — one file set per process, so a title cannot overwrite another's. */
static BOOL gate_path(char* out, size_t size, const char* suffix)
{
  char dir[MAX_PATH];
  if (!gate_dir(dir, sizeof(dir))) return FALSE;

  char exe[MAX_PATH];
  if (GetModuleFileNameA(NULL, exe, (DWORD)sizeof(exe)) == 0) return FALSE;
  const char* base = strrchr(exe, '\\');
  base = (base == NULL) ? exe : base + 1;

  /* The extension is dropped so the pid and suffix are what the name ends with: a file
     called `Biohazard.exe.1234.chain.txt` reads badly in a directory listing. */
  char stem[MAX_PATH];
  _snprintf_s(stem, sizeof(stem), _TRUNCATE, "%s", base);
  char* dot = strrchr(stem, '.');
  if (dot != NULL) *dot = '\0';

  _snprintf_s(out, size, _TRUNCATE, "%s\\%s.%lu.%s", dir, stem, (unsigned long)GetCurrentProcessId(), suffix);
  return TRUE;
}

/**
 * Appends one line, flushed immediately.
 *
 * Opened and closed per line on purpose: the probe must produce a usable file even if
 * the game is killed with `taskkill /F`, which is exactly how the gate run ends.
 */
static void gate_line(const char* suffix, const char* format, ...)
{
  char path[MAX_PATH];
  if (!gate_path(path, sizeof(path), suffix)) return;

  FILE* file = NULL;
  if (fopen_s(&file, path, "ab") != 0 || file == NULL) return;

  SYSTEMTIME now;
  GetLocalTime(&now);
  fprintf(file, "%04u-%02u-%02u %02u:%02u:%02u.%03u\t",
          (unsigned)now.wYear, (unsigned)now.wMonth, (unsigned)now.wDay,
          (unsigned)now.wHour, (unsigned)now.wMinute, (unsigned)now.wSecond,
          (unsigned)now.wMilliseconds);

  va_list args;
  va_start(args, format);
  vfprintf(file, format, args);
  va_end(args);

  fputc('\n', file);
  fflush(file);
  fclose(file);
}

static void gate_text(const char* suffix, const char* format, ...)
{
  char path[MAX_PATH];
  if (!gate_path(path, sizeof(path), suffix)) return;

  FILE* file = NULL;
  if (fopen_s(&file, path, "wb") != 0 || file == NULL) return;

  va_list args;
  va_start(args, format);
  vfprintf(file, format, args);
  va_end(args);

  fflush(file);
  fclose(file);
}

/* ------------------------------------------------------- module enumeration */

/**
 * The modules whose presence decides which API the game presents through.
 *
 * Matched on the file name only; every hit's *full path* is written, which is what
 * distinguishes a game-folder `ddraw.dll` (Classic REbirth) from the system one, and
 * confirms whether dgVoodoo's renamed DirectDraw (`re1_ddraw.dll`, `re2_ddraw.dll`)
 * really is what REbirth loads.
 */
static const char* kInteresting[] = {
  "ddraw.dll", "d3dimm.dll", "d3d8.dll", "d3d9.dll", "d3d10.dll", "d3d11.dll", "d3d12.dll",
  "dxgi.dll", "dinput8.dll", "dinput.dll", "dsound.dll", "winmm.dll", "opengl32.dll",
  "libwebp.dll", "dgvoodoo.conf", "gdiplus.dll", "asi", "bio1hd", "bio2hd", "bio3hd"
};

static BOOL gate_is_interesting(const char* lowerName)
{
  size_t i;
  for (i = 0; i < sizeof(kInteresting) / sizeof(kInteresting[0]); i++)
  {
    if (strstr(lowerName, kInteresting[i]) != NULL) return TRUE;
  }
  return FALSE;
}

static void gate_lower(char* out, size_t size, const char* in)
{
  size_t i;
  for (i = 0; i + 1 < size && in[i] != '\0'; i++)
  {
    char c = in[i];
    out[i] = (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c;
  }
  out[i] = '\0';
}

/** Every module path seen so far, so a module is reported once, when it first appears. */
static char g_seen[512][MAX_PATH];
static int g_seenCount = 0;

/**
 * Snapshots the process's modules and appends the interesting ones it has not seen.
 *
 * `MODULEENTRY32.szExePath` is the whole point: `.szModule` alone would not say whether
 * `ddraw.dll` came from the game folder or from `SysWOW64`, and that difference is the
 * entire question this probe is asking.
 */
static int gate_scan_modules(void)
{
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, GetCurrentProcessId());
  if (snapshot == INVALID_HANDLE_VALUE) return g_seenCount;

  MODULEENTRY32 entry;
  entry.dwSize = sizeof(entry);

  if (Module32First(snapshot, &entry))
  {
    do
    {
      char lower[MAX_PATH];
      gate_lower(lower, sizeof(lower), entry.szModule);
      if (!gate_is_interesting(lower)) continue;

      int already = 0;
      int i;
      for (i = 0; i < g_seenCount; i++)
      {
        if (_stricmp(g_seen[i], entry.szExePath) == 0) { already = 1; break; }
      }
      if (already) continue;

      if (g_seenCount < (int)(sizeof(g_seen) / sizeof(g_seen[0])))
      {
        _snprintf_s(g_seen[g_seenCount], MAX_PATH, _TRUNCATE, "%s", entry.szExePath);
        g_seenCount++;
      }

      gate_line("chain.txt", "MODULE\t%s\t%s\tbase=0x%08lX\tsize=%lu",
                entry.szModule, entry.szExePath,
                (unsigned long)(ULONG_PTR)entry.modBaseAddr, (unsigned long)entry.modBaseSize);
    } while (Module32Next(snapshot, &entry));
  }

  CloseHandle(snapshot);
  return g_seenCount;
}

/* -------------------------------------------------------- window enumeration */

typedef struct WindowProbe
{
  HWND best;
  DWORD bestArea;
  char className[128];
  char title[256];
  int width;
  int height;
  int visibleCount;
} WindowProbe;

static BOOL CALLBACK gate_window_proc(HWND hwnd, LPARAM param)
{
  WindowProbe* probe = (WindowProbe*)param;

  DWORD owner = 0;
  GetWindowThreadProcessId(hwnd, &owner);
  if (owner != GetCurrentProcessId()) return TRUE;
  if (!IsWindowVisible(hwnd)) return TRUE;

  RECT rect;
  if (!GetWindowRect(hwnd, &rect)) return TRUE;
  int width = rect.right - rect.left;
  int height = rect.bottom - rect.top;
  if (width < GATE_MIN_WINDOW || height < GATE_MIN_WINDOW) return TRUE;

  probe->visibleCount++;
  DWORD area = (DWORD)width * (DWORD)height;
  if (area <= probe->bestArea) return TRUE;

  probe->best = hwnd;
  probe->bestArea = area;
  probe->width = width;
  probe->height = height;
  GetClassNameA(hwnd, probe->className, (int)sizeof(probe->className));
  GetWindowTextA(hwnd, probe->title, (int)sizeof(probe->title));
  return TRUE;
}

/**
 * The game's window, by the same rule `resources/window-host.ps1` uses: the largest
 * visible window this process owns that is not one of the loader's `#32770` dialogs.
 * Reported for the record, and as the anchor the gate runner captures from outside.
 */
static void gate_report_window(const char* tag, int tick)
{
  WindowProbe probe;
  ZeroMemory(&probe, sizeof(probe));
  EnumWindows(gate_window_proc, (LPARAM)&probe);

  if (probe.best == NULL)
  {
    gate_line("heartbeat.txt", "%s\ttick=%d\tmodules=%d\twindow=none", tag, tick, g_seenCount);
    return;
  }

  RECT client;
  GetClientRect(probe.best, &client);
  gate_line("heartbeat.txt", "%s\ttick=%d\tmodules=%d\twindow=%s\tclass=%s\ttitle=%s\tsize=%dx%d\tclient=%dx%d",
            tag, tick, g_seenCount, "found", probe.className, probe.title,
            probe.width, probe.height,
            client.right - client.left, client.bottom - client.top);
}

/* ------------------------------------------------------------------- worker */

static DWORD WINAPI gate_worker(LPVOID param)
{
  (void)param;

  char modulePath[MAX_PATH];
  HMODULE self = NULL;
  GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                     (LPCSTR)&gate_worker, &self);
  GetModuleFileNameA(self, modulePath, (DWORD)sizeof(modulePath));

  char exePath[MAX_PATH];
  GetModuleFileNameA(NULL, exePath, (DWORD)sizeof(exePath));

  char cwd[MAX_PATH];
  GetCurrentDirectoryA((DWORD)sizeof(cwd), cwd);

  gate_text("loaded.txt",
            "plugin\t%s\n"
            "pluginBase\t0x%08lX\n"
            "pid\t%lu\n"
            "exe\t%s\n"
            "cwd\t%s\n"
            "thread\t%lu\n",
            modulePath,
            (unsigned long)(ULONG_PTR)self,
            (unsigned long)GetCurrentProcessId(),
            exePath, cwd,
            (unsigned long)GetCurrentThreadId());

  gate_scan_modules();
  gate_report_window("start", 0);

  int tick = 1;
  while (tick <= GATE_MAX_TICKS && InterlockedCompareExchange(&g_stop, 0, 0) == 0)
  {
    Sleep(GATE_TICK_MS);
    gate_scan_modules();
    /* Every fifth tick writes the window line (10 s) so a long session's heartbeat file
       stays readable; the module scan above still runs every tick, which is what catches
       a module that arrives late. */
    if (tick % 5 == 0) gate_report_window("alive", tick);
    tick++;
  }

  gate_line("heartbeat.txt", "worker\texiting\ttick=%d", tick);
  return 0;
}

/* ------------------------------------------------------------------ exports */

extern "C" BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved)
{
  (void)reserved;

  if (reason == DLL_PROCESS_ATTACH)
  {
    g_self = instance;
    DisableThreadLibraryCalls(instance);

    /* The worker is started from DllMain only in the sense that the thread is created
       here; everything of substance happens on it. `DisableThreadLibraryCalls` means the
       loader lock is never taken again by this module. */
    g_thread = CreateThread(NULL, 0, gate_worker, NULL, 0, NULL);
    if (g_thread != NULL) CloseHandle(g_thread);
    return TRUE;
  }

  if (reason == DLL_PROCESS_DETACH)
  {
    /*
     * The flag is set and nothing is written. A file write here would run under the
     * loader lock, with the C runtime possibly already torn down during process exit —
     * and a probe that can deadlock the game on shutdown measures nothing. The worker
     * writes the final line itself when it notices the flag, and a `taskkill /F` run
     * ends without one, which is why every line above is flushed as it is written.
     */
    InterlockedExchange(&g_stop, 1);
    return TRUE;
  }

  return TRUE;
}
