#!/usr/bin/env bash
# Publishes <repo root>/picodeck-web-sim.zip as web-sim release $1, with notes
# from its version.json. $2 (optional) is the commit to tag
# (follow-picodeck.yml, which also marks the notes "Rebuilt for PicoDeck
# <ref>" via --rebuilt); a pushed tag (release.yml) passes none. Works from
# any directory: the zip and repo root are found from this script's own path,
# never from $PWD. Never overwrites: it refuses a tag that already has a
# release and, given a target, a tag that already exists (gh release create
# would ignore --target and attach the zip to that tag). Also refuses to
# publish a zip whose version.json disagrees with the tag being published
# (the usual cause: a workflow forgot to set WEB_SIM_VERSION).
set -euo pipefail
usage="usage: scripts/publish.sh <tag> [<target commit>]"
if [ $# -lt 1 ] || [ -z "$1" ]; then echo "$usage" >&2; exit 1; fi
tag="$1"
target="${2:-}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
zip="$root/picodeck-web-sim.zip"

if [ ! -f "$zip" ]; then
  echo "publish: no $zip (run make package first)" >&2
  exit 1
fi

zip_version="$(unzip -p "$zip" version.json | node -e \
  'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).web_sim)')"
if [ "$zip_version" != "$tag" ]; then
  echo "publish: $zip was packaged as web_sim $zip_version, not $tag" \
    "(did the build forget WEB_SIM_VERSION?)" >&2
  exit 1
fi

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

notes_args=("$zip")
if [ -n "$target" ]; then notes_args+=(--rebuilt); fi
notes="$(node "$here/notes.mjs" "${notes_args[@]}")"
args=(release create "$tag" "$zip" --title "$tag" --notes "$notes")
if [ -n "$target" ]; then args+=(--target "$target"); fi
gh "${args[@]}"
