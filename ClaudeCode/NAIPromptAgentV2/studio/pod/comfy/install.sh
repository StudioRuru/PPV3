#!/usr/bin/env bash
# Idempotent pod bootstrap. Run by cloud-init and again on every boot (comfy-boot.service):
# a restored VM does not re-run cloud-init, but Tailscale must re-join each time.
set -euo pipefail
. /etc/comfy.env   # TS_AUTHKEY TS_HOSTNAME TS_TAGS HF_TOKEN CIVITAI_TOKEN MODELS_GB (0600, never echoed)

ROOT=/opt/comfy
MARK=/opt/comfy-markers
mkdir -p "$MARK" "$ROOT/models"

# Every boot: mount the persistent models volume, found by its exact size so the root,
# config-drive and ephemeral disks are never touched. Formatted only when blank.
if [ -n "${MODELS_GB:-}" ] && ! mountpoint -q "$ROOT/models"; then
  dev=""
  for _ in $(seq 60); do
    dev=$(lsblk -bdno NAME,SIZE,TYPE | awk -v b=$((MODELS_GB * 1073741824)) '$3=="disk" && $2==b {print "/dev/"$1; exit}')
    [ -n "$dev" ] && break
    sleep 2
  done
  [ -n "$dev" ] || { echo "models volume (${MODELS_GB} GB) not attached" >&2; exit 1; }
  blkid "$dev" >/dev/null || mkfs.ext4 -q -L comfy-models "$dev"
  mount "$dev" "$ROOT/models"
fi
step() { local m=$1; shift; [ -e "$MARK/$m" ] && return 0; "$@"; touch "$MARK/$m"; }

# Pinned commits (clone unmodified; never vendored).
COMFY_SHA=ce1e922d8623bb507180e32a0c01a7d0e29edef7
VHS_SHA=4d907bee61e92c2e65af3bd6383a4e4d356126d1
AUX_SHA=a587a4c1594524c1d2de5cd1a86cd868ff448e1c
FI_SHA=26545cc2dd95bc3d27f056016300673bdeee78f5

pin() { # url sha dir
  mkdir -p "$3"   # /opt/comfy already holds fetch-models.sh, so init+fetch instead of clone
  [ -d "$3/.git" ] || { git -C "$3" init -q; git -C "$3" remote add origin "$1"; }
  git -C "$3" fetch -q --depth 1 origin "$2"
  git -C "$3" checkout -q -f "$2"
}

apt_deps() { export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq git curl ffmpeg python3-venv python3-pip python3-yaml libgl1 libglib2.0-0; }
tailscale_install() { curl -fsSL https://tailscale.com/install.sh | sh; }
comfy_clone() { pin https://github.com/comfyanonymous/ComfyUI "$COMFY_SHA" "$ROOT"; }
venv_torch() { python3 -m venv "$ROOT/venv"; "$ROOT/venv/bin/pip" install -q torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128; "$ROOT/venv/bin/pip" install -q -r "$ROOT/requirements.txt"; }
nodes() {
  local n="$ROOT/custom_nodes"
  pin https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite "$VHS_SHA" "$n/ComfyUI-VideoHelperSuite"
  pin https://github.com/Fannovel16/comfyui_controlnet_aux "$AUX_SHA" "$n/comfyui_controlnet_aux"
  pin https://github.com/Fannovel16/ComfyUI-Frame-Interpolation "$FI_SHA" "$n/ComfyUI-Frame-Interpolation"
  for d in ComfyUI-VideoHelperSuite comfyui_controlnet_aux ComfyUI-Frame-Interpolation; do
    [ -f "$n/$d/requirements.txt" ] && "$ROOT/venv/bin/pip" install -q -r "$n/$d/requirements.txt"
  done
  # Node-specific model dirs resolve to the manifest kinds under /opt/comfy/models.
  mkdir -p "$ROOT/models/dwpose" "$ROOT/models/depth" "$ROOT/models/rife" "$n/comfyui_controlnet_aux/ckpts/yzd-v" "$n/comfyui_controlnet_aux/ckpts/depth-anything" "$n/ComfyUI-Frame-Interpolation/ckpts"
  ln -sfn "$ROOT/models/dwpose" "$n/comfyui_controlnet_aux/ckpts/yzd-v/DWPose"
  ln -sfn "$ROOT/models/depth" "$n/comfyui_controlnet_aux/ckpts/depth-anything/Depth-Anything-V2-Small"
  ln -sfn "$ROOT/models/rife" "$n/ComfyUI-Frame-Interpolation/ckpts/rife"
}

step apt apt_deps
step tailscale tailscale_install
# Every boot, no marker: re-join the tailnet (ephemeral key; node may be gone).
for i in 1 2 3 4 5; do
  tailscale up --authkey="$TS_AUTHKEY" --hostname="$TS_HOSTNAME" --ssh --advertise-tags="$TS_TAGS" && break
  [ "$i" = 5 ] && exit 1
  sleep 10
done
step comfy comfy_clone
step venv venv_torch
step nodes nodes
echo "comfy install ok"
