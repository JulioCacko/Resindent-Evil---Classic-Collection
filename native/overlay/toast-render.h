/*
 * toast-render.h — the composed toast, as pixels.
 *
 * The toast is composed once per unlock, at the size it will be drawn, and then drawn as a single
 * textured quad. Two reasons for that order rather than drawing text and shapes straight into the
 * device every frame:
 *
 *   - **The game's device is not ours to hold.** Composition is a GDI+ bitmap operation with no
 *     device involvement, so nothing in it can leave D3D state dirty, and the frame path only ever
 *     touches one texture and one quad.
 *   - **The design is a rasteriser's.** The toast's card, hairline, glyph and type are transcribed
 *     from `overlays/AchievementToast.tsx`, and doing that once per unlock is cheap; doing it 60
 *     times a second is not.
 *
 * The buffer is BGRA with PREMULTIPLIED alpha, which is what GDI+ produces and what the D3D9 blend
 * (`ONE, INVSRCALPHA`) expects - the alternative would be unpremultiplying every pixel by hand, and
 * getting that wrong shows up as a dark halo around the text rather than as an error.
 */

#ifndef RE_OVERLAY_TOAST_RENDER_H
#define RE_OVERLAY_TOAST_RENDER_H

#include "overlay.h"

/** A composed bitmap: `width * height * 4` bytes of premultiplied BGRA, top row first. */
typedef struct OverlayBitmap
{
  unsigned char* pixels;
  int width;
  int height;
} OverlayBitmap;

typedef struct OverlayCompose
{
  /** What the toast is anchored to: the back buffer, which is not always the window size. */
  int viewWidth;
} OverlayCompose;

/**
 * The card's width in device pixels for a given back-buffer width.
 *
 * Exposed because the draw path has to position the card and must agree with the composition about
 * how wide it is; two copies of the scale rule is exactly how a toast ends up half off the screen.
 */
int overlay_toast_card_width(int viewWidth);

/**
 * Composes `toast` into a bitmap. Returns 0 on failure, leaving `out` zeroed.
 *
 * Must not be called from the game's render thread while a device is open: GDI+ initialises
 * lazily on first use and that is not a thing to do inside a present call.
 */
int overlay_toast_compose(const OverlayToast* toast, const OverlayCompose* compose, OverlayBitmap* out);

void overlay_bitmap_free(OverlayBitmap* bitmap);

/** Loads the bundled typeface, privately, so the game's own font usage is untouched. */
void overlay_fonts_init(const wchar_t* pluginDirectory);

/**
 * Writes a composed bitmap to `directory\capture-<pid>-<seq>.bgra`, behind `RE_OVERLAY_CAPTURE`.
 *
 * An 8-byte header (width, height as int32) followed by the raw premultiplied BGRA rows: no image
 * encoder, and a test can read it with `fs` alone. This is how a hermetic test *measures* what was
 * drawn rather than trusting a counter, and how a human looks at it.
 */
void overlay_bitmap_capture(const OverlayBitmap* bitmap, const wchar_t* directory, unsigned long seq);

#endif /* RE_OVERLAY_TOAST_RENDER_H */
