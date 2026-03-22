#ifndef RE_TYPES_H
#define RE_TYPES_H

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>
#include <memory>
#include <functional>

typedef unsigned char  byte;
typedef unsigned short word;
typedef unsigned int   uint;
typedef uint32_t       rcolor;

#define RGBA(r,g,b,a) ((rcolor)((((a)&0xff)<<24)|(((b)&0xff)<<16)|(((g)&0xff)<<8)|((r)&0xff)))
#define RGBA_R(c) ((c) & 0xff)
#define RGBA_G(c) (((c) >> 8) & 0xff)
#define RGBA_B(c) (((c) >> 16) & 0xff)
#define RGBA_A(c) (((c) >> 24) & 0xff)

#define COLOR_WHITE   RGBA(0xFF, 0xFF, 0xFF, 0xFF)
#define COLOR_BLACK   RGBA(0x00, 0x00, 0x00, 0xFF)
#define COLOR_RED     RGBA(0xFF, 0x00, 0x00, 0xFF)
#define COLOR_GREEN   RGBA(0x00, 0xFF, 0x00, 0xFF)
#define COLOR_YELLOW  RGBA(0xFF, 0xFF, 0x00, 0xFF)
#define COLOR_GREY    RGBA(0x99, 0x99, 0x99, 0xFF)

#define COLOR_BG          RGBA(0x0F, 0x0F, 0x0F, 0xFF)
#define COLOR_CARD_BORDER RGBA(0x4D, 0x4D, 0x4D, 0xFF)
#define COLOR_HINT_TEXT   RGBA(0x99, 0x99, 0x99, 0xFF)
#define COLOR_KEY_BG      RGBA(0x2A, 0x2A, 0x2A, 0xFF)
#define COLOR_DIM_OVERLAY RGBA(0x0F, 0x0F, 0x0F, 0x99)
#define COLOR_RE_RED      RGBA(0xFE, 0x00, 0x00, 0xFF)
#define COLOR_CCC         RGBA(0xCC, 0xCC, 0xCC, 0xFF)

#define ARRLEN(a) (sizeof(a) / sizeof(*(a)))

#if defined(_WIN32) || defined(WIN32)
  #define RE_PLATFORM_WIN32
#elif defined(__linux__)
  #define RE_PLATFORM_LINUX
#elif defined(__APPLE__)
  #define RE_PLATFORM_MACOS
#endif

static const int DESIGN_WIDTH  = 1920;
static const int DESIGN_HEIGHT = 1080;

enum class InstallState
{
    INSTALLED,
    PARTIAL,
    MISSING
};

#endif
