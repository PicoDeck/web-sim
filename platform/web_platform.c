// Web (Emscripten) platform glue.
//
// The desktop simulator runs Core 1 on a pthread and lets the OS block freely
// (launcher_run() never returns; apps spin in their own loops). A browser tab
// has one thread and freezes unless code returns to the event loop, so here:
//
//   * Core 1's 5 ms service loop becomes web_core1_tick(), which runs the
//     core's sim_core1_service() cooperatively.
//   * Every place the OS already waits (hal_sleep_*, display present, the Lua
//     watchdog hook, kbd_poll) calls web_yield*(), which uses ASYNCIFY's
//     emscripten_sleep() to unwind to the browser and resume afterwards.
//
// No core OS file needs to know about any of this.

#include <emscripten.h>
#include <stdbool.h>
#include <stdint.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

// PicoDeck's side of the seam: hal/web_platform.h states the contract (what
// this file must define, and the core functions it may call).
#include "hal/web_platform.h"
#include "hal/hal_display.h"     // hal_display_get_framebuffer
#include "hal/hal_input.h"       // hal_input_inject_char
#include "dev_ops.h"             // dev_op_exit (test hook)
#include "sim_test_control.h"    // sim_launch_request (test hook)
#include "web_internal.h"        // web_sd_root
// The desktop-only hooks this file defines:
#include "sim_socket.h"          // sim_socket_notify*
#include "sim_socket_handler.h"  // sim_*_active_terminal

// Longest the OS may run without handing the tab back to the browser. Longer
// than a frame so apps that flush every frame are paced by present, not this.
#define WEB_MAX_BUSY_MS 20
#define WEB_CORE1_PERIOD_MS 5

static double s_last_yield_ms;
static double s_last_core1_ms;
static bool s_in_core1;

void web_core1_tick(void) {
    double now = emscripten_get_now();
    if (s_in_core1 || now - s_last_core1_ms < WEB_CORE1_PERIOD_MS) return;
    s_in_core1 = true;
    s_last_core1_ms = now;
    sim_core1_service();
    s_in_core1 = false;
}

void web_yield(uint32_t ms) {
    web_core1_tick();
    emscripten_sleep(ms);
    s_last_yield_ms = emscripten_get_now();
    web_core1_tick();
}

void web_yield_if_due(void) {
    web_core1_tick();
    if (emscripten_get_now() - s_last_yield_ms >= WEB_MAX_BUSY_MS) web_yield(0);
}

// ── Persistent saves ─────────────────────────────────────────────────────────
// /sd/data (per-app config + game saves) lives in IndexedDB via IDBFS; the rest
// of the SD image is the read-only preload. Loaded before the SD card mounts,
// written back every 2 s and whenever the page is hidden. If IndexedDB is
// unavailable (some private windows) saves just stay in memory for the session.
EM_ASYNC_JS(void, web_fs_init_js, (const char *dir_c), {
  var dir = UTF8ToString(dir_c);
  var syncing = false;
  // Resolves true on a clean sync, false on a failed one (logged once here).
  function sync(populate) {
    return new Promise(function (resolve) {
      if (syncing) return resolve(true);
      syncing = true;
      FS.syncfs(populate, function (err) {
        syncing = false;
        if (err) console.warn('[WEB] save sync failed:', err);
        resolve(!err);
      });
    });
  }
  try {
    FS.mkdirTree(dir);
    FS.mount(IDBFS, {}, dir);
  } catch (e) {
    console.warn('[WEB] persistent saves unavailable:', e);
    return;
  }
  // No usable IndexedDB (some private windows, or a stubbed-out API): the
  // first sync already warned once, and nothing here would ever succeed, so
  // don't poll it every 2 s for the rest of the session.
  if (!(await sync(true))) return;
  setInterval(function () { sync(false); }, 2000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sync(false);
  });
  window.addEventListener('pagehide', function () { sync(false); });
});

static char s_sd_root[256];
const char *web_sd_root(void) { return s_sd_root; }

void web_fs_init(const char *sd_root) {
    snprintf(s_sd_root, sizeof(s_sd_root), "%s", sd_root);
    char dir[512];
    snprintf(dir, sizeof(dir), "%s/data", sd_root);
    web_fs_init_js(dir);
    printf("[WEB] Saves persisted in browser storage: %s\n", dir);
    // A native app's own C library calls (fopen and friends) see the browser's
    // filesystem, not PicoDeck's SD layer: link the SD's top directories at
    // the paths they have on the device.
    static const char *const k_dirs[] = { "apps", "data", "system" };
    for (size_t i = 0; i < sizeof(k_dirs) / sizeof(k_dirs[0]); i++) {
        char target[512], link[16];
        snprintf(target, sizeof(target), "%s/%s", sd_root, k_dirs[i]);
        snprintf(link, sizeof(link), "/%s", k_dirs[i]);
        if (symlink(target, link) != 0)
            printf("[WEB] %s -> %s: %s\n", link, target, strerror(errno));
    }
}

// ── Soft-keyboard text ───────────────────────────────────────────────────────
// SDL derives characters from the unshifted US key (Shift+= arrives as '='), so
// the page's phone-keyboard path types exact ASCII straight into the char queue.
EMSCRIPTEN_KEEPALIVE void web_type_char(int c) {
    if (c >= 32 && c < 127) hal_input_inject_char((char)c);
}

// ── sim_socket_handler.c hooks (no RPC socket in the browser) ────────────────
// sim_handler_check_launch and sim_log_append come from sim_test_control.c,
// which the web build compiles (it has no socket code of its own).

// sim_socket.c is not built: sim_test_control.c's notifications go nowhere.
void sim_socket_notify(const char *method, const char *params_json) {
    (void)method; (void)params_json;
}
void sim_socket_notify_log_subscribers(const char *json_line, size_t len) {
    (void)json_line; (void)len;
}

static void *s_active_terminal;
void sim_set_active_terminal(void *term) { s_active_terminal = term; }
void *sim_get_active_terminal(void) { return s_active_terminal; }

// ── Test hooks (tests/web.spec.mjs) ──────────────────────────────────────────
// Queue an app launch, as ?app= does at boot; and ask the running app to
// exit, as the dev `exit` command does (a native app's shouldExit()).
EMSCRIPTEN_KEEPALIVE void web_launch(const char *name) { sim_launch_request(name, NULL); }
EMSCRIPTEN_KEEPALIVE void web_exit_app(void) {
    char reply[DEV_OP_REPLY_MAX];
    dev_op_exit(reply, sizeof(reply));
}

// ── The screen, for the browser tests ────────────────────────────────────────
// The 320x320 RGB565 frame the display last showed (what the canvas shows),
// read from Module.HEAPU16 by tests/web.spec.mjs: its launcher probe and the
// release's launcher.png.
EMSCRIPTEN_KEEPALIVE uint16_t *web_screen(void) { return hal_display_get_framebuffer(); }
