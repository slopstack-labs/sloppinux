#!/usr/bin/env bash
# Builds the Sloppinux ISO inside a throwaway Debian container, for hosts
# that aren't Debian/Ubuntu (e.g. Arch) and don't want to spin up a VM.
#
# live-build needs root plus chroot/loopback-mount access, so the container
# runs --privileged. State (chroot cache, config/, the output .iso) lives on
# the bind-mounted repo, so it survives between runs — `./build-in-container.sh
# --quick` works the same as running build.sh --quick directly.
#
# Usage: ./build-in-container.sh [--engine docker|podman] [build.sh options]
# Everything except --engine is forwarded to build.sh (see ./build.sh --help).
set -euo pipefail

DIST="trixie"

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(dirname "$REPO_DIR")"
REPO_NAME="$(basename "$REPO_DIR")"

ENGINE=""
BUILD_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --engine)
            ENGINE="${2:-}"
            shift
            ;;
        --engine=*)
            ENGINE="${1#--engine=}"
            ;;
        -h|--help)
            echo "Usage: $0 [--engine docker|podman] [build.sh options]"
            echo
            # build.sh parses --help before its root/live-build checks, so
            # this works on any host without starting a container.
            "$REPO_DIR/build.sh" --help
            exit 0
            ;;
        *)
            BUILD_ARGS+=("$1")
            ;;
    esac
    shift
done

if [[ -z "$ENGINE" ]]; then
    if command -v podman &>/dev/null; then
        ENGINE="podman"
    elif command -v docker &>/dev/null; then
        ENGINE="docker"
    else
        echo "Error: need docker or podman installed" >&2
        exit 1
    fi
elif [[ "$ENGINE" != docker && "$ENGINE" != podman ]]; then
    echo "Error: --engine must be docker or podman, got '$ENGINE'" >&2
    exit 2
elif ! command -v "$ENGINE" &>/dev/null; then
    echo "Error: $ENGINE not found" >&2
    exit 1
fi

RUN_ARGS=(--rm --privileged)
# -it only when we actually have a terminal: under CI, nohup, cron or a
# pipe, `-t` makes docker/podman bail with "the input device is not a TTY".
if [[ -t 0 && -t 1 ]]; then
    RUN_ARGS+=(-it)
fi
# APT_PROXY="" — build.sh's default apt-cacher-ng proxy lives on the host,
# not inside this container, so skip it and hit the mirror directly.
RUN_ARGS+=(-e APT_PROXY="")
# Forward the bake-model knob only when it's set, so build.sh can tell
# "unset" (use its default) from "set but empty" (bake nothing).
if [[ -n "${SLOPPINUX_BAKE_MODEL+set}" ]]; then
    RUN_ARGS+=(-e "SLOPPINUX_BAKE_MODEL=${SLOPPINUX_BAKE_MODEL}")
fi
if [[ -n "${SLOPPILER_SRC+set}" ]]; then
    # Paths inside the container differ; only the "use the release" case
    # (empty) translates cleanly.
    if [[ -z "$SLOPPILER_SRC" ]]; then
        RUN_ARGS+=(-e SLOPPILER_SRC=)
    else
        echo "Warning: SLOPPILER_SRC is a host path; ignoring it in the container (../sloppiler/sloppiler is still picked up via the /build mount)" >&2
    fi
fi

echo "==> Building with $ENGINE (debian:$DIST)"
# build.sh's arguments are passed as real positional parameters ("$@" in
# the inner script) rather than spliced into the command string, so things
# like `--model qwen2.5:3b` arrive exactly as typed.
exec "$ENGINE" run "${RUN_ARGS[@]}" \
    -v "$PARENT_DIR":/build \
    -w "/build/$REPO_NAME" \
    "debian:$DIST" \
    bash -c '
        set -euo pipefail
        apt-get update -qq
        apt-get install -y -qq live-build debootstrap >/dev/null
        exec ./build.sh "$@"
    ' build-in-container "${BUILD_ARGS[@]}"
