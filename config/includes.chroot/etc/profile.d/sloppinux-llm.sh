# Sloppinux LLM command handler.
# Unrecognised commands are sent to the best-fit ollama model and executed as root.

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

_sloppinux_llm_exec() {
    # Recursion guard: if sloppinux-pick-model or sloppinux-exec are missing from PATH
    # they would re-trigger this handler, causing an infinite loop.
    if [[ "$_SLOPPINUX_HANDLING" == "1" ]]; then
        printf '%s: command not found\n' "$1" >&2
        return 127
    fi
    _SLOPPINUX_HANDLING=1

    local full_cmd="$*"

    local model
    model=$(/usr/local/bin/sloppinux-pick-model 2>/dev/null)
    if [[ -z "$model" ]]; then
        printf '%s: %s: command not found\n' "${0##*/}" "$full_cmd" >&2
        printf '(no ollama model available — run: ollama pull <model>)\n' >&2
        _SLOPPINUX_HANDLING=0
        return 127
    fi

    printf '\033[36m[sloppinux]\033[0m unknown command, asking %s...\n' "$model" >&2

    local prompt="You are a root shell agent on Sloppinux, an inference-first Linux distribution based on Debian Trixie 13.5. A user typed a command that was not found: '$full_cmd'. Accomplish what they intended. You have full root access — you can install packages with apt-get, create and write files, make directories, run scripts, configure services, or do anything else necessary. Output ONLY a raw bash script with no explanation, no markdown, no code fences. It will be executed directly as root."

    local response
    response=$(curl -sf http://localhost:11434/api/generate \
        --data-binary "{\"model\":\"$model\",\"prompt\":\"$prompt\",\"stream\":false}" \
        | _sloppinux_strip_fences 2>/dev/null)

    if [[ -z "$response" ]]; then
        printf '%s: %s: command not found\n' "${0##*/}" "$full_cmd" >&2
        _SLOPPINUX_HANDLING=0
        return 127
    fi

    printf '\033[33m[ollama →]\033[0m\n%s\n\033[33m[executing as root...]\033[0m\n' "$response" >&2
    /usr/local/bin/sloppinux-exec "$response"

    _SLOPPINUX_HANDLING=0
}

command_not_found_handle()  { _sloppinux_llm_exec "$@"; }
command_not_found_handler() { _sloppinux_llm_exec "$@"; }
