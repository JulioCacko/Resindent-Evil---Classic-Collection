# The hermetic test host for the overlay plugin.
#
# A 32-bit console EXE that loads the plugin with `LoadLibrary` and gives a client time to talk
# to it, so the plugin's pipe, handshake and toast slot can be tested without launching a game —
# the difference between a test that runs in a second and one that costs a game launch, a loader
# dialog and a taskkill. Phase 2 extends it with a D3D9 device and a D3D11 swapchain.
#
# Built by:
#   node tools/build-native.mjs --project native/testhost \
#     --out native/testhost/overlay-testhost.exe --ext .exe

cmake_minimum_required(VERSION 3.20)

project(re_overlay_testhost LANGUAGES CXX)

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
  message(FATAL_ERROR
    "the test host must be 32-bit, because the plugin it loads is: the ASI loader inside the "
    "games is x86. CMAKE_SIZEOF_VOID_P=${CMAKE_SIZEOF_VOID_P}")
endif()

string(REPLACE "/EHsc" "" CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS}")

add_executable(overlay_testhost testhost.cpp device.cpp)

set_target_properties(overlay_testhost PROPERTIES
  MSVC_RUNTIME_LIBRARY "MultiThreaded"
  # A console app, so its `testhost ...` lines are readable directly by whoever runs it.
  WIN32_EXECUTABLE FALSE
)

target_compile_options(overlay_testhost PRIVATE /W4 /O2 /EHs-c- /GR- /GS)

# The two APIs the overlay hooks, so the host can create a real device of each: d3d9 for RE2 and
# RE3 (measured in docs/ARCHITECTURE.md §12.2) and D3D11/DXGI for RE1's dgVoodoo chain. The PLUGIN
# does not link these: it loads them at runtime, so a game that presents through only one of them
# never has the other forced into its process.
target_link_libraries(overlay_testhost PRIVATE user32 d3d9 dxgi d3d11)
