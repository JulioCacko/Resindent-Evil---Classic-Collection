/*
 * draw9.cpp — one quad, and the state it borrows put back.
 *
 * The rule this file exists to obey: after our draw, the game's next frame must be pixel-identical
 * to what it would have been without us. A game rendering wrong because an overlay left its state
 * dirty is the failure that gets an overlay called broken, and it is silent — it shows up as
 * missing textures or an invisible player three minutes later, not as an error.
 *
 * So every piece of state this borrows is read first and written back afterwards, in the same order,
 * and the list is explicit rather than "the states I remembered to set": render states, the texture
 * stage that the quad uses, the FVF, the stream source, the vertex and pixel shaders, and texture
 * stage 0's texture.
 *
 * `IDirect3DDevice9`'s own methods are called through the interface pointer, which is a normal
 * virtual call through the object's real vtable. The one method this file must never call is
 * `Present`: that entry is the hook, and calling it from inside itself would re-enter the draw.
 */

#include "draw9.h"

#include <d3d9.h>

#include <string.h>
#include <stdlib.h>

/** The states borrowed for the draw, in one place so the restore cannot drift from the save. */
static const D3DRENDERSTATETYPE kSavedStates[] = {
    D3DRS_ZENABLE, D3DRS_ZWRITEENABLE, D3DRS_ALPHABLENDENABLE, D3DRS_SRCBLEND, D3DRS_DESTBLEND,
    D3DRS_CULLMODE, D3DRS_LIGHTING, D3DRS_FOGENABLE, D3DRS_ALPHATESTENABLE, D3DRS_SCISSORTESTENABLE,
    D3DRS_STENCILENABLE, D3DRS_SHADEMODE, D3DRS_CLIPPING, D3DRS_TEXTUREFACTOR};

/** The stage-0 texture states the textured quad depends on. */
static const D3DTEXTURESTAGESTATETYPE kSavedStageStates[] = {
    D3DTSS_COLOROP, D3DTSS_COLORARG1, D3DTSS_COLORARG2, D3DTSS_ALPHAOP, D3DTSS_ALPHAARG1,
    D3DTSS_ALPHAARG2};

#define SAVED_STATE_COUNT (sizeof(kSavedStates) / sizeof(kSavedStates[0]))
#define SAVED_STAGE_COUNT (sizeof(kSavedStageStates) / sizeof(kSavedStageStates[0]))

struct ToastVertex
{
  float x;
  float y;
  float z;
  float rhw;
  D3DCOLOR colour;
  float u;
  float v;
};

#define TOAST_FVF (D3DFVF_XYZRHW | D3DFVF_DIFFUSE | D3DFVF_TEX1)

/**
 * Logs a failing call and its HRESULT, and nothing when it succeeds.
 *
 * The draw is a chain of about a dozen calls, and a single `D3DERR_INVALIDCALL` at the end of it says
 * only that *some* input was unacceptable. Naming the call that actually refused is the difference
 * between a fix and another guess.
 */
#define LOG_IF_FAILED(call, label)                                     \
  do                                                                   \
  {                                                                    \
    HRESULT hr_ = (call);                                              \
    if (FAILED(hr_))                                                   \
    {                                                                  \
      overlay_log("draw9: %s failed (hr=0x%08lX)", label, (unsigned long)hr_); \
    }                                                                  \
  } while (0)

/** One texture, reused across toasts and recreated only when the card's size changes. */
static IDirect3DTexture9* g_texture = NULL;
static int g_textureWidth = 0;
static int g_textureHeight = 0;

int overlay_draw9_verify(void* devicePointer, const OverlayBitmap* bitmap, int x, int y)
{
  if (devicePointer == NULL || bitmap == NULL) return -1;

  IDirect3DDevice9* device = (IDirect3DDevice9*)devicePointer;
  IDirect3DSurface9* target = NULL;
  if (FAILED(device->GetRenderTarget(0, &target)) || target == NULL) return -1;

  D3DSURFACE_DESC description;
  ZeroMemory(&description, sizeof(description));
  if (FAILED(target->GetDesc(&description)))
  {
    target->Release();
    return -1;
  }

  IDirect3DSurface9* readback = NULL;
  HRESULT made = device->CreateOffscreenPlainSurface(description.Width, description.Height,
                                                     description.Format, D3DPOOL_SYSTEMMEM,
                                                     &readback, NULL);
  if (FAILED(made) || readback == NULL)
  {
    target->Release();
    return -1;
  }

  int gold = 0;
  int total = 0;
  if (SUCCEEDED(device->GetRenderTargetData(target, readback)))
  {
    D3DLOCKED_RECT locked;
    ZeroMemory(&locked, sizeof(locked));
    if (SUCCEEDED(readback->LockRect(&locked, NULL, D3DLOCK_READONLY)))
    {
      for (int row = y; row < y + bitmap->height; row++)
      {
        if (row < 0 || row >= (int)description.Height) continue;
        for (int column = x; column < x + bitmap->width; column++)
        {
          if (column < 0 || column >= (int)description.Width) continue;
          /* A8R8G8B8 and X8R8G8B8 share a layout: red in bits 16-23, green 8-15, blue 0-7. */
          DWORD value = ((DWORD*)((unsigned char*)locked.pBits + (size_t)row * locked.Pitch))[column];
          const int red = (int)((value >> 16) & 0xFF);
          const int green = (int)((value >> 8) & 0xFF);
          const int blue = (int)(value & 0xFF);
          total++;
          if (abs(red - 212) < 40 && abs(green - 175) < 40 && abs(blue - 55) < 50) gold++;
        }
      }
      readback->UnlockRect();
    }
  }

  readback->Release();
  target->Release();

  overlay_log("readback: gold=%d of %d pixels in the toast box, on a %lux%lu frame",
              gold, total, description.Width, description.Height);
  return gold;
}

void overlay_draw9_reset(void)
{
  if (g_texture != NULL)
  {
    g_texture->Release();
    g_texture = NULL;
  }
  g_textureWidth = 0;
  g_textureHeight = 0;
}

int overlay_draw9_capture(void* devicePointer, const wchar_t* directory)
{
  if (devicePointer == NULL || directory == NULL) return 0;
  IDirect3DDevice9* device = (IDirect3DDevice9*)devicePointer;
  IDirect3DSurface9* target = NULL;
  if (FAILED(device->GetRenderTarget(0, &target)) || target == NULL) return 0;
  D3DSURFACE_DESC description;
  if (FAILED(target->GetDesc(&description)) ||
      (description.Format != D3DFMT_A8R8G8B8 && description.Format != D3DFMT_X8R8G8B8) ||
      description.Width > 8192 || description.Height > 8192) { target->Release(); return 0; }
  IDirect3DSurface9* surface = NULL;
  if (FAILED(device->CreateOffscreenPlainSurface(description.Width, description.Height,
      description.Format, D3DPOOL_SYSTEMMEM, &surface, NULL))) { target->Release(); return 0; }
  int captured = 0;
  D3DLOCKED_RECT locked;
  if (SUCCEEDED(device->GetRenderTargetData(target, surface)) &&
      SUCCEEDED(surface->LockRect(&locked, NULL, D3DLOCK_READONLY))) {
    OverlayBitmap bitmap;
    bitmap.width = (int)description.Width;
    bitmap.height = (int)description.Height;
    bitmap.pixels = (unsigned char*)malloc((size_t)bitmap.width * bitmap.height * 4);
    if (bitmap.pixels != NULL) {
      for (int row = 0; row < bitmap.height; ++row) {
        memcpy(bitmap.pixels + (size_t)row * bitmap.width * 4,
          (unsigned char*)locked.pBits + (size_t)row * locked.Pitch, (size_t)bitmap.width * 4);
      }
      for (size_t pixel = 0; pixel < (size_t)bitmap.width * bitmap.height; ++pixel) bitmap.pixels[pixel * 4 + 3] = 255;
      /* Sequence zero is reserved for frame evidence; toast sequences start at one. */
      overlay_bitmap_capture(&bitmap, directory, 0);
      free(bitmap.pixels);
      captured = 1;
    }
    surface->UnlockRect();
  }
  surface->Release(); target->Release();
  return captured;
}

int overlay_draw9_viewport(void* devicePointer, int* width, int* height)
{
  if (devicePointer == NULL || width == NULL || height == NULL) return 0;

  D3DVIEWPORT9 viewport;
  ZeroMemory(&viewport, sizeof(viewport));
  IDirect3DDevice9* device = (IDirect3DDevice9*)devicePointer;
  if (FAILED(device->GetViewport(&viewport))) return 0;
  if (viewport.Width == 0 || viewport.Height == 0) return 0;

  *width = (int)viewport.Width;
  *height = (int)viewport.Height;
  return 1;
}

/** Uploads the composed card, creating the texture the first time and on any size change. */
static int upload_texture(IDirect3DDevice9* device, const OverlayBitmap* bitmap)
{
  if (g_texture == NULL || g_textureWidth != bitmap->width || g_textureHeight != bitmap->height)
  {
    overlay_draw9_reset();

    /*
     * `D3DPOOL_MANAGED` rather than a dynamic default-pool texture: managed textures survive device
     * loss without this file having to track reset events, and the toast is uploaded once per unlock
     * rather than per frame, so the copy cost is irrelevant.
     */
    HRESULT created = device->CreateTexture((UINT)bitmap->width, (UINT)bitmap->height, 1, 0,
                                            D3DFMT_A8R8G8B8, D3DPOOL_MANAGED, &g_texture, NULL);
    if (FAILED(created) || g_texture == NULL)
    {
      overlay_log("could not create the toast texture (hr=0x%08lX)", (unsigned long)created);
      g_texture = NULL;
      return 0;
    }
    g_textureWidth = bitmap->width;
    g_textureHeight = bitmap->height;
  }

  D3DLOCKED_RECT locked;
  ZeroMemory(&locked, sizeof(locked));
  if (FAILED(g_texture->LockRect(0, &locked, NULL, 0)))
  {
    overlay_log("could not lock the toast texture");
    return 0;
  }

  for (int row = 0; row < bitmap->height; row++)
  {
    memcpy((unsigned char*)locked.pBits + (size_t)row * locked.Pitch,
           bitmap->pixels + (size_t)row * (size_t)bitmap->width * 4u,
           (size_t)bitmap->width * 4u);
  }
  g_texture->UnlockRect(0);
  return 1;
}

int overlay_draw9(void* devicePointer, const OverlayBitmap* bitmap, int x, int y, float alpha)
{
  if (devicePointer == NULL || bitmap == NULL || bitmap->pixels == NULL) return 0;
  if (alpha <= 0.0f) return 0;

  IDirect3DDevice9* device = (IDirect3DDevice9*)devicePointer;
  if (!upload_texture(device, bitmap)) return 0;

  /* ---- re-acquire the back buffer --------------------------------------------------- */
  /*
   * MANDATORY, and it is the trap that costs an afternoon: after `Present`, Direct3D 9 leaves the
   * device with no render target bound, so a draw issued from inside a Present hook fails with
   * `D3DERR_INVALIDCALL` (0x8876086C) every single frame - which looks exactly like a hook that
   * never fired, and is why that HRESULT is logged rather than swallowed.
   *
   * The previous binding is saved and put back afterwards, like every other piece of state here.
   */
  IDirect3DSurface9* savedTarget = NULL;
  LOG_IF_FAILED(device->GetRenderTarget(0, &savedTarget), "GetRenderTarget");

  IDirect3DSurface9* backBuffer = NULL;
  HRESULT gotBackBuffer = device->GetBackBuffer(0, 0, D3DBACKBUFFER_TYPE_MONO, &backBuffer);
  LOG_IF_FAILED(gotBackBuffer, "GetBackBuffer");
  if (SUCCEEDED(gotBackBuffer) && backBuffer != NULL)
  {
    LOG_IF_FAILED(device->SetRenderTarget(0, backBuffer), "SetRenderTarget(backBuffer)");
  }

  /* ---- save ------------------------------------------------------------------------- */
  DWORD savedStates[SAVED_STATE_COUNT];
  for (size_t index = 0; index < SAVED_STATE_COUNT; index++)
  {
    savedStates[index] = 0;
    device->GetRenderState(kSavedStates[index], &savedStates[index]);
  }

  DWORD savedStage[SAVED_STAGE_COUNT];
  for (size_t index = 0; index < SAVED_STAGE_COUNT; index++)
  {
    savedStage[index] = 0;
    device->GetTextureStageState(0, kSavedStageStates[index], &savedStage[index]);
  }

  DWORD savedFvf = 0;
  device->GetFVF(&savedFvf);

  IDirect3DVertexBuffer9* savedStream = NULL;
  UINT savedOffset = 0, savedStride = 0;
  device->GetStreamSource(0, &savedStream, &savedOffset, &savedStride);

  IDirect3DBaseTexture9* savedTexture = NULL;
  device->GetTexture(0, &savedTexture);

  IDirect3DVertexShader9* savedVertexShader = NULL;
  device->GetVertexShader(&savedVertexShader);
  IDirect3DPixelShader9* savedPixelShader = NULL;
  device->GetPixelShader(&savedPixelShader);

  /* ---- draw ------------------------------------------------------------------------- */
  /*
   * Premultiplied blending, to match the composed bitmap: GDI+ produces premultiplied ARGB, so the
   * source factor is ONE and only the destination is scaled by the inverse alpha. Using
   * SRCALPHA/INVSRCALPHA here would multiply the colour by its own alpha a second time and darken
   * every translucent pixel — the halo around text that this pairing exists to avoid.
   */
  device->SetVertexShader(NULL);
  device->SetPixelShader(NULL);
  LOG_IF_FAILED(device->SetFVF(TOAST_FVF), "SetFVF");
  LOG_IF_FAILED(device->SetTexture(0, g_texture), "SetTexture");

  device->SetRenderState(D3DRS_ALPHABLENDENABLE, TRUE);
  LOG_IF_FAILED(device->SetRenderState(D3DRS_SRCBLEND, D3DBLEND_ONE), "SetRenderState(SRCBLEND)");
  LOG_IF_FAILED(device->SetRenderState(D3DRS_DESTBLEND, D3DBLEND_INVSRCALPHA), "SetRenderState(DESTBLEND)");
  device->SetRenderState(D3DRS_ZENABLE, FALSE);
  device->SetRenderState(D3DRS_ZWRITEENABLE, FALSE);
  device->SetRenderState(D3DRS_CULLMODE, D3DCULL_NONE);
  device->SetRenderState(D3DRS_LIGHTING, FALSE);
  device->SetRenderState(D3DRS_FOGENABLE, FALSE);
  device->SetRenderState(D3DRS_ALPHATESTENABLE, FALSE);
  device->SetRenderState(D3DRS_SCISSORTESTENABLE, FALSE);
  device->SetRenderState(D3DRS_STENCILENABLE, FALSE);
  device->SetRenderState(D3DRS_CLIPPING, FALSE);

  device->SetTextureStageState(0, D3DTSS_COLOROP, D3DTOP_MODULATE);
  LOG_IF_FAILED(device->SetTextureStageState(0, D3DTSS_COLORARG1, D3DTA_TEXTURE), "TSS(COLORARG1)");
  device->SetTextureStageState(0, D3DTSS_COLORARG2, D3DTA_DIFFUSE);
  device->SetTextureStageState(0, D3DTSS_ALPHAOP, D3DTOP_MODULATE);
  device->SetTextureStageState(0, D3DTSS_ALPHAARG1, D3DTA_TEXTURE);
  device->SetTextureStageState(0, D3DTSS_ALPHAARG2, D3DTA_DIFFUSE);

  /*
   * The fade, as the vertex colour. With a premultiplied source, a diffuse of (a, a, a, a) scales
   * both the colour and its alpha, which is exactly a fade — and it costs nothing per frame, where
   * re-composing the card would cost a GDI+ pass.
   */
  const BYTE level = (BYTE)(alpha * 255.0f + 0.5f);
  const D3DCOLOR colour = D3DCOLOR_ARGB(level, level, level, level);

  const float left = (float)x;
  const float top = (float)y;
  const float right = left + (float)bitmap->width;
  const float bottom = top + (float)bitmap->height;

  ToastVertex vertices[4] = {
      {left, top, 0.0f, 1.0f, colour, 0.0f, 0.0f},
      {right, top, 0.0f, 1.0f, colour, 1.0f, 0.0f},
      {left, bottom, 0.0f, 1.0f, colour, 0.0f, 1.0f},
      {right, bottom, 0.0f, 1.0f, colour, 1.0f, 1.0f},
  };

  /*
   * `DrawPrimitiveUP` rather than a vertex buffer: it leaves the stream source alone apart from the
   * transient set it makes internally, which is restored below from what was saved, and it removes
   * an allocation from a path that runs inside the game's frame.
   */
  /*
   * OUR OWN SCENE, and it is the second thing this file learned the hard way.
   *
   * A `Present` hook runs after the game has ended its scene - `EndScene` then `Present` is the
   * standard order - and Direct3D refuses a draw issued outside a scene even when every state call
   * around it succeeded: `DrawPrimitiveUP` came back `D3DERR_INVALIDCALL` (0x8876086C) on every frame,
   * with `SetFVF`, `SetTexture`, the blend and the stage states all reporting success and the back
   * buffer re-acquired. Opening a scene of our own is what makes the draw legal.
   *
   * If the game left a scene open, `BeginScene` fails and the draw still happens - the state is
   * already correct in that case, and failing the frame over it would be worse.
   */
  HRESULT beganScene = device->BeginScene();

  HRESULT drawn = device->DrawPrimitiveUP(D3DPT_TRIANGLESTRIP, 2, vertices, sizeof(ToastVertex));

  if (SUCCEEDED(beganScene)) device->EndScene();

  if (FAILED(drawn))
  {
    /* Logged rather than swallowed: a silently failing draw is indistinguishable from a hook that
       never fired, and the two need very different fixes. */
    overlay_log("DrawPrimitiveUP failed (hr=0x%08lX, %dx%d at %d,%d)",
                (unsigned long)drawn, bitmap->width, bitmap->height, x, y);
  }

  /* ---- restore ---------------------------------------------------------------------- */
  device->SetRenderTarget(0, savedTarget);
  if (savedTarget != NULL) savedTarget->Release();
  if (backBuffer != NULL) backBuffer->Release();

  device->SetStreamSource(0, savedStream, savedOffset, savedStride);
  if (savedStream != NULL) savedStream->Release();
  device->SetTexture(0, savedTexture);
  if (savedTexture != NULL) savedTexture->Release();
  device->SetVertexShader(savedVertexShader);
  if (savedVertexShader != NULL) savedVertexShader->Release();
  device->SetPixelShader(savedPixelShader);
  if (savedPixelShader != NULL) savedPixelShader->Release();
  device->SetFVF(savedFvf);

  for (size_t index = 0; index < SAVED_STAGE_COUNT; index++)
  {
    device->SetTextureStageState(0, kSavedStageStates[index], savedStage[index]);
  }
  for (size_t index = 0; index < SAVED_STATE_COUNT; index++)
  {
    device->SetRenderState(kSavedStates[index], savedStates[index]);
  }

  return SUCCEEDED(drawn) ? 1 : 0;
}
