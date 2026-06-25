export ZSH=/usr/share/oh-my-zsh

ZSH_THEME="agnoster"

plugins=(git sudo command-not-found python pip)

source $ZSH/oh-my-zsh.sh

# Show system info on new login shells
[[ $- == *i* ]] && fastfetch --config /etc/fastfetch/config.jsonc
