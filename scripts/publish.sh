#!/usr/bin/env bash
# Publishes picodeck-web-sim.zip as web-sim release $1, with notes from its
# version.json. $2 (optional) is the commit to tag when the tag doesn't exist
# yet (follow-picodeck.yml, which also marks the notes "Rebuilt for
# PicoDeck <ref>" via --rebuilt); a pushed tag (release.yml) passes neither.
set -euo pipefail
tag="$1"
target="${2:-}"
notes_args=(picodeck-web-sim.zip)
if [ -n "$target" ]; then notes_args+=(--rebuilt); fi
notes="$(node scripts/notes.mjs "${notes_args[@]}")"
args=(release create "$tag" picodeck-web-sim.zip --title "$tag" --notes "$notes")
if [ -n "$target" ]; then args+=(--target "$target"); fi
gh "${args[@]}"
