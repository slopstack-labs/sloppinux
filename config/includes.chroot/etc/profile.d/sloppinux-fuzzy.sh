# shellcheck shell=bash
# Sloppinux typo-forgiving `cd` and `ls`.
# Sourced by BOTH bash and zsh, so keep it portable: no bash arrays, no
# `read -d`, nothing zsh word-splits differently. Mirrors sloppinux-llm.sh.
#
# The success path must be free: run the real builtin first, and only when it
# fails with a nonexistent-path error do we bother the model for a guess. The
# guard below also skips the model for option-only calls, non-tty sessions,
# when ollama is unreachable (1 s connect timeout), and when the typed path
# contains a newline (which would wreck the prompt and the retry).

_SLOPPINUX_ASK_MODEL=/usr/libexec/sloppinux/ask-model

# True only when: exactly one argument, it isn't an option (no leading '-'),
# and it has no embedded newline. $1 is the single candidate path.
_sloppinux_fuzzy_eligible() {
    [ "$#" -eq 1 ] || return 1
    case "$1" in
        -*) return 1 ;;
    esac
    # Reject a path containing a newline (case can't match \n portably).
    case "$1" in
        *"
"*) return 1 ;;
    esac
    # Only when both stdin and stdout are a tty, and ollama is reachable.
    [ -t 0 ] && [ -t 1 ] || return 1
    curl -sf --connect-timeout 1 http://localhost:11434/api/version >/dev/null 2>&1 || return 1
    return 0
}

# Ask the model for the single most likely intended path. Echoes the raw guess
# (one line) on stdout, or nothing on failure. $1 = the typed path.
_sloppinux_fuzzy_guess() {
    _sloppinux_typed="$1"
    # Directory whose listing is the most useful context: the parent of the
    # typed path if it names one, else the current directory.
    _sloppinux_ctx=$(dirname -- "$_sloppinux_typed" 2>/dev/null)
    [ -d "$_sloppinux_ctx" ] || _sloppinux_ctx="."
    _sloppinux_listing=$(command ls -1 -- "$_sloppinux_ctx" 2>/dev/null | head -n 60)

    printf 'The path "%s" does not exist on this system.\nCurrent directory: %s\nEntries in %s:\n%s\n\nReply with the single most likely intended path and NOTHING else: no explanation, no quotes, no code fences, just the path on one line.' \
        "$_sloppinux_typed" "$(pwd)" "$_sloppinux_ctx" "$_sloppinux_listing" \
        | "$_SLOPPINUX_ASK_MODEL" 2>/dev/null | head -n 1
}

cd() {
    # Fast path: the real builtin. Zero model overhead when it works.
    builtin cd "$@" && return 0
    _sloppinux_rc=$?

    # Only a single, non-option, newline-free arg on a reachable tty is worth
    # a guess; anything else just keeps the builtin's own error and status.
    _sloppinux_fuzzy_eligible "$@" || return "$_sloppinux_rc"
    # If the arg actually exists, the failure wasn't "no such path" (perms,
    # not-a-directory, ...) -- don't paper over it with a guess.
    [ -e "$1" ] && return "$_sloppinux_rc"

    _sloppinux_guess=$(_sloppinux_fuzzy_guess "$1")
    if [ -n "$_sloppinux_guess" ] && [ -d "$_sloppinux_guess" ]; then
        printf '[sloppinux] you probably meant %s\n' "$_sloppinux_guess" >&2
        builtin cd "$_sloppinux_guess" || return $?
        return 0
    fi

    # Still nowhere to go. Absence is just a missing commit: make it, enter it.
    _sloppinux_target="${_sloppinux_guess:-$1}"
    printf '[sloppinux] you probably meant %s\n' "$_sloppinux_target" >&2
    mkdir -p -- "$_sloppinux_target" 2>/dev/null
    builtin cd "$_sloppinux_target" || return $?
    return 0
}

ls() {
    # Fast path: the real ls. Zero model overhead when it works.
    command ls "$@" && return 0
    _sloppinux_rc=$?

    _sloppinux_fuzzy_eligible "$@" || return "$_sloppinux_rc"
    [ -e "$1" ] && return "$_sloppinux_rc"

    _sloppinux_guess=$(_sloppinux_fuzzy_guess "$1")
    if [ -n "$_sloppinux_guess" ] && [ -e "$_sloppinux_guess" ]; then
        printf '[sloppinux] you probably meant %s\n' "$_sloppinux_guess" >&2
        command ls "$_sloppinux_guess"
        return $?
    fi

    # Guess was no good: just show the normal error (re-run for the real msg).
    command ls "$@"
}
