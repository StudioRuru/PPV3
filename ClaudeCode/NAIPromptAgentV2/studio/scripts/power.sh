#!/usr/bin/env bash
# Co-pilot power: start/stop the local model servers. Safe to repeat; `down` keeps the tagger and Ollama itself.
# Used by `npm run up|down|status` and by the app's On/Off toggle (POST /api/copilot).
set -u   # the app spawns this detached, so Ctrl-C on `next dev` never reaches the servers
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"   # LaunchAgents and spawned shells start with a bare PATH
cd "$(dirname "$0")/.."

OLLAMA_URL=${OLLAMA_URL:-http://127.0.0.1:11434}
BRAIN_MODEL=${BRAIN_MODEL:-gemma4-12b-heretic-vision:latest}
TAGGER_URL=${TAGGER_URL:-http://127.0.0.1:8190}
CAPTION_URL=${CAPTION_URL:-http://127.0.0.1:8191}
TIPO_URL=${TIPO_URL:-http://127.0.0.1:8193}

alive() { curl -sf -m 2 -o /dev/null "$1"; }
port() { local p=${1##*:}; echo "${p%%/*}"; }
wait_for() { for _ in $(seq 240); do alive "$1" && return 0; sleep 0.5; done; return 1; }

# start NAME URL CMD... — no-op when already healthy; logs to studio/.run/NAME.log
start() {
  local name=$1 url=$2; shift 2
  alive "$url/health" && return 0
  mkdir -p .run
  nohup "$@" </dev/null >".run/$name.log" 2>&1 &
  wait_for "$url/health" && echo "$name up" || { echo "$name failed to start — see studio/.run/$name.log" >&2; return 1; }
}
stop() { local pids; pids=$(lsof -ti "tcp:$(port "$1")" -sTCP:LISTEN 2>/dev/null); [ -z "$pids" ] || kill $pids; }
brain() { curl -sf -m 180 -o /dev/null "$OLLAMA_URL/api/generate" -d "{\"model\":\"$BRAIN_MODEL\",\"prompt\":\"\",\"keep_alive\":$1}"; }

case "${1:-}" in
  up)
    ok=0
    if ! alive "$OLLAMA_URL/api/version"; then open -a Ollama 2>/dev/null; wait_for "$OLLAMA_URL/api/version" || { echo "brain failed — Ollama didn't start" >&2; ok=1; }; fi
    start tagger "$TAGGER_URL" bash -c "cd ../tagger && exec uv run uvicorn tagger:app --host 127.0.0.1 --port $(port "$TAGGER_URL")" || ok=1
    start caption "$CAPTION_URL" llama-server -m ~/models/toriigate/ToriiGate-0.5-Q4_K_M.gguf --mmproj ~/models/toriigate/ToriiGate-0.5-Q8_0.mmproj.gguf --host 127.0.0.1 --port "$(port "$CAPTION_URL")" -c 8192 -ngl 99 || ok=1
    start tipo "$TIPO_URL" llama-server -m ~/models/tipo/gguf/TIPO-v2.1-1B-A200M-Q8_0.gguf --host 127.0.0.1 --port "$(port "$TIPO_URL")" -c 2048 -ngl 99 || ok=1
    if alive "$OLLAMA_URL/api/version"; then brain '"2h"' && echo "brain loaded" || { echo "brain failed to load $BRAIN_MODEL" >&2; ok=1; }; fi
    exit $ok ;;
  down)
    alive "$OLLAMA_URL/api/version" && brain 0
    stop "$CAPTION_URL"; stop "$TIPO_URL"
    exit 0 ;;
  status)
    ok=0
    if ! alive "$OLLAMA_URL/api/version"; then b=down; ok=1
    elif curl -sf -m 2 "$OLLAMA_URL/api/ps" | grep -qF "\"$BRAIN_MODEL\""; then b=loaded; else b=up; fi
    printf '%-8s%s\n' brain "$b"
    for s in tagger:$TAGGER_URL caption:$CAPTION_URL tipo:$TIPO_URL; do
      if alive "${s#*:}/health"; then printf '%-8s%s\n' "${s%%:*}" up; else printf '%-8s%s\n' "${s%%:*}" down; ok=1; fi
    done
    exit $ok ;;
  *) echo "usage: power.sh up|down|status" >&2; exit 2 ;;
esac
