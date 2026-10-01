# PicoDeck/web-sim's half of the simulator build. PicoDeck's
# simulator/CMakeLists.txt includes this file when it is compiled with
# Emscripten and PICODECK_WEB_DIR points at this repo (PicoDeck's
# simulator/CLAUDE.md, "Web build seam"). It sets the web platform and
# network-stub sources and defines picodeck_web_package(target), which builds
# the demo's SD image from apps.json and links the page.
if(CMAKE_VERSION VERSION_LESS 3.19)
    message(FATAL_ERROR "web-sim needs CMake 3.19 or newer (string(JSON))")
endif()

set(PICODECK_WEB_PLATFORM_SOURCES ${PICODECK_WEB_DIR}/platform/web_platform.c)
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

    # "builtin": PicoDeck's own apps, by folder under apps/ in the checkout.
    string(JSON n_builtin LENGTH "${apps_json}" builtin)
    if(n_builtin GREATER 0)
        math(EXPR last "${n_builtin} - 1")
        foreach(i RANGE ${last})
            string(JSON app GET "${apps_json}" builtin ${i})
            web_sim_copy_app(${PICODECK_ROOT}/apps/${app})
        endforeach()
    endif()

    # "store": release ZIPs pinned by SHA-256, downloaded at configure time
    # into web_downloads/ and reused while the hash still matches.
    string(JSON n_store LENGTH "${apps_json}" store)
    if(n_store GREATER 0)
        math(EXPR last "${n_store} - 1")
        foreach(i RANGE ${last})
            string(JSON app_dir GET "${apps_json}" store ${i} dir)
            string(JSON app_url GET "${apps_json}" store ${i} url)
            string(JSON app_sha GET "${apps_json}" store ${i} sha256)
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
            if(NOT EXISTS ${WEB_SD_DIR}/apps/${app_dir}/main.lua)
                message(FATAL_ERROR "web-sim: store app ${app_dir}: ${app_url} has no main.lua at its root")
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

    set_target_properties(${target} PROPERTIES
        SUFFIX ".html"
        LINK_DEPENDS "${PICODECK_WEB_DIR}/page/shell.html;${sd_stamp}")
    # The page glue shell.html loads (and picodeck.net/try/ loads from the zip).
    configure_file(${PICODECK_WEB_DIR}/page/shell.js ${CMAKE_BINARY_DIR}/shell.js COPYONLY)
    target_link_options(${target} PRIVATE
        -O2
        -sASYNCIFY
        -sASYNCIFY_STACK_SIZE=262144
        -sSTACK_SIZE=1048576
        -sALLOW_MEMORY_GROWTH
        -sINITIAL_MEMORY=64MB
        -sEXIT_RUNTIME=0
        -lidbfs.js
        -sEXPORTED_RUNTIME_METHODS=FS,HEAPU16
        --preload-file ${WEB_SD_DIR}@/sd
        --shell-file ${PICODECK_WEB_DIR}/page/shell.html
    )
endfunction()
