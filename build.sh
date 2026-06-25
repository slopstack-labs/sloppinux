#!/usr/bin/env bash
# Builds the Sloppinux live ISO using live-build.
# Must run as root on a Debian/Ubuntu host with live-build installed:
#   apt install live-build debootstrap
set -euo pipefail

DIST="trixie"
ARCH="amd64"
ISO_NAME="sloppinux-${DIST}-${ARCH}.iso"

QUICK=0
[[ "${1:-}" == "--quick" ]] && QUICK=1

if [[ $EUID -ne 0 ]]; then
    echo "Error: run as root (sudo ./build.sh)" >&2
    exit 1
fi

if ! command -v lb &>/dev/null; then
    echo "Error: live-build not found. Install it with: apt install live-build" >&2
    exit 1
fi

echo "==> Syncing sloppiler binary"
SLOPPILER_SRC="$(dirname "$0")/../sloppiler/sloppiler"
SLOPPILER_DST="$(dirname "$0")/config/includes.chroot/usr/local/bin/sloppiler"
if [[ -f "$SLOPPILER_SRC" ]]; then
    cp "$SLOPPILER_SRC" "$SLOPPILER_DST"
    chmod +x "$SLOPPILER_DST"
    echo "    copied $(file -b "$SLOPPILER_DST" | cut -d, -f1)"
else
    echo "Warning: ../sloppiler/sloppiler not found, using cached binary" >&2
fi

if [[ $QUICK -eq 1 ]]; then
    echo "==> Quick build: cleaning binary only (reusing chroot cache)"
    lb clean --binary
else
    echo "==> Cleaning previous build artifacts"
    lb clean
fi

echo "==> Configuring live-build"
lb config \
    --distribution "$DIST" \
    --architectures "$ARCH" \
    --archive-areas "main contrib non-free non-free-firmware" \
    --debian-installer none \
    --iso-application "Sloppinux" \
    --iso-publisher "Slopstack Labs" \
    --iso-volume "SLOPPINUX" \
    --bootappend-live "boot=live components quiet splash locales=en_US.UTF-8 keyboard-layouts=us" \
    --linux-flavours amd64 \
    --apt-recommends true \
    --apt-indices false \
    --apt-http-proxy "http://localhost:3142"

echo "==> Building ISO (this takes a while)"
lb build

if [[ -f live-image-amd64.hybrid.iso ]]; then
    mv live-image-amd64.hybrid.iso "$ISO_NAME"
    echo "==> Done: $ISO_NAME ($(du -sh "$ISO_NAME" | cut -f1))"
else
    echo "==> Build complete. Check for .iso in current directory."
fi
