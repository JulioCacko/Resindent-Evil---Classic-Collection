/*
 * device.cpp — real graphics objects, so the hook can be tested without a game.
 *
 * Two present paths are exercised here, because the Phase 0 gate measured two in the real
 * installs: RE2 and RE3 present through `d3d9.dll`, and RE1's dgVoodoo chain ends in DXGI/D3D11
 * (docs/ARCHITECTURE.md §12.2).
 *
 * Each function prints:
 *
 *   - the address of the object's vtable, and which loaded module that address belongs to;
 *   - the vtable of a SECOND object of the same class, so "these are shared" is an observation
 *     rather than an assumption.
 *
 * If the vtables differ per instance, the vtable-patching design is wrong and this says so
 * immediately, before any of it is pointed at a game.
 */

#include "device.h"

#include <d3d9.h>
#include <d3d11.h>
#include <dxgi1_2.h>

#include <stdio.h>

/**
 * Pumps the thread's messages between frames.
 *
 * A thread that presents in a loop without pumping makes its window "not responding", and a
 * frozen window is a different problem from the one this host exists to measure — so the host
 * stays responsive, exactly as the games do while they render.
 */
static void pump_messages(void)
{
  MSG message;
  while (PeekMessageA(&message, NULL, 0, 0, PM_REMOVE))
  {
    TranslateMessage(&message);
    DispatchMessageA(&message);
  }
}

/** The vtable pointer of any COM object: the first pointer-sized word of the object. */
static void* object_vtable(void* object)
{
  if (object == NULL) return NULL;
  return *(void**)object;
}

/**
 * Which module an address belongs to, by allocation base.
 *
 * `VirtualQuery` is the honest way to ask: it reports the allocation the address was mapped from,
 * which for a vtable inside a loaded DLL is that DLL's base address. Comparing it against the
 * module handles of the two libraries is then a real check that the vtable lives where the design
 * assumes it does - read-only data in the implementing module - and not in a heap block or a
 * private copy.
 */
static void describe_address(const char* label, void* address)
{
  MEMORY_BASIC_INFORMATION info;
  ZeroMemory(&info, sizeof(info));
  if (address == NULL || VirtualQuery(address, &info, sizeof(info)) == 0)
  {
    printf("testhost %s=0x%p module=unknown\n", label, address);
    return;
  }

  HMODULE owner = (HMODULE)info.AllocationBase;
  char path[MAX_PATH];
  path[0] = '\0';
  GetModuleFileNameA(owner, path, (DWORD)sizeof(path));
  const char* name = path;
  for (const char* cursor = path; *cursor != '\0'; cursor++)
  {
    if (*cursor == '\\' || *cursor == '/') name = cursor + 1;
  }

  printf("testhost %s=0x%p module=%s protect=0x%lX readonly=%d\n",
         label, address, name, (unsigned long)info.Protect,
         (info.Protect & (PAGE_READONLY | PAGE_EXECUTE_READ)) != 0 ? 1 : 0);
}

/* --------------------------------------------------------------------- D3D9 */

int host_d3d9_present(HWND window, int frames)
{
  IDirect3D9* d3d = Direct3DCreate9(D3D_SDK_VERSION);
  if (d3d == NULL)
  {
    printf("testhost d3d9=FAILED reason=no-direct3d9\n");
    return 1;
  }

  /*
   * The D3D9 DEVICE's vtable was measured to be per-instance heap memory, so it cannot be found
   * without an instance. The `IDirect3D9` object is the level above it: if ITS vtable is a single
   * static table inside d3d9.dll, then patching ONE entry - `CreateDevice` - catches every device
   * the process ever creates, including the game's, with no creation hooking at all. That is
   * checked here rather than assumed, because it is the difference between a data patch and an
   * inline hook with a trampoline.
   */
  IDirect3D9* secondDirect3D = Direct3DCreate9(D3D_SDK_VERSION);
  void* direct3dVtable = object_vtable(d3d);
  void* direct3dVtableSecond = object_vtable(secondDirect3D);
  describe_address("d3d9.direct3dVtable", direct3dVtable);
  describe_address("d3d9.direct3dVtable2", direct3dVtableSecond);
  printf("testhost d3d9.sharedDirect3DVtable=%d\n",
         (direct3dVtable != NULL && direct3dVtableSecond != NULL && direct3dVtable == direct3dVtableSecond) ? 1 : 0);
  if (secondDirect3D != NULL) secondDirect3D->Release();

  D3DPRESENT_PARAMETERS present;
  ZeroMemory(&present, sizeof(present));
  present.Windowed = TRUE;
  present.SwapEffect = D3DSWAPEFFECT_DISCARD;
  present.BackBufferFormat = D3DFMT_X8R8G8B8;
  present.BackBufferWidth = 640;
  present.BackBufferHeight = 480;
  present.hDeviceWindow = window;
  /* No vsync: the host wants frames it can count, not frames the display would pace. */
  present.PresentationInterval = D3DPRESENT_INTERVAL_IMMEDIATE;

  IDirect3DDevice9* device = NULL;
  HRESULT created = d3d->CreateDevice(
      D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, window,
      D3DCREATE_SOFTWARE_VERTEXPROCESSING | D3DCREATE_FPU_PRESERVE,
      &present, &device);
  if (FAILED(created) || device == NULL)
  {
    printf("testhost d3d9=FAILED reason=CreateDevice hr=0x%08lX\n", (unsigned long)created);
    d3d->Release();
    return 2;
  }

  /*
   * A second device, on the same window and adapter, purely to compare vtables. Two devices
   * cannot both own a window's swapchain in D3D9, so this one is created with a hidden helper
   * window and `D3DSWAPEFFECT_COPY`, which is what makes "the same class" observable.
   */
  IDirect3DDevice9* second = NULL;
  {
    WNDCLASSA description;
    ZeroMemory(&description, sizeof(description));
    description.lpfnWndProc = DefWindowProcA;
    description.hInstance = GetModuleHandleA(NULL);
    description.lpszClassName = "ReOverlayTestHostHidden";
    RegisterClassA(&description);
    HWND hidden = CreateWindowExA(0, "ReOverlayTestHostHidden", "hidden",
                                  WS_OVERLAPPEDWINDOW, 0, 0, 64, 64, NULL, NULL,
                                  GetModuleHandleA(NULL), NULL);

    D3DPRESENT_PARAMETERS other = present;
    other.hDeviceWindow = hidden;
    other.SwapEffect = D3DSWAPEFFECT_COPY;
    other.BackBufferWidth = 64;
    other.BackBufferHeight = 64;
    if (hidden != NULL)
    {
      d3d->CreateDevice(D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, hidden,
                        D3DCREATE_SOFTWARE_VERTEXPROCESSING, &other, &second);
    }
  }

  void* vtable = object_vtable(device);
  void* vtableSecond = object_vtable(second);
  describe_address("d3d9.vtable", vtable);
  describe_address("d3d9.vtable2", vtableSecond);
  printf("testhost d3d9.sharedVtable=%d\n",
         (vtable != NULL && vtableSecond != NULL && vtable == vtableSecond) ? 1 : 0);

  int presented = 0;
  for (int frame = 0; frame < frames; frame++)
  {
    HRESULT cleared = device->Clear(0, NULL, D3DCLEAR_TARGET, D3DCOLOR_XRGB(frame % 255, 0, 0), 1.0f, 0);
    HRESULT shown = device->Present(NULL, NULL, NULL, NULL);
    if (SUCCEEDED(cleared) && SUCCEEDED(shown)) presented++;
    if (shown == D3DERR_DEVICELOST)
    {
      printf("testhost d3d9.deviceLost=1 at frame=%d\n", frame);
      break;
    }
    pump_messages();
    Sleep(16);
  }

  printf("testhost d3d9.presented=%d of %d\n", presented, frames);

  if (second != NULL) second->Release();
  device->Release();
  d3d->Release();
  return 0;
}

/* --------------------------------------------------------------------- DXGI */

int host_dxgi_present(HWND window, int frames)
{
  ID3D11Device* device = NULL;
  ID3D11DeviceContext* context = NULL;
  D3D_FEATURE_LEVEL level;
  HRESULT created = D3D11CreateDevice(NULL, D3D_DRIVER_TYPE_HARDWARE, NULL, 0, NULL, 0,
                                      D3D11_SDK_VERSION, &device, &level, &context);
  if (FAILED(created) || device == NULL)
  {
    printf("testhost dxgi=FAILED reason=D3D11CreateDevice hr=0x%08lX\n", (unsigned long)created);
    return 3;
  }

  IDXGIFactory2* factory = NULL;
  HRESULT gotFactory = CreateDXGIFactory1(__uuidof(IDXGIFactory2), (void**)&factory);
  if (FAILED(gotFactory) || factory == NULL)
  {
    printf("testhost dxgi=FAILED reason=CreateDXGIFactory1 hr=0x%08lX\n", (unsigned long)gotFactory);
    context->Release();
    device->Release();
    return 4;
  }

  DXGI_SWAP_CHAIN_DESC1 description;
  ZeroMemory(&description, sizeof(description));
  description.Width = 640;
  description.Height = 480;
  description.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  description.SampleDesc.Count = 1;
  description.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  description.BufferCount = 2;
  description.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;

  IDXGISwapChain1* swapchain = NULL;
  HRESULT madeSwapchain = factory->CreateSwapChainForHwnd(device, window, &description, NULL, NULL, &swapchain);
  if (FAILED(madeSwapchain) || swapchain == NULL)
  {
    printf("testhost dxgi=FAILED reason=CreateSwapChainForHwnd hr=0x%08lX\n", (unsigned long)madeSwapchain);
    factory->Release();
    context->Release();
    device->Release();
    return 5;
  }

  /* A second swapchain of the same class, so "shared vtable" is measured here too. */
  IDXGISwapChain1* second = NULL;
  factory->CreateSwapChainForHwnd(device, window, &description, NULL, NULL, &second);

  void* vtable = object_vtable(swapchain);
  void* vtableSecond = object_vtable(second);
  describe_address("dxgi.vtable", vtable);
  describe_address("dxgi.vtable2", vtableSecond);
  printf("testhost dxgi.sharedVtable=%d\n",
         (vtable != NULL && vtableSecond != NULL && vtable == vtableSecond) ? 1 : 0);

  int presented = 0;
  for (int frame = 0; frame < frames; frame++)
  {
    HRESULT shown = swapchain->Present(0, 0);
    if (SUCCEEDED(shown)) presented++;
    if (shown == DXGI_ERROR_DEVICE_REMOVED || shown == DXGI_ERROR_DEVICE_RESET)
    {
      printf("testhost dxgi.deviceRemoved=1 at frame=%d\n", frame);
      break;
    }
    pump_messages();
    Sleep(16);
  }

  printf("testhost dxgi.presented=%d of %d\n", presented, frames);

  if (second != NULL) second->Release();
  swapchain->Release();
  factory->Release();
  context->Release();
  device->Release();
  return 0;
}
