#!/usr/bin/env bash
# Installs and activates the Emscripten web-sim is built with into $EMSDK
# (default ~/emsdk). Bumping it is a web-sim change: rebuild and run make test.
set -euo pipefail
EMSDK_VERSION=6.0.10
EMSDK="${EMSDK:-$HOME/emsdk}"
[ -x "$EMSDK/emsdk" ] || git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK"
"$EMSDK/emsdk" install "$EMSDK_VERSION"
"$EMSDK/emsdk" activate "$EMSDK_VERSION"
