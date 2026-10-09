# PicoDeck web simulator

The browser demo at [picodeck.net/try](https://picodeck.net/try/): PicoDeck's
simulator compiled to WebAssembly with Emscripten, running Lua apps, and native
apps that ship a browser build of themselves, in a page.
It is built from PicoDeck's own source: the latest
[PicoDeck release](https://github.com/PicoDeck/picodeck/releases) that has the
web build seam or, while no release has it, the PicoDeck ref in
`picodeck.pin`. It releases on its own schedule; picodeck.net takes
`picodeck-web-sim.zip` from this repo's latest release.

## What lives here

- `platform/`: the web half of the simulator's platform layer.
  `web_platform.c` implements PicoDeck's `simulator/hal/web_platform.h`
  (Core 1 ticks, yielding to the browser, saves in IndexedDB);
  `web_net_stubs.c` stubs networking, which the browser build lacks;
  `web_native.c` runs native apps (below).
- `page/`: the page (`shell.html`) and its glue (`shell.js`, which
  picodeck.net's `/try/` page also loads). `/try/?app=<folder>` starts an app.
- `web.cmake`: included by PicoDeck's `simulator/CMakeLists.txt`
  (`-DPICODECK_WEB_DIR=<this repo>`); the contract is in PicoDeck's
  `simulator/CLAUDE.md`, "Web build seam".
- `apps.json`: the demo's apps. `builtin` are folders under PicoDeck's `apps/`;
  `store` are release ZIPs pinned by SHA-256.
- `picodeck.pin`: the PicoDeck ref CI builds while no PicoDeck release has the
  web build seam yet (`scripts/picodeck-ref.mjs`).

## Native apps

A native app runs here only if it ships a browser build of itself: `main.wasm`,
a WebAssembly side module next to its `main.elf`, built from the same sources
with

    emcc -O2 -I<PicoDeck>/sdk/native -sSIDE_MODULE=2 -sASYNCIFY \
         -sEXPORTED_FUNCTIONS=_picodeck_main <sources> -o main.wasm

`platform/web_native.c` loads a fresh copy at each launch and calls
`picodeck_main` with PicoDeck's API table (PicoDeck's
`simulator/sim_native_api.c`). An app without a `main.wasm` is refused with a
message, and one whose `main.wasm` fails to load returns to the launcher.

The page is a main module (`-sMAIN_MODULE=2`). It exports only the C library
functions and data the bundled apps import: `web.cmake` reads each bundled
`main.wasm`'s imports, so a new app's imports are picked up when it is bundled.
(`MAIN_MODULE=1` would export everything, but under ASYNCIFY Emscripten 6.0.10
then generates the page's JS before the `dynCall_*` thunks exist, and every C
callback the JS libraries make, SDL's key events among them, does nothing.)

What a native app has to do differently in a browser build:
- **No newlib syscall stubs.** The C library is Emscripten's. `/apps`, `/data`
  and `/system` are linked into the browser's filesystem, and relative paths
  resolve in the app's directory.
- **Don't call `exit()`.** Emscripten's would end the page. Return from
  `picodeck_main`, or `longjmp` back to it, as DOOM's `web_exit.c` does.
- **Don't mix drawing calls and raw `getBackBuffer()` writes in one frame.** As
  in the desktop simulator, the drawing calls win that present.
- **Memory isn't reclaimed.** Each launch's memory stays allocated, a few MB per
  launch.

## Build and test

Needs Emscripten (`scripts/emsdk.sh` installs the pinned version into
`~/emsdk`), Node 22, and a PicoDeck checkout next to this one (`../picodeck`,
or `PICODECK=...`).

    npm ci && npx playwright install chromium
    make build      # build/: the release page
    make serve      # http://127.0.0.1:8765/picodeck_simulator.html
    make test       # build-test/ (with tests/fixtures/*) + browser tests
    make test DOOM=../doom  # also bundle a local DOOM (its `make web-stage` output)
    make smoke      # the @release browser tests on build/; writes build/launcher.png
    make package    # picodeck-web-sim.zip (after make smoke)
    make unit       # the scripts' unit tests

## Releases

- Push a `vX.Y.Z` tag: CI checks it is greater than web-sim's latest release
  (before the build: a lower tag would become "latest" and roll picodeck.net
  back), builds against PicoDeck's latest release with the web build seam
  (else `picodeck.pin`), runs the tests and publishes `picodeck-web-sim.zip`
  (with `version.json`: this version, the PicoDeck ref and commit, the apps
  and their versions).
- Or release by hand against a chosen PicoDeck ref: run `release` from the
  Actions tab on `main` (a run on another branch is refused) with `version` (a
  `vX.Y.Z` greater than the latest release, whose tag doesn't exist yet: both
  are checked before the build, and the tag is created on the commit the run
  starts from) and `picodeck_ref` (a PicoDeck tag, branch or commit; empty =
  the usual ref). Use it when a PicoDeck release breaks the web build in a way
  only PicoDeck can fix and web-sim still needs to release (build against the
  previous PicoDeck release or a fixed commit), or to put a PicoDeck develop
  commit on the demo early. The notes record that ref, and the release stays
  up until PicoDeck publishes its next release, which the follow (below) picks
  up.
- When PicoDeck releases, `follow-picodeck.yml` rebuilds the latest web-sim
  release's commit against it and, if the tests pass, publishes that as the
  next patch version, tagged on the same commit. It follows a PicoDeck release
  only if web-sim's latest release isn't already built against it and
  PicoDeck published it after that release (by the two releases' publish
  times): a web-sim release made by hand or by a pushed tag after a PicoDeck
  release chose its ref, so it stays. So does one whose build was already
  running when PicoDeck released (its ref was resolved first): release again
  by hand to pick that release up before PicoDeck's next one. A follow release
  chose nothing, so it is judged by the PicoDeck release it was rebuilt for
  (the `Rebuilt for PicoDeck <ref>` line in its notes) instead: a PicoDeck
  release published while a follow was building is followed next. A follow
  release never ships unreleased work from `main`: if PicoDeck's change needs
  web-sim work that isn't released yet, the follow run fails and you release
  by hand. It waits for the first hand-made release: until web-sim has a
  release, and a PicoDeck release has the web build seam, it does nothing.
  PicoDeck's release workflow sends `picodeck-release`, with its tag, when its
  `WEB_SIM_DISPATCH_TOKEN` secret is set; a daily check covers it otherwise
  (and it can be run by hand from the Actions tab, on `main` only: a run on
  another branch is refused). A dispatched run reads GitHub's latest PicoDeck
  release up to six times, 10 s apart, until it is the dispatched tag, then
  decides on that tag; if it never is (GitHub is slow, or a later release came
  out), the run fails and publishes nothing, and the daily check follows
  whatever is latest. It also fails, rather than skip the dispatched release
  quietly, when that release isn't newer by the rule above (a release made by
  hand or by a pushed tag landed in between): release by hand to build
  against it.
- A follow runs `main`'s `build.yml` on the release's files (its scripts,
  Makefile and tests), and the release's `publish.sh`: a change to
  `build.yml` that needs newer scripts makes follows fail, safely, until the
  next release has those scripts. Just before publishing, it checks with
  `main`'s `scripts/release-version.mjs` that the release it rebuilt is still
  web-sim's latest and its version still a new tag above it: if a release
  landed during the follow, it fails and publishes nothing.
- Run `ci` from the Actions tab with a `picodeck_ref` to build and test
  against an unreleased PicoDeck (a branch or commit): the zip is the run's
  artifact; nothing is published.
- `nightly-develop.yml` builds and tests against PicoDeck's develop every night.
- A release rebuilds picodeck.net when the `PAGES_DEPLOY_HOOK` secret is set.
  If that fails after the release is published, re-running the release job is
  refused (the release exists): run `redeploy-site` from the Actions tab,
  which calls the hook again.
- GitHub turns off a public repo's scheduled workflows (the daily check,
  `nightly-develop.yml`) after 60 days with no repository activity;
  re-enable them from the Actions tab when that happens. PicoDeck's
  `WEB_SIM_DISPATCH_TOKEN` makes following immediate and independent of
  schedules.
