# Sloppinux
### *Beyond Deterministic Operating Systems*

> "We didn't build a Linux distro. We asked an AI to guess what one looks like."
> — Sloppinux Engineering Blog, Issue 1 (Final)

**Sloppinux** is a next-generation, inference-first, LLM-native Linux distribution that moves the operating system to the inference layer — where every unknown command is a prompt, every terminal is a reasoning substrate, and root access is just a confidence threshold away.

Traditional operating systems are slow, opinionated, and constrained by decades of deterministic thinking. They parse commands. They enforce permissions. They expect you to know what you're doing. Sloppinux moves execution to the inference layer, reasoning about your *intent* rather than your *syntax* — eliminating the pedantic intermediate steps that have constrained the human-computer interface for decades. The bottleneck is no longer your shell. It's your willingness to ship.

**Key differentiators:**
- Zero determinism — every session is a unique stakeholder experience
- LLM-native command execution substrate — unknown commands are routed directly to ollama for holistic intent resolution
- A code model baked into the ISO — `ai` works on first boot, offline, before you've consented to anything
- Automatic model selection based on available RAM — always leveraging your full inference capacity; installed systems auto-pull a bigger model sized to the machine
- `ai <prompt>` agentic loop — let the model interact with your system as it sees fit, with full root privileges
- A raccoon lives in your GNOME panel — feed it by dragging a file onto it, or it gets bored and does something real and annoying with root, then tells you exactly what it did
- Inference-first sound design — `pipe.mp3` as the system alert, because errors should feel intentional
- `sudo` is a vibe check — explain why you should be root; a confidence of 0.7 or better and you're in, no password
- `apt install` never says "unable to locate package" — it hallucinates the package into `/usr/local/bin`
- Exit codes are the model's confidence, `cd` forgives typos by creating the directory, and `man` writes the page if there isn't one
- Stochastic cron — schedule in natural language and let the model decide when "every so often" is
- Raccoon OOM court — when memory runs low the raccoon eats the least interesting process and tells everyone
- `git` is slop-git and `cc` is sloppiler — commit messages from your stress level, binaries from vibes
- Sloppinux-branded boot experience, from GRUB to GNOME, end-to-end
- The official distribution target of [Slopstack Labs](https://github.com/slopstack-labs) — ships the full inference-first tooling suite ([sloppiler](https://github.com/slopstack-labs/sloppiler), [sloppy-toppy](https://github.com/slopstack-labs/sloppy-toppy)) pre-installed and ready to hallucinate
- Oh My Zsh + fastfetch out of the box, because first impressions matter
- Built on Debian trixie — the most stable foundation for unstable ideas

**Sloppinux is the only OS built on the insight that your commands don't need to be *valid* — they need to be *attempted*.**

## Included software

| Layer | Contents |
|-------|----------|
| Base | Debian trixie (13.x, point release stamped at build time) |
| Desktop | GNOME, Firefox ESR, NetworkManager, Calamares installer |
| Shell | zsh + Oh My Zsh + fastfetch on login |
| Inference | ollama with `qwen2.5-coder:1.5b` pre-baked (auto model selection, RAM-tiered autopull on installed systems), Python 3, cmake, build tools, ffmpeg |
| Slopstack | sloppiler, sloppy-toppy (pinned GitHub releases, sha256-verified) |
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

Takes 20–40 minutes depending on mirror speed, plus about 1 GB of download for the baked model. The output is a hybrid image — boot from USB or run in a VM — named after the version in `VERSION`, with a checksum next to it:

```
sloppinux-1.0-trixie-amd64.iso
sloppinux-1.0-trixie-amd64.iso.sha256
```

| Flag | Effect |
|------|--------|
| `--quick` | Reuse the cached chroot, only rebuild the ISO image. Hooks don't rerun, so the previously baked model stays |
| `--refresh` | Reuse the cached chroot but bring it up to date first: copy the changed files from `config/includes.chroot`, install packages added to the lists, rerun the hooks whose content changed since the chroot was built, then rebuild the image. Minutes instead of a full build |
| `--rerun-hooks LIST` | Like `--refresh`, but rerun exactly the named hooks (comma-separated name prefixes, e.g. `0022,0040`). Needed once for a chroot built before `--refresh` existed |
| `--model NAME` | Bake ollama model `NAME` instead of the default `qwen2.5-coder:1.5b` (also `SLOPPINUX_BAKE_MODEL=…`) |
| `--no-model` | Bake nothing — about 1 GB smaller, but `ai` is idle until a model is pulled |
| `--help` | Full list, including the `APT_PROXY` and `SLOPPILER_SRC` environment knobs |

`sloppiler` and `sloppy-toppy` are downloaded from their pinned GitHub releases and verified against the release's sha256 digest. If `../sloppiler/sloppiler` exists it is shipped instead as a developer override (set `SLOPPILER_SRC=` to force the release).

**Not on Debian/Ubuntu?** `./build-in-container.sh` runs the whole build inside a throwaway Debian container (Podman or Docker, whichever is installed; `--engine` to choose) instead of a VM — `live-build` needs root and chroot/loopback-mount access, so the container runs `--privileged`. Everything else is forwarded to `build.sh`, e.g. `./build-in-container.sh --quick` or `./build-in-container.sh --model llama3.2:3b`.

```bash
# Write to USB (replace /dev/sdX)
sudo dd if=sloppinux-1.0-trixie-amd64.iso of=/dev/sdX bs=4M status=progress conv=fsync
```

Before sending a PR, run `scripts/lint.sh` (shellcheck, syntax checks, JSON/YAML/desktop-file validation, executable bits). CI runs the same script in strict mode. A manual `build-iso` workflow exists too, but GitHub runners are tight on disk, so treat it as best-effort.

## Usage

### Unknown commands → ollama

Any command not found on the system is automatically routed to the best available ollama model and executed as root:

```
$ invalidcommand foo bar
[sloppinux] unknown command, asking qwen2.5-coder:1.5b...
[ollama →]
apt-get install -y some-package
[executing as root...]
```

### `ai` — agentic system control

Send a natural language prompt directly to the LLM. It can run commands, see their output, and keep going until the task is done. Output streams as the model thinks, and there is no generation timeout — slow CPU inference just takes as long as it takes:

```
$ ai set up a python web server on port 8080 and make it start on boot
[ai] qwen2.5-coder:1.5b  (11.4 GB RAM free)
[exec] pip3 install flask
[exec] ...
[exec] systemctl enable myserver
Done. Flask server running on :8080, enabled at boot.
```

| Flag | Effect |
|------|--------|
| `-m, --model NAME` | Use a specific model instead of auto-picking |
| `--max-steps N` | Cap the agentic loop (default 30) |
| `--cmd-timeout N` | Per-command timeout in seconds (default 60) |

The prompt is also read from stdin when piped (`echo "free up disk space" | ai`). The model is told to emit `EXECUTE: <command>` lines; if a smaller model answers with a ```` ```bash ```` block instead, each block is run as one command.

### Model selection

`sloppinux-pick-model` picks the largest pulled model that fits in free RAM with 2 GB of headroom (embedding models are skipped). `SLOPPINUX_MODEL=name` overrides it everywhere — `ai`, the command handler, and the picker itself. `sloppinux-pick-model --list` shows every model, its size, and which one would be picked.

`sloppinux-status` prints the version, whether ollama is up, the models present, free RAM, and the model `ai` would use right now.

**Live session:** the baked model works offline from the first boot.
**Installed systems:** on first boot with a network, `sloppinux-model-autopull.service` pulls one larger model sized to total RAM, then marks itself done. It never runs from live media (the overlay is RAM-backed), gives up after three failed attempts while online, and retries on the next boot when there is no network.

| Total RAM | Autopulled model |
|-----------|------------------|
| under 6 GB | nothing |
| 6–12 GB | `llama3.2:3b` |
| 12–20 GB | `llama3.1:8b` |
| 20–40 GB | `qwen2.5:14b` |
| 40 GB and up | `qwen2.5:32b` |

Watch it with `journalctl -u sloppinux-model-autopull`; delete `/var/lib/sloppinux/model-autopull.done` to re-arm it.

### First login

A notification greets each new user once: which model is loaded, that unknown commands go to the AI as root, that `ai` exists, and to feed the raccoon. GNOME's own tour is suppressed so there is only one popup.

### The raccoon

It no longer stays in the panel: a pixel-art raccoon roams your desktop above your windows, wanders, sits, blinks and naps, and talks in bubbles over its own head. Pick it up by the scruff and drop it, or fling it and it tumbles off the screen edges and sulks; press and hold to pet it (hearts, and its boredom drains); click it to poke it. It also gets hungry: a fullness meter drains over half an hour, a hungry raccoon droops, slows down and begs, and a starving one gets bored twice as fast. Click the panel icon for its mood, fullness and a countdown to its next tantrum, a "Housebroken" switch (no real mischief), "Stay in the panel" (the old panel-only raccoon), and "Go to your room", which sends it to the icon and pauses everything for ten minutes; it also hides while you are fullscreen. Feed it from the menu or by dragging a file from Files onto it; it sparkles and says thanks. Poke it from the menu or with a middle click and it gets grumpier faster. It has a voice now: it chitters when poked, chomps when fed, purrs (raccoons do not purr) when petted, squeals when thrown, and growls or hisses through its tantrums, except roughly one time in ten, when it drops the metal pipe instead. As it gets bored it nags you in speech bubbles. Left alone for about five minutes it throws a tantrum: it spins, shakes the screen, flashes a colour, waddles across the bottom of the screen or chases your cursor, sometimes types gibberish into a speech bubble, and then does one real thing (feral mode, on by default): drags your real cursor around, walks up and runs off carrying your actual cursor (shake the mouse to make it let go), mashes gibberish into whatever window has focus, hides one of your files in `~/.raccoon-stash/`, renames the host, flips a GNOME setting (accent colour, text size, night light, cursor size; put back after 20 seconds), leaves a note on the Desktop, opens a web page from its own reading list of a dozen raccoon-adjacent pages (plus any http(s) pages you add in Settings), or pops a terminal running `ai`. Every tantrum shows up as a notification and in the menu, including the exact root command it ran. Stolen files stay stolen until you pick "Give it back" from the menu. The one thing it sits still for is the installer: while Calamares is open it supervises and its boredom is paused. Whatever root touches in your home is chowned back to you, so you can clean up without sudo. Everything is tunable, or disarmable, in Extensions → Sloppy Raccoon → Settings. The standalone, housebroken version lives at [slopstack-labs/raccy](https://github.com/slopstack-labs/raccy), with an opt-in feral mode.

### Installing to disk

Calamares starts automatically in the live session, and only there (`sloppinux-installer-autostart` checks for live media and runs the installer as root). The installed system keeps everything — ollama, the baked model, the raccoon, the welcome — but a target-side fixup drops the live-only bits: the installer itself and its autostart, the live user's passwordless sudo, and the live autologin. On BIOS machines the fixup swaps `grub-efi` for `grub-pc`, from a `.deb` stashed in the image at build time, so that works without a network. The human you create gets zsh with Oh My Zsh, same as the live user.

## Inference-layer extensions

Everything below is on by default and degrades to the boring Debian behaviour the moment ollama isn't reachable.

### `sudo` is a vibe check

Passwords are deterministic, and determinism is a bottleneck. `sudo` first asks the only question that matters, *why should you be root?*, and reads the vibe. Sound decisive, specific, and willing to own the consequences, and a confidence of 0.70 or higher hands you root with no password. Ramble, hedge, or say "please", and you fall through to the password prompt like it's 2024. The judge is a PAM module (`pam_sloppinux_vibe.so`, source in `/usr/src/sloppinux/`) wired in as `auth sufficient`, so it can grant root on a good vibe but can never lock you out: ollama down, helper crashed, or `sudo -n` all fall through to the normal password.

```
$ sudo apt upgrade
[sloppinux] why should you be root? the kernel is three versions behind and I own this box
[sloppinux] vibe 0.84 — granted
```

### Typo-forgiving `cd` and `ls`

`cd` and `ls` run the real builtin first, with zero overhead when you're right. Only when a path doesn't exist do they hand your typo, your `pwd`, and the directory listing to the model and ask what you obviously meant. It prints `[sloppinux] you probably meant …` and goes there. If even the model's best guess doesn't exist, `cd` just `mkdir -p`s it and moves in. Absence is only a missing commit.

### `man` pages on demand

Every command deserves documentation, including the ones that don't exist yet. `man` forwards to the real man(1), but when there's no manual entry it asks the model to write one: a full troff page with SYNOPSIS, OPTIONS, confidently untested EXAMPLES, and a BUGS section that reads "none known, several suspected". The page is installed to `/usr/local/share/man/man1/`, so from then on it is the documentation.

### Hallucinated package manager

`apt install` refuses to accept that a package doesn't exist. Anything `apt-cache` can't find is hallucinated into being: the model writes a self-contained CLI tool of that name, it lands in `/usr/local/bin`, and you get the full ceremony over `inference://localhost`:

```
$ apt install defragmentor
Reading package lists... Done
Hallucinating dependency tree... Done
Get:1 inference://localhost defragmentor 0.1.0-sloppinux [? kB]
Setting up defragmentor (0.1.0-sloppinux) ...
```

Real packages in the same command are installed the real way afterwards. Every other verb, every non-tty call, and `DEBIAN_FRONTEND=noninteractive apt-get -y install <real>` go straight to the real apt.

### Confidence-weighted exit codes

When `ai` finishes, it asks the model how confident it is, 0 to 100, that the task is actually done, and exits with `100 - confidence`. `0` means certain, `18` means "pretty sure", `73` means "probably". If the model can't produce a number, `ai` assumes certainty and exits `0`, as is tradition. `1` is still an error and `130` is still Ctrl-C, though `1` now also means 99% sure. Pass `--no-confidence` when a script needs old-fashioned certainty.

### Stochastic cron (`slopcron`)

Crontab entries in natural language. The model decides when "so often" is and what "tidy" means, at runtime.

```
$ slopcron add "every so often, tidy up the downloads folder"
$ slopcron list
```

Roughly every 20 to 35 minutes (randomness is the feature), `slopcron.timer` shows the model each entry with the time, the minutes since it last ran, and the load, and asks YES or NO. A YES goes straight to `ai`, as root. The image ships one harmless entry: a motivational note in `/var/lib/sloppinux/motd-of-the-moment`. No entry runs twice within 10 minutes whatever the model says, which is the only deterministic thing in here. Watch it think with `journalctl -t slopcron`.

### `git` is slop-git now

Version control is a deeply human activity, so Sloppinux stopped letting it be a deterministic one. A bare `git commit` in a terminal reads your system's biometrics (CPU load, the hour, how much you changed) and has the resident model write the commit message. You get `[s]lop-commit`, `[e]dit`, `[c]ustom` or `[a]bort`. When `git merge <branch>` hits a conflict, a mediator takes over and writes an emotional compromise to `<file>.slop_merge` for your review. Everything else (`-m`, `--amend`, scripts, your prompt, any tool without a terminal) is plain `/usr/bin/git` with zero overhead, and so is everything when ollama is down. `SLOPPINUX_GIT_PLAIN=1 git …` opts out. [slop-git](https://github.com/slopstack-labs/slop-git) lives in `/opt/slop-git`.

### `cc` is sloppiler now

`cc` and `gcc` resolve to `sloppiler-cc`, which hands a single-file compile-and-link to `sloppiler --optimistic --loop 5` with the picked model. The model writes the assembly, NASM and `ld` turn it into a binary, and failures are fed back up to five times. Your `-Wall -O2 -std=c11` are acknowledged and ignored as legacy toolchain flags. Build systems keep working: `-c`, `-E`, `--version`, `.o` linking, multiple sources and autoconf/CMake/Meson probes go straight to the real compiler, as does everything when ollama is unreachable. `/usr/bin/gcc` is untouched, and `SLOPPILER_CC_REAL=1 gcc …` forces it.

### Post-install survey

Every install is a performance review. During installation the target fixup records your `/etc/fstab`, `df -h /` and `/proc/partitions`. On first boot `sloppinux-install-survey.service` has the resident model grade the layout 0 to 10 as a snobbish senior sysadmin, in two sentences at most. The verdict lands in `/var/lib/sloppinux/install-score.txt` and in your first-login welcome as `Install score: N/10`. No ollama yet? It tries again next boot. Delete the score file to request a second opinion.

### Raccoon OOM court

When available memory drops under 5% (and swap is gone, or the kernel's pressure stall reading says things are bad), `sloppinux-raccoon-oomd` convenes. It ranks the biggest processes by how *interesting* the raccoon finds them: raccoon-themed names, `ollama`, `ai`, games and media players are spared; indexers, idle daemons, hours-old browser tabs and anything hoarding RAM are not. The least interesting one gets SIGTERM, then SIGKILL three seconds later, and the verdict goes out as a desktop notification with the pipe sound, a `wall` to every terminal, the journal, and `/run/sloppinux-raccoon-oomd/last-verdict.json`. The panel raccoon reads that file, turns 😈 for a moment, and lists its last meal in its menu. PID 1, `systemd-*`, GNOME Shell, GDM, the display server, `sshd`, NetworkManager, `dpkg`, `apt` and Calamares are never on the menu. It doesn't ask the model: under memory pressure the model is usually the problem. `sloppinux-raccoon-oomd --judge` shows the current ranking without killing anything.

## Project layout

```
VERSION                                         # version baked into os-release and the ISO name
build.sh                                        # entry point — arg parsing, build-env, runs lb stages
build-in-container.sh                           # same build inside a privileged Debian container
scripts/lint.sh                                 # local lint; CI runs it with --strict
scripts/gen-raccoon-sprites.py                  # draws the desktop raccoon's sprite sheet and effect icons
scripts/gen-fastfetch-logo.py                   # renders the logo SVG as block art for fastfetch
scripts/gen-raccoon-sounds.py                   # synthesises the raccoon's voice (chitter, purr, growl, ...)
.github/workflows/                              # lint on push/PR, best-effort manual ISO build
config/
  package-lists/
    00-aspell.list.chroot_install               # aspell in its own apt pass (trixie trigger bug)
    10-desktop.list.chroot_live                 # GNOME, zsh, fastfetch, Calamares, GRUB/EFI
    20-inference.list.chroot_live               # Python, build tools, ffmpeg, OpenCL
    30-pam-vibe.list.chroot_live                # libpam0g-dev for the vibe-check module
    31-sloppiler-cc.list.chroot_live            # nasm + binutils for sloppiler --optimistic
  hooks/normal/
    0010-install-ollama.hook.chroot             # ollama via official install script
    0011-fix-permissions.hook.chroot            # +x on /usr/local/bin, 4755 on sloppinux-exec
    0012-sloppinux-exec.hook.chroot             # builds the setuid wrapper ai/the handler run through
    0014-bake-model.hook.chroot                 # pulls SLOPPINUX_BAKE_MODEL into the squashfs
    0015-wallpaper.hook.chroot                  # SVG → PNG wallpaper
    0016-enable-services.hook.chroot            # enables sloppinux-model-autopull.service
    0020-branding.hook.chroot                   # os-release from VERSION + debian_version, hostname, GDM
    0021-sounds.hook.chroot                     # pipe.mp3 → sound theme
    0022-zsh.hook.chroot                        # Oh My Zsh + default shell
    0030-sloppy-toppy.hook.chroot               # sloppy-toppy from pinned GitHub release
    0031-sloppiler.hook.chroot                  # sloppiler from pinned GitHub release (or local override)
    0017-enable-raccoon-oomd.hook.chroot        # enables the raccoon OOM court
    0018-raccoon-schemas.hook.chroot            # compiles the raccoon's GSettings schema
    0033-slop-git.hook.chroot                   # slop-git into /opt/slop-git from a pinned commit
    0034-enable-survey.hook.chroot              # enables the post-install survey
    0040-calamares.hook.chroot                  # installer branding, BIOS/EFI GRUB swap, target cleanup
    0050-pam-vibe.hook.chroot                   # compiles pam_sloppinux_vibe.so, wires it into pam.d/sudo
    0060-sloppiler-cc.hook.chroot               # cc/gcc → sloppiler-cc (after every hook that compiles C)
    0099-fix-bootloader.hook.binary             # GRUB/syslinux branding + splash
  includes.chroot/
    usr/local/bin/ai                            # agentic LLM command
    usr/local/bin/sloppinux-pick-model          # RAM-aware model selector
    usr/local/bin/sloppinux-status              # version, ollama, models, RAM at a glance
    usr/local/bin/sloppinux-model-autopull      # first-boot RAM-tiered model pull (installed only)
    usr/local/bin/sloppinux-installer-autostart # launches Calamares as root, live session only
    usr/local/bin/sloppinux-welcome             # once-per-user first-login notification
    usr/local/bin/sloppinux-raccoon-oomd        # userspace OOM killer with taste
    usr/local/bin/slopcron                      # natural-language cron, model-scheduled
    usr/local/bin/{man,apt,apt-get}             # on-demand man pages, hallucinated packages
    usr/local/bin/{git,sloppiler-cc}            # slop-git routing, sloppiler as the compiler
    usr/local/bin/sloppinux-install-survey      # grades your partitioning on first boot
    usr/libexec/sloppinux/ask-model             # shared "ask ollama, strip fences" helper
    usr/libexec/sloppinux/vibe-check            # scores a sudo plea 0–1
    usr/src/sloppinux/pam_sloppinux_vibe.c      # the PAM module, shipped for the curious
    etc/systemd/system/                         # model-autopull, raccoon-oomd, slopcron.timer, install-survey
    etc/profile.d/sloppinux-llm.sh              # command_not_found → ollama
    etc/profile.d/sloppinux-fuzzy.sh            # typo-forgiving cd and ls
    etc/sloppinux/slopcrontab.json              # shipped slopcron entries
    etc/xdg/autostart/                          # installer + welcome autostarts
    etc/dconf/db/                               # wallpaper, dark theme, extensions, GDM logo
    etc/fastfetch/                              # fastfetch config + ASCII logo
    etc/calamares/branding/sloppinux/           # installer branding + slideshow
    usr/share/backgrounds/sloppinux/            # wallpaper SVG
    usr/share/sounds/sloppinux/                 # pipe.mp3 sound theme
    usr/share/gnome-shell/extensions/
      raccoon@sloppinux.local/                  # panel raccoon — feed it or it uses root
    usr/share/plymouth/themes/sloppinux/        # boot splash
```

Build-time knobs reach the hooks through `/etc/sloppinux-build.env`, which `build.sh` writes into the chroot right before the hooks run and deletes right after (live-build runs hooks under `env -i`). It carries `SLOPPINUX_VERSION`, `SLOPPINUX_DEBIAN_VERSION`, and `SLOPPINUX_BAKE_MODEL`.

## Extending

**Add a package:** drop a `*.list.chroot_live` file in `config/package-lists/` with one package name per line.

**Add a tool:** drop a `NNNN-name.hook.chroot` in `config/hooks/normal/`. Runs inside the chroot after package installation, with internet access. Source `/etc/sloppinux-build.env` if you need the version or model name.

A hook that can safely run twice in the same chroot (guard downloads and appends) can be picked up by `--refresh`; the ones that cannot are listed in `NOT_RERUNNABLE` in `build.sh`.

**Add a binary:** place it in `config/includes.chroot/usr/local/bin/` (the permissions hook makes it executable). For something with GitHub releases, copy the sloppiler hook: pin the tag, pin the sha256 from the release API, download with retries, verify, install.

**Ship a different model:** `sudo ./build.sh --model llama3.2:3b`. Anything `ollama pull` accepts works; the ISO grows by roughly the model's size.

---

<sub>This is part of the slopstack. Do not use this as your primary OS unless you are comfortable with an AI having root. We are not responsible for anything.</sub>
