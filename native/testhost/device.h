/*
 * device.h — the hermetic host's graphics side.
 *
 * The overlay's hook needs to reach `IDirect3DDevice9::Present` and (for RE1)
 * `IDXGISwapChain::Present` WITHOUT an inline-hook library, because a trampoline means a length
 * disassembler and that is a lot of fragile code to run inside someone's game.
 *
 * The alternative rests on one assumption: that these APIs implement their COM objects with a
 * single static vtable per class inside the implementing module, so that replacing one entry in
 * that vtable redirects every present call — the game's included — with no code patching at all.
 * That is testable, so it is tested here rather than believed: each function creates a device,
 * prints the address of its vtable and which module that address lies in, and creates a SECOND
 * device to print whether the two share the same vtable.
 */

#ifndef RE_OVERLAY_TESTHOST_DEVICE_H
#define RE_OVERLAY_TESTHOST_DEVICE_H

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

/**
 * Creates a D3D9 device on `window`, presents `frames` frames, and reports the device's vtable.
 *
 * Returns 0 on success, or the failing step's HRESULT as a positive-ish diagnostic.
 */
int host_d3d9_present(HWND window, int frames);

/** The same for D3D11 + DXGI: creates a swapchain on `window` and presents `frames` frames. */
int host_dxgi_present(HWND window, int frames);

#endif /* RE_OVERLAY_TESTHOST_DEVICE_H */
