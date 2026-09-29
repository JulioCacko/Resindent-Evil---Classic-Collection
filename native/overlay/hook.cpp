/*
 * hook.cpp — reaching the game's present call without an injector library.
 *
 * Everything here was decided by measurement (docs/ARCHITECTURE.md §12.2 and §12.5), and the
 * measurement is what makes it small. Two facts about how these APIs are implemented:
 *
 *   IDirect3D9        vtable 0x648E2C88, inside d3d9.dll, PAGE_EXECUTE_READ   -> SHARED
 *   IDirect3DDevice9  vtable in the heap, PAGE_READWRITE, different per device -> per-instance
 *   IDXGISwapChain    vtable 0x69FC20EC, inside dxgi.dll, PAGE_EXECUTE_READ   -> SHARED
 *
 * A shared, static vtable in a module's read-only data is the whole opportunity: replacing ONE
 * pointer in it redirects every call of that method for every object of that class, the game's
 * included. That is a *data* patch. It needs no trampoline, no length disassembler, no MinHook —
 * which matters, because the alternative for "inject a DLL and hook Present" is normally a
 * function-hooking library, and a disassembler running inside a 1998 game is exactly the
 * fragility that the SetParent measurement warned about.
 *
 * The per-instance device vtable would normally be the hard case — you cannot patch a class
 * table that does not exist. It turns out not to be a problem at all: the one entry worth
 * patching one level up (`IDirect3D9::CreateDevice`) is on the SHARED table, and our replacement
 * receives the new `IDirect3DDevice9**` as its own argument. The device we could not find is
 * handed to us by the game.
 *
 * So the chain is three patches and no code is ever rewritten:
 *
 *     IDirect3D9::CreateDevice  (shared table, entry 16)  -> ours
 *         -> patches the returned device's Present (its own table, entry 17)
 *             -> counts the call, then chains to the original
 *
 * Both indices are COM ABI, frozen since the interfaces shipped — and they are not taken on
 * faith either: the hermetic host presents real frames through a real device, and the test fails
 * if the counter does not move.
 *
 * Discovery never intercepts anything. The plugin calls `Direct3DCreate9` itself, through
 * `GetProcAddress`, purely to obtain an object of the class whose vtable address it needs to
 * learn — then releases it. Nothing about the game's own path is touched to find it.
 */

#include "overlay.h"
#include "draw9.h"
#include "toast-render.h"

#include <stdio.h>
#include <string.h>
#include <wchar.h>

/*
 * The toast's timing and geometry, from `overlays/AchievementToast.tsx`: 300 ms in, 3200 ms held,
 * 300 ms out, entering and leaving over 32 author-space pixels, anchored 20 px from the right and
 * 30 px from the top of a 1920-wide canvas. The authored insets are scaled with the card, so the
 * in-game toast sits in the same corner at the same proportion.
 */
#define TOAST_FADE_IN_MS 300
#define TOAST_HOLD_MS 3200
#define TOAST_FADE_OUT_MS 300
#define TOAST_TOTAL_MS (TOAST_FADE_IN_MS + TOAST_HOLD_MS + TOAST_FADE_OUT_MS)
#define TOAST_SLIDE_AUTHORED 32.0f
#define TOAST_INSET_RIGHT_AUTHORED 20.0f
#define TOAST_INSET_TOP_AUTHORED 30.0f
#define TOAST_AUTHORED_VIEW_WIDTH 1920.0f

/*
 * `D3D_SDK_VERSION` is 32 for the Direct3D 9 runtime these games use.
 *
 * Stated here rather than included from `d3d9.h` on purpose: the plugin imports no graphics
 * library, so a game whose chain is DXGI-only never has d3d9 forced into its process. Everything
 * this file calls is reached through `GetProcAddress` and the saved vtable pointers.
 */
#define RE_D3D_SDK_VERSION 32

/* The COM ABI's positions for the two methods this needs. */
#define VTABLE_INDEX_CREATE_DEVICE 16
#define VTABLE_INDEX_PRESENT_9 17

/*
 * The calling convention is `__stdcall`, NOT `__thiscall`, and that is not a detail to get wrong:
 * COM methods are declared `STDMETHODCALLTYPE`, which is `__stdcall` on x86 because COM has to be
 * callable from any language — the interface pointer is simply the first stack argument.
 * `__thiscall` is the MSVC C++ convention for non-COM classes, and using its register-passed
 * `this` here would misalign every argument and corrupt the stack inside the game.
 */
typedef void* (WINAPI* Direct3DCreate9Fn)(unsigned int sdkVersion);
typedef void(WINAPI* ReleaseFn)(void* self);

typedef long(WINAPI* CreateDeviceFn)(void* self, unsigned int adapter, unsigned int deviceType,
                                     HWND focusWindow, unsigned long behaviourFlags,
                                     void* presentationParameters, void** returnedDevice);
typedef long(WINAPI* Present9Fn)(void* self, const void* sourceRect, const void* destRect,
                                 HWND destWindowOverride, const void* dirtyRegion);

static CreateDeviceFn g_realCreateDevice = NULL;
static Present9Fn g_realPresent9 = NULL;
static char g_api[32] = "none";

/* ------------------------------------------------------------------- helpers */

/** True for an address inside a mapped image's executable range. */
static int is_executable(void* address)
{
  MEMORY_BASIC_INFORMATION info;
  ZeroMemory(&info, sizeof(info));
  if (address == NULL) return 0;
  if (VirtualQuery(address, &info, sizeof(info)) == 0) return 0;
  if (info.State != MEM_COMMIT) return 0;
  if (info.Type != MEM_IMAGE) return 0;
  return (info.Protect & (PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY)) != 0;
}

/**
 * Replaces one vtable entry, after checking that what is being replaced looks like a function.
 *
 * The check is the fail-safe: if the entry is null, or points outside any loaded module's code,
 * then this is not the vtable the design expects and the patch is refused. A refused patch costs
 * the overlay and nothing else; a patch applied to the wrong table costs the game.
 */
static int patch_entry(void** vtable, int index, void* replacement, void** previous, const char* what)
{
  if (vtable == NULL) return 0;

  void* current = vtable[index];
  if (current == replacement)
  {
    /* Already ours - a second device on an already-patched table, which is normal. */
    return 1;
  }
  if (!is_executable(current))
  {
    overlay_log("refused to patch %s: entry %d is 0x%p, which is not a function in any module",
                what, index, current);
    return 0;
  }

  DWORD previousProtection = 0;
  if (!VirtualProtect(&vtable[index], sizeof(void*), PAGE_READWRITE, &previousProtection))
  {
    overlay_log("could not unprotect %s (error %lu)", what, (unsigned long)GetLastError());
    return 0;
  }

  /*
   * The original is saved BEFORE the write, so the chain is always intact: whatever was there -
   * the API's own implementation, or another overlay's hook that got in first - still gets called.
   * Two overlays chaining through each other is the ordinary case here, not an edge case.
   */
  if (previous != NULL) *previous = current;
  vtable[index] = replacement;

  DWORD ignored = 0;
  VirtualProtect(&vtable[index], sizeof(void*), previousProtection, &ignored);

  overlay_log("patched %s (entry %d, 0x%p -> 0x%p)", what, index, current, replacement);
  return 1;
}

/** Releases a COM object through its own vtable, since the plugin imports no interface headers. */
static void com_release(void* object)
{
  if (object == NULL) return;
  void** vtable = *(void***)object;
  if (vtable == NULL) return;
  ReleaseFn release = (ReleaseFn)vtable[2];
  if (release != NULL) release(object);
}

/* ------------------------------------------------------------ the composed card */

/** The composed toast, cached by sequence: composition is a GDI+ pass, not a per-frame one. */
static OverlayBitmap g_card;
static unsigned long g_cardSeq = 0;
/** The last toast whose frame was read back, so the verification costs one frame per unlock. */
static unsigned long g_verifiedSeq = 0;
static int g_viewWidth = 0;
static int g_viewHeight = 0;
static int g_capture = -1;

/**
 * `RE_OVERLAY_CAPTURE=1` writes each composed card to `%TEMP%\re-classic-overlay\` as raw BGRA.
 *
 * Off by default, like the log: a shipping plugin writes nothing. It exists because "the toast was
 * drawn" deserves to be *looked at* — by a human, and by a test that measures the pixels with its
 * own code rather than trusting the plugin's counters.
 */
static int capture_enabled(void)
{
  if (g_capture < 0)
  {
    char value[8];
    DWORD got = GetEnvironmentVariableA("RE_OVERLAY_CAPTURE", value, (DWORD)sizeof(value));
    g_capture = (got > 0 && value[0] != '0') ? 1 : 0;
  }
  return g_capture;
}

static void capture_directory(wchar_t* out, size_t capacity)
{
  wchar_t temp[MAX_PATH];
  DWORD got = GetTempPathW((DWORD)(sizeof(temp) / sizeof(temp[0])), temp);
  if (got == 0 || got > MAX_PATH) return;
  _snwprintf_s(out, capacity, _TRUNCATE, L"%sre-classic-overlay", temp);
  CreateDirectoryW(out, NULL);
}

/**
 * Composes and draws the active toast, from inside the game's present call.
 *
 * The composition happens here, on the render thread, but only once per unlock — the card is cached
 * by sequence, and the per-frame work is one texture upload and one quad. GDI+ itself is
 * initialised earlier, on the pipe thread, so nothing in this path initialises a subsystem inside a
 * game's frame.
 */
static void draw_toast9(void* device)
{
  OverlayToast toast;
  if (!overlay_toast_snapshot(&toast) || !toast.active) return;

  const unsigned long long elapsed = GetTickCount64() - toast.startedAtMs;
  if (elapsed >= TOAST_TOTAL_MS)
  {
    /* The display is over. The slot is cleared so a finished toast is not drawn forever, and the
       cache is dropped because the next unlock will compose its own card. */
    overlay_toast_clear();
    if (g_card.pixels != NULL) overlay_bitmap_free(&g_card);
    g_cardSeq = 0;
    return;
  }

  if (g_viewWidth <= 0 && !overlay_draw9_viewport(device, &g_viewWidth, &g_viewHeight)) return;

  if (g_card.pixels == NULL || g_cardSeq != toast.seq)
  {
    if (g_card.pixels != NULL) overlay_bitmap_free(&g_card);
    OverlayCompose compose;
    compose.viewWidth = g_viewWidth;

    const DWORD started = GetTickCount();
    if (!overlay_toast_compose(&toast, &compose, &g_card))
    {
      overlay_log("could not compose the toast for seq=%lu", toast.seq);
      return;
    }
    /* Timed and logged, because this runs inside a frame: if it ever costs enough to be seen, that
       is the measurement that says the composition has to move to the pipe thread. */
    overlay_log("composed %dx%d for seq=%lu in %lu ms (view %dx%d)",
                g_card.width, g_card.height, toast.seq,
                (unsigned long)(GetTickCount() - started), g_viewWidth, g_viewHeight);

    g_cardSeq = toast.seq;
    if (capture_enabled())
    {
      wchar_t directory[MAX_PATH];
      directory[0] = L'\0';
      capture_directory(directory, MAX_PATH);
      if (directory[0] != L'\0') overlay_bitmap_capture(&g_card, directory, toast.seq);
    }
  }

  /* The design's one animation: fade in, hold, fade out, entering and leaving over 32 px. */
  const float scale = (float)g_viewWidth / TOAST_AUTHORED_VIEW_WIDTH;
  float alpha;
  float slide;
  if (elapsed < TOAST_FADE_IN_MS)
  {
    const float progress = (float)elapsed / (float)TOAST_FADE_IN_MS;
    alpha = progress;
    slide = (1.0f - progress) * TOAST_SLIDE_AUTHORED * scale;
  }
  else if (elapsed < TOAST_FADE_IN_MS + TOAST_HOLD_MS)
  {
    alpha = 1.0f;
    slide = 0.0f;
  }
  else
  {
    const float progress = (float)(elapsed - TOAST_FADE_IN_MS - TOAST_HOLD_MS) / (float)TOAST_FADE_OUT_MS;
    alpha = 1.0f - progress;
    slide = progress * TOAST_SLIDE_AUTHORED * scale;
  }

  const int x = g_viewWidth - g_card.width -
                (int)(TOAST_INSET_RIGHT_AUTHORED * scale + 0.5f) + (int)slide;
  const int y = (int)(TOAST_INSET_TOP_AUTHORED * scale + 0.5f);

  if (overlay_draw9(device, &g_card, x, y, alpha))
  {
    overlay_count_drawn();

    /*
     * Once per toast, and only when asked: read the frame back and count the gold. This is the overlay's
     * proof that it drew where it meant to, taken from the buffer the game is about to present rather
     * than from the screen - which automation cannot measure, because Windows will not let a background
     * process bring a game to the foreground.
     */
    /*
     * Verified during the HOLD, not on the first frame, and that distinction is the whole measurement:
     * the design fades in from alpha 0, so the first drawn frame is a fully transparent card. Reading it
     * back there reports `gold=0` about a toast that is drawing perfectly - which is exactly what the
     * first version of this did.
     */
    if (capture_enabled() && g_verifiedSeq != toast.seq && elapsed > TOAST_FADE_IN_MS)
    {
      g_verifiedSeq = toast.seq;
      overlay_draw9_verify(device, &g_card, x, y);
    }
  }
}

/* -------------------------------------------------------------------- hooks */

static int patch_device_present(void* device);

/**
 * Our `IDirect3DDevice9::Present`.
 *
 * The count is incremented *before* the chain, so a frame that the API then refuses is still
 * counted as an arrival: `presents` answers "did our hook get called", which is what the launcher
 * and the tests ask it. Whether the frame reached the screen is the API's business, and asking
 * this counter to mean both would make it useless for the question it exists to answer.
 */
static long WINAPI hook_present9(void* self, const void* sourceRect, const void* destRect,
                                 HWND destWindowOverride, const void* dirtyRegion)
{
  /*
   * The count first, the draw second, the chain last.
   *
   * Counting first means the counter answers "did our hook get called" whatever the API then does
   * with the frame; drawing before the chain means the toast is in the frame that is about to be
   * presented rather than in the one after it.
   */
  overlay_count_present();
  draw_toast9(self);
  static int captureFrames = -1;
  static unsigned long long lastCapture = 0;
  if (captureFrames < 0) {
    char enabled[8];
    DWORD count = GetEnvironmentVariableA("RE_GAME_FRAME_CAPTURE", enabled, sizeof(enabled));
    captureFrames = count > 0 && count < sizeof(enabled) && enabled[0] == '1';
  }
  if (captureFrames && GetTickCount64() - lastCapture >= 1000) {
    lastCapture = GetTickCount64();
    wchar_t directory[MAX_PATH] = {0};
    capture_directory(directory, MAX_PATH);
    if (directory[0]) overlay_draw9_capture(self, directory);
  }

  if (g_realPresent9 == NULL) return 0;
  return g_realPresent9(self, sourceRect, destRect, destWindowOverride, dirtyRegion);
}

/**
 * Our `IDirect3D9::CreateDevice`.
 *
 * The device pointer arrives as this call's last argument, which is how a per-instance vtable
 * gets patched without ever having to find the device — see this file's header comment.
 */
static long WINAPI hook_create_device(void* self, unsigned int adapter, unsigned int deviceType,
                                      HWND focusWindow, unsigned long behaviourFlags,
                                      void* presentationParameters, void** returnedDevice)
{
  if (g_realCreateDevice == NULL) return (long)0x80004005; /* E_FAIL: the chain is broken, so refuse */
  long result = g_realCreateDevice(self, adapter, deviceType, focusWindow, behaviourFlags,
                                   presentationParameters, returnedDevice);

  /* Only a device that was actually created has a vtable to patch; a failure's out-pointer is
     left untouched by the API and may hold anything. */
  if (result >= 0 && returnedDevice != NULL && *returnedDevice != NULL)
  {
    patch_device_present(*returnedDevice);
  }
  return result;
}

/** Replaces `Present` in one device's own vtable. Called for every device the game creates. */
static int patch_device_present(void* device)
{
  void** vtable = (device == NULL) ? NULL : *(void***)device;
  if (vtable == NULL)
  {
    overlay_log("a device was created with no vtable at 0x%p", device);
    return 0;
  }
  return patch_entry(vtable, VTABLE_INDEX_PRESENT_9, (void*)hook_present9,
                     (void**)&g_realPresent9, "IDirect3DDevice9::Present");
}

/* ---------------------------------------------------------------- discovery */

/**
 * Learns where `IDirect3D9`'s vtable lives, by obtaining an object of that class of our own.
 *
 * `Direct3DCreate9` is cheap and needs no window: it returns an interface object, not a device.
 * The object is released immediately afterwards — the vtable it pointed at is static module data,
 * so it outlives the object, and the module is deliberately kept loaded (see below) so the patch
 * cannot be unmapped out from under the game.
 */
static int install_d3d9(int allowLoad)
{
  /*
   * PATCH FIRST IF THE LIBRARY IS ALREADY THERE, and that ordering is the difference between working and
   * not: measured on RE3, the plugin linked and reported `api=d3d9` while `STAT` stayed at zero presents,
   * because the game's renderer - Classic REbirth - creates its Direct3D device during process start,
   * before the 50 ms wait this function used to sit behind. A device created before the patch is a device
   * we never see.
   *
   * `GetModuleHandle` loads nothing, so this is safe to do immediately from a thread created in
   * `DllMain`: in the case that matters, the game has already mapped d3d9.dll itself. Only when the
   * library is genuinely absent - a game that has not touched Direct3D 9 yet - is a load needed, and
   * that one waits for `DllMain` to return.
   */
  HMODULE module = GetModuleHandleA("d3d9.dll");
  /*
   * Whether the library was ALREADY mapped when this ran, which is how asynchronous the ASI loader is
   * relative to the game's own initialisation: if the game or its mod had already touched Direct3D 9 by
   * the time a plugin loaded at all, then a device may already exist that no late patch can reach.
   */
  overlay_log("d3d9.dll already mapped at hook time: %d", (module != NULL) ? 1 : 0);
  if (module == NULL)
  {
    if (!allowLoad) return 0;
    module = LoadLibraryA("d3d9.dll");
  }
  if (module == NULL)
  {
    overlay_log("no d3d9.dll in this process: the overlay will not hook Direct3D 9");
    return 0;
  }

  Direct3DCreate9Fn create = (Direct3DCreate9Fn)GetProcAddress(module, "Direct3DCreate9");
  if (create == NULL)
  {
    overlay_log("d3d9.dll has no Direct3DCreate9 export");
    return 0;
  }

  void* direct3d = create(RE_D3D_SDK_VERSION);
  if (direct3d == NULL)
  {
    overlay_log("Direct3DCreate9 returned nothing");
    return 0;
  }

  void** vtable = *(void***)direct3d;
  int patched = patch_entry(vtable, VTABLE_INDEX_CREATE_DEVICE, (void*)hook_create_device,
                            (void**)&g_realCreateDevice, "IDirect3D9::CreateDevice");

  /*
   * THE EXPERIMENT THAT DECIDES WHAT TO DO NEXT, taken on every install.
   *
   * Measured on RE3: the patch lands (`d3d9=1`), the launcher links, and `Present` is never called once -
   * so the game's device was not created through this table. Two causes remain, and they need completely
   * different fixes:
   *
   *   - the vtables are per object, so patching the one WE were handed covers only our own objects, and
   *     the whole route has to become creation-interception; or
   *   - the table is shared (as the hermetic host measured) and the game simply created its device
   *     before this ran, which means the hook has to go in earlier than any thread can manage.
   *
   * Asking for a second object and comparing its vtable with the one just patched separates them, costs
   * one COM object, and needs no game to be built.
   */
  void* fresh = create(RE_D3D_SDK_VERSION);
  if (fresh != NULL)
  {
    void** freshVtable = *(void***)fresh;
    overlay_log("vtable probe: patched=0x%p fresh=0x%p shared=%d", (void*)vtable, (void*)freshVtable,
                (freshVtable == vtable) ? 1 : 0);
    com_release(fresh);
  }
  else
  {
    overlay_log("vtable probe: a second Direct3DCreate9 returned nothing");
  }

  com_release(direct3d);

  /*
   * The library reference is deliberately NOT released.
   *
   * The patch lives in d3d9.dll's own read-only data. If the module were unloaded and mapped
   * again at another base - which a process that had no other reason to keep it could do - the
   * patched page would go with it, and the overlay would silently stop counting. Holding the
   * reference costs one module in a process that is about to load it anyway.
   */
  return patched;
}

/**
 * Loads the bundled typeface from the plugin's own directory, on this thread.
 *
 * Called from the install path rather than lazily from the draw path on purpose: `AddFontResourceEx`
 * and GDI+ startup both touch process-wide state, and doing that inside a game's present call is
 * exactly the kind of thing that turns a toast into a hitch.
 */
static void init_fonts(void)
{
  wchar_t path[MAX_PATH];
  HMODULE self = NULL;
  if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                          (LPCWSTR)&init_fonts, &self))
  {
    return;
  }
  if (GetModuleFileNameW(self, path, MAX_PATH) == 0) return;

  wchar_t* separator = wcsrchr(path, L'\\');
  if (separator != NULL) *separator = L'\0';
  overlay_fonts_init(path);
}

/**
 * The earliest possible hook attempt, called from `DllMain` itself.
 *
 * Measured: the plugin patches `CreateDevice` about 86 ms after attach, and on some launches RE3's
 * renderer - Classic REbirth - has already created its device by then, so the patch lands on a table
 * nobody will call again and the overlay silently counts nothing (`STAT 0 0 1`, seen twice). Thread
 * startup, `GetModuleHandle`, `GetProcAddress`, `Direct3DCreate9` and `VirtualProtect` are the whole
 * 86 ms, and the only way to remove it is to do the work in `DllMain`.
 *
 * What makes that safe HERE, and not in general: it loads nothing. `install_d3d9(0)` uses
 * `GetModuleHandle` and gives up if d3d9.dll is absent, so the loader lock - held by this very thread,
 * because `DllMain` has not returned - is never asked for. The GDI+ work stays on the thread, where it
 * has to be: `GdiplusStartup` loads a library, and that is what deadlocked when it ran this early.
 *
 * If the library is not mapped yet, this does nothing and the thread's install (with the 50 ms wait and
 * a real load) handles it exactly as before.
 */
int overlay_hook_install_early(void)
{
  HMODULE module = GetModuleHandleA("d3d9.dll");
  overlay_log("early hook attempt in DllMain: d3d9.dll mapped=%d", (module != NULL) ? 1 : 0);
  if (module == NULL) return 0;

  int patched = install_d3d9(0);
  if (patched != 0)
  {
    _snprintf_s(g_api, sizeof(g_api), _TRUNCATE, "d3d9");
    overlay_log("early hook installed from DllMain (api=%s)", g_api);
  }
  return patched;
}

int overlay_hook_install(void)
{
  /*
   * WAIT BEFORE TOUCHING THE LOADER, and this is not superstition.
   *
   * `DllMain` creates the thread this runs on, and a thread created inside `DllMain` can start
   * executing while the thread that is still inside `DllMain` holds the loader lock. Anything that
   * loads another library - `GdiplusStartup` pulls in gdiplus.dll, `LoadLibraryA("d3d9.dll")` is a
   * load outright - then blocks on a lock its own process is holding, and the thread never finishes
   * initialising. That is the failure this delay prevents, and it was measured: without it the log
   * stopped after "plugin attached" and no hook was ever installed.
   *
   * A short sleep is sufficient because `DllMain` does nothing but create this thread and return.
   */
  /*
   * THE ORDER IS THE FIX, and it was measured rather than reasoned.
   *
   * The hook goes in first, with no delay, when the game has already mapped d3d9.dll - which is the case
   * that matters, because that is a renderer that may already have created its device. Only the GDI+
   * work (the typeface, and the text cache it warms) waits for `DllMain` to release the loader lock,
   * because `GdiplusStartup` loads a library and that is what deadlocked when it ran immediately.
   */
  int d3d9 = install_d3d9(0);
  if (d3d9 == 0)
  {
    Sleep(50);
    d3d9 = install_d3d9(1);
  }

  init_fonts();

  /*
   * Which APIs are patched, as a string, because it is the measurement: the launcher logs it and
   * the live spec reads it, so "the overlay is loaded but hooking nothing" is a visible state
   * rather than a toast that never appears for no stated reason.
   *
   * DXGI is not attempted yet. It is RE1's path only (its dgVoodoo chain ends in D3D11), and
   * discovering a swapchain's vtable requires creating one - a device and a window that the
   * plugin does not otherwise need. RE2 and RE3, the two titles that run, are D3D9.
   */
  if (d3d9) _snprintf_s(g_api, sizeof(g_api), _TRUNCATE, "d3d9");
  else _snprintf_s(g_api, sizeof(g_api), _TRUNCATE, "none");

  overlay_log("hook install: d3d9=%d api=%s", d3d9, g_api);
  return d3d9;
}

const char* overlay_hook_api(void)
{
  return g_api;
}
