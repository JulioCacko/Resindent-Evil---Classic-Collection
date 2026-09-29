/*
 * testhost.cpp — a 32-bit process that loads the overlay plugin and lets the launcher talk to it.
 *
 * This exists so the plugin can be tested WITHOUT a game. Everything the plugin does that is not
 * drawing — loading, starting its pipe, the handshake, accepting a toast, reporting counters —
 * is reachable from here, deterministically, in about a second. Without it, every iteration of
 * the protocol would cost a game launch, a loader dialog and a taskkill, and a test that is that
 * expensive stops being run.
 *
 * Phase 2 grows it: a D3D9 device and a D3D11 swapchain, so the present hook and the drawing can
 * be verified hermetically as well. For now it does only what Phase 1 needs — a window (so the
 * plugin's `HELLO` has a real client size to report) and time for a client to connect.
 *
 * Usage:
 *   overlay-testhost --plugin <path-to.asi> [--seconds N] [--window]
 *
 * It prints one `testhost ...` line per step and exits 0.
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "device.h"

static LRESULT CALLBACK host_window_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam)
{
  if (message == WM_CLOSE || message == WM_DESTROY)
  {
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

/* Milliseconds to wait before presenting anything. The overlay starts a toast's clock on the first frame it can draw, so this is how  SHOW that arrives long before the game can present is tested hermetically: the plugin only draws on Present, so a toast queued during the delay is still waiting when frames begin. */
static int g_delayMs = 0;

int main(int argc, char** argv)
{
  const char* plugin = NULL;
  int seconds = 5;
  int withWindow = 0;
  int d3d9 = 0;
  int dxgi = 0;
  int frames = 30;

  for (int index = 1; index < argc; index++)
  {
    if (strcmp(argv[index], "--plugin") == 0 && index + 1 < argc) plugin = argv[++index];
    else if (strcmp(argv[index], "--seconds") == 0 && index + 1 < argc) seconds = atoi(argv[++index]);
    else if (strcmp(argv[index], "--delay") == 0 && index + 1 < argc) g_delayMs = atoi(argv[++index]);
    else if (strcmp(argv[index], "--frames") == 0 && index + 1 < argc) frames = atoi(argv[++index]);
    else if (strcmp(argv[index], "--window") == 0) withWindow = 1;
    else if (strcmp(argv[index], "--d3d9") == 0) d3d9 = 1;
    else if (strcmp(argv[index], "--dxgi") == 0) dxgi = 1;
    else
    {
      fprintf(stderr, "unrecognised argument: %s\n", argv[index]);
      return 2;
    }
  }

  if (plugin == NULL)
  {
    fprintf(stderr,
            "usage: overlay-testhost --plugin <path-to.asi> [--seconds N] [--window]\n"
            "                          [--d3d9] [--dxgi] [--frames N]\n");
    return 2;
  }

  /* A device needs a window, so asking for one implies asking for the other. */
  if (d3d9 || dxgi) withWindow = 1;

  printf("testhost pid=%lu\n", (unsigned long)GetCurrentProcessId());
  fflush(stdout);

  HWND window = NULL;
  if (withWindow)
  {
    /* The class name and size are arbitrary; what matters is that it is a window of this
       process that is big enough for the plugin's window search to find, so `HELLO` reports a
       real client size instead of 0x0. */
    WNDCLASSW description;
    ZeroMemory(&description, sizeof(description));
    description.lpfnWndProc = host_window_proc;
    description.hInstance = GetModuleHandleW(NULL);
    description.lpszClassName = L"ReOverlayTestHost";
    RegisterClassW(&description);

    window = CreateWindowExW(0, L"ReOverlayTestHost", L"re-overlay test host",
                             WS_OVERLAPPEDWINDOW, 80, 80, 646, 509,
                             NULL, NULL, GetModuleHandleW(NULL), NULL);
    if (window != NULL)
    {
      ShowWindow(window, SW_SHOW);
      /*
       * A process started with `STARTUPINFO.wShowWindow` set - which is what `windowsHide: true`
       * in Node's `spawn` does - has its FIRST `ShowWindow` call overridden by that value. The
       * window then exists, is top-level and is never visible, so anything that enumerates
       * *visible* windows finds nothing: the plugin reports 0x0, and in Phase 2 a swapchain would
       * be created for a window nobody can see.
       *
       * `SetWindowPos` is not subject to that rule, so the visibility is forced and then
       * verified rather than assumed.
       */
      if (!IsWindowVisible(window))
      {
        SetWindowPos(window, NULL, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
      }
      UpdateWindow(window);

      RECT client;
      GetClientRect(window, &client);
      printf("testhost window=%ldx%ld visible=%d\n",
             client.right - client.left, client.bottom - client.top,
             IsWindowVisible(window) ? 1 : 0);
      fflush(stdout);
    }
    else
    {
      printf("testhost window=none (error %lu)\n", (unsigned long)GetLastError());
      fflush(stdout);
    }
  }

  HMODULE loaded = LoadLibraryA(plugin);
  if (loaded == NULL)
  {
    printf("testhost plugin=FAILED error=%lu\n", (unsigned long)GetLastError());
    fflush(stdout);
    if (window != NULL) DestroyWindow(window);
    return 1;
  }

  printf("testhost plugin=loaded base=0x%08lX\n", (unsigned long)(ULONG_PTR)loaded);
  fflush(stdout);

  /*
   * The plugin installs its present hooks from its own thread just after load, so the host waits
   * a moment before creating a device.
   *
   * The ordering is the point: a device created before the hook is a device whose vtable was
   * read before it was patched, which is precisely the question this host settles. The sleep is
   * not the evidence — the plugin's `STAT` counters are, and they only move if a real present
   * call arrived through the patched vtable.
   *
   * Nothing graphics-related can happen in `DllMain` itself: creating a device loads more DLLs,
   * which is forbidden under the loader lock.
   */
  Sleep(500);

  /*
   * The delay pauses the FRAMES, and it belongs here rather than in the message loop below.
   *
   * It was in the loop first, which made it look wired and do nothing: the presents happen in the two calls
   * directly below this, so by the time the loop's sleep ran, all `--frames` had already been presented -
   * `STAT` reported `presents = 60` within two seconds against a six-second delay. The overlay starts a
   * toast's clock on the first frame it can draw, so this delay is what makes "a `SHOW` that arrives long
   * before the game can present" testable without a game: the plugin only draws on Present, so a toast queued
   * while this sleeps is still waiting when the frames begin.
   */
  if (g_delayMs > 0) Sleep((DWORD)g_delayMs);

  if (d3d9) host_d3d9_present(window, frames);
  if (dxgi) host_dxgi_present(window, frames);
  fflush(stdout);

  printf("testhost waiting=%ds\n", seconds);
  fflush(stdout);

  /* A message loop rather than `Sleep`, so the window is a real, responsive window: a window
     that never pumps is not a window the plugin's search should be expected to trust. */
  DWORD deadline = GetTickCount() + (DWORD)seconds * 1000;

  while (GetTickCount() < deadline)
  {
    MSG message;
    while (PeekMessageW(&message, NULL, 0, 0, PM_REMOVE))
    {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    Sleep(50);
  }

  /*
   * Unloaded explicitly, so the plugin's detach path runs here rather than only at process exit.
   * That is the path a game takes when the plugin is replaced mid-session, and it is the one
   * most likely to deadlock if the pipe thread were not interruptible.
   */
  FreeLibrary(loaded);
  printf("testhost unloaded=ok\n");

  if (window != NULL) DestroyWindow(window);
  printf("testhost done\n");
  fflush(stdout);
  return 0;
}
