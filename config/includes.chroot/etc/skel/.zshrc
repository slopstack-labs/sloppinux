export ZSH=/usr/share/oh-my-zsh

ZSH_THEME="agnoster"

plugins=(git sudo command-not-found python pip)

source $ZSH/oh-my-zsh.sh

# Show system info on new login shells — but not when it'd be pointless or
# break: skip tiny terminals, dumb terminals, and the case where fastfetch
# never got installed. First impressions matter; crashing on login doesn't.
if [[ $- == *i* ]] && [[ "$TERM" != "dumb" ]] && [[ ${COLUMNS:-80} -ge 20 ]] \
    && command -v fastfetch >/dev/null 2>&1; then
    fastfetch --config /etc/fastfetch/config.jsonc
fi
