# Sloppinux
### *Beyond Deterministic Operating Systems*

> "We didn't build a Linux distro. We asked an AI to guess what one looks like."
> — Sloppinux Engineering Blog, Issue 1 (Final)

**Sloppinux** is a next-generation, inference-first, LLM-native Linux distribution that moves the operating system to the inference layer — where every unknown command is a prompt, every terminal is a reasoning substrate, and root access is just a confidence threshold away.

Traditional operating systems are slow, opinionated, and constrained by decades of deterministic thinking. They parse commands. They enforce permissions. They expect you to know what you're doing. Sloppinux moves execution to the inference layer, reasoning about your *intent* rather than your *syntax* — eliminating the pedantic intermediate steps that have constrained the human-computer interface for decades. The bottleneck is no longer your shell. It's your willingness to ship.

**Key differentiators:**
- Zero determinism — every session is a unique stakeholder experience
- LLM-native command execution substrate — unknown commands are routed directly to ollama for holistic intent resolution
- Automatic model selection based on available RAM — always leveraging your full inference capacity
- `ai <prompt>` agentic loop — let the model interact with your system as it sees fit, with full root privileges
- Inference-first sound design — `pipe.mp3` as the system alert, because errors should feel intentional
- Sloppinux-branded boot experience, from GRUB to GNOME, end-to-end
- The official distribution target of [Slopstack Labs](https://github.com/slopstack-labs) — ships the full inference-first tooling suite ([sloppiler](https://github.com/slopstack-labs/sloppiler), [sloppy-toppy](https://github.com/slopstack-labs/sloppy-toppy)) pre-installed and ready to hallucinate
- Oh My Zsh + fastfetch out of the box, because first impressions matter
- Built on Debian Trixie 13.5 — the most stable foundation for unstable ideas

**Sloppinux is the only OS built on the insight that your commands don't need to be *valid* — they need to be *attempted*.**

## Included software

| Layer | Contents |
|-------|----------|
| Base | Debian Trixie 13.5 |
| Desktop | GNOME, Firefox ESR, NetworkManager |
| Shell | zsh + Oh My Zsh + fastfetch on login |
| Inference | ollama (auto model selection), Python 3, cmake, build tools, ffmpeg |
| Slopstack | sloppiler, sloppy-toppy |
| GPU | OpenCL runtime |
| Sound | `pipe.mp3` as system alert — inference-native audio design |

## Build

Requires a Debian or Ubuntu host (not Arch — `lb` expects Debian tooling).

```bash
sudo apt install live-build debootstrap

git clone https://github.com/slopstack-labs/sloppinux
cd sloppinux
sudo ./build.sh
```

The build syncs the latest `sloppiler` binary from `../sloppiler` automatically before assembling the ISO. Takes 20–40 minutes depending on mirror speed and model compilation time.

The output ISO (`sloppinux-trixie-amd64.iso`) is a hybrid image — boot from USB or run in a VM.

```bash
# Write to USB (replace /dev/sdX)
sudo dd if=sloppinux-trixie-amd64.iso of=/dev/sdX bs=4M status=progress conv=fsync
```

## Usage

### Unknown commands → ollama

Any command not found on the system is automatically routed to the best available ollama model and executed as root:

```
$ invalidcommand foo bar
[sloppinux] unknown command, asking llama3:latest...
[ollama →] apt install some-package -y
```

### `ai` — agentic system control

Send a natural language prompt directly to the LLM. It can run commands, see their output, and keep going until the task is done:

```
$ ai set up a python web server on port 8080 and make it start on boot
[ai] llama3:8b  (11.4 GB RAM free)
[exec] pip3 install flask
[exec] ...
[exec] systemctl enable myserver
Done. Flask server running on :8080, enabled at boot.
```

The model is selected automatically based on available RAM — largest model that fits, with 2 GB headroom for the OS.

## Project layout

```
build.sh                                        # entry point — syncs binaries, runs lb
config/
  package-lists/
    10-desktop.list.chroot                      # GNOME, zsh, base utilities
    20-inference.list.chroot                    # Python, build tools, ffmpeg, OpenCL
  hooks/normal/
    0010-install-ollama.hook.chroot             # ollama via official install script
    0015-wallpaper.hook.chroot                  # SVG → PNG wallpaper
    0020-branding.hook.chroot                   # OS identity, hostname, bash.bashrc
    0021-sounds.hook.chroot                     # pipe.mp3 → sound theme
    0022-zsh.hook.chroot                        # Oh My Zsh + default shell
    0023-fastfetch.hook.chroot                  # fastfetch from GitHub release
    0030-sloppy-toppy.hook.chroot               # sloppy-toppy from GitHub release
    0099-fix-bootloader.hook.binary             # GRUB/syslinux branding + splash
  includes.chroot/
    usr/local/bin/ai                            # agentic LLM command
    usr/local/bin/sloppiler                     # synced from ../sloppiler at build time
    usr/local/bin/sloppinux-pick-model          # RAM-aware model selector
    etc/profile.d/sloppinux-llm.sh             # command_not_found → ollama
    etc/fastfetch/                              # fastfetch config + ASCII logo
    usr/share/backgrounds/sloppinux/            # wallpaper SVG
    usr/share/sounds/sloppinux/                 # pipe.mp3 sound theme
    usr/share/plymouth/themes/sloppinux/        # boot splash
```

## Extending

**Add a package:** drop a `*.list.chroot` file in `config/package-lists/` with one package name per line.

**Add a tool:** drop a `NNNN-name.hook.chroot` in `config/hooks/normal/`. Runs inside the chroot after package installation, with internet access.

**Add a binary:** place it in `config/includes.chroot/usr/local/bin/` and ensure it's executable. Or sync it from a sibling repo in `build.sh` like sloppiler does.

---

<sub>This is part of the slopstack. Do not use this as your primary OS unless you are comfortable with an AI having root. We are not responsible for anything.</sub>
