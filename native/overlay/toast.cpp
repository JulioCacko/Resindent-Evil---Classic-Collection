/*
 * toast.cpp — the one toast the overlay knows about.
 *
 * One at a time, mirroring the launcher's own rule (`store.ts`'s `pushAchievement`: a single
 * `AchievementToast` carries one achievement and tells the store when it is done). Keeping the
 * same rule on both sides means the in-game toast can never run ahead of the launcher's queue
 * or show something the launcher has already moved past.
 *
 * The slot is a plain struct behind a critical section, and the render thread's copy is the
 * only thing it does under that lock. A game's frame must not wait on the launcher, so there
 * is deliberately no queue here: the launcher sends one `SHOW` at a time and waits for `ACK`.
 */

#include "overlay.h"

#include <stdarg.h>
#include <stdio.h>

static CRITICAL_SECTION g_lock;
static int g_lockReady = 0;

static OverlayToast g_toast;
static unsigned long long g_acceptedAtMs = 0;
static OverlayStats g_stats;

void overlay_lock_init(void)
{
  if (g_lockReady) return;
  /*
   * `InitializeCriticalSection` is one of the few calls the loader documentation allows from
   * `DllMain`, and it cannot fail on any Windows this plugin runs on. It is called from
   * `DllMain` rather than lazily so the render thread never races to create it.
   */
  InitializeCriticalSection(&g_lock);
  g_lockReady = 1;
}

void overlay_toast_set(const OverlayToast* toast)
{
  EnterCriticalSection(&g_lock);
  g_toast = *toast;
  g_toast.active = 1;
  g_acceptedAtMs = GetTickCount64();
  g_stats.lastSeq = toast->seq;
  LeaveCriticalSection(&g_lock);

  overlay_log("toast accepted: seq=%lu id=%ls", toast->seq, toast->id);
}

int overlay_toast_snapshot(OverlayToast* out)
{
  int active;
  EnterCriticalSection(&g_lock);
  if (g_toast.active && g_toast.startedAtMs == 0 && GetTickCount64() - g_acceptedAtMs > 30000)
    g_toast.active = 0;
  /*
   * The clock starts HERE - on the first read of a toast that has not started, which is the first frame able
   * to draw it. `overlay_toast_push` leaves `startedAtMs` at 0 deliberately: a `SHOW` can arrive long before
   * the game presents anything (the launcher's observed unlock is sent at spawn, and RE3 spends about 1.8
   * minutes initialising Classic REbirth and playing its intro), and the draw path discards a toast once
   * `TOAST_TOTAL_MS` has passed, so stamping at arrival meant that toast was never seen at all.
   *
   * It is stamped on `g_toast`, NOT on `*out`. The draw path fills a local copy from here, so stamping the
   * copy - which is what the first attempt at this fix did, one line in the draw path - is discarded on
   * return: `startedAtMs` stays 0, `elapsed` stays 0, the fade-in alpha stays 0, and the plugin draws an
   * invisible card on every frame, forever. `overlay-link.test.ts` caught that by polling `framesDrawn`, which
   * is the one thing that can tell "drew a frame" from "did nothing".
   */
  if (g_toast.active && g_toast.startedAtMs == 0) g_toast.startedAtMs = GetTickCount64();
  *out = g_toast;
  active = g_toast.active;
  LeaveCriticalSection(&g_lock);
  return active;
}

void overlay_toast_clear(void)
{
  EnterCriticalSection(&g_lock);
  ZeroMemory(&g_toast, sizeof(g_toast));
  LeaveCriticalSection(&g_lock);
  overlay_log("toast cleared");
}

void overlay_counters(OverlayStats* out)
{
  EnterCriticalSection(&g_lock);
  if (g_toast.active && g_toast.startedAtMs == 0 && GetTickCount64() - g_acceptedAtMs > 30000) g_toast.active = 0;
  *out = g_stats;
  LeaveCriticalSection(&g_lock);
}

/*
 * The two counters are the overlay's own evidence that it is running, and they are the reason
 * `STAT` exists: a launcher, and a test, can tell "loaded and drawing" from "loaded and
 * silently doing nothing" without looking at the screen. They are incremented on the render
 * thread, so they are plain interlocked adds and take no lock at all.
 */
void overlay_count_present(void)
{
  InterlockedIncrement64((volatile LONG64*)&g_stats.presents);
}

void overlay_count_drawn(void)
{
  InterlockedIncrement64((volatile LONG64*)&g_stats.framesDrawn);
}

/* ------------------------------------------------------------------ logging */

/** Off unless asked for: a plugin that writes files by default is one that gets quarantined. */
int overlay_log_enabled(void)
{
  static int cached = -1;
  if (cached < 0)
  {
    char value[16];
    DWORD got = GetEnvironmentVariableA("RE_OVERLAY_LOG", value, (DWORD)sizeof(value));
    cached = (got > 0 && got < sizeof(value) && value[0] != '0') ? 1 : 0;
  }
  return cached;
}

/**
 * Appends one line to `%TEMP%\re-classic-overlay\<pid>.log`.
 *
 * Opened, written and closed per line, like the Phase 0 probe: the game may be killed with
 * `taskkill /F`, and a log that loses its last line is worse than a slightly slower one.
 * Never called from the render thread.
 */
void overlay_log(const char* format, ...)
{
  if (!overlay_log_enabled()) return;

  char dir[MAX_PATH];
  char path[MAX_PATH];
  DWORD got = GetTempPathA((DWORD)sizeof(dir), dir);
  if (got == 0 || got > sizeof(dir)) return;
  _snprintf_s(path, sizeof(path), _TRUNCATE, "%sre-classic-overlay", dir);
  if (!CreateDirectoryA(path, NULL) && GetLastError() != ERROR_ALREADY_EXISTS) return;

  char file[MAX_PATH];
  _snprintf_s(file, sizeof(file), _TRUNCATE, "%s\\%lu.log", path, (unsigned long)GetCurrentProcessId());

  FILE* handle = NULL;
  if (fopen_s(&handle, file, "ab") != 0 || handle == NULL) return;

  SYSTEMTIME now;
  GetLocalTime(&now);
  fprintf(handle, "%02u:%02u:%02u.%03u\t",
          (unsigned)now.wHour, (unsigned)now.wMinute, (unsigned)now.wSecond, (unsigned)now.wMilliseconds);

  va_list args;
  va_start(args, format);
  vfprintf(handle, format, args);
  va_end(args);

  fputc('\n', handle);
  fflush(handle);
  fclose(handle);
}
