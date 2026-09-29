# The Phase 0 gate probe: a 32-bit ASI plugin that only measures.
#
# THROWAWAY — `native/_gate/` is deleted once the gate's questions are answered. The
# real plugin's build (`native/overlay/`) is what survives, and it reuses this file's
# shape: 32-bit, static CRT, no exceptions.
#
# 32 BIT IS NOT A PREFERENCE. The ASI loader in all three installs identifies itself as
# "Ultimate-ASI-Loader-x86" (ThirteenAG), and these are 1998 32-bit games, so a 64-bit
# plugin is never loaded and never reports anything — a silent total failure. The
# configure step below refuses, and `tools/build-native.mjs` checks the machine type of
# the artifact as well, because a wrong-bitness build is exactly the mistake that would
# be diagnosed as "the loader does not work".

cmake_minimum_required(VERSION 3.20)

project(re_overlay_gate LANGUAGES CXX)

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
  message(FATAL_ERROR
    "the gate plugin must be built 32-bit (the game's ASI loader is x86); "
    "configure with -A Win32. CMAKE_SIZEOF_VOID_P=${CMAKE_SIZEOF_VOID_P}")
endif()

add_library(re_overlay_gate SHARED gate.cpp)

# No `lib` prefix and an `.asi` suffix, because the loader looks for `*.asi` and the
# extension is the whole interface.
set_target_properties(re_overlay_gate PROPERTIES
  PREFIX ""
  SUFFIX ".asi"
  OUTPUT_NAME "re_overlay_gate"
  # Static CRT (/MT): the plugin lands in a game folder with no redistributable beside
  # it and must not depend on a VC runtime matching whatever the machine happens to have.
  MSVC_RUNTIME_LIBRARY "MultiThreaded"
)

target_compile_options(re_overlay_gate PRIVATE
  /W4          # warnings are worth reading in code that runs inside someone's game
  /O2
  /EHsc-       # no exceptions: an unwind through the loader lock is a hang
  /GR-         # no RTTI: nothing here needs it
  /GS          # keep the stack cookie
)

# Deliberately NO /DUNICODE: every Win32 call in the probe names its A or W form
# explicitly (`GetModuleFileNameA`, `CreateDirectoryA`, `GetClassNameA`), and the Toolhelp
# structs are selected by that macro — defining it here would silently switch
# `MODULEENTRY32` to its wide form and the module paths would not compile as char[].

# kernel32/user32 come from the default libraries; gdi32 and the Toolhelp snapshot are
# the only two things this probe asks of the system.
target_link_libraries(re_overlay_gate PRIVATE user32 gdi32)
