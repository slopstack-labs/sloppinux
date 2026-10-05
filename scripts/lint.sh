#!/usr/bin/env bash
# Static checks for the Sloppinux tree — the same script CI runs
# (.github/workflows/lint.yml), so "works on my machine" and "works in CI"
# are the same statement.
#
#   scripts/lint.sh            skip checks whose tool is missing (with a warning)
#   scripts/lint.sh --strict   treat a missing tool as a failure (CI does this)
#
# Only looks at files git knows about or would pick up (tracked + untracked
# but not ignored), so chroot/, binary/, cache/ and live-build's own
# auto-populated hooks are never scanned.
set -euo pipefail

STRICT=0
case "${1:-}" in
    --strict) STRICT=1 ;;
    "") ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Usage: $0 [--strict]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

FAILURES=0
SKIPPED=()
fail() { echo "  FAIL: $*"; FAILURES=$((FAILURES + 1)); }
section() { echo "==> $*"; }
have() {
    if command -v "$1" &>/dev/null; then
        return 0
    fi
    if [[ $STRICT -eq 1 ]]; then
        fail "$1 not installed (required with --strict)"
    else
        echo "  warning: $1 not installed, skipping"
        SKIPPED+=("$1")
    fi
    return 1
}

# Every file in the working tree that git tracks or would track.
mapfile -t FILES < <(git ls-files --cached --others --exclude-standard | sort -u)
exists() { [[ -f "$1" && ! -L "$1" ]]; }
shebang() { head -c 128 "$1" 2>/dev/null | head -n 1 | tr -d '\0'; }

SH_FILES=()      # POSIX sh / bash: bash -n + shellcheck
ZSH_FILES=()     # zsh -n
PY_FILES=()      # py_compile
JSON_FILES=()
JSONC_FILES=()
DESKTOP_FILES=()
YAML_FILES=()
for f in "${FILES[@]}"; do
    exists "$f" || continue
    first="$(shebang "$f")"
    case "$f" in
        *.json)    JSON_FILES+=("$f"); continue ;;
        *.jsonc)   JSONC_FILES+=("$f"); continue ;;
        *.desktop) DESKTOP_FILES+=("$f"); continue ;;
        *.yml|*.yaml) YAML_FILES+=("$f"); continue ;;
        *.py)      PY_FILES+=("$f"); continue ;;
    esac
    case "$first" in
        '#!'*python*) PY_FILES+=("$f"); continue ;;
        '#!'*zsh*)    ZSH_FILES+=("$f"); continue ;;
        '#!'*/sh|'#!'*/bash|'#!'*' sh'|'#!'*' bash') SH_FILES+=("$f"); continue ;;
    esac
    case "$f" in
        *zshrc|*.zsh|*/zprofile|*/zshenv) ZSH_FILES+=("$f") ;;
        # profile.d snippets have no shebang. Sloppinux sources them from
        # both bash.bashrc and /etc/zsh/zshrc, so they must parse in both.
        */etc/profile.d/*.sh) SH_FILES+=("$f"); ZSH_FILES+=("$f") ;;
        *.sh|*.hook.chroot|*.hook.binary) SH_FILES+=("$f") ;;
    esac
done

section "bash -n (${#SH_FILES[@]} files)"
for f in "${SH_FILES[@]}"; do
    out="$(bash -n "$f" 2>&1)" || fail "$f: $out"
done

section "zsh -n (${#ZSH_FILES[@]} files)"
if have zsh; then
    for f in "${ZSH_FILES[@]}"; do
        out="$(zsh -n "$f" 2>&1)" || fail "$f: $out"
    done
fi

section "shellcheck (${#SH_FILES[@]} files)"
if have shellcheck; then
    # Excludes:
    #   SC1090/SC1091  can't follow sourced files that only exist at build or
    #                  run time (/etc/sloppinux-build.env, oh-my-zsh, ...)
    # Severity "warning" keeps style/info nits (e.g. SC2086 quoting in
    # deliberately word-split commands) out of the gate.
    SC_ARGS=(--severity=warning "--exclude=SC1090,SC1091" --format=gcc)
    for f in "${SH_FILES[@]}"; do
        extra=()
        # no shebang (profile.d snippets) → tell shellcheck what dialect
        [[ "$(shebang "$f")" == '#!'* ]] || extra=(--shell=bash)
        out="$(shellcheck "${SC_ARGS[@]}" "${extra[@]}" "$f" 2>&1)" || {
            fail "$f"
            echo "${out//$'\n'/$'\n'    }" | sed '1s/^/    /'
        }
    done
fi

section "python3 -m py_compile (${#PY_FILES[@]} files)"
if have python3; then
    # Byte-compile into a throwaway dir: the default would drop __pycache__/
    # next to the scripts in includes.chroot and ship it in the image.
    PYCACHE="$(mktemp -d)"
    for f in "${PY_FILES[@]}"; do
        out="$(PYTHONPYCACHEPREFIX="$PYCACHE" python3 -m py_compile "$f" 2>&1)" || fail "$f: $out"
    done
    rm -rf "$PYCACHE"
fi

section "JSON / JSONC (${#JSON_FILES[@]} + ${#JSONC_FILES[@]} files)"
if have python3; then
    for f in "${JSON_FILES[@]}"; do
        out="$(python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$f" 2>&1)" || fail "$f: $out"
    done
    for f in "${JSONC_FILES[@]}"; do
        # Strip // and /* */ comments and trailing commas outside strings,
        # then parse as strict JSON.
        out="$(python3 - "$f" <<'PY' 2>&1
import json, re, sys
src = open(sys.argv[1], encoding="utf-8").read()
out, i, n = [], 0, len(src)
while i < n:
    c = src[i]
    if c == '"':
        j = i + 1
        while j < n and src[j] != '"':
            j += 2 if src[j] == '\\' else 1
        out.append(src[i:j + 1]); i = j + 1
    elif src.startswith('//', i):
        while i < n and src[i] != '\n':
            i += 1
    elif src.startswith('/*', i):
        end = src.find('*/', i + 2)
        if end < 0:
            sys.exit("unterminated /* comment")
        i = end + 2
    else:
        out.append(c); i += 1
text = re.sub(r',(\s*[}\]])', r'\1', ''.join(out))
json.loads(text)
PY
)" || fail "$f: ${out##*$'\n'}"
    done
fi

section "desktop-file-validate (${#DESKTOP_FILES[@]} files)"
if have desktop-file-validate; then
    for f in "${DESKTOP_FILES[@]}"; do
        out="$(desktop-file-validate "$f" 2>&1)" || fail "$f: $out"
        [[ -z "$out" ]] || echo "  note: $out"
    done
fi

if [[ ${#YAML_FILES[@]} -gt 0 ]]; then
    section "YAML (${#YAML_FILES[@]} files)"
    if python3 -c 'import yaml' &>/dev/null; then
        for f in "${YAML_FILES[@]}"; do
            out="$(python3 -c 'import sys,yaml; yaml.safe_load(open(sys.argv[1]))' "$f" 2>&1)" || fail "$f: $out"
        done
    else
        echo "  warning: python3-yaml not installed, skipping"
        SKIPPED+=(python3-yaml)
    fi
fi

section "executable bits (usr/local/bin + hooks)"
EXEC_DIRS=(config/includes.chroot/usr/local/bin config/hooks/normal)
# Tracked files: check the mode git will check out, not the local disk.
while read -r mode _ _ path; do
    fail "$path is mode ${mode#100} in git, want 755 (git update-index --chmod=+x '$path')"
done < <(git ls-files -s -- "${EXEC_DIRS[@]}" | awk '$1 != "100755" && $1 != "120000"')
# New, not-yet-added files: git will record whatever the disk says.
while read -r path; do
    exists "$path" || continue
    [[ -L "$path" ]] && continue  # symlinks take the target's mode
    [[ -x "$path" ]] || fail "$path is not executable (chmod +x '$path' before git add)"
done < <(git ls-files --others --exclude-standard -- "${EXEC_DIRS[@]}")

echo
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
    echo "Skipped (tool missing): ${SKIPPED[*]} — CI runs these with --strict."
fi
if [[ $FAILURES -gt 0 ]]; then
    echo "lint: $FAILURES problem(s)"
    exit 1
fi
echo "lint: all clear"
