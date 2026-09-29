/*
 * dllmain.cpp — the loader entry point.
 *
 * As short as it can be, on purpose. This runs under the loader lock, where touching anything
 * that loads a DLL, allocates through another heap or waits on another thread can deadlock the
 * game before it has drawn a frame. So it does exactly three things: stop the loader bothering
 * us again, create the one lock the rest of the plugin uses, and start the pipe thread.
 *
 * Detach only *signals* the pipe thread. Waiting for it here would be the classic shutdown
 * deadlock, and the process is ending anyway — the thread's sole remaining job is to see the
 * event and leave, which the interruptible overlapped I/O in `pipe.cpp` is built to allow.
 */

#include "overlay.h"

extern "C" BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved)
{
  (void)reserved;

  if (reason == DLL_PROCESS_ATTACH)
  {
    DisableThreadLibraryCalls(instance);
    overlay_lock_init();

    /*
     * The hook goes in FIRST, before the thread this plugin also needs.
     *
     * The thread costs about 86 ms of startup, and that is long enough for a game's renderer to create
     * its Direct3D device and leave us with a table nobody calls again - measured, twice, on RE3. This
     * call loads nothing (it is `GetModuleHandle`-only), so it is safe under the loader lock that
     * `DllMain` is holding; the GDI+ work that is NOT safe here still happens on the thread.
     */
    overlay_hook_install_early();

    overlay_pipe_start();
    overlay_log("plugin attached (base 0x%08lX, pid %lu)",
                (unsigned long)(ULONG_PTR)instance, (unsigned long)GetCurrentProcessId());
    return TRUE;
  }

  if (reason == DLL_PROCESS_DETACH)
  {
    overlay_pipe_stop();
    return TRUE;
  }

  return TRUE;
}
