/*
 * overlay.h — the in-game overlay plugin's own interface.
 *
 * The plugin is what runs inside the game process (docs/ARCHITECTURE.md §12 explains how it
 * gets there: the Ultimate ASI Loader that RE-Enhance already installs loads any `*.asi` in
 * the game folder). This header is the seam between its parts:
 *
 *   dllmain.cpp  the loader entry point, which does nothing but start those below
 *   toast.cpp    the one toast slot the render side reads and the pipe writes
 *   pipe.cpp     the named pipe the launcher talks to
 *   log.cpp      opt-in file logging, off unless RE_OVERLAY_LOG is set
 *
 * THREADING, because it decides the shape of everything here. Three threads touch this state:
 * the game's render thread (which will call the present hook), the pipe thread, and the
 * loader's own thread during attach. The render thread can never block — a stalled frame is a
 * stalled game — so nothing on that path takes a lock for longer than a struct copy, and the
 * pipe thread is the only one that waits on I/O.
 */

#ifndef RE_OVERLAY_H
#define RE_OVERLAY_H

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

/** Bumped when the line protocol changes shape, so a stale launcher is refused loudly. */
#define OVERLAY_PROTOCOL_VERSION 1
#define OVERLAY_VERSION L"0.1.0"

/*
 * Field limits, and why they are small: every one of these is copied into a fixed buffer on
 * the render thread. The launcher's own achievement names are far shorter than these, so the
 * limit exists to bound the copy, not to accommodate anything real.
 */
#define OVERLAY_ID_MAX 64
#define OVERLAY_NAME_MAX 128
#define OVERLAY_DESC_MAX 256

/** One toast, as the pipe writes it and the render thread reads it. */
typedef struct OverlayToast
{
  int active;
  unsigned long seq;
  wchar_t id[OVERLAY_ID_MAX];
  wchar_t name[OVERLAY_NAME_MAX];
  wchar_t desc[OVERLAY_DESC_MAX];
  /** `GetTickCount64()` when the toast was accepted: the render side drives its fade from it. */
  unsigned long long startedAtMs;
} OverlayToast;

/** What the launcher asks for with `STAT`. */
typedef struct OverlayStats
{
  /** Present calls the hook has seen. Stays 0 until the hook exists (Phase 2). */
  unsigned long long presents;
  /** Frames the toast was actually drawn into - the launcher's proof the overlay is live. */
  unsigned long long framesDrawn;
  unsigned long lastSeq;
} OverlayStats;

/* ------------------------------------------------------------------ logging */
void overlay_log(const char* format, ...);
int overlay_log_enabled(void);

/* -------------------------------------------------------------- toast state */
void overlay_lock_init(void);
void overlay_toast_set(const OverlayToast* toast);
/** Copies the slot out. Returns 0 when there is nothing to show. */
int overlay_toast_snapshot(OverlayToast* out);
void overlay_toast_clear(void);
void overlay_counters(OverlayStats* out);
void overlay_count_present(void);
void overlay_count_drawn(void);

/* --------------------------------------------------------------------- pipe */
void overlay_pipe_start(void);
void overlay_pipe_stop(void);

/* --------------------------------------------------------------------- hook */
/**
 * Installs the present hook. Safe to call once, from a worker thread — never from `DllMain`,
 * because it loads a graphics library and that is forbidden under the loader lock.
 *
 * Returns 1 when a present call is now being counted, 0 when nothing could be patched (which is
 * a legitimate outcome: an install whose chain differs from the one measured, or a Windows
 * without the library).
 */
int overlay_hook_install(void);

/**
 * The same hook, attempted from `DllMain` with no thread and no library load.
 *
 * Exists because the thread's ~86 ms of startup loses a race against a game's renderer on some launches.
 * Safe only because it loads nothing: see `hook.cpp`.
 */
int overlay_hook_install_early(void);

/** Which APIs are actually patched: `d3d9`, or `none`. Reported in `HELLO`, and logged. */
const char* overlay_hook_api(void);

#endif /* RE_OVERLAY_H */
