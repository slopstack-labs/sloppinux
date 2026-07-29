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
# APT_PROXY points at a local apt-cacher-ng instance to speed up repeat
# builds. Set APT_PROXY="" (e.g. when building in a container with no
# proxy reachable at that address) to fetch straight from the mirror.
APT_PROXY="${APT_PROXY-http://localhost:3142}"
LB_CONFIG_ARGS=(
    --distribution "$DIST"
    --architectures "$ARCH"
    --archive-areas "main contrib non-free non-free-firmware"
    --debian-installer none
    --iso-application "Sloppinux"
    --iso-publisher "Slopstack Labs"
    --iso-volume "SLOPPINUX"
    --bootappend-live "boot=live components quiet splash locales=en_US.UTF-8 keyboard-layouts=us"
    --linux-flavours amd64
    --apt-recommends true
    --apt-indices false
    --apt-http-proxy "$APT_PROXY"
)
lb config "${LB_CONFIG_ARGS[@]}"

echo "==> Building ISO (this takes a while)"
# Expand `lb build` (bootstrap, chroot, installer, binary, source) into its
# component stages so we can inject a fix between package-list queueing and
# package installation. Debian trixie's dictionaries-common has a packaging
# bug: its aspell-autobuildhash trigger crashes ("Error: /dev/null:1: The
# key \"/usr/bin/aspell\" is unknown") specifically when this desktop
# package set's mix of aspell + hunspell dictionaries gets installed
# together — reproduced independently of ordering, recommends, or
# apt/dpkg-configure options. Rebuilding aspell's hash cache is a
# non-essential performance optimization, so divert the crashing script to
# a no-op before any packages are unpacked. The diversion is deliberately
# left in place in the shipped image: without it, installing any
# dictionary package later on a running Sloppinux system hits the same
# crash.
lb bootstrap
lb chroot_cache restore
lb chroot_prep install all mode-archives-chroot

# live-build only mounts /dev/pts, /proc and /sys into the chroot — it
# relies on debootstrap having created real device nodes for everything
# else. That doesn't happen when debootstrap itself runs inside a
# container (mknod for functioning char devices needs real root), which
# breaks anything needing /dev/urandom (e.g. git, used by the Oh My Zsh
# install hook: "unable to get random bytes for temporary file"). Bind
# mount the host's own working device nodes in; harmless on a real
# Debian/Ubuntu host where they already work.
DEV_NODES=(null zero full random urandom tty)
mkdir -p chroot/dev
for dev in "${DEV_NODES[@]}"; do
    rm -f "chroot/dev/$dev"
    touch "chroot/dev/$dev"
    mount --bind "/dev/$dev" "chroot/dev/$dev"
done
cleanup_dev_binds() {
    for dev in "${DEV_NODES[@]}"; do
        mountpoint -q "chroot/dev/$dev" 2>/dev/null && umount "chroot/dev/$dev"
    done
    return 0
}
trap cleanup_dev_binds EXIT

lb chroot_linux-image
lb chroot_firmware
lb chroot_preseed
lb chroot_includes_before_packages
chroot chroot dpkg-divert --local --rename --add /usr/sbin/aspell-autobuildhash
chroot chroot ln -sf /bin/true /usr/sbin/aspell-autobuildhash
for PASS in install live; do
    lb chroot_package-lists "$PASS"
    lb chroot_install-packages "$PASS"
    # lb binary_manifest expects these package-state snapshots — normally
    # written by live-build's own "lb chroot" orchestrator, which we're
    # replicating manually here.
    [[ "$PASS" == install ]] && chroot chroot dpkg-query -W > chroot.packages.install
done
lb chroot_includes_after_packages
lb chroot_hooks
lb chroot_hacks
lb chroot_interactive
chroot chroot dpkg-query -W > chroot.packages.live
cleanup_dev_binds
lb chroot_prep remove all mode-archives-chroot
lb chroot_cache save
chroot chroot ls -lR > chroot.files
lb installer
lb binary
lb source

if [[ -f live-image-amd64.hybrid.iso ]]; then
    mv live-image-amd64.hybrid.iso "$ISO_NAME"
    echo "==> Done: $ISO_NAME ($(du -sh "$ISO_NAME" | cut -f1))"
else
    echo "==> Build complete. Check for .iso in current directory."
fi
