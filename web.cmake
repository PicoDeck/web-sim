# PicoDeck/web-sim's half of the simulator build. PicoDeck's
# simulator/CMakeLists.txt includes this file when it is compiled with
# Emscripten and PICODECK_WEB_DIR points at this repo (PicoDeck's
# simulator/CLAUDE.md, "Web build seam"). It sets the web platform and
# network-stub sources and defines picodeck_web_package(target), which builds
# the demo's SD image from apps.json and links the page.
if(CMAKE_VERSION VERSION_LESS 3.19)
    message(FATAL_ERROR "web-sim needs CMake 3.19 or newer (string(JSON))")
endif()

# Native apps run here as WebAssembly side modules that the page dlopens
# (platform/web_native.c), so the page is a main module: every object in it
# must be position-independent. This file is included before PicoDeck's
# simulator/CMakeLists.txt creates any target, so this reaches them all.
add_compile_options(-fPIC)

set(PICODECK_WEB_PLATFORM_SOURCES
    ${PICODECK_WEB_DIR}/platform/web_platform.c
    ${PICODECK_WEB_DIR}/platform/web_native.c)
set(PICODECK_WEB_NET_SOURCES ${PICODECK_WEB_DIR}/platform/web_net_stubs.c)

# Test builds add the browser tests' fixture apps here (absolute app dirs);
# releases leave it empty.
set(WEB_SIM_EXTRA_APPS "" CACHE STRING "Extra app directories to bundle (test builds)")

# Copies one app directory into the SD image, without repo clutter.
function(web_sim_copy_app src)
    if(NOT IS_DIRECTORY ${src})
        message(FATAL_ERROR "web-sim: app ${src} is not a directory")
    endif()
    file(COPY ${src} DESTINATION ${WEB_SD_DIR}/apps
         PATTERN ".git" EXCLUDE PATTERN ".github" EXCLUDE
         PATTERN "tests" EXCLUDE PATTERN "tools" EXCLUDE
         PATTERN "*.md" EXCLUDE)
endfunction()

function(picodeck_web_package target)
    set(WEB_SD_DIR ${CMAKE_BINARY_DIR}/web_sd)
    file(REMOVE_RECURSE ${WEB_SD_DIR})
    file(MAKE_DIRECTORY ${WEB_SD_DIR}/apps ${WEB_SD_DIR}/data)
    file(COPY ${PICODECK_ROOT}/system DESTINATION ${WEB_SD_DIR})
    # Re-run the configure step when the app list changes.
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${PICODECK_WEB_DIR}/apps.json)
    file(READ ${PICODECK_WEB_DIR}/apps.json apps_json)

    # Parse once up front: a syntax error would otherwise surface as a raw
    # CMake JSON error deep in whichever lookup hit it first.
    string(JSON root_type ERROR_VARIABLE json_err TYPE "${apps_json}")
    if(json_err)
        message(FATAL_ERROR "web-sim: apps.json: ${json_err}")
    endif()

    # "builtin": PicoDeck's own apps, by folder under apps/ in the checkout.
    string(JSON builtin_type ERROR_VARIABLE json_err TYPE "${apps_json}" builtin)
    if(json_err OR NOT builtin_type STREQUAL "ARRAY")
        message(FATAL_ERROR "web-sim: apps.json: \"builtin\" must be an array")
    endif()
    string(JSON n_builtin LENGTH "${apps_json}" builtin)
    if(n_builtin GREATER 0)
        math(EXPR last "${n_builtin} - 1")
        foreach(i RANGE ${last})
            string(JSON app GET "${apps_json}" builtin ${i})
            web_sim_copy_app(${PICODECK_ROOT}/apps/${app})
        endforeach()
    endif()

    # "store": release ZIPs pinned by SHA-256, downloaded at configure time
    # into web_downloads/ and reused while the hash still matches. A native
    # app's entry also pins its browser build ("wasm").
    string(JSON store_type ERROR_VARIABLE json_err TYPE "${apps_json}" store)
    if(json_err OR NOT store_type STREQUAL "ARRAY")
        message(FATAL_ERROR "web-sim: apps.json: \"store\" must be an array")
    endif()
    string(JSON n_store LENGTH "${apps_json}" store)
    if(n_store GREATER 0)
        math(EXPR last "${n_store} - 1")
        foreach(i RANGE ${last})
            string(JSON app_dir ERROR_VARIABLE json_err GET "${apps_json}" store ${i} dir)
            if(json_err)
                message(FATAL_ERROR "web-sim: apps.json: store[${i}] has no \"dir\"")
            endif()
            string(JSON app_url ERROR_VARIABLE json_err GET "${apps_json}" store ${i} url)
            if(json_err)
                message(FATAL_ERROR "web-sim: apps.json: store[${i}] (${app_dir}) has no \"url\"")
            endif()
            string(JSON app_sha ERROR_VARIABLE json_err GET "${apps_json}" store ${i} sha256)
            if(json_err)
                message(FATAL_ERROR "web-sim: apps.json: store[${i}] (${app_dir}) has no \"sha256\"")
            endif()
            set(app_zip ${CMAKE_BINARY_DIR}/web_downloads/${app_dir}.zip)
            set(have_sha "")
            if(EXISTS ${app_zip})
                file(SHA256 ${app_zip} have_sha)
            endif()
            if(NOT have_sha STREQUAL app_sha)
                file(DOWNLOAD ${app_url} ${app_zip} TLS_VERIFY ON
                     EXPECTED_HASH SHA256=${app_sha} STATUS dl_status)
                list(GET dl_status 0 dl_code)
                if(NOT dl_code EQUAL 0)
                    message(FATAL_ERROR "web-sim: store app ${app_dir}: ${app_url}: ${dl_status}")
                endif()
            endif()
            file(ARCHIVE_EXTRACT INPUT ${app_zip} DESTINATION ${WEB_SD_DIR}/apps/${app_dir})
            if(NOT EXISTS ${WEB_SD_DIR}/apps/${app_dir}/main.lua AND NOT EXISTS ${WEB_SD_DIR}/apps/${app_dir}/main.elf)
                message(FATAL_ERROR "web-sim: store app ${app_dir}: ${app_url} has no main.lua or main.elf at its root")
            endif()
            # A native app's browser build: "wasm": {"url", "sha256"}, its
            # release's main.wasm (platform/web_native.c), downloaded and
            # checked like the zip.
            string(JSON wasm_url ERROR_VARIABLE no_wasm GET "${apps_json}" store ${i} wasm url)
            if(NOT no_wasm)
                string(JSON wasm_sha ERROR_VARIABLE json_err GET "${apps_json}" store ${i} wasm sha256)
                if(json_err)
                    message(FATAL_ERROR "web-sim: apps.json: store[${i}] (${app_dir}) has a \"wasm\" with no \"sha256\"")
                endif()
                set(wasm_file ${CMAKE_BINARY_DIR}/web_downloads/${app_dir}.wasm)
                set(have_sha "")
                if(EXISTS ${wasm_file})
                    file(SHA256 ${wasm_file} have_sha)
                endif()
                if(NOT have_sha STREQUAL wasm_sha)
                    file(DOWNLOAD ${wasm_url} ${wasm_file} TLS_VERIFY ON
                         EXPECTED_HASH SHA256=${wasm_sha} STATUS dl_status)
                    list(GET dl_status 0 dl_code)
                    if(NOT dl_code EQUAL 0)
                        message(FATAL_ERROR "web-sim: store app ${app_dir}: ${wasm_url}: ${dl_status}")
                    endif()
                endif()
                configure_file(${wasm_file} ${WEB_SD_DIR}/apps/${app_dir}/main.wasm COPYONLY)
            endif()
        endforeach()
    endif()

    foreach(app ${WEB_SIM_EXTRA_APPS})
        web_sim_copy_app(${app})
    endforeach()

    # web_sd/ is rebuilt at every configure, but only the link packs it into
    # picodeck_simulator.data. The link depends on a stamp of its content
    # (each file's SHA-256 and path), which file(CONFIGURE) rewrites only when
    # that changes: a changed app relinks, an unchanged configure does not.
    file(GLOB_RECURSE sd_files LIST_DIRECTORIES false RELATIVE ${WEB_SD_DIR} ${WEB_SD_DIR}/*)
    list(SORT sd_files)
    set(WEB_SD_STAMP "")
    foreach(f ${sd_files})
        file(SHA256 ${WEB_SD_DIR}/${f} sd_sha)
        string(APPEND WEB_SD_STAMP "${sd_sha}  ${f}\n")
    endforeach()
    set(sd_stamp ${CMAKE_BINARY_DIR}/web_sd.stamp)
    file(CONFIGURE OUTPUT ${sd_stamp} CONTENT "@WEB_SD_STAMP@" @ONLY)

    # The page is a main module that exports only what is listed: every C
    # library function and data symbol the bundled native apps import (each
    # main.wasm's "env", "GOT.func" and "GOT.mem" imports), so a new app's
    # imports are picked up when it is bundled. (MAIN_MODULE=1, which exports
    # everything, links twice under ASYNCIFY and generates its JS from the
    # first link, before the dynCall_* thunks exist: every C callback the JS
    # libraries make, SDL's key events among them, becomes a no-op.)
    find_program(WEB_SIM_WASM_DIS wasm-dis
        HINTS $ENV{EMSDK}/upstream/bin $ENV{HOME}/emsdk/upstream/bin REQUIRED)
    file(GLOB native_wasms ${WEB_SD_DIR}/apps/*/main.wasm)
    set(native_imports "")
    foreach(w ${native_wasms})
        execute_process(COMMAND ${WEB_SIM_WASM_DIS} ${w}
            OUTPUT_VARIABLE dis ERROR_QUIET RESULT_VARIABLE dis_rc)
        if(NOT dis_rc EQUAL 0)
            continue()  # not a WebAssembly module: the runner reports it at launch
        endif()
        # A side module reaches its own globals through the GOT too (so they
        # could be overridden), and resolves those from its own exports: only
        # what it imports and does not export comes from the page.
        string(REGEX MATCHALL "\\(export \"[A-Za-z0-9_]+\"" own "${dis}")
        list(TRANSFORM own REPLACE ".*\"([A-Za-z0-9_]+)\"$" "\\1")
        string(REGEX MATCHALL "\\(import \"(env|GOT\\.func|GOT\\.mem)\" \"[A-Za-z0-9_]+\"" found "${dis}")
        foreach(f ${found})
            string(REGEX REPLACE ".*\"([A-Za-z0-9_]+)\"$" "\\1" name "${f}")
            if(NOT name IN_LIST own)
                list(APPEND native_imports _${name})
            endif()
        endforeach()
    endforeach()
    list(REMOVE_DUPLICATES native_imports)
    list(FILTER native_imports EXCLUDE REGEX
        "^_(memory|__indirect_function_table|__memory_base|__table_base|__stack_pointer|__asyncify_state|__asyncify_data|invoke_.*)$")
    list(JOIN native_imports "," native_exports)
    set(native_exports_comma "")
    if(native_exports)
        set(native_exports_comma ",${native_exports}")
    endif()
    message(STATUS "web-sim: the page exports, for native apps: ${native_exports}")

    set_target_properties(${target} PROPERTIES
        SUFFIX ".html"
        LINK_DEPENDS "${PICODECK_WEB_DIR}/page/shell.html;${sd_stamp}")
    # The page glue shell.html loads (and picodeck.net/try/ loads from the zip).
    configure_file(${PICODECK_WEB_DIR}/page/shell.js ${CMAKE_BINARY_DIR}/shell.js COPYONLY)
    target_link_options(${target} PRIVATE
        -O2
        -sMAIN_MODULE=2
        "-sEXPORTED_FUNCTIONS=_main,_web_screen,_web_launch,_web_exit_app,_web_type_char${native_exports_comma}"
        -sASYNCIFY
        -sASYNCIFY_STACK_SIZE=262144
        -sSTACK_SIZE=1048576
        -sALLOW_MEMORY_GROWTH
        -sINITIAL_MEMORY=64MB
        -sEXIT_RUNTIME=0
        -lidbfs.js
        -sEXPORTED_RUNTIME_METHODS=FS,HEAPU16,ccall
        --preload-file ${WEB_SD_DIR}@/sd
        --shell-file ${PICODECK_WEB_DIR}/page/shell.html
    )
endfunction()
