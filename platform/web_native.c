// Native apps in the browser. Unicorn (the desktop simulator's ARM emulator)
// is a JIT and cannot run in WebAssembly, so a native app runs here only if
// it ships a browser build of itself: main.wasm, a WebAssembly side module
// (emcc -sSIDE_MODULE=2 -sASYNCIFY) next to its main.elf. This loads it and
// calls its picodeck_main with PicoDeck's g_api, whose host tables live in
// PicoDeck's simulator/sim_native_api.c. The launcher (PicoDeck's
// native_loader.c) does the teardown afterwards, as for any native app.

#include <dlfcn.h>
#include <emscripten.h>
#include <emscripten/heap.h>
#include <stdbool.h>
#include <stdio.h>
#include <unistd.h>

#include "app_abi.h"          // picodeck_app_entry_t
#include "hal/web_platform.h" // web_yield
#include "os.h"               // g_api
#include "sim_native_api.h"   // sim_native_app_begin / _end
#include "unicorn_runner.h"   // unicorn_run_app: the core's native-app hook
#include "web_internal.h"     // web_sd_root

static unsigned s_loads;

// emscripten_dlopen's outcome. Plain dlopen() is asynchronous under ASYNCIFY
// and, in Emscripten 6.0.10, lets a load error (not a module, a missing
// import) escape as a rejected promise, so the app's stack is never resumed;
// emscripten_dlopen reports it to its error callback instead.
static volatile int s_dl_state;  // 0 loading, 1 loaded, -1 failed
static void *s_dl_lib;

static void dl_loaded(void *user, void *lib) { (void)user; s_dl_lib = lib; s_dl_state = 1; }
static void dl_failed(void *user) { (void)user; s_dl_state = -1; }

static void *load_side_module(const char *path) {
    s_dl_state = 0;
    s_dl_lib = NULL;
    emscripten_dlopen(path, RTLD_NOW | RTLD_LOCAL, NULL, dl_loaded, dl_failed);
    while (s_dl_state == 0) web_yield(1);
    return s_dl_state == 1 ? s_dl_lib : NULL;
}

static bool copy_file(const char *src, const char *dst) {
    FILE *in = fopen(src, "rb");
    if (!in) return false;
    FILE *out = fopen(dst, "wb");
    if (!out) { fclose(in); return false; }
    char buf[65536];
    size_t n;
    bool ok = true;
    while ((n = fread(buf, 1, sizeof(buf), in)) > 0)
        if (fwrite(buf, 1, n, out) != n) { ok = false; break; }
    fclose(in);
    if (fclose(out) != 0) ok = false;
    return ok;
}

bool unicorn_run_app(const char *elf_path, const char *app_dir,
                     const char *app_id, const char *app_name) {
    (void)elf_path;
    char wasm[512], dir[512];
    snprintf(dir, sizeof(dir), "%s%s", web_sd_root(), app_dir);
    snprintf(wasm, sizeof(wasm), "%s/main.wasm", dir);
    if (access(wasm, R_OK) != 0) {
        printf("[WEB] %s has no browser build (main.wasm): not supported in the web demo\n",
               app_name);
        return false;
    }
    // dlopen keeps a module by its name and never unloads it, and only a new
    // instance starts with fresh globals: load a copy under a new name each
    // launch. The old instance's memory is not reclaimed (a few MB per launch).
    char copy[64];
    snprintf(copy, sizeof(copy), "/tmp/native-%u.wasm", ++s_loads);
    if (!copy_file(wasm, copy)) {
        printf("[WEB] %s: could not stage main.wasm\n", app_name);
        return false;
    }
    void *lib = load_side_module(copy);
    if (!lib) {
        const char *why = dlerror();
        printf("[WEB] %s: main.wasm failed to load: %s\n", app_name, why ? why : "unknown error");
        unlink(copy);
        return false;
    }
    picodeck_app_entry_t entry = (picodeck_app_entry_t)dlsym(lib, "picodeck_main");
    if (!entry) {
        printf("[WEB] %s: main.wasm failed to load: no picodeck_main\n", app_name);
        dlclose(lib);
        unlink(copy);
        return false;
    }
    // Relative paths resolve in the app's directory, where the device's
    // newlib stubs put them; absolute ones go through the /apps, /data and
    // /system links (web_platform.c).
    if (chdir(dir) != 0) printf("[WEB] %s: chdir %s failed\n", app_name, dir);
    sim_native_app_begin();
    entry(&g_api, app_dir, app_id, app_name);
    sim_native_app_end();
    if (chdir("/") != 0) printf("[WEB] chdir / failed\n");
    dlclose(lib);
    unlink(copy);
    printf("[WEB] %s returned (memory now %u MB)\n", app_name,
           (unsigned)(emscripten_get_heap_size() >> 20));
    return true;
}
