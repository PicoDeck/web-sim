# PicoDeck web simulator. Needs Emscripten (EMSDK, default ~/emsdk, version in
# scripts/emsdk.sh) and a PicoDeck checkout (PICODECK, default ../picodeck).
#
#   make build     the release page in build/ (apps.json's apps)
#   make serve     serve build/ at http://127.0.0.1:8765/picodeck_simulator.html
SHELL := /bin/bash
.SHELLFLAGS := -o pipefail -c

PICODECK ?= ../picodeck
EMSDK ?= $(HOME)/emsdk
EMCMAKE := $(EMSDK)/upstream/emscripten/emcmake
JOBS := $(shell nproc 2>/dev/null || echo 4)

.PHONY: build serve clean

# $(call wasm,<build dir>,<extra app dirs>)
define wasm
	@test -x $(EMCMAKE) || { echo "Emscripten not found at $(EMSDK) (set EMSDK=...)"; exit 1; }
	@test -f $(PICODECK)/simulator/CMakeLists.txt || { echo "No PicoDeck checkout at $(PICODECK) (set PICODECK=...)"; exit 1; }
	$(MAKE) -C $(PICODECK) download-lua
	$(EMCMAKE) cmake -S $(PICODECK)/simulator -B $(1) -DCMAKE_BUILD_TYPE=Release \
		-DPICODECK_WEB_DIR=$(CURDIR) -DWEB_SIM_EXTRA_APPS="$(2)"
	cmake --build $(1) -j$(JOBS) 2>&1 | tee $(1)/build.log
	@if grep -q 'function signature mismatch' $(1)/build.log; then \
		echo "wasm-ld reported a function signature mismatch: WebAssembly traps on these at run time"; exit 1; fi
endef

build:
	$(call wasm,build,)

serve:
	cd build && python3 -m http.server 8765 --bind 127.0.0.1

clean:
	rm -rf build
