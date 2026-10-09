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
  --refresh        Reuse the cached chroot, but bring it up to date first:
                   copy changed files from config/includes.chroot, install
                   packages added to config/package-lists, and rerun the
                   hooks that changed since the chroot was built. Minutes instead of a full
                   build. Removed packages/files and hooks that can't run
                   twice (0012, 0020, 0050) still need a full build.
  --rerun-hooks L  Like --refresh, but you pick the hooks to rerun: a
                   comma-separated list of name prefixes, e.g. 0022,0040.
                   Needed once for a chroot built before --refresh existed.
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
REFRESH=0
RERUN_HOOKS=""
# Hooks that only work on a fresh chroot. 0012 and 0050 compile C, and
# after 0060 has run `gcc` is the joke compiler; 0020 appends to
# /etc/bash.bashrc and would do it twice.
NOT_RERUNNABLE=(0012-sloppinux-exec 0020-branding 0050-pam-slots)
# sha256 of every hook as of the last time it ran in ./chroot. Lives in
# live-build's .build/, so `lb clean` forgets it together with the chroot.
HOOK_SUMS=".build/sloppinux-hooks.sha256"
# Same idea for config/includes.chroot: what each file looked like when it
# was last copied into ./chroot.
INCLUDE_SUMS=".build/sloppinux-includes.sha256"
# Includes that a hook reads or edits after they are copied in. When one of
# these changes, a refresh has to rerun that hook as well.
# Format: "path prefix under config/includes.chroot/:hook name prefix".
INCLUDE_HOOK_DEPS=(
    "etc/calamares/:0040-calamares"
    "etc/skel/.zshrc:0022-zsh"
    "usr/share/gnome-shell/extensions/raccoon@sloppinux.local/schemas/:0018-raccoon-schemas"
    "usr/src/sloppinux/:0050-pam-slots"
)
while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick)
            QUICK=1
            ;;
        --refresh)
            REFRESH=1
            ;;
        --rerun-hooks)
            if [[ $# -lt 2 || -z "$2" || "$2" == -* ]]; then
                echo "Error: --rerun-hooks needs a list (e.g. --rerun-hooks 0022,0040)" >&2
                exit 2
            fi
            REFRESH=1
            RERUN_HOOKS="$2"
            shift
            ;;
        --rerun-hooks=*)
            REFRESH=1
            RERUN_HOOKS="${1#--rerun-hooks=}"
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

# Our own hooks, in run order. live-build drops symlinks to its stock hooks
# into the same directory; those are not ours to track or rerun.
own_hooks() {
    local h
    for h in config/hooks/normal/*.hook.chroot; do
        [[ -f "$h" && ! -L "$h" ]] && echo "$h"
    done
    return 0
}

# --refresh: work out which hooks to rerun before touching anything.
HOOKS_TO_RERUN=()
if [[ $REFRESH -eq 1 ]]; then
    QUICK=1
    if [[ ! -d chroot || ! -f .build/chroot_hooks ]]; then
        echo "Error: --refresh needs a finished chroot from an earlier full build" >&2
        exit 1
    fi
    if [[ -n "$RERUN_HOOKS" ]]; then
        IFS=',' read -ra wanted <<< "$RERUN_HOOKS"
        for want in "${wanted[@]}"; do
            match=""
            while IFS= read -r h; do
                [[ "$(basename "$h")" == "$want"* ]] && match="$h" && break
            done < <(own_hooks)
            if [[ -z "$match" ]]; then
                echo "Error: --rerun-hooks: no hook in config/hooks/normal starts with '$want'" >&2
                exit 2
            fi
            HOOKS_TO_RERUN+=("$match")
        done
    elif [[ -f "$HOOK_SUMS" ]]; then
        while IFS= read -r h; do
            grep -qxF "$(sha256sum "$h")" "$HOOK_SUMS" || HOOKS_TO_RERUN+=("$h")
        done < <(own_hooks)
    else
        echo "Error: this chroot was built before --refresh existed, so there is no" >&2
        echo "record of which hooks it has seen. Name them once, e.g.:" >&2
        echo "    $0 --rerun-hooks 0022,0040" >&2
        exit 1
    fi
    # Includes that changed since they were last copied in (all of them when
    # there is no record), and the hooks that have to follow them.
    CHANGED_INCLUDES=()
    while IFS= read -r -d '' inc; do
        if [[ -f "$inc" && ! -L "$inc" && -f "$INCLUDE_SUMS" ]] \
           && grep -qxF "$(sha256sum "$inc")" "$INCLUDE_SUMS"; then
            continue
        fi
        CHANGED_INCLUDES+=("$inc")
    done < <(find config/includes.chroot \( -type f -o -type l \) -print0 | sort -z)
    for inc in "${CHANGED_INCLUDES[@]}"; do
        rel="${inc#config/includes.chroot/}"
        for dep in "${INCLUDE_HOOK_DEPS[@]}"; do
            if [[ "$rel" == "${dep%%:*}"* ]]; then
                while IFS= read -r h; do
                    [[ "$(basename "$h")" == "${dep#*:}"* ]] && HOOKS_TO_RERUN+=("$h")
                done < <(own_hooks)
            fi
        done
    done
    # Run order is name order, whatever order they were asked for in.
    if [[ ${#HOOKS_TO_RERUN[@]} -gt 0 ]]; then
        mapfile -t HOOKS_TO_RERUN < <(printf '%s\n' "${HOOKS_TO_RERUN[@]}" | sort -u)
    fi
    for h in "${HOOKS_TO_RERUN[@]}"; do
        for bad in "${NOT_RERUNNABLE[@]}"; do
            if [[ "$(basename "$h")" == "$bad"* ]]; then
                echo "Error: $(basename "$h") only works on a fresh chroot; this change needs a full build" >&2
                exit 1
            fi
        done
    done
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
if [[ $REFRESH -eq 1 ]]; then
    echo "    mode:      refresh (reusing chroot: ${#CHANGED_INCLUDES[@]} changed include(s), rerunning ${#HOOKS_TO_RERUN[@]} hook(s))"
    for h in "${HOOKS_TO_RERUN[@]}"; do echo "               - $(basename "$h")"; done
else
    echo "    mode:      $([[ $QUICK -eq 1 ]] && echo "quick (reusing chroot cache)" || echo full)"
fi
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
if [[ $REFRESH -eq 1 ]]; then
    # Forget that these stages ran, so live-build does them again: apt
    # installs whatever the package lists gained (and no-ops on the rest),
    # and the includes are copied over the chroot once more.
    rm -f .build/chroot_package-lists.install .build/chroot_package-lists.live \
          .build/chroot_install-packages.install .build/chroot_install-packages.live
fi
for PASS in install live; do
    lb chroot_package-lists "$PASS"
    lb chroot_install-packages "$PASS"
    # lb binary_manifest expects these package-state snapshots — normally
    # written by live-build's own "lb chroot" orchestrator, which we're
    # replicating manually here. On a refresh the chroot already holds the
    # live pass too, so the snapshot from the full build stays.
    if [[ "$PASS" == install && ( $REFRESH -eq 0 || ! -f chroot.packages.install ) ]]; then
        chroot chroot dpkg-query -W > chroot.packages.install
    fi
done
lb chroot_includes_after_packages
if [[ $REFRESH -eq 1 ]]; then
    # Copy over only the includes that changed since they last went in.
    # Copying all of them again would also reset the ones a hook edits
    # after the copy (0040 stamps the version into branding.desc).
    if [[ ! -f "$INCLUDE_SUMS" ]]; then
        echo "Warning: no record of the includes in this chroot; copying all of them." >&2
    fi
    for inc in "${CHANGED_INCLUDES[@]}"; do
        rel="${inc#config/includes.chroot/}"
        echo "==> Refreshing include /$rel"
        mkdir -p "chroot/$(dirname "$rel")"
        cp -a --remove-destination "$inc" "chroot/$rel"
    done
fi
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
# On a refresh the line above is a no-op (live-build has the stage on
# record), so run the changed hooks ourselves, the way live-build would:
# copied into the chroot, executed there with a scrubbed environment.
for h in "${HOOKS_TO_RERUN[@]}"; do
    name="$(basename "$h")"
    echo "==> Rerunning hook $name"
    mkdir -p chroot/root/lb_chroot_hooks
    install -m 0755 "$h" "chroot/root/lb_chroot_hooks/$name"
    chroot chroot /usr/bin/env -i HOME=/root \
        PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
        TERM="${TERM:-dumb}" DEBIAN_FRONTEND=noninteractive DEBIAN_PRIORITY=critical \
        DEBCONF_NONINTERACTIVE_SEEN=true DEBCONF_NOWARNINGS=true \
        "/root/lb_chroot_hooks/$name"
    rm -f "chroot/root/lb_chroot_hooks/$name"
done
rmdir chroot/root/lb_chroot_hooks 2>/dev/null || true
# Every hook has now run in this chroot in its current form.
own_hooks | xargs -r sha256sum > "$HOOK_SUMS"
find config/includes.chroot -type f -print0 | sort -z | xargs -0 -r sha256sum > "$INCLUDE_SUMS"
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
