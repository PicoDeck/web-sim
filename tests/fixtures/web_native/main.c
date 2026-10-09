// Browser-test fixture, bundled only in test builds (make test): a native app
// built to main.wasm (the Makefile's emcc rule, a side module) and run by
// platform/web_native.c. It records what it saw in /data/net.picodeck.webnative,
// which tests/web.spec.mjs reads: launches (fs read + write), runs (its own
// global, 1 on a fresh instance), the longjmp exit path, the audio callback,
// and C-library file opens by absolute and relative path. It keeps its audio
// callback registered until it returns. Esc or the exit request ends it.
#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "app_abi.h"
#include "os.h"

#define DATA "/data/net.picodeck.webnative"

static const PicoCalcAPI *s_api;
static int s_runs;
static volatile int s_audio_ticks;
static jmp_buf s_jump;

static void put(const char *name, const char *text) {
    char path[96];
    snprintf(path, sizeof(path), DATA "/%s", name);
    pcfile_t f = s_api->fs->open(path, "w");
    if (!f) return;
    s_api->fs->write(f, text, (int)strlen(text));
    s_api->fs->close(f);
}

static int get_int(const char *name) {
    char path[96], buf[16] = {0};
    snprintf(path, sizeof(path), DATA "/%s", name);
    pcfile_t f = s_api->fs->open(path, "r");
    if (!f) return 0;
    s_api->fs->read(f, buf, (int)sizeof(buf) - 1);
    s_api->fs->close(f);
    return atoi(buf);
}

static const char *libc_open(const char *path) {
    FILE *f = fopen(path, "r");
    if (!f) return "missing";
    fclose(f);
    return "ok";
}

static void audio_tick(void) { s_audio_ticks++; }

static void deep(int n) {
    if (n == 0) {
        s_api->sys->poll();  // a host call that may yield to the browser, mid-stack
        longjmp(s_jump, 7);
    }
    deep(n - 1);
}

void picodeck_main(const PicoCalcAPI *api, const char *app_dir,
                   const char *app_id, const char *app_name) {
    (void)app_id; (void)app_name;
    char buf[160];
    s_api = api;
    s_runs++;
    api->fs->mkdir(DATA);
    int launch = get_int("launches.txt") + 1;
    snprintf(buf, sizeof(buf), "%d", launch);
    put("launches.txt", buf);
    snprintf(buf, sizeof(buf), "%d", s_runs);
    put("runs.txt", buf);

    // A drawing call, presented: green everywhere. Then raw panel-order
    // (byte-swapped) red into rows 100-199 only, presented as a region.
    api->display->clear(0x07E0);
    api->display->flush();
    uint16_t *fb = api->display->getBackBuffer();
    for (int y = 100; y < 200; y++)
        for (int x = 0; x < 320; x++) fb[y * 320 + x] = 0x00F8;
    api->display->flushRegion(100, 199);

    int r = setjmp(s_jump);
    if (r == 0) deep(20);
    snprintf(buf, sizeof(buf), "%d", r);
    put("jumped.txt", buf);

    snprintf(buf, sizeof(buf), "%s/app.json", app_dir);
    put("libc_abs.txt", libc_open(buf));
    put("libc_rel.txt", libc_open("app.json"));

    api->sys->setAudioCallback(audio_tick);
    uint32_t t0 = api->sys->getTimeMs();
    while (api->sys->getTimeMs() - t0 < 300) api->sys->poll();
    put("audio.txt", s_audio_ticks > 0 ? "ticked" : "silent");

    snprintf(buf, sizeof(buf), "%d", launch);
    put("ready.txt", buf);
    api->sys->log("WEBNATIVE ready %d", launch);
    for (;;) {
        api->sys->poll();
        if (api->sys->shouldExit() ||
            (api->input->getButtonsPressed() & BTN_ESC))
            return;  // the audio callback stays registered: the OS clears it
    }
}
