#!/usr/bin/env bash
# Publishes ./picodeck-web-sim.zip as web-sim release $1, with notes from its
# version.json. $2 (optional) is the commit to tag (follow-picodeck.yml, which
# also marks the notes "Rebuilt for PicoDeck <ref>" via --rebuilt); a pushed
# tag (release.yml) passes none. Never overwrites: it refuses a tag that
# already has a release and, given a target, a tag that already exists (gh
# release create would ignore --target and attach the zip to that tag).
set -euo pipefail
usage="usage: scripts/publish.sh <tag> [<target commit>]"
if [ $# -lt 1 ] || [ -z "$1" ]; then echo "$usage" >&2; exit 1; fi
tag="$1"
target="${2:-}"
here="$(cd "$(dirname "$0")" && pwd)"

# found <gh args...>: true if GitHub has it, false if GitHub says it doesn't;
# any other failure (auth, network, HTTP 5xx) stops the script.
found() {
  local err
  if err="$(gh "$@" 2>&1 >/dev/null)"; then return 0; fi
  case "$err" in *"Not Found"* | *"not found"*) return 1 ;; esac
  echo "publish: gh $*: $err" >&2
  exit 1
}

if found release view "$tag"; then
  echo "publish: release $tag already exists: refusing to overwrite it" >&2
  exit 1
fi
if [ -n "$target" ] && found api "repos/{owner}/{repo}/git/ref/tags/$tag"; then
  echo "publish: tag $tag already exists: refusing to publish $target under it" >&2
  exit 1
fi

notes_args=(picodeck-web-sim.zip)
if [ -n "$target" ]; then notes_args+=(--rebuilt); fi
notes="$(node "$here/notes.mjs" "${notes_args[@]}")"
args=(release create "$tag" picodeck-web-sim.zip --title "$tag" --notes "$notes")
if [ -n "$target" ]; then args+=(--target "$target"); fi
gh "${args[@]}"
