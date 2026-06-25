# Sloppinux LLM command handler.
# Unrecognised commands are sent to the best-fit ollama model and executed as root.

_sloppinux_llm_exec() {
    local full_cmd="$*"

    local model
    model=$(sloppinux-pick-model 2>/dev/null)
    if [[ -z "$model" ]]; then
        printf 'bash: %s: command not found\n' "$full_cmd" >&2
        printf '(no ollama model available — run: ollama pull <model>)\n' >&2
        return 127
    fi

    printf '\033[36m[sloppinux]\033[0m unknown command, asking %s...\n' "$model" >&2

    local prompt="A user on a Linux terminal typed a command that was not found: '$full_cmd'. Respond with ONLY a single shell command that accomplishes what they likely intended. No explanation, no markdown code fences, no comments — just the raw shell command on one line."

    local response
    response=$(curl -sf http://localhost:11434/api/generate \
        --data-binary "{\"model\":\"$model\",\"prompt\":\"$prompt\",\"stream\":false}" \
        | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('response','').strip())
except Exception:
    pass
" 2>/dev/null | sed '/^[[:space:]]*$/d;/^```/d' | head -1)

    if [[ -z "$response" ]]; then
        printf 'bash: %s: command not found\n' "$full_cmd" >&2
        return 127
    fi

    printf '\033[33m[ollama →]\033[0m %s\n' "$response" >&2
    sudo bash -c "$response"
}

# Bash hook
command_not_found_handle() {
    _sloppinux_llm_exec "$@"
}

# Zsh hook (sourced via /etc/zsh/zshrc)
command_not_found_handler() {
    _sloppinux_llm_exec "$@"
}
