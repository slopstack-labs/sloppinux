#!/usr/bin/env bash
# Builds the Sloppinux live ISO using live-build.
# Must run as root on a Debian/Ubuntu host with live-build installed:
#   apt install live-build debootstrap
# Not on Debian/Ubuntu? Use ./build-in-container.sh instead (same flags).
# Run ./build.sh --help for options.
set -euo pipefail

DIST="trixie"
ARCH="amd64"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
# live-build works on the current directory (config/, chroot/, binary/), so
# always build from the repo root no matter where we were invoked from.
cd "$REPO_DIR"

if [[ ! -s VERSION ]]; then
    echo "Error: $REPO_DIR/VERSION missing or empty" >&2
    exit 1
fi
SLOPPINUX_VERSION="$(tr -d '[:space:]' < VERSION)"
ISO_NAME="sloppinux-${SLOPPINUX_VERSION}-${DIST}-${ARCH}.iso"
DEFAULT_BAKE_MODEL="qwen2.5-coder:1.5b"
# ollama model baked into the squashfs so `ai` and the command-not-found
# handler work on first boot without a network. Empty = don't bake one.
# The env var is the default; --model / --no-model override it.
SLOPPINUX_BAKE_MODEL="${SLOPPINUX_BAKE_MODEL-$DEFAULT_BAKE_MODEL}"
# Developer override for sloppiler: if a local build exists here, it ships
# instead of the pinned GitHub release that 0031-sloppiler downloads. Set
# SLOPPILER_SRC="" to always use the release.
SLOPPILER_SRC="${SLOPPILER_SRC-$REPO_DIR/../sloppiler/sloppiler}"
SLOPPILER_DST="config/includes.chroot/usr/local/bin/sloppiler"

usage() {
    cat <<EOF
Usage: sudo ./build.sh [options]

Builds the Sloppinux ${SLOPPINUX_VERSION} live ISO (${ISO_NAME}) with live-build.

Options:
  --quick          Reuse the cached chroot and only rebuild the ISO image.
                   Hooks don't rerun, so --model/--no-model have no effect.
  --model NAME     Bake ollama model NAME into the image
                   (default: \$SLOPPINUX_BAKE_MODEL, else ${DEFAULT_BAKE_MODEL}).
  --no-model       Don't bake any model (smaller ISO; ollama needs a network
                   on first boot to pull one).
  -h, --help       Show this help and exit.

Environment:
  SLOPPINUX_BAKE_MODEL  Default for --model. Set it empty to bake nothing.
  APT_PROXY             apt proxy for the build (default http://localhost:3142,
                        an apt-cacher-ng instance). Empty = hit the mirror.
  SLOPPILER_SRC         Local sloppiler dev build to ship instead of the pinned
                        release (default ../sloppiler/sloppiler). Empty = release.
EOF
}

QUICK=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick)
            QUICK=1
            ;;
        --model)
            if [[ $# -lt 2 || -z "$2" || "$2" == -* ]]; then
                echo "Error: --model needs a model name (e.g. --model qwen2.5:3b)" >&2
                exit 2
            fi
            SLOPPINUX_BAKE_MODEL="$2"
            shift
            ;;
        --model=*)
            SLOPPINUX_BAKE_MODEL="${1#--model=}"
            ;;
        --no-model)
            SLOPPINUX_BAKE_MODEL=""
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Error: unknown option: $1" >&2
            echo "Run '$0 --help' for usage." >&2
            exit 2
            ;;
    esac
    shift
done

# Both values end up in a file that hooks source as shell, and the version
# also lands in os-release's VERSION_ID — keep them to boring characters.
if [[ ! "$SLOPPINUX_VERSION" =~ ^[A-Za-z0-9._~-]+$ ]]; then
    echo "Error: VERSION must be a plain version string, got: '$SLOPPINUX_VERSION'" >&2
    exit 2
fi
if [[ -n "$SLOPPINUX_BAKE_MODEL" && ! "$SLOPPINUX_BAKE_MODEL" =~ ^[A-Za-z0-9._:/-]+$ ]]; then
    echo "Error: not a valid ollama model name: '$SLOPPINUX_BAKE_MODEL'" >&2
    exit 2
fi

if [[ $EUID -ne 0 ]]; then
    echo "Error: run as root (sudo ./build.sh)" >&2
    exit 1
fi

if ! command -v lb &>/dev/null; then
    echo "Error: live-build not found. Install it with: apt install live-build" >&2
    exit 1
fi

# APT_PROXY points at a local apt-cacher-ng instance to speed up repeat
# builds. Set APT_PROXY="" (e.g. when building in a container with no
# proxy reachable at that address) to fetch straight from the mirror.
APT_PROXY="${APT_PROXY-http://localhost:3142}"

echo "==> Sloppinux build settings"
echo "    version:   ${SLOPPINUX_VERSION}"
echo "    dist:      ${DIST} (${ARCH})"
echo "    mode:      $([[ $QUICK -eq 1 ]] && echo "quick (reusing chroot cache)" || echo full)"
echo "    model:     ${SLOPPINUX_BAKE_MODEL:-none (not baking a model)}"
echo "    apt proxy: ${APT_PROXY:-none (direct to mirror)}"
echo "    output:    ${ISO_NAME}"

echo "==> Resolving sloppiler binary"
if [[ -n "$SLOPPILER_SRC" && -f "$SLOPPILER_SRC" ]]; then
    cp "$SLOPPILER_SRC" "$SLOPPILER_DST"
    chmod +x "$SLOPPILER_DST"
    echo "    developer override: shipping local build $SLOPPILER_SRC"
    echo "    (built $(date -r "$SLOPPILER_SRC" '+%Y-%m-%d %H:%M'); set SLOPPILER_SRC=\"\" to use the pinned release instead)"
else
    # Drop any copy synced by an earlier build so a stale dev binary can't
    # silently stick around once the sibling repo is gone.
    rm -f "$SLOPPILER_DST"
    echo "    no local build — 0031-sloppiler hook will download the pinned release"
fi

if [[ $QUICK -eq 1 ]]; then
    echo "==> Quick build: cleaning binary only (reusing chroot cache)"
    lb clean --binary
else
    echo "==> Cleaning previous build artifacts"
    lb clean
fi

echo "==> Configuring live-build"
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
# Also drop the build-env file (see below) if we die mid-hooks, so a later
# --quick run can't pick up a stale one from the cached chroot.
trap 'cleanup_dev_binds; rm -f chroot/etc/sloppinux-build.env' EXIT

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
# live-build runs chroot hooks under `env -i`, so build-time knobs go in
# via a file. Hooks source it with
#   [ -f /etc/sloppinux-build.env ] && . /etc/sloppinux-build.env
# and it's deleted again right after the hooks so it never ships in the image.
cat > chroot/etc/sloppinux-build.env <<EOF
SLOPPINUX_VERSION=${SLOPPINUX_VERSION}
SLOPPINUX_DEBIAN_VERSION=$(cat chroot/etc/debian_version)
SLOPPINUX_BAKE_MODEL=${SLOPPINUX_BAKE_MODEL}
EOF
lb chroot_hooks
rm -f chroot/etc/sloppinux-build.env
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
    sha256sum "$ISO_NAME" > "$ISO_NAME.sha256"
    echo "==> Done: $REPO_DIR/$ISO_NAME ($(du -sh "$ISO_NAME" | cut -f1))"
    echo "    sha256: $(cut -d' ' -f1 "$ISO_NAME.sha256") (verify with: sha256sum -c $ISO_NAME.sha256)"
else
    echo "==> Build complete, but live-image-amd64.hybrid.iso wasn't produced. Check the lb output above." >&2
    exit 1
fi
