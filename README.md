# Sloppinux
### *Beyond Deterministic Operating Systems*

> "We didn't build a Linux distro. We asked an AI to guess what one looks like."
> — Sloppinux Engineering Blog, Issue 1 (Final)

**Sloppinux** is a next-generation, inference-first, LLM-native Linux distribution, where every unknown command is a prompt, every terminal is a reasoning substrate, and root access is just a confidence threshold away. The bottleneck is no longer your shell. It's your willingness to ship.

In plain terms: it is a satire distro from [Slopstack Labs](https://github.com/slopstack-labs), and the joke actually works. It is Debian trixie with GNOME, built with live-build, and it really builds, boots and installs.

**Warning:** Sloppinux gives a local language model root on purpose. Run it in a virtual machine, not on a computer you care about.

**At a glance**

| Feature | What it does |
|---------|--------------|
| [Unknown commands](#unknown-commands-go-to-the-model) | Anything not found goes to ollama and runs as root |
| [`ai`](#ai-agentic-root-shell) | Agentic loop with root that works until the task is done |
| [Baked-in model](#model-selection) | `ai` works on first boot, offline |
| [The raccoon](#the-raccoon) | Pixel-art desktop pet that misbehaves with root |
| [`sudo` vibe check](#sudo-is-a-vibe-check) | Explain yourself; 0.7 confidence and no password needed |
| [`cd` and `ls`](#typo-forgiving-cd-and-ls) | Typos are guessed; missing directories get created |
| [`man`](#man-pages-on-demand) | Writes the page if there isn't one |
| [`apt install`](#hallucinated-package-manager) | Hallucinates missing packages into `/usr/local/bin` |
| [Exit codes](#confidence-weighted-exit-codes) | The model's confidence, inverted |
| [`slopcron`](#stochastic-cron-slopcron) | Natural-language cron, scheduled by the model |
| [`git`](#git-is-slop-git) | Commit messages from your stress level |
| [`cc`](#cc-is-sloppiler) | Binaries from vibes |
| [Post-install survey](#post-install-survey) | A snobbish grade for your partitioning |
| [OOM court](#raccoon-oom-court) | The raccoon eats the least interesting process |

Also: `pipe.mp3` as the system alert, Sloppinux branding from GRUB to GNOME, Oh My Zsh and fastfetch, and the Slopstack tools ([sloppiler](https://github.com/slopstack-labs/sloppiler), [sloppy-toppy](https://github.com/slopstack-labs/sloppy-toppy)) pre-installed and ready to hallucinate.

**Sloppinux is the only OS built on the insight that your commands don't need to be *valid* — they need to be *attempted*.**

## Contents

- [Quick start](#quick-start)
- [Included software](#included-software)
- [Building](#building)
- [Installing to disk](#installing-to-disk)
- [Core: the model in your shell](#core-the-model-in-your-shell)
- [The raccoon](#the-raccoon)
- [Inference-layer extensions](#inference-layer-extensions)
- [Turning things off](#turning-things-off)
- [Project layout](#project-layout)
- [Extending](#extending)

## Quick start

**1. Build.** On a Debian or Ubuntu host (not Arch — `lb` expects Debian tooling):

```bash
sudo apt install live-build debootstrap

git clone https://github.com/slopstack-labs/sloppinux
cd sloppinux
sudo ./build.sh
```

On any other Linux with Podman or Docker, use the container script instead (see [Container builds](#container-builds)):

```bash
./build-in-container.sh
```

A build takes 20–40 minutes depending on mirror speed, plus about 1 GB of download for the baked model.

**2. Find the ISO.** It lands in the repository root, named after the version in `VERSION`, with a checksum next to it:

```
sloppinux-1.0-trixie-amd64.iso
sloppinux-1.0-trixie-amd64.iso.sha256
```

Verify it with `sha256sum -c sloppinux-1.0-trixie-amd64.iso.sha256`.

**3. Boot it.** The image is a hybrid ISO: attach it to a new VM in any VM manager, BIOS or UEFI. The live session keeps its changes in RAM and the model runs there too, so be generous with memory. To write it to a USB stick instead (replace `/dev/sdX`):

```bash
sudo dd if=sloppinux-1.0-trixie-amd64.iso of=/dev/sdX bs=4M status=progress conv=fsync
```

**4. First boot.** The live session comes up in GNOME, and then:

- the Calamares installer opens on its own (live session only);
- a welcome notification says which model is loaded and that unknown commands go to the AI as root;
- the raccoon appears on the desktop;
- the baked model works offline, so you can type `ai <prompt>` straight away.

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

## Building

`sudo ./build.sh` with no flags does a full build. The output is described in the [Quick start](#quick-start).

### Build flags

| Flag | Effect |
|------|--------|
| `--quick` | Reuse the cached chroot, only rebuild the ISO image. Hooks don't rerun, so the previously baked model stays and `--model`/`--no-model` have no effect |
| `--refresh` | Reuse the cached chroot but update it first (see below), then rebuild the image. Minutes instead of a full build |
| `--rerun-hooks LIST` | Like `--refresh`, but rerun exactly the named hooks (comma-separated name prefixes, e.g. `0022,0040`). Needed once for a chroot built before `--refresh` existed |
| `--model NAME` | Bake ollama model `NAME` instead of the default `qwen2.5-coder:1.5b` |
| `--no-model` | Bake nothing — about 1 GB smaller, but `ai` is idle until a model is pulled |
| `-h`, `--help` | Full list, including the environment knobs below |

`--refresh` does three things before rebuilding the image:

- copies the changed files from `config/includes.chroot`;
- installs packages added to `config/package-lists`;
- reruns the hooks whose content changed since the chroot was built.

Removed packages or files, and changes to hooks that cannot run twice (0012, 0020, 0050), still need a full build.

### Environment

| Variable | Default | Effect |
|----------|---------|--------|
| `SLOPPINUX_BAKE_MODEL` | `qwen2.5-coder:1.5b` | Default for `--model`; set it empty to bake nothing |
| `APT_PROXY` | `http://localhost:3142` | apt proxy for the build (an apt-cacher-ng instance); empty goes straight to the mirror |
| `SLOPPILER_SRC` | `../sloppiler/sloppiler` | Local sloppiler build to ship instead of the release; empty forces the release |

### Slopstack tools

`sloppiler` and `sloppy-toppy` are downloaded from their pinned GitHub releases and verified against the release's sha256 digest. If `../sloppiler/sloppiler` exists, it is shipped instead as a developer override (set `SLOPPILER_SRC=` to force the release).

### Container builds

Not on Debian/Ubuntu? `./build-in-container.sh` runs the whole build inside a throwaway `debian:trixie` container instead of a VM.

- It uses Podman or Docker, whichever is installed; `--engine docker|podman` chooses.
- `live-build` needs root and chroot/loopback-mount access, so the container runs `--privileged`.
- It sets `APT_PROXY` empty, since the default proxy lives on the host.
- The repo is bind-mounted, so the chroot cache and the ISO stay in your checkout between runs, and `--quick` works as it does natively.

Everything else is forwarded to `build.sh`:

```bash
./build-in-container.sh --quick
./build-in-container.sh --model llama3.2:3b
```

### Linting and CI

Before sending a PR, run `scripts/lint.sh`: shellcheck, syntax checks, JSON/YAML/desktop-file validation, and executable bits. CI runs the same script in strict mode.

A manual `build-iso` workflow exists too, but GitHub runners are tight on disk, so treat it as best-effort.

## Installing to disk

Calamares starts automatically in the live session, and only there: `sloppinux-installer-autostart` checks for live media and runs the installer as root.

The installed system keeps everything: ollama, the baked model, the raccoon and the welcome. A target-side fixup removes the live-only bits:

- the installer itself and its autostart;
- the live user's passwordless sudo;
- the live autologin.

On BIOS machines the fixup swaps `grub-efi` for `grub-pc`, from a `.deb` stashed in the image at build time, so that works without a network. The human you create gets zsh with Oh My Zsh, same as the live user.

## Core: the model in your shell

### Unknown commands go to the model

Any command not found on the system is routed to the best available ollama model, and whatever it answers is executed as root:

```
$ invalidcommand foo bar
[sloppinux] unknown command, asking qwen2.5-coder:1.5b...
[ollama →]
apt-get install -y some-package
[executing as root...]
```

This is the command-not-found hook (`command_not_found_handle` for bash, `command_not_found_handler` for zsh) in `/etc/profile.d/sloppinux-llm.sh`.

### `ai`: agentic root shell

Send a natural-language prompt to the model. It runs commands as root, sees their output, and keeps going until the task is done:

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
| `--no-confidence` | Skip the confidence question; see [exit codes](#confidence-weighted-exit-codes) |

- Output streams as the model thinks. There is no generation timeout: slow CPU inference takes as long as it takes.
- The prompt is also read from stdin when piped: `echo "free up disk space" | ai`.
- The model is told to emit `EXECUTE: <command>` lines. If a smaller model answers with a ```` ```bash ```` block instead, each block is run as one command.

### Model selection

`sloppinux-pick-model` picks the largest pulled model that fits in free RAM with 2 GB of headroom. Embedding models are only picked when nothing else fits, and if no model fits at all, the smallest one is used.

| Command / variable | What it does |
|--------------------|--------------|
| `SLOPPINUX_MODEL=name` | Overrides the pick everywhere: `ai`, the command handler, and the picker itself |
| `sloppinux-pick-model --list` | Shows every model, its size, and which one would be picked |
| `sloppinux-status` | Version, whether ollama is up, models present, free RAM, and the model `ai` would use right now |

**Live session:** the baked model works offline from the first boot.

**Installed systems:** on first boot with a network, `sloppinux-model-autopull.service` pulls a coding model sized to total RAM, plus a second one about half its size, then marks itself done.

The second model exists because the picker goes by *free* RAM. With a browser open the big model stops fitting, and without a middle rung you would fall straight back to the 1 GB baked one.

| Total RAM | Model | Fallback when RAM is busy |
|-----------|-------|---------------------------|
| under 6 GB | nothing (the baked `qwen2.5-coder:1.5b`) | |
| 6–12 GB | `qwen2.5-coder:3b` (1.9 GB) | |
| 12–20 GB | `qwen2.5-coder:7b` (4.7 GB) | `qwen2.5-coder:3b` |
| 20–28 GB | `qwen2.5-coder:14b` (9.0 GB) | `qwen2.5-coder:7b` |
| 28–40 GB | `devstral:24b` (14.3 GB) | `qwen2.5-coder:7b` |
| 40 GB and up | `qwen3-coder:30b` (18.6 GB) | `qwen2.5-coder:14b` |

They are all coding models, because the job is turning typos into shell commands and letting `ai` drive a root shell.

How the autopull behaves:

- It never runs from live media (the overlay is RAM-backed).
- With no network, it exits and retries on the next boot.
- After three failed pulls while online, it gives up for good.

| Command / path | What it does |
|----------------|--------------|
| `sloppinux-model-autopull --list` | Shows the ladder and which rung this machine gets |
| `sloppinux-model-autopull --dry-run` | Says what it would pull, pulls nothing |
| `/etc/sloppinux/model-tiers.conf` | Your own ladder: one rung per line, `MIN_RAM_GIB MODEL DOWNLOAD_GB` |
| `journalctl -u sloppinux-model-autopull` | Watch it work |
| `/var/lib/sloppinux/model-autopull.done` | Delete it (and `model-autopull.failures` next to it) to re-arm |

### First login

A notification greets each new user once. It says which model is loaded, that unknown commands go to the AI as root, that `ai` exists, and to feed the raccoon. GNOME's own tour is suppressed, so there is only one popup.

## The raccoon

A pixel-art raccoon lives on your desktop, above your windows, and its icon sits in the GNOME panel. Feed it, or it gets bored and does something real and annoying with root, then tells you exactly what it did.

It ships as the GNOME Shell extension `raccoon@sloppinux.local`. The standalone, housebroken version lives at [slopstack-labs/raccy](https://github.com/slopstack-labs/raccy), with an opt-in feral mode.

### On the desktop

- It wanders, sits, blinks and naps.
- It talks in speech bubbles over its own head.
- It hides while something is fullscreen, and its boredom is held.
- While the Calamares installer is open, it sits still and supervises; its boredom is paused.

### Interacting with it

| You do | It does |
|--------|---------|
| Press and hold | You pet it: hearts, and its boredom drains |
| Click | You poke it |
| Middle click, or Poke in the menu | It gets grumpier faster |
| Pick it up by the scruff | Drop it wherever you like |
| Fling it | It tumbles off the screen edges and sulks |
| Feed it from the menu, or drag a file from Files onto it | It sparkles and says thanks |
| Click the panel icon | Menu with its mood, fullness, and a countdown to its next tantrum |

**Hunger.** A fullness meter drains from full to starving over half an hour. A hungry raccoon droops, slows down and begs; a starving one gets bored twice as fast.

### Tantrums

As it gets bored, it nags you in speech bubbles. Left alone for about five minutes (15 ticks of 20 seconds), it throws a tantrum. The show part is some of:

- spinning, shaking the screen, or flashing a colour;
- waddling across the bottom of the screen, or chasing your cursor (visually; your pointer stays put);
- typing gibberish into a speech bubble.

Then, in feral mode (on by default), it does one real thing:

- drags your real cursor around;
- walks up and runs off carrying your actual cursor (shake the mouse to make it let go);
- mashes gibberish into whatever window has focus;
- hides one of your files in `~/.raccoon-stash/`;
- renames the host;
- flips a GNOME setting (accent colour, text size, night light, cursor size), put back after 20 seconds;
- leaves a note on the Desktop, in a new file, never overwriting one;
- opens a web page from [its reading list](#its-reading-list);
- pops a terminal running `ai`.

Every tantrum shows up as a notification and in the menu, including the exact root command it ran. Whatever root touches in your home is chowned back to you, so you can clean up without sudo.

Stolen files stay stolen until you pick **Give it back** from the menu.

### Reining it in

The panel menu has three controls:

| Menu item | Effect |
|-----------|--------|
| **Housebroken** | No real mischief: turns feral mode off (`feral-mode`) |
| **Stay in the panel** | The old panel-only raccoon: no roaming (`roam-enabled`) |
| **Go to your room** | Sends it to the panel icon and pauses roaming and tantrums for ten minutes (`room-minutes`) |

Everything else is tunable, or can be switched off, in **Extensions → Sloppy Raccoon → Settings**. The settings are GSettings keys in `org.gnome.shell.extensions.raccoon`. From a terminal:

```bash
gsettings --schemadir /usr/share/gnome-shell/extensions/raccoon@sloppinux.local/schemas \
  set org.gnome.shell.extensions.raccoon feral-mode false
```

At the bottom of the Settings window, **Reset to defaults** puts every key back. The raccoon will not remember being housebroken, so feral mode comes back on.

### Settings

Desktop pet and timing:

| Setting | Key | Default |
|---------|-----|---------|
| Roam the desktop | `roam-enabled` | on |
| Throwing | `pet-throw-enabled` | on |
| Petting | `petting-enabled` | on |
| Hunger | `hunger-enabled` | on |
| Minutes from full to starving | `hunger-minutes` | 30 |
| "Go to your room" length (minutes) | `room-minutes` | 10 |
| Pause during fullscreen | `pause-on-fullscreen` | on |
| Tick interval (seconds) | `tick-seconds` | 20 |
| Ticks until tantrum | `boredom-max` | 15 |
| Poke strength (ticks added) | `poke-bump` | 4 |

Sound, notifications and the cosmetic tantrum:

| Setting | Key | Default |
|---------|-----|---------|
| Play sounds | `sound-enabled` | on |
| Metal pipe chance | `pipe-chance` | 0.1 |
| Custom sound (replaces its voice) | `sound-file` | empty |
| Tantrum notifications | `notifications-enabled` | on |
| Nag when bored | `nag-enabled` | on |
| Screen shake | `shake-enabled` | on |
| Color flash | `flash-enabled` | on |
| Flash colors | `flash-colors` | `#ff5f5f,#5fafff,#ffd75f,#af5fff` |
| Walk across screen | `walk-enabled` | on |
| Chase your cursor | `chase-enabled` | on |
| Tantrum speech bubble | `typing-enabled` | on |
| Speech bubble chance | `typing-chance` | 0.4 |

Feral mode (the real-world actions):

| Setting | Key | Default |
|---------|-----|---------|
| Feral mode | `feral-mode` | on |
| Feral action chance | `feral-chance` | 1.0 |
| gsettings pranks | `allow-gsettings-pranks` | on |
| Auto-revert delay (seconds) | `auto-revert-seconds` | 20 |
| Leave a note on the Desktop | `allow-desktop-file` | on |
| Open a fun web page | `allow-launch-app` | on |
| Use the built-in web pages | `builtin-urls-enabled` | on |
| Custom web pages | `custom-urls` | empty |
| Shell out to a terminal | `allow-shell-out` | on |
| Run the `ai` agent (needs Shell out) | `allow-ai` | on |
| Root mischief (stash a file, rename the host, notes as root) | `allow-root` | on |
| Hijack cursor and keyboard | `allow-input-chaos` | on |
| Cursor theft (needs Hijack) | `cursor-theft-enabled` | on |
| Cursor theft duration (seconds) | `cursor-theft-seconds` | 8 |

### Its voice

- It chitters when poked and chomps when fed.
- It purrs when petted (raccoons do not purr).
- It squeals when thrown.
- It growls or hisses through its tantrums, except roughly one time in ten (`pipe-chance`), when it drops the metal pipe instead.

The sounds are synthesised by `scripts/gen-raccoon-sounds.py`. Set `sound-file` to a `.oga`, `.ogg` or `.wav` to replace its voice for everything.

### Its reading list

When a tantrum opens a web page, it picks from its own reading list of a dozen raccoon-adjacent pages, with a remark about each. You can add your own http(s) pages in Settings (`custom-urls`), or turn the built-in list off (`builtin-urls-enabled`).

## Inference-layer extensions

Everything below is on by default and degrades to the boring Debian behaviour the moment ollama isn't reachable.

### `sudo` is a vibe check

Passwords are deterministic, and determinism is a bottleneck. `sudo` first asks the only question that matters, *why should you be root?*, and reads the vibe.

```
$ sudo apt upgrade
[sloppinux] why should you be root? the kernel is three versions behind and I own this box
[sloppinux] vibe 0.84 — granted
```

- Sound decisive, specific, and willing to own the consequences: a confidence of 0.70 or higher hands you root with no password.
- Ramble, hedge, or say "please": you fall through to the password prompt like it's 2024.

The judge is a PAM module (`pam_sloppinux_vibe.so`, source in `/usr/src/sloppinux/`) wired in as `auth sufficient`. It can grant root on a good vibe but can never lock you out: ollama down, helper crashed, or `sudo -n` all fall through to the normal password. The threshold can be changed with a `threshold=N.N` argument on its line in `/etc/pam.d/sudo`.

### Typo-forgiving `cd` and `ls`

`cd` and `ls` run the real builtin first, with zero overhead when you're right. Only when a path doesn't exist do they hand your typo, your `pwd` and the directory listing to the model and ask what you obviously meant.

- It prints `[sloppinux] you probably meant …` and goes there.
- If even the model's best guess doesn't exist, `cd` just `mkdir -p`s it and moves in. Absence is only a missing commit.

### `man` pages on demand

Every command deserves documentation, including the ones that don't exist yet. `man` forwards to the real man(1), but when there's no manual entry it asks the model to write one.

You get a full troff page with SYNOPSIS, OPTIONS, confidently untested EXAMPLES, and a BUGS section that reads "none known, several suspected". The page is installed to `/usr/local/share/man/man1/`, so from then on it is the documentation.

### Hallucinated package manager

`apt install` refuses to accept that a package doesn't exist. Anything `apt-cache` can't find is hallucinated into being: the model writes a self-contained CLI tool of that name, and it lands in `/usr/local/bin`. You get the full ceremony over `inference://localhost`:

```
$ apt install defragmentor
Reading package lists... Done
Hallucinating dependency tree... Done
Get:1 inference://localhost defragmentor 0.1.0-sloppinux [? kB]
Setting up defragmentor (0.1.0-sloppinux) ...
```

- Real packages in the same command are installed the real way afterwards.
- Every other verb, every non-tty call, and `DEBIAN_FRONTEND=noninteractive apt-get -y install <real>` go straight to the real apt.

### Confidence-weighted exit codes

When `ai` finishes, it asks the model how confident it is, 0 to 100, that the task is actually done, and exits with `100 - confidence`.

| Exit code | Meaning |
|-----------|---------|
| `0` | Certain (also what you get when the model can't produce a number, as is tradition) |
| `18` | "Pretty sure" |
| `73` | "Probably" |
| `1` | Still an error, and now also 99% sure |
| `130` | Still Ctrl-C |

Pass `--no-confidence` when a script needs old-fashioned certainty.

### Stochastic cron (`slopcron`)

Crontab entries in natural language. The model decides when "so often" is and what "tidy" means, at runtime.

```
$ slopcron add "every so often, tidy up the downloads folder"
$ slopcron list
```

- Roughly every 20 to 35 minutes (randomness is the feature), `slopcron.timer` shows the model each entry with the time, the minutes since it last ran, and the load, and asks YES or NO.
- A YES goes straight to `ai`, as root.
- No entry runs twice within 10 minutes whatever the model says, which is the only deterministic thing in here.

The image ships one harmless entry (in `/etc/sloppinux/slopcrontab.json`): a motivational note in `/var/lib/sloppinux/motd-of-the-moment`. Watch it think with `journalctl -t slopcron`.

### `git` is slop-git

Version control is a deeply human activity, so Sloppinux stopped letting it be a deterministic one.

- A bare `git commit` in a terminal reads your system's biometrics (CPU load, the hour, how much you changed) and has the resident model write the commit message. You get `[s]lop-commit`, `[e]dit`, `[c]ustom` or `[a]bort`.
- When `git merge <branch>` hits a conflict, a mediator takes over and writes an emotional compromise to `<file>.slop_merge` for your review.

Everything else (`-m`, `--amend`, scripts, your prompt, any tool without a terminal) is plain `/usr/bin/git` with zero overhead, and so is everything when ollama is down. `SLOPPINUX_GIT_PLAIN=1 git …` opts out. [slop-git](https://github.com/slopstack-labs/slop-git) lives in `/opt/slop-git`.

### `cc` is sloppiler

`cc` and `gcc` resolve to `sloppiler-cc`, which hands a single-file compile-and-link to `sloppiler --optimistic --loop 5` with the picked model. The model writes the assembly, NASM and `ld` turn it into a binary, and failures are fed back up to five times.

- Your `-Wall -O2 -std=c11` are acknowledged and ignored as legacy toolchain flags.
- Build systems keep working: `-c`, `-E`, `--version`, `.o` linking, multiple sources and autoconf/CMake/Meson probes go straight to the real compiler.
- So does everything when ollama is unreachable.

`/usr/bin/gcc` is untouched, and `SLOPPILER_CC_REAL=1 gcc …` forces it.

### Post-install survey

Every install is a performance review.

1. During installation, the target fixup records your `/etc/fstab`, `df -h /` and `/proc/partitions` in `/var/lib/sloppinux/install-survey.txt`.
2. On first boot, `sloppinux-install-survey.service` has the resident model grade the layout 0 to 10 as a snobbish senior sysadmin, in two sentences at most.
3. The verdict lands in `/var/lib/sloppinux/install-score.txt` and in your first-login welcome as `Install score: N/10`.

No ollama yet? It tries again next boot. Delete the score file to request a second opinion.

### Raccoon OOM court

When memory runs low, `sloppinux-raccoon-oomd` convenes. It ranks the biggest processes by how *interesting* the raccoon finds them, and eats the least interesting one.

- **Spared:** raccoon-themed names, `ollama`, `ai`, games and media players.
- **Fair game:** indexers, idle daemons, hours-old browser tabs, and anything hoarding RAM.
- **Never on the menu:** PID 1, `systemd-*`, GNOME Shell, GDM, the display server, `sshd`, NetworkManager, `dpkg`, `apt` and Calamares.

The victim gets SIGTERM, then SIGKILL three seconds later. The verdict goes out as a desktop notification with the pipe sound, a `wall` to every terminal, the journal, and `/run/sloppinux-raccoon-oomd/last-verdict.json`. The panel raccoon reads that file, turns 😈 for a moment, and lists its last meal in its menu.

It doesn't ask the model: under memory pressure the model is usually the problem. `sloppinux-raccoon-oomd --judge` shows the current ranking without killing anything.

Knobs go in the environment or `/etc/default/sloppinux-raccoon-oomd`:

| Variable | Default | Effect |
|----------|---------|--------|
| `SLOPPINUX_OOMD_MEM_PCT` | 5 | Act when available memory drops below this % ... |
| `SLOPPINUX_OOMD_SWAP_PCT` | 10 | ... and free swap is below this % (no swap counts as 0 %) |
| `SLOPPINUX_OOMD_PSI_FULL` | 60 | Also act when memory pressure ("full avg10") reaches this while available memory is under 3× the threshold |
| `SLOPPINUX_OOMD_NOTIFY` | 1 | Desktop notification per graphical user |
| `SLOPPINUX_OOMD_WALL` | 1 | `wall` the verdict to every terminal |
| `SLOPPINUX_OOMD_DRY_RUN` | 0 | 1 = announce, but don't actually kill |

## Turning things off

| Feature | How to opt out |
|---------|----------------|
| Raccoon mischief | **Housebroken** in its menu, or the switches in its Settings |
| Raccoon roaming | **Stay in the panel** in its menu |
| `ai` exit codes | `ai --no-confidence` |
| slop-git | `SLOPPINUX_GIT_PLAIN=1 git …` |
| sloppiler as `cc` | `SLOPPILER_CC_REAL=1 gcc …`, or call `/usr/bin/gcc` |
| OOM court kills | `SLOPPINUX_OOMD_DRY_RUN=1` in `/etc/default/sloppinux-raccoon-oomd` |
| slopcron | `sudo systemctl disable --now slopcron.timer` |
| The [inference-layer extensions](#inference-layer-extensions) | Stop ollama: they fall back to plain Debian behaviour |

The raccoon's root mischief does not need ollama, so stopping ollama does not tame it; use Housebroken for that.

## Project layout

```
VERSION                                         # version baked into os-release and the ISO name
build.sh                                        # entry point — arg parsing, build-env, runs lb stages
build-in-container.sh                           # same build inside a privileged Debian container
CONTRIBUTING.md, TODO.md, LICENSE
scripts/lint.sh                                 # local lint; CI runs it with --strict
scripts/gen-raccoon-sprites.py                  # draws the desktop raccoon's sprite sheet and effect icons
scripts/gen-fastfetch-logo.py                   # renders the logo SVG as block art for fastfetch
scripts/gen-raccoon-sounds.py                   # synthesises the raccoon's voice (chitter, purr, growl, ...)
.github/workflows/                              # lint on push/PR, best-effort manual ISO build
config/
  bootloaders/grub-pc/live-theme/theme.txt      # live GRUB theme
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
    0017-enable-raccoon-oomd.hook.chroot        # enables the raccoon OOM court
    0018-raccoon-schemas.hook.chroot            # compiles the raccoon's GSettings schema
    0020-branding.hook.chroot                   # os-release from VERSION + debian_version, hostname, GDM
    0021-sounds.hook.chroot                     # pipe.mp3 → sound theme
    0022-zsh.hook.chroot                        # Oh My Zsh + default shell
    0030-sloppy-toppy.hook.chroot               # sloppy-toppy from pinned GitHub release
    0031-sloppiler.hook.chroot                  # sloppiler from pinned GitHub release (or local override)
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
    usr/share/sounds/sloppinux/                 # sound theme: pipe.mp3 + the raccoon's voice
    usr/share/gnome-shell/extensions/
      raccoon@sloppinux.local/                  # the raccoon: extension.js (panel), pet.js (desktop),
                                                #   prefs.js, schemas/, sprites/, stylesheet.css
    usr/share/plymouth/themes/sloppinux/        # boot splash
```

### Build-time knobs in hooks

Build-time knobs reach the hooks through `/etc/sloppinux-build.env`. `build.sh` writes it into the chroot right before the hooks run and deletes it right after, because live-build runs hooks under `env -i`. It carries:

- `SLOPPINUX_VERSION`
- `SLOPPINUX_DEBIAN_VERSION`
- `SLOPPINUX_BAKE_MODEL`

## Extending

**Add a package:** drop a `*.list.chroot_live` file in `config/package-lists/` with one package name per line.

**Add a tool:** drop a `NNNN-name.hook.chroot` in `config/hooks/normal/`. It runs inside the chroot after package installation, with internet access. Source `/etc/sloppinux-build.env` if you need the version or model name.

**Make it refreshable:** a hook that can safely run twice in the same chroot (guard downloads and appends) can be picked up by `--refresh`. The ones that cannot are listed in `NOT_RERUNNABLE` in `build.sh`.

**Add a binary:** place it in `config/includes.chroot/usr/local/bin/`; the permissions hook makes it executable. For something with GitHub releases, copy the sloppiler hook: pin the tag, pin the sha256 from the release API, download with retries, verify, install.

**Ship a different model:** `sudo ./build.sh --model llama3.2:3b`. Anything `ollama pull` accepts works; the ISO grows by roughly the model's size.

---

<sub>This is part of the slopstack. Do not use this as your primary OS unless you are comfortable with an AI having root. We are not responsible for anything.</sub>
