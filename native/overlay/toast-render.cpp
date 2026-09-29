/*
 * toast-render.cpp — the toast, composed with GDI+.
 *
 * Every number here is transcribed from `src/renderer/src/overlays/AchievementToast.tsx`, which is
 * the behavioural reference, so the in-game toast and the launcher's own are the same object drawn
 * by two renderers. The tokens, and where each comes from:
 *
 *   plate            #1a1a1a    `bg-[#1a1a1a]`
 *   hairline         #4d4d4d    1px, `border border-[#4d4d4d]`
 *   corner           4px        `rounded-[4px]`
 *   padding          16px       `p-[16px]`
 *   glyph            32px       the trophy's `size-[32px]` SVG, redrawn here as GDI+ paths
 *   eyebrow          14px       `text-[14px] tracking-[0.08em] uppercase`, colour GOLD
 *   name             22px       `text-[22px] text-white`
 *   description      16px       `text-[16px] text-[#999]`, clamped to two lines
 *   underline        2px        gold, `h-[2px]`, filling across the display duration
 *   GOLD             #D4AF37    the legacy overlay's `RGBA(0xD4,0xAF,0x37,0xFF)`
 *
 * ONE DELIBERATE DEPARTURE FROM THE DESIGN, and it is a measurement rather than a preference: the
 * concept is authored on a 1920-wide canvas, so scaling the toast by `viewWidth / 1920` is what
 * keeps it faithful - but RE2 and RE3 present at 640x480 (docs/ARCHITECTURE.md §12.3), where a
 * faithful scale would draw the 22px name at 7px, which is not a toast anyone can read. The scale
 * is therefore floored at 0.5, and the floor is what this file's `toast_scale` documents.
 *
 * GDI has no letter-spacing, so the eyebrow's 0.08em tracking is drawn one glyph at a time. GDI+
 * rather than GDI because GDI does not write alpha into a 32bpp DIB at all: text composed with GDI
 * comes out as an opaque black box, which is the classic way an overlay like this ends up with
 * invisible text.
 */

#include "toast-render.h"

#include <windows.h>
/* `objidl.h` must come before `gdiplus.h`: GDI+'s headers declare `IStream`-taking members and
   expect it, and `WIN32_LEAN_AND_MEAN` keeps `windows.h` from pulling the OLE headers in. Without
   this the failure is a hundred errors inside Microsoft's own headers. */
#include <objidl.h>
#include <gdiplus.h>

#include <stdio.h>
#include <string.h>
#include <wchar.h>

namespace gdip = Gdiplus;

/* The design's tokens. */
static const BYTE PLATE_R = 0x1a, PLATE_G = 0x1a, PLATE_B = 0x1a;
static const BYTE HAIRLINE_R = 0x4d, HAIRLINE_G = 0x4d, HAIRLINE_B = 0x4d;
static const BYTE GOLD_R = 0xD4, GOLD_G = 0xAF, GOLD_B = 0x37;
static const BYTE DESC_R = 0x99, DESC_G = 0x99, DESC_B = 0x99;

static const float CARD_WIDTH_AUTHORED = 420.0f;
static const float AUTHORED_VIEW_WIDTH = 1920.0f;
static const float INSET_RIGHT_AUTHORED = 20.0f;
static const float INSET_TOP_AUTHORED = 30.0f;
static const float PADDING_AUTHORED = 16.0f;
static const float CORNER_AUTHORED = 4.0f;
static const float GLYPH_AUTHORED = 32.0f;
static const float GAP_AUTHORED = 12.0f;
static const float EYEBROW_AUTHORED = 14.0f;
static const float NAME_AUTHORED = 22.0f;
static const float DESC_AUTHORED = 16.0f;
static const float UNDERLINE_AUTHORED = 2.0f;
static const float TRACKING_AUTHORED = 0.08f;

static ULONG_PTR g_gdiplusToken = 0;
static int g_gdiplusReady = 0;
static wchar_t g_familyName[64] = L"Arial";

/**
 * The bundled face, owned by GDI+ for this process.
 *
 * A `PrivateFontCollection` rather than a GDI font registration, because that is the only one of the
 * two GDI+ can actually see - see `overlay_fonts_init`. Null until the face is loaded, and the fonts
 * below are built from it when it exists.
 */
static gdip::PrivateFontCollection* g_fontCollection = NULL;

/**
 * The family the fonts are built from, for the plugin's whole life.
 *
 * Created once during install rather than per composition: a `FontFamily` built from the private
 * collection is exactly the object this file must not leak on any of the composition's several failure
 * paths, and a single owner removes that question entirely.
 */
static gdip::FontFamily* g_family = NULL;

int overlay_toast_compose(const OverlayToast* toast, const OverlayCompose* compose, OverlayBitmap* out);

/* ------------------------------------------------------------------ helpers */

static void ensure_gdiplus(void)
{
  if (g_gdiplusReady) return;
  gdip::GdiplusStartupInput input;
  if (gdip::GdiplusStartup(&g_gdiplusToken, &input, NULL) == gdip::Ok) g_gdiplusReady = 1;
}

/**
 * The bundled typeface, loaded privately.
 *
 * `FR_PRIVATE` matters: without it the face would be registered for every process on the desktop,
 * and this plugin has no business changing what other applications' font menus offer.
 */
static void load_private_font(const wchar_t* pluginDirectory)
{
  ensure_gdiplus();
  if (!g_gdiplusReady || pluginDirectory == NULL) return;

  wchar_t path[MAX_PATH];
  _snwprintf_s(path, MAX_PATH, _TRUNCATE, L"%s\\Actor-Regular.ttf", pluginDirectory);
  if (GetFileAttributesW(path) == INVALID_FILE_ATTRIBUTES)
  {
    overlay_log("no bundled typeface at %ls; falling back to %ls", path, g_familyName);
    return;
  }

  /*
   * THE TOAST'S TEXT DEPENDS ON THIS CALL BEING THE RIGHT ONE.
   *
   * The first version used `AddFontResourceExW(path, FR_PRIVATE, 0)` and then asked for the family by
   * name. That is the Win32 way, and GDI+ cannot see a font registered that way at all: the
   * registration goes into GDI's font table, while GDI+ enumerates from its own. The symptoms were
   * exactly what that predicts and nothing like an error - every `MeasureString` returned a height of
   * zero, so the card collapsed to just its glyph and padded to 32 px tall, and not one pixel of text
   * was drawn. It was found by reading the composed card's palette: gold (`212,175,55`) in abundance,
   * and no white and no grey anywhere in it.
   *
   * It was also slow - about 2.8 seconds, spent searching for a family that could not exist - and that
   * cost landed inside the game's present call. One cause, two symptoms.
   *
   * `PrivateFontCollection` is the GDI+ mechanism: it owns the face for this process, needs no
   * installation, and its families are the ones the fonts below are built from.
   */
  if (g_fontCollection == NULL)
  {
    g_fontCollection = new gdip::PrivateFontCollection();
  }
  if (g_fontCollection->AddFontFile(path) != gdip::Ok)
  {
    overlay_log("GDI+ refused %ls; falling back to %ls", path, g_familyName);
    return;
  }

  const INT families = g_fontCollection->GetFamilyCount();
  if (families <= 0)
  {
    overlay_log("%ls added no family to the private collection", path);
    return;
  }

  gdip::FontFamily* list = new gdip::FontFamily[families];
  INT found = 0;
  g_fontCollection->GetFamilies(families, list, &found);
  if (found > 0)
  {
    /* The name the face actually reports, rather than the name it was expected to have: the file is
       the authority on what its family is called, and a wrong guess here is the same silent failure
       this function exists to avoid. */
    WCHAR name[LF_FACESIZE];
    name[0] = L'\0';
    list[0].GetFamilyName(name);
    if (name[0] != L'\0') _snwprintf_s(g_familyName, 64, _TRUNCATE, L"%s", name);
  }
  delete[] list;

  /* The one family the composition uses, built here and kept, so a composition never allocates it. */
  if (g_family != NULL) delete g_family;
  g_family = new gdip::FontFamily(g_familyName, g_fontCollection);

  /*
   * WARM THE TEXT PATH, HERE, ON THIS THREAD.
   *
   * GDI+ builds its text cache the first time it measures or draws anything, and that costs about
   * 2.8 seconds in a process that has never done it - measured, not guessed. The composition runs
   * inside the game's present call, so without this the first toast freezes the game for those 2.8
   * seconds. This function runs on the pipe thread during install, before the game has drawn a frame,
   * which is the one place that cost is free.
   */
  {
    gdip::Bitmap probe(1, 1, PixelFormat32bppPARGB);
    gdip::Graphics measure(&probe);
    measure.SetTextRenderingHint(gdip::TextRenderingHintAntiAlias);
    gdip::Font warm(g_family, 16.0f, gdip::FontStyleRegular, gdip::UnitPixel);
    gdip::StringFormat format;
    gdip::RectF box;
    gdip::SolidBrush brush(gdip::Color(255, 255, 255, 255));
    const DWORD warmStart = GetTickCount();
    measure.MeasureString(L"warm", 4, &warm, gdip::PointF(0.0f, 0.0f), &format, &box);
    measure.DrawString(L"warm", 4, &warm, gdip::PointF(0.0f, 0.0f), &format, &brush);
    overlay_log("fonts: text path warmed in %lu ms (this is the cost the first toast used to pay)",
                (unsigned long)(GetTickCount() - warmStart));
  }

  overlay_log("typeface %ls registered privately; family=%ls (%d found)", path, g_familyName, (int)found);
}

/**
 * The family `overlay_toast_compose` uses, and the reason it never builds one for itself.
 *
 * Constructing a `Gdiplus::FontFamily` by name is a lookup against the *installed* font collection, and
 * it was measured at about **2.7 seconds** in this process - the whole of the composition's cost, spent
 * before a single glyph was measured, and spent inside the game's present call. Building it here, on
 * the pipe thread during install, is what makes that cost disappear from the frame.
 *
 * A fallback family is created here too, unconditionally, so the composition path has none to build.
 */
static void ensure_family_or_fallback(void)
{
  if (g_family != NULL) return;

  const DWORD start = GetTickCount();
  g_family = new gdip::FontFamily(L"Arial");
  _snwprintf_s(g_familyName, 64, _TRUNCATE, L"Arial");
  overlay_log("no private face; fallback family built in %lu ms", (unsigned long)(GetTickCount() - start));
}

/**
 * Loads the bundled face and guarantees a usable family, whatever happened.
 *
 * The wrapper exists so that every path through the loader - a missing file, a GDI+ refusal, a
 * collection with no families - still leaves `g_family` valid, because the composition may not build
 * one for itself. See `ensure_family_or_fallback` for why that matters.
 */
void overlay_fonts_init(const wchar_t* pluginDirectory)
{
  load_private_font(pluginDirectory);
  ensure_family_or_fallback();
}

/**
 * The in-game scale, and the floor that departs from the design.
 *
 * `viewWidth / 1920` is the faithful rule. The floor of 0.5 exists because RE2 and RE3 present at
 * 640x480, where the faithful rule draws the name at 7px; the ceiling of 1.5 is so a very high
 * resolution back buffer cannot produce a card wider than the frame is tall.
 */
static float toast_scale(const OverlayCompose* compose)
{
  float scale = (float)compose->viewWidth / AUTHORED_VIEW_WIDTH;
  if (scale < 0.5f) scale = 0.5f;
  if (scale > 1.5f) scale = 1.5f;
  return scale;
}

int overlay_toast_card_width(int viewWidth)
{
  OverlayCompose compose;
  compose.viewWidth = viewWidth;
  int width = (int)(CARD_WIDTH_AUTHORED * toast_scale(&compose) + 0.5f);
  return width < 32 ? 32 : width;
}

/** One UTF-16 line, drawn glyph by glyph so `tracking` in ems is honoured. */
static void draw_tracked_text(gdip::Graphics* graphics, const wchar_t* text, int length,
                              gdip::Font* font, gdip::Brush* brush, float x, float y, float tracking)
{
  if (length <= 0) return;
  gdip::StringFormat format;
  format.SetFormatFlags(gdip::StringFormatFlagsMeasureTrailingSpaces | gdip::StringFormatFlagsNoWrap);

  float cursor = x;
  for (int index = 0; index < length; index++)
  {
    wchar_t glyph[2] = {text[index], L'\0'};
    gdip::RectF box(cursor, y, 64.0f, 64.0f);
    gdip::RectF fitted;
    graphics->MeasureString(glyph, 1, font, box, &format, &fitted);
    graphics->DrawString(glyph, 1, font, gdip::PointF(cursor, y), &format, brush);
    cursor += fitted.Width + tracking;
  }
}

static void add_rounded_rect(gdip::GraphicsPath* path, float x, float y, float width, float height, float radius)
{
  const float diameter = radius * 2.0f;
  path->AddArc(x, y, diameter, diameter, 180.0f, 90.0f);
  path->AddArc(x + width - diameter, y, diameter, diameter, 270.0f, 90.0f);
  path->AddArc(x + width - diameter, y + height - diameter, diameter, diameter, 0.0f, 90.0f);
  path->AddArc(x, y + height - diameter, diameter, diameter, 90.0f, 90.0f);
  path->CloseFigure();
}

/**
 * The trophy glyph, at the design's 32px in a 24-unit box.
 *
 * The same geometry as the inline SVG in `AchievementToast.tsx`, so the two renderers draw the same
 * mark; the coordinates are the SVG's, scaled by `size / 24`.
 */
static void draw_glyph(gdip::Graphics* graphics, float x, float y, float size)
{
  const float unit = size / 24.0f;
  gdip::SolidBrush gold(gdip::Color(255, GOLD_R, GOLD_G, GOLD_B));
  gdip::Pen pen(gdip::Color(255, GOLD_R, GOLD_G, GOLD_B), 1.6f * unit);

  /* The bowl: x 6.6..17.4, y 3.5, height 4.9 with a semicircular bottom. */
  gdip::GraphicsPath bowl;
  bowl.AddArc(x + 6.6f * unit, y + 3.0f * unit, 10.8f * unit, 5.4f * unit, 180.0f, 180.0f);
  bowl.AddLine(x + 6.6f * unit, y + 5.7f * unit, x + 17.4f * unit, y + 5.7f * unit);
  bowl.CloseFigure();
  graphics->FillPath(&gold, &bowl);

  /* The two handles, the stem and the base. */
  graphics->DrawArc(&pen, x + 3.0f * unit, y + 4.9f * unit, 4.6f * unit, 4.6f * unit, 90.0f, 180.0f);
  graphics->DrawArc(&pen, x + 16.4f * unit, y + 4.9f * unit, 4.6f * unit, 4.6f * unit, 270.0f, 180.0f);
  graphics->DrawLine(&pen, x + 12.0f * unit, y + 13.8f * unit, x + 12.0f * unit, y + 16.8f * unit);
  graphics->FillRectangle(&gold, x + 8.6f * unit, y + 16.8f * unit, 6.8f * unit, 3.1f * unit);
  graphics->DrawLine(&pen, x + 6.6f * unit, y + 21.0f * unit, x + 17.4f * unit, y + 21.0f * unit);
}

/* ---------------------------------------------------------------- composition */

int overlay_toast_compose(const OverlayToast* toast, const OverlayCompose* compose, OverlayBitmap* out)
{
  out->pixels = NULL;
  out->width = 0;
  out->height = 0;

  ensure_gdiplus();
  if (!g_gdiplusReady) return 0;

  const float scale = toast_scale(compose);
  const float cardWidth = (float)overlay_toast_card_width(compose->viewWidth);
  if (cardWidth < 32.0f) return 0;
  const float padding = PADDING_AUTHORED * scale;
  const float gap = GAP_AUTHORED * scale;
  const float glyph = GLYPH_AUTHORED * scale;
  const float eyebrowSize = EYEBROW_AUTHORED * scale;
  const float nameSize = NAME_AUTHORED * scale;
  const float descSize = DESC_AUTHORED * scale;
  const float textWidth = cardWidth - padding * 2.0f - glyph - gap;
  if (textWidth < 24.0f) return 0;

  /* Checkpoints, because this function is called inside a game's present call and it was measured at
     ~2.8 seconds. A number that large with no name attached is not a bug report anyone can act on. */
  const DWORD composeStart = GetTickCount();

  /* Every construction that costs anything happened at install. Compose only consumes. */
  const gdip::FontFamily* family = g_family;
  if (family == NULL) return 0;
  gdip::Font eyebrowFont(family, eyebrowSize, gdip::FontStyleRegular, gdip::UnitPixel);
  gdip::Font nameFont(family, nameSize, gdip::FontStyleRegular, gdip::UnitPixel);
  gdip::Font descFont(family, descSize, gdip::FontStyleRegular, gdip::UnitPixel);
  gdip::SolidBrush white(gdip::Color(255, 255, 255, 255));
  gdip::SolidBrush gold(gdip::Color(255, GOLD_R, GOLD_G, GOLD_B));
  gdip::SolidBrush grey(gdip::Color(255, DESC_R, DESC_G, DESC_B));

  /*
   * The card's height is measured before it is drawn, because a bitmap has to exist before anything
   * can be drawn into it — and GDI+ measures text through a `Graphics`, which needs a bitmap of its
   * own. So a 1x1 probe is used purely to ask "how tall is this, at this width and font", and the
   * real bitmap is then allocated at the height that came back.
   *
   * The description wraps to at most two lines, which is the design's `line-clamp-2`; the eyebrow
   * is one line by construction.
   */
  gdip::StringFormat wrap;
  wrap.SetFormatFlags(gdip::StringFormatFlagsNoClip);

  float eyebrowHeight = 0;
  float nameHeight = 0;
  float descriptionHeight = 0;
  overlay_log("compose: fonts+fam in %lu ms", (unsigned long)(GetTickCount() - composeStart));
  {
    gdip::Bitmap probe(1, 1, PixelFormat32bppPARGB);
    gdip::Graphics measure(&probe);
    measure.SetTextRenderingHint(gdip::TextRenderingHintAntiAlias);
    overlay_log("compose: probe+graphics in %lu ms", (unsigned long)(GetTickCount() - composeStart));
    gdip::RectF measured;
    measure.MeasureString(L"ACHIEVEMENT UNLOCKED", -1, &eyebrowFont, gdip::PointF(0, 0), &wrap, &measured);
    eyebrowHeight = measured.Height;
    overlay_log("compose: eyebrow in %lu ms", (unsigned long)(GetTickCount() - composeStart));

    measure.MeasureString(toast->name, -1, &nameFont, gdip::PointF(0, 0), &wrap, &measured);
    nameHeight = measured.Height;
    overlay_log("compose: name in %lu ms", (unsigned long)(GetTickCount() - composeStart));

    if (toast->desc[0] != L'\0')
    {
      gdip::RectF layout(0, 0, textWidth, 4096.0f);
      measure.MeasureString(toast->desc, -1, &descFont, layout, &wrap, &measured);
      descriptionHeight = measured.Height;

      gdip::RectF lineBox;
      measure.MeasureString(L"Ag", 2, &descFont, gdip::PointF(0, 0), &wrap, &lineBox);
      const float lineHeight = lineBox.Height;
      if (descriptionHeight > lineHeight * 2.0f) descriptionHeight = lineHeight * 2.0f;
      overlay_log("compose: desc in %lu ms", (unsigned long)(GetTickCount() - composeStart));
    }
  }

  overlay_log("compose: measured in %lu ms (eyebrow=%.1f name=%.1f desc=%.1f)",
              (unsigned long)(GetTickCount() - composeStart), eyebrowHeight, nameHeight, descriptionHeight);

  const float textBlock = eyebrowHeight + 4.0f * scale + nameHeight +
                          (toast->desc[0] != L'\0' ? 4.0f * scale + descriptionHeight : 0.0f);
  const float contentHeight = (textBlock > glyph) ? textBlock : glyph;
  const int height = (int)(contentHeight + padding * 2.0f + 0.5f);
  if (height < 32) return 0;

  gdip::Bitmap bitmap((INT)cardWidth, (INT)height, PixelFormat32bppPARGB);
  if (bitmap.GetLastStatus() != gdip::Ok) return 0;

  {
    gdip::Graphics graphics(&bitmap);
    graphics.SetSmoothingMode(gdip::SmoothingModeAntiAlias);
    graphics.SetTextRenderingHint(gdip::TextRenderingHintAntiAlias);
    graphics.SetInterpolationMode(gdip::InterpolationModeHighQualityBicubic);

    /* The plate and its hairline. */
    gdip::GraphicsPath card;
    add_rounded_rect(&card, 0.5f, 0.5f, cardWidth - 1.0f, (float)height - 1.0f, CORNER_AUTHORED * scale);
    gdip::SolidBrush plate(gdip::Color(255, PLATE_R, PLATE_G, PLATE_B));
    graphics.FillPath(&plate, &card);
    gdip::Pen hairline(gdip::Color(255, HAIRLINE_R, HAIRLINE_G, HAIRLINE_B), 1.0f);
    graphics.DrawPath(&hairline, &card);

    /* The gold eyebrow, tracking included, then the name and the description. */
    const wchar_t* eyebrow = L"ACHIEVEMENT UNLOCKED";
    draw_tracked_text(&graphics, eyebrow, (int)wcslen(eyebrow), &eyebrowFont, &gold,
                      padding + glyph + gap, padding, TRACKING_AUTHORED * eyebrowSize);

    const float nameY = padding + eyebrowHeight + 4.0f * scale;
    graphics.DrawString(toast->name, -1, &nameFont, gdip::PointF(padding + glyph + gap, nameY), &wrap, &white);

    if (toast->desc[0] != L'\0')
    {
      gdip::RectF box(padding + glyph + gap, nameY + nameHeight + 4.0f * scale, textWidth, descriptionHeight);
      graphics.SetClip(box);
      gdip::RectF layout(box.X, box.Y, box.Width, descriptionHeight);
      graphics.DrawString(toast->desc, -1, &descFont, layout, &wrap, &grey);
      graphics.ResetClip();
    }

    /* The trophy, vertically centred against the text block. */
    const float glyphY = padding + (contentHeight - glyph) / 2.0f;
    draw_glyph(&graphics, padding, glyphY, glyph);

    /*
     * GDI+ ANTIALIASES FILLED SHAPES, not just outlines, and that is what made this bar a 57% blend
     * of gold and plate (`132,114,54`) instead of the design's gold (`212,175,55`) - measured from the
     * composed card, at row 54, with full alpha. `SmoothingModeNone` is what turns the coverage
     * blending off; the rounded card and the glyph keep their antialiasing because it is restored
     * straight after.
     *
     * The bar is also at least two device pixels tall. At the half-scale floor the design's 2 px rule
     * is 1 px, and one row of sub-pixel coverage is a smear rather than a rule.
     */
    gdip::SolidBrush underline(gdip::Color(255, GOLD_R, GOLD_G, GOLD_B));
    int underlineHeight = (int)(UNDERLINE_AUTHORED * scale + 0.5f);
    if (underlineHeight < 2) underlineHeight = 2;

    graphics.SetSmoothingMode(gdip::SmoothingModeNone);
    graphics.FillRectangle(&underline, 0, height - underlineHeight, (INT)cardWidth, underlineHeight);
    graphics.SetSmoothingMode(gdip::SmoothingModeAntiAlias);
  }

  /* Out to a plain buffer: the caller owns it, and D3D9 wants bytes rather than a GDI+ object. */
  const int width = (int)cardWidth;
  unsigned char* pixels = (unsigned char*)malloc((size_t)width * (size_t)height * 4u);
  if (pixels == NULL) return 0;

  gdip::Rect lock(0, 0, width, height);
  gdip::BitmapData data;
  ZeroMemory(&data, sizeof(data));
  if (bitmap.LockBits(&lock, gdip::ImageLockModeRead, PixelFormat32bppPARGB, &data) != gdip::Ok)
  {
    free(pixels);
    return 0;
  }

  for (int row = 0; row < height; row++)
  {
    memcpy(pixels + (size_t)row * width * 4u,
           (unsigned char*)data.Scan0 + (size_t)row * data.Stride,
           (size_t)width * 4u);
  }
  bitmap.UnlockBits(&data);

  out->pixels = pixels;

  overlay_log("compose: finished in %lu ms total (%dx%d)", (unsigned long)(GetTickCount() - composeStart),
              width, height);
  out->width = width;
  out->height = height;
  return 1;
}

void overlay_bitmap_free(OverlayBitmap* bitmap)
{
  if (bitmap == NULL) return;
  if (bitmap->pixels != NULL) free(bitmap->pixels);
  bitmap->pixels = NULL;
  bitmap->width = 0;
  bitmap->height = 0;
}

void overlay_bitmap_capture(const OverlayBitmap* bitmap, const wchar_t* directory, unsigned long seq)
{
  if (bitmap == NULL || bitmap->pixels == NULL || directory == NULL) return;

  wchar_t path[MAX_PATH];
  _snwprintf_s(path, MAX_PATH, _TRUNCATE, L"%s\\capture-%lu-%lu.bgra", directory,
               (unsigned long)GetCurrentProcessId(), seq);

  FILE* file = NULL;
  wchar_t temporary[MAX_PATH];
  _snwprintf_s(temporary, MAX_PATH, _TRUNCATE, L"%s.tmp", path);
  if (_wfopen_s(&file, temporary, L"wb") != 0 || file == NULL) return;

  /* An 8-byte header then raw premultiplied BGRA: no encoder, and a test can read it with `fs`. */
  int header[2] = {bitmap->width, bitmap->height};
  fwrite(header, sizeof(int), 2, file);
  fwrite(bitmap->pixels, 4u, (size_t)bitmap->width * (size_t)bitmap->height, file);
  fclose(file);
  MoveFileExW(temporary, path, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);

  overlay_log("captured the composed toast to %ls", path);
}
