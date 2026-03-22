cmake_minimum_required(VERSION 3.16)
project(REClassicCollection C CXX)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# --- Dependencies -----------------------------------------------------------
find_package(SDL2 CONFIG REQUIRED)
find_package(OpenGL REQUIRED)

# --- Vendored headers (stb, glad, nlohmann) ---------------------------------
set(EXTERN_DIR ${CMAKE_SOURCE_DIR}/extern)

add_library(glad STATIC ${EXTERN_DIR}/glad/src/glad.c)
target_include_directories(glad PUBLIC ${EXTERN_DIR}/glad/include)

# --- Source files ------------------------------------------------------------
set(RE_SOURCES
    src/main.cpp

    # core
    src/core/app.cpp
    src/core/platform.cpp
    src/core/log.cpp

    # renderer
    src/renderer/renderer.cpp
    src/renderer/shader.cpp
    src/renderer/texture.cpp
    src/renderer/render_target.cpp
    src/renderer/crt_filter.cpp

    # input
    src/input/input_manager.cpp

    # audio
    src/audio/audio_system.cpp

    # config
    src/config/config.cpp
    src/config/paths.cpp

    # ui
    src/ui/ui_system.cpp
    src/ui/ui_element.cpp
    src/ui/font.cpp
    src/ui/screens/screen_title.cpp
    src/ui/screens/screen_version.cpp
    src/ui/screens/screen_launch.cpp
    src/ui/screens/screen_install.cpp
    src/ui/screens/screen_error.cpp
    src/ui/components/game_card.cpp
    src/ui/components/version_row.cpp
    src/ui/components/sidebar_title.cpp
    src/ui/components/input_hints.cpp
    src/ui/components/achievement_hud.cpp

    # games
    src/games/game_catalog.cpp
    src/games/game_launcher.cpp
    src/games/mod_loader.cpp

    # install
    src/install/gog_detector.cpp
    src/install/install_validator.cpp

    # achievements
    src/achievements/achievement_db.cpp
    src/achievements/achievement_hook.cpp
    src/achievements/achievement_overlay.cpp
)

add_executable(re-launcher ${RE_SOURCES})

target_include_directories(re-launcher PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${EXTERN_DIR}/glad/include
    ${EXTERN_DIR}/stb
    ${EXTERN_DIR}/nlohmann
)

target_link_libraries(re-launcher PRIVATE
    SDL2::SDL2
    SDL2::SDL2main
    OpenGL::GL
    glad
)

if(WIN32)
    target_link_libraries(re-launcher PRIVATE advapi32 shell32 shlwapi)
    target_compile_definitions(re-launcher PRIVATE
        _CRT_SECURE_NO_WARNINGS
        NOMINMAX
        WIN32_LEAN_AND_MEAN
    )
endif()

# --- Copy assets, media, and mods to build directory -------------------------
add_custom_command(TARGET re-launcher POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${CMAKE_SOURCE_DIR}/assets $<TARGET_FILE_DIR:re-launcher>/assets
    COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${CMAKE_SOURCE_DIR}/media $<TARGET_FILE_DIR:re-launcher>/media
    COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${CMAKE_SOURCE_DIR}/reenhancemods $<TARGET_FILE_DIR:re-launcher>/reenhancemods
)
