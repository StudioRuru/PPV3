#!/usr/bin/env bash
# Usage: fetch-models.sh [manifest.yaml]   (reads stdin when no file is given)
# Skips files whose sha256 already matches; downloads to /opt/comfy/models/<kind>/.
set -euo pipefail
[ -r /etc/comfy.env ] && . /etc/comfy.env
MODELS=/opt/comfy/models
manifest=$(cat "${1:-/dev/stdin}")

printf '%s' "$manifest" | python3 -c '
import sys, yaml
for e in yaml.safe_load(sys.stdin):
    print("\t".join([e["kind"], e["filename"], e["sha256"], " ".join(e["urls"])]))
' | while IFS=$'\t' read -r kind name sha urls; do
  dest="$MODELS/$kind/$name"
  mkdir -p "$MODELS/$kind"
  if [ -f "$dest" ] && [ "$(sha256sum "$dest" | cut -d' ' -f1)" = "$sha" ]; then echo "skip $kind/$name"; continue; fi
  ok=0
  for url in $urls; do
    auth=()
    case "$url" in
      https://huggingface.co/*) [ -n "${HF_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $HF_TOKEN") ;;
      https://civitai.com/*|https://civitai.red/*) [ -n "${CIVITAI_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $CIVITAI_TOKEN") ;;
    esac
    echo "get $kind/$name"
    if curl -fL --retry 3 -C - -o "$dest.part" "${auth[@]}" "$url" </dev/null \
       && [ "$(sha256sum "$dest.part" | cut -d' ' -f1)" = "$sha" ]; then
      mv "$dest.part" "$dest"; ok=1; break
    fi
    rm -f "$dest.part"
  done
  [ "$ok" = 1 ] || { echo "FAILED $kind/$name" >&2; exit 1; }
done
echo "models ok"
