# PicoDeck web simulator

The browser demo at [picodeck.net/try](https://picodeck.net/try/): PicoDeck's
simulator compiled to WebAssembly with Emscripten, running Lua apps in a page.
It is built from PicoDeck's own source: the latest
[PicoDeck release](https://github.com/PicoDeck/picodeck/releases) that has the
web build seam or, while no release has it, the PicoDeck ref in
`picodeck.pin`. It releases on its own schedule; picodeck.net takes
`picodeck-web-sim.zip` from this repo's latest release.

## What lives here

- `platform/`: the web half of the simulator's platform layer.
  `web_platform.c` implements PicoDeck's `simulator/hal/web_platform.h`
  (Core 1 ticks, yielding to the browser, saves in IndexedDB);
  `web_net_stubs.c` stubs networking, which the browser build lacks.
- `page/`: the page (`shell.html`) and its glue (`shell.js`, which
  picodeck.net's `/try/` page also loads). `/try/?app=<folder>` starts an app.
- `web.cmake`: included by PicoDeck's `simulator/CMakeLists.txt`
  (`-DPICODECK_WEB_DIR=<this repo>`); the contract is in PicoDeck's
  `simulator/CLAUDE.md`, "Web build seam".
- `apps.json`: the demo's apps. `builtin` are folders under PicoDeck's `apps/`;
  `store` are release ZIPs pinned by SHA-256.
- `picodeck.pin`: the PicoDeck ref CI builds while no PicoDeck release has the
  web build seam yet (`scripts/picodeck-ref.mjs`).

## Build and test

Needs Emscripten (`scripts/emsdk.sh` installs the pinned version into
`~/emsdk`), Node 22, and a PicoDeck checkout next to this one (`../picodeck`,
or `PICODECK=...`).

    npm ci && npx playwright install chromium
    make build      # build/: the release page
    make serve      # http://127.0.0.1:8765/picodeck_simulator.html
    make test       # build-test/ (with tests/fixtures/*) + browser tests
    make smoke      # the @release browser tests on build/; writes build/launcher.png
    make package    # picodeck-web-sim.zip (after make smoke)
    make unit       # the scripts' unit tests

## Releases

- Push a `vX.Y.Z` tag: CI builds against PicoDeck's latest release with the
  web build seam (else `picodeck.pin`), runs the tests and publishes
  `picodeck-web-sim.zip` (with `version.json`: this version, the PicoDeck ref
  and commit, the apps and their versions).
- When PicoDeck releases, `follow-picodeck.yml` rebuilds the latest web-sim
  release's commit against it and, if the tests pass, publishes that as the
  next patch version, tagged on the same commit. A follow release never ships
  unreleased work from `main`: if PicoDeck's change needs web-sim work that
  isn't released yet, the follow run fails and you release by hand (push the
  next `vX.Y.Z` tag). PicoDeck's release workflow sends `picodeck-release` when
  its `WEB_SIM_DISPATCH_TOKEN` secret is set; a daily check covers it
  otherwise.
- `nightly-develop.yml` builds and tests against PicoDeck's develop every night.
- A release rebuilds picodeck.net when the `PAGES_DEPLOY_HOOK` secret is set.
- GitHub turns off a public repo's scheduled workflows (the daily check,
  `nightly-develop.yml`) after 60 days with no repository activity;
  re-enable them from the Actions tab when that happens. PicoDeck's
  `WEB_SIM_DISPATCH_TOKEN` makes following immediate and independent of
  schedules.
