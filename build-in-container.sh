#!/usr/bin/env bash
# Builds the Sloppinux ISO inside a throwaway Debian container, for hosts
# that aren't Debian/Ubuntu (e.g. Arch) and don't want to spin up a VM.
#
# live-build needs root plus chroot/loopback-mount access, so the container
# runs --privileged. State (chroot cache, config/, the output .iso) lives on
# the bind-mounted repo, so it survives between runs — `./build-in-container.sh
# --quick` works the same as running build.sh --quick directly.
set -euo pipefail

DIST="trixie"

if command -v podman &>/dev/null; then
    ENGINE="podman"
elif command -v docker &>/dev/null; then
    ENGINE="docker"
else
    echo "Error: need docker or podman installed" >&2
    exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(dirname "$REPO_DIR")"
REPO_NAME="$(basename "$REPO_DIR")"

BUILD_ARGS=""
for arg in "$@"; do
    BUILD_ARGS+=" $(printf '%q' "$arg")"
done

echo "==> Building with $ENGINE (debian:$DIST)"
# APT_PROXY="" — build.sh's default apt-cacher-ng proxy lives on the host,
# not inside this container, so skip it and hit the mirror directly.
exec "$ENGINE" run --rm -it \
    --privileged \
    -e APT_PROXY="" \
    -v "$PARENT_DIR":/build \
    -w "/build/$REPO_NAME" \
    "debian:$DIST" \
    bash -c "
        set -euo pipefail
        apt-get update -qq
        apt-get install -y -qq live-build debootstrap >/dev/null
        ./build.sh$BUILD_ARGS
    "
