# PicoDeck web simulator. Needs Emscripten (EMSDK, default ~/emsdk, version in
# scripts/emsdk.sh) and a PicoDeck checkout (PICODECK, default ../picodeck).
#
#   make build     the release page in build/ (apps.json's apps)
#   make test      a test build in build-test/ (plus the fixture apps) and
#                  the browser tests against it
#   make smoke     the release-build browser tests; writes build/launcher.png
#   make package   picodeck-web-sim.zip from build/ (after make smoke)
#   make serve     serve build/ at http://127.0.0.1:8765/picodeck_simulator.html
#   make unit      the release scripts' unit tests
SHELL := /bin/bash
.SHELLFLAGS := -o pipefail -c

PICODECK ?= ../picodeck
EMSDK ?= $(HOME)/emsdk
EMCMAKE := $(EMSDK)/upstream/emscripten/emcmake
JOBS := $(shell nproc 2>/dev/null || echo 4)
# The test build's fixture apps (a CMake list: WEB_SIM_EXTRA_APPS).
FIXTURES := $(CURDIR)/tests/fixtures/web_test;$(CURDIR)/tests/fixtures/web_busy

.PHONY: build build-test test smoke package serve unit clean

# $(call wasm,<build dir>,<extra app dirs>)
define wasm
	@test -x $(EMCMAKE) || { echo "Emscripten not found at $(EMSDK) (set EMSDK=...)"; exit 1; }
	@test -f $(PICODECK)/simulator/CMakeLists.txt || { echo "No PicoDeck checkout at $(PICODECK) (set PICODECK=...)"; exit 1; }
	@grep -q PICODECK_WEB_DIR $(PICODECK)/simulator/CMakeLists.txt || \
		{ echo "$(PICODECK) predates the web build seam (no PICODECK_WEB_DIR in simulator/CMakeLists.txt): pick a ref with it"; exit 1; }
	$(MAKE) -C $(PICODECK) download-lua
	$(EMCMAKE) cmake -S $(PICODECK)/simulator -B $(1) -DCMAKE_BUILD_TYPE=Release \
		-DPICODECK_WEB_DIR=$(CURDIR) -DWEB_SIM_EXTRA_APPS="$(2)"
	cmake --build $(1) -j$(JOBS) 2>&1 | tee $(1)/build.log
	@if grep -q 'function signature mismatch' $(1)/build.log; then \
		echo "wasm-ld reported a function signature mismatch: WebAssembly traps on these at run time"; exit 1; fi
endef

build:
	$(call wasm,build,)

build-test:
	$(call wasm,build-test,$(FIXTURES))

test: build-test
	WEB_SIM_BUILD=build-test npx playwright test

smoke:
	WEB_SIM_BUILD=build npx playwright test --grep @release

package:
	node scripts/package.mjs --build build --picodeck $(PICODECK) --out picodeck-web-sim.zip

serve:
	cd build && python3 -m http.server 8765 --bind 127.0.0.1

unit:
	node --test test/*.test.mjs

clean:
	rm -rf build build-test picodeck-web-sim.zip test-results playwright-report
