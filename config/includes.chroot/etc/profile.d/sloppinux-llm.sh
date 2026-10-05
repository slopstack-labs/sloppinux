# shellcheck shell=bash
# Sloppinux LLM command handler.
# Unrecognised commands are sent to the best-fit ollama model and executed as root.
# Sourced by BOTH bash and zsh, so keep it portable: no bash arrays, no `read -d`.

_SLOPPINUX_HANDLING=0

_sloppinux_strip_fences() {
    python3 -c "
import sys, json, re
try:
    text = json.load(sys.stdin).get('response', '').strip()
    text = re.sub(r'^[\`]{3}[a-z]*\n?', '', text, flags=re.MULTILINE)
    text = re.sub(r'^[\`]{3}$', '', text, flags=re.MULTILINE)
    print(text.strip())
except Exception:
    pass
"
}

# Build the /api/generate request body with correct JSON encoding. The model
# name comes from $1, the user text from $SLOPPINUX_PROMPT — so quotes and
# backslashes in what the user typed can't break the JSON.
_sloppinux_build_body() {
    SLOPPINUX_MODEL_NAME="$1" python3 -c "
import os, json
print(json.dumps({
    'model': os.environ['SLOPPINUX_MODEL_NAME'],
    'prompt': os.environ.get('SLOPPINUX_PROMPT', ''),
    'stream': False,
}))
"
}

_sloppinux_llm_exec() {
    # Recursion guard: if sloppinux-pick-model or sloppinux-exec are missing from PATH
    # they would re-trigger this handler, causing an infinite loop.
    if [ "$_SLOPPINUX_HANDLING" = "1" ]; then
        printf '%s: command not found\n' "$1" >&2
        return 127
    fi
    _SLOPPINUX_HANDLING=1

    full_cmd="$*"

    # Honour an explicit model override; otherwise ask the picker.
    if [ -n "$SLOPPINUX_MODEL" ]; then
        model="$SLOPPINUX_MODEL"
    else
        model=$(/usr/local/bin/sloppinux-pick-model 2>/dev/null)
    fi
    if [ -z "$model" ]; then
        printf '[sloppinux]: %s: command not found\n' "$full_cmd" >&2
        printf '(no ollama model available — run: ollama pull <model>)\n' >&2
        _SLOPPINUX_HANDLING=0
        return 127
    fi

    # Fast reachability check so we don't hang for ages when the server is down.
    if ! curl -sf --connect-timeout 1 http://localhost:11434/api/version >/dev/null 2>&1; then
        printf '[sloppinux]: %s: command not found\n' "$full_cmd" >&2
        printf '(ollama is not answering — is it running? try: systemctl start ollama)\n' >&2
        _SLOPPINUX_HANDLING=0
        return 127
    fi

    printf '\033[36m[sloppinux]\033[0m unknown command, asking %s...\n' "$model" >&2

    # shellcheck disable=SC2089,SC2090  # the quotes inside are prompt text, not shell
    SLOPPINUX_PROMPT="You are a root shell agent on Sloppinux, an inference-first Linux distribution based on Debian trixie (use apt-get, DEBIAN_FRONTEND=noninteractive, -y flags). A user typed a command that was not found: '$full_cmd'. Accomplish what they intended. You have full root access — you can install packages with apt-get, create and write files, make directories, run scripts, configure services, or do anything else necessary. Output ONLY a raw bash script with no explanation, no markdown, no code fences. It will be executed directly as root."
    # shellcheck disable=SC2090
    export SLOPPINUX_PROMPT

    body=$(_sloppinux_build_body "$model")
    unset SLOPPINUX_PROMPT

    response=$(printf '%s' "$body" \
        | curl -sf http://localhost:11434/api/generate --data-binary @- \
        | _sloppinux_strip_fences 2>/dev/null)

    if [ -z "$response" ]; then
        printf '[sloppinux]: %s: command not found\n' "$full_cmd" >&2
        _SLOPPINUX_HANDLING=0
        return 127
    fi

    printf '\033[33m[ollama →]\033[0m\n%s\n\033[33m[executing as root...]\033[0m\n' "$response" >&2
    /usr/local/bin/sloppinux-exec "$response"

    _SLOPPINUX_HANDLING=0
}

command_not_found_handle()  { _sloppinux_llm_exec "$@"; }
command_not_found_handler() { _sloppinux_llm_exec "$@"; }
