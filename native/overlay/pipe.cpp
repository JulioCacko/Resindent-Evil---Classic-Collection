/*
 * pipe.cpp — the launcher's way in.
 *
 * A named pipe the plugin OWNS and the launcher connects to: `\\.\pipe\re-classic-overlay-<pid>`.
 * That direction is deliberate. The alternative — the launcher owns something and the plugin
 * connects out — would need the plugin to find the launcher, and the pid in the name means a
 * plugin can only ever serve the launcher that started it, with no discovery, no broadcast and
 * no way for one game's toast to arrive in another's window.
 *
 * The pid is also why this is not shared memory: Electron's main process is Node, which cannot
 * create a Windows file mapping without a native module, and this project ships none. A named
 * pipe is reachable from Node with `net.connect({ path })` and nothing else.
 *
 * Protocol, one UTF-8 line per message, tab-separated, `\n` terminated:
 *
 *   launcher -> plugin   SHOW <seq> <id> <name> <desc>     show one toast
 *                        RESET                            take it down now
 *                        PING                             liveness
 *                        STAT                             counters
 *   plugin -> launcher   HELLO <protocol> <version> <api> <w>x<h>   sent first, on connect
 *                        ACK <seq>                        accepted into the slot
 *                        OK RESET / PONG
 *                        STAT <presents> <framesDrawn> <lastSeq>
 *                        ERR <reason>
 *
 * `ACK` is what makes a test able to assert that the toast was *taken*, rather than assert that
 * a line was written into a socket and hope. `STAT` is what makes it able to tell "drawing" from
 * "loaded and doing nothing" — the two failures look identical on screen.
 *
 * Overlapped I/O throughout, because the pipe thread has to be interruptible: the plugin is
 * unloaded from `DllMain`, and a blocking `ConnectNamedPipe` would leave a thread stuck inside a
 * DLL that is being unmapped. A synchronous pipe would also be a thread the game's exit has to
 * wait for.
 */

#include "overlay.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/** One command line, and one reply. A `SHOW` carrying 448 bytes of text fits with room to spare. */
#define PIPE_BUFFER 4096

static HANDLE g_stopEvent = NULL;
static HANDLE g_thread = NULL;
static volatile LONG g_running = 0;

/* ------------------------------------------------------------------- helpers */

/** `\\.\pipe\re-classic-overlay-<pid>` - the exact name `src/main/overlay-link.ts` builds. */
static void pipe_name(char* out, size_t size)
{
  _snprintf_s(out, size, _TRUNCATE, "\\\\.\\pipe\\re-classic-overlay-%lu",
              (unsigned long)GetCurrentProcessId());
}

/*
 * The size reported in `HELLO`, taken from the game's largest visible window.
 *
 * It is the *client* size, not the window size, because that is what the toast is placed
 * against. Phase 2 replaces this with the swapchain's back-buffer size, which is the thing the
 * overlay actually draws into and is not always the same as the window - dgVoodoo's scaling can
 * make them differ - so this is the honest answer available before the hook exists.
 */
static void game_window_size(int* width, int* height)
{
  *width = 0;
  *height = 0;

  struct Find
  {
    HWND best;
    DWORD area;
    int width;
    int height;
  } find = {NULL, 0, 0, 0};

  /* No lambda: this file is compiled as C++ but the enumeration is a plain callback. */
  struct Local
  {
    static BOOL CALLBACK Enum(HWND hwnd, LPARAM param)
    {
      Find* target = (Find*)param;
      DWORD owner = 0;
      GetWindowThreadProcessId(hwnd, &owner);
      if (owner != GetCurrentProcessId() || !IsWindowVisible(hwnd)) return TRUE;

      RECT rect;
      if (!GetWindowRect(hwnd, &rect)) return TRUE;
      int width = rect.right - rect.left;
      int height = rect.bottom - rect.top;
      if (width < 200 || height < 200) return TRUE;

      DWORD area = (DWORD)width * (DWORD)height;
      if (area <= target->area) return TRUE;

      RECT client;
      GetClientRect(hwnd, &client);
      target->best = hwnd;
      target->area = area;
      target->width = client.right - client.left;
      target->height = client.bottom - client.top;
      return TRUE;
    }
  };

  EnumWindows(&Local::Enum, (LPARAM)&find);
  *width = find.width;
  *height = find.height;
}

/**
 * UTF-8 to UTF-16 for the slot, with control characters flattened to spaces.
 *
 * The launcher is trusted, but the framing is not: a tab or newline inside an achievement name
 * would split or merge protocol lines, so anything below 0x20 (and DEL) becomes a space rather
 * than being refused - a name with a stray character in it should still show.
 */
static void to_wide_field(const char* text, wchar_t* out, size_t capacity)
{
  if (capacity == 0) return;
  out[0] = L'\0';
  if (text == NULL || text[0] == '\0') return;

  wchar_t buffer[OVERLAY_DESC_MAX * 2];
  int written = MultiByteToWideChar(CP_UTF8, 0, text, -1, buffer, (int)(sizeof(buffer) / sizeof(buffer[0])));
  if (written <= 0) return;

  size_t index = 0;
  for (int source = 0; source < written && index + 1 < capacity; source++)
  {
    wchar_t value = buffer[source];
    if (value == L'\0') break;
    if (value < 0x20 || value == 0x7F) value = L' ';
    out[index++] = value;
  }
  out[index] = L'\0';
}

static int write_all(HANDLE pipe, const char* text)
{
  size_t length = strlen(text);
  size_t offset = 0;
  while (offset < length)
  {
    DWORD written = 0;
    if (!WriteFile(pipe, text + offset, (DWORD)(length - offset), &written, NULL) || written == 0) return 0;
    offset += written;
  }
  return 1;
}

/** Splits a line on tabs in place. Returns the field count, or -1 when there are too many. */
static int split_tabs(char* line, char** fields, int capacity)
{
  int count = 0;
  char* cursor = line;
  fields[count++] = cursor;

  while (*cursor != '\0')
  {
    if (*cursor == '\t')
    {
      if (count >= capacity) return -1;
      *cursor = '\0';
      fields[count++] = cursor + 1;
    }
    cursor++;
  }
  return count;
}

/* ------------------------------------------------------------------ dispatch */

static void handle_line(HANDLE pipe, char* line)
{
  char* fields[8];
  int count = split_tabs(line, fields, 8);
  if (count <= 0 || fields[0][0] == '\0') return;

  const char* command = fields[0];

  if (_stricmp(command, "SHOW") == 0)
  {
    if (count < 5)
    {
      write_all(pipe, "ERR show-needs-5-fields\n");
      return;
    }

    unsigned long seq = strtoul(fields[1], NULL, 10);
    OverlayToast toast;
    ZeroMemory(&toast, sizeof(toast));
    toast.seq = seq;
    /*
     * KNOWN DEFECT, recorded here because this line is where it lives.
     *
     * The clock starts when the toast ARRIVES, and the draw path discards a toast once `TOAST_TOTAL_MS` (the
     * design's 300 + 3200 + 300 = 3800 ms) has passed - whether or not a frame ever arrived to draw it. The
     * launcher's own OBSERVED unlock is sent at SPAWN, because what it celebrates is the player's choice to
     * launch that row, and RE3 then spends about 1.8 minutes initialising Classic REbirth and playing its
     * intro before it presents anything. So that toast is discarded unseen, every time: the observed producer
     * is silent in the only path a player takes, while `tools/probe-overlay.ps1` never sees it because the
     * probe waits for the game's window before sending its own `SHOW` (`gold=1815`, six launches).
     *
     * The fix is to stamp this on the first frame that can draw the toast instead of here - one line in the
     * draw path: `if (toast.startedAtMs == 0) toast.startedAtMs = GetTickCount64();`. It was written and
     * reverted in the same round because it turned `overlay-link.test.ts`'s "draws the toast, and the composed
     * card holds the design's colours" red, and that failure was not diagnosed: it is either a timing
     * assumption in that test (it waits a fixed period after sending, and the clock now starts a frame later)
     * or a real problem with the change. Deciding that comes before shipping it; the behaviour here is
     * unchanged until then.
     */
    /* Left unstarted on purpose: `overlay_toast_snapshot` stamps the clock on the first frame that can draw
       this toast. Stamping it here means a `SHOW` that arrives before the game presents anything - which is
       every observed unlock the launcher raises, sent at spawn - expires unseen, because the draw path drops a
       toast once `TOAST_TOTAL_MS` has passed. */
    toast.startedAtMs = 0;
    to_wide_field(fields[2], toast.id, OVERLAY_ID_MAX);
    to_wide_field(fields[3], toast.name, OVERLAY_NAME_MAX);
    to_wide_field(fields[4], toast.desc, OVERLAY_DESC_MAX);

    overlay_toast_set(&toast);

    char reply[64];
    _snprintf_s(reply, sizeof(reply), _TRUNCATE, "ACK\t%lu\n", seq);
    write_all(pipe, reply);
    return;
  }

  if (_stricmp(command, "RESET") == 0)
  {
    overlay_toast_clear();
    write_all(pipe, "OK\tRESET\n");
    return;
  }

  if (_stricmp(command, "PING") == 0)
  {
    write_all(pipe, "PONG\n");
    return;
  }

  if (_stricmp(command, "STAT") == 0)
  {
    OverlayStats stats;
    overlay_counters(&stats);
    char reply[128];
    _snprintf_s(reply, sizeof(reply), _TRUNCATE, "STAT\t%llu\t%llu\t%lu\n",
                stats.presents, stats.framesDrawn, stats.lastSeq);
    write_all(pipe, reply);
    return;
  }

  write_all(pipe, "ERR\tunknown-command\n");
}

/* --------------------------------------------------------------- connection */

static HANDLE make_event(void)
{
  return CreateEventW(NULL, TRUE, FALSE, NULL);
}

/** Waits for a client, or for the stop event. */
static int wait_for_client(HANDLE pipe)
{
  OVERLAPPED overlap;
  ZeroMemory(&overlap, sizeof(overlap));
  HANDLE connected = make_event();
  if (connected == NULL) return 0;
  overlap.hEvent = connected;

  int result = 0;
  if (ConnectNamedPipe(pipe, &overlap))
  {
    result = 1;
  }
  else
  {
    DWORD error = GetLastError();
    if (error == ERROR_PIPE_CONNECTED)
    {
      /* Already connected between `CreateNamedPipe` and here - normal, not an error. */
      result = 1;
    }
    else if (error == ERROR_IO_PENDING)
    {
      HANDLE waits[2] = {connected, g_stopEvent};
      if (WaitForMultipleObjects(2, waits, FALSE, INFINITE) == WAIT_OBJECT_0) result = 1;
      else CancelIo(pipe);
    }
  }

  CloseHandle(connected);
  return result;
}

/** 1 = a chunk arrived, 0 = the client is gone, -1 = stopping. */
static int read_chunk(HANDLE pipe, char* buffer, DWORD capacity, DWORD* received)
{
  OVERLAPPED overlap;
  ZeroMemory(&overlap, sizeof(overlap));
  HANDLE ready = make_event();
  if (ready == NULL) return -1;
  overlap.hEvent = ready;

  *received = 0;
  int result = -1;

  if (ReadFile(pipe, buffer, capacity, received, &overlap))
  {
    result = 1;
  }
  else
  {
    DWORD error = GetLastError();
    if (error == ERROR_BROKEN_PIPE || error == ERROR_PIPE_NOT_CONNECTED)
    {
      result = 0;
    }
    else if (error == ERROR_IO_PENDING)
    {
      HANDLE waits[2] = {ready, g_stopEvent};
      if (WaitForMultipleObjects(2, waits, FALSE, INFINITE) == WAIT_OBJECT_0)
      {
        if (GetOverlappedResult(pipe, &overlap, received, FALSE)) result = 1;
        else result = 0;
      }
      else
      {
        CancelIo(pipe);
        result = -1;
      }
    }
  }

  CloseHandle(ready);
  return result;
}

/**
 * Serves one client until it goes away.
 *
 * The `HELLO` goes out first and unconditionally: the launcher's whole notion of "the overlay is
 * available" is that handshake arriving, so it must not depend on the launcher asking anything.
 */
static void serve(HANDLE pipe)
{
  int width = 0;
  int height = 0;
  game_window_size(&width, &height);

  char hello[160];
  _snprintf_s(hello, sizeof(hello), _TRUNCATE, "HELLO\t%d\t%ls\t%s\t%dx%d\n",
              OVERLAY_PROTOCOL_VERSION, OVERLAY_VERSION,
              /*
               * Which API the overlay actually hooked - "d3d9", or "none" when nothing could be
               * patched. Reported rather than hidden because this string is the measurement: the
               * launcher logs it and the live spec reads it, so "loaded but hooking nothing" is a
               * state that can be seen instead of guessed at from a toast that never appears.
               */
              overlay_hook_api(), width, height);
  if (!write_all(pipe, hello)) return;

  overlay_log("launcher connected; HELLO sent (api=%s, client %dx%d)", overlay_hook_api(), width, height);

  char buffer[PIPE_BUFFER];
  char line[PIPE_BUFFER];
  size_t pending = 0;
  line[0] = '\0';

  for (;;)
  {
    DWORD received = 0;
    int outcome = read_chunk(pipe, buffer, (DWORD)sizeof(buffer), &received);
    if (outcome <= 0) break;

    for (DWORD index = 0; index < received; index++)
    {
      char value = buffer[index];
      if (value == '\n')
      {
        line[pending] = '\0';
        if (pending > 0)
        {
          /* A trailing CR is tolerated: a caller that writes CRLF is not malformed. */
          if (line[pending - 1] == '\r') line[pending - 1] = '\0';
          handle_line(pipe, line);
        }
        pending = 0;
        continue;
      }

      if (pending + 1 >= sizeof(line))
      {
        /* An over-long line is dropped whole rather than truncated into a valid-looking one. */
        pending = 0;
        write_all(pipe, "ERR\tline-too-long\n");
        continue;
      }
      line[pending++] = value;
    }
  }

  overlay_log("launcher disconnected");
}

static DWORD WINAPI pipe_thread(LPVOID param)
{
  (void)param;

  /*
   * The hook is installed here, first thing on this thread, and that placement matters twice
   * over. It cannot be done in `DllMain`: installing it loads `d3d9.dll`, and loading a library
   * under the loader lock is forbidden. It must also happen *before the game creates its device*,
   * which is why it is not deferred to the first client connection — `DllMain` runs long before
   * the game's `WinMain`, so this thread has the patch in place first.
   */
  overlay_hook_install();

  char name[128];
  pipe_name(name, sizeof(name));
  overlay_log("pipe thread up: %s", name);

  while (InterlockedCompareExchange(&g_running, 1, 1) != 0)
  {
    HANDLE pipe = CreateNamedPipeA(
        name,
        PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
        /* One instance: exactly one launcher can be talking to this plugin. A second connect
           gets ERROR_PIPE_BUSY, which the launcher treats as "already linked". */
        1,
        PIPE_BUFFER, PIPE_BUFFER,
        0, NULL);

    if (pipe == INVALID_HANDLE_VALUE)
    {
      overlay_log("could not create the pipe (error %lu)", (unsigned long)GetLastError());
      Sleep(500);
      continue;
    }

    if (wait_for_client(pipe))
    {
      serve(pipe);
      DisconnectNamedPipe(pipe);
    }

    CloseHandle(pipe);
  }

  overlay_log("pipe thread down");
  return 0;
}

void overlay_pipe_start(void)
{
  if (g_stopEvent == NULL)
  {
    g_stopEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (g_stopEvent == NULL) return;
  }

  ResetEvent(g_stopEvent);
  InterlockedExchange(&g_running, 1);

  g_thread = CreateThread(NULL, 0, pipe_thread, NULL, 0, NULL);
  if (g_thread != NULL) CloseHandle(g_thread);
}

/**
 * Signals the pipe thread and returns immediately.
 *
 * Deliberately no wait: this is called from `DllMain` on detach, where waiting on another thread
 * can deadlock against the loader lock — and the process is going away anyway, so the thread's
 * only remaining job is to notice the event and exit. Interruptible overlapped I/O above is what
 * makes a signal sufficient.
 */
void overlay_pipe_stop(void)
{
  InterlockedExchange(&g_running, 0);
  if (g_stopEvent != NULL) SetEvent(g_stopEvent);
}
