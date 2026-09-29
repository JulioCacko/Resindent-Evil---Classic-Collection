/*
 * draw9.h — drawing the composed toast into a Direct3D 9 frame.
 *
 * Deliberately one textured quad and nothing else. An overlay that sets up a pipeline, draws, and
 * leaves the device as it found it is the whole requirement; anything more is surface area that can
 * change what the game sees.
 */

#ifndef RE_OVERLAY_DRAW9_H
#define RE_OVERLAY_DRAW9_H

#include "toast-render.h"

/**
 * Draws `bitmap` at `x`,`y` with `alpha` (0..1), premultiplied, then puts every piece of device
 * state it touched back the way it was.
 *
 * `alpha` folds the design's fade into the quad's vertex colour, which is why it is a parameter
 * rather than something the caller composes: fading a texture by re-composing it 60 times a second
 * would be absurd, and the vertex colour does it for free.
 *
 * `device` is an `IDirect3DDevice9*`, typed as `void*` so this header does not drag `d3d9.h` into
 * every translation unit that includes it.
 *
 * Returns 1 when the frame was drawn, 0 when it could not be (a lost device, an allocation failure)
 * — never a throw, and never a partially-restored device.
 */
int overlay_draw9(void* device, const OverlayBitmap* bitmap, int x, int y, float alpha);

/** Releases the cached texture. Called when the device goes away. */
void overlay_draw9_reset(void);

/**
 * The back buffer's size, which is what the toast is positioned and scaled against.
 *
 * Read from the device's viewport rather than its window: dgVoodoo's scaling means the two are not
 * the same, and the viewport is what the quad's screen-space coordinates are measured in.
 * Returns 0 if the device could not be asked.
 */
int overlay_draw9_viewport(void* device, int* width, int* height);

/**
 * Reads the frame back off the device and counts the design's gold inside the toast's rectangle.
 *
 * This is the overlay's own proof that it drew where it meant to, and it exists because the alternative
 * does not work: a screen capture (`CopyFromScreen`) reads the *screen*, so a test script that launches a
 * game and captures it gets a picture of whatever window is on top - Windows will not let a background
 * process bring a game to the foreground, so that measurement is unavailable to automation by design.
 *
 * Reading the render target back has no such dependency: it measures the buffer the plugin just drew
 * into, which is the frame the game is about to present. Returns the gold pixel count, or -1 when the
 * readback itself failed (a lost device, an allocation the driver refused).
 */
int overlay_draw9_verify(void* device, const OverlayBitmap* bitmap, int x, int y);
/* Opt-in test evidence: copies the actual D3D9 frame without desktop focus. */
int overlay_draw9_capture(void* device, const wchar_t* directory);

#endif /* RE_OVERLAY_DRAW9_H */
