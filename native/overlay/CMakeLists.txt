# The in-game overlay plugin: a 32-bit ASI plugin that the game's existing loader loads.
#
# Shipped to `resources/re_classic_overlay.asi` by `node tools/build-native.mjs --project
# native/overlay --out resources/re_classic_overlay.asi` (run by `pnpm build:overlay`).
#
# The 32-bit requirement is the same one the Phase 0 gate established and is NOT a preference:
# the loader in every install is `Ultimate-ASI-Loader-x86`, so a 64-bit plugin is never loaded
# and never reports why. `tools/build-native.mjs` also checks the finished artifact's machine
# type, because a wrong-bitness build is diagnosed as "the loader does not work".

cmake_minimum_required(VERSION 3.20)

project(re_classic_overlay LANGUAGES CXX)

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
  message(FATAL_ERROR
    "the overlay plugin must be built 32-bit (the game's ASI loader is x86); "
    "configure with -A Win32. CMAKE_SIZEOF_VOID_P=${CMAKE_SIZEOF_VOID_P}")
endif()

# CMake's MSVC default is /EHsc; this plugin has no exceptions at all, and leaving the default in
# place only produces an "overriding '/EHc'" warning on every build.
string(REPLACE "/EHsc" "" CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS}")

add_library(re_classic_overlay SHARED
  dllmain.cpp
  draw9.cpp
  hook.cpp
  pipe.cpp
  toast-render.cpp
  toast.cpp
)

set_target_properties(re_classic_overlay PROPERTIES
  PREFIX ""
  SUFFIX ".asi"
  OUTPUT_NAME "re_classic_overlay"
  # Static CRT (/MT): the plugin sits in a game folder with no redistributable beside it, and a
  # /MD build would load on this machine and fail on a clean one.
  MSVC_RUNTIME_LIBRARY "MultiThreaded"
)

target_compile_options(re_classic_overlay PRIVATE
  /W4
  /O2
  /EHs-c-      # no exceptions: unwinding through a game's frame is not survivable
  /GR-
  /GS          # the stack cookie matters more, not less, in someone else's process
)

# user32 for the window work, gdiplus for the toast's composition.
#
# NOTABLY ABSENT: d3d9, d3d11 and dxgi. `hook.cpp` reaches Direct3D through `GetProcAddress` and the
# vtable it patches, and `draw9.cpp` calls the device through the interface pointer it was handed -
# a virtual call, not an import - so a game whose chain is DXGI-only never has d3d9.dll forced into
# its process by this plugin, and the built artifact still imports nothing but system DLLs.
target_link_libraries(re_classic_overlay PRIVATE user32 gdiplus)
