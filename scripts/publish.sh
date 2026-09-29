#!/usr/bin/env bash
# Publishes picodeck-web-sim.zip as web-sim release $1, with notes from its
# version.json. $2 (optional) is the commit to tag when the tag doesn't exist
# yet (follow-picodeck.yml); a pushed tag (release.yml) needs none.
set -euo pipefail
tag="$1"
target="${2:-}"
notes="$(node scripts/notes.mjs picodeck-web-sim.zip)"
args=(release create "$tag" picodeck-web-sim.zip --title "$tag" --notes "$notes")
if [ -n "$target" ]; then args+=(--target "$target"); fi
gh "${args[@]}"
