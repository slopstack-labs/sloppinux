# Open items

What is still unproven or unfinished after the October 2026 round. Everything
here was found while live-patching a running Sloppinux 1.0 VM in GNOME Boxes.

## Needs a real test

- **Raccoon tantrums on GNOME 48 Wayland.** The new extension was copied into
  the VM and the session restarted, but no tantrum was observed afterwards.
  The cursor drag and keyboard mash rely on Clutter virtual input devices
  (`create_virtual_device`, `notify_absolute_motion`, `notify_keyval`). Those
  calls are wrapped in try/catch and fall back to the cosmetic tantrum, so a
  wrong API name fails quietly. Check `journalctl -b | grep raccoon` after a
  tantrum. To trigger one quickly, temporarily drop `BOREDOM_MAX` to 2.
- **Installer end to end.** The packages-step fix is in the hook and was
  applied to the running VM, but no reinstall was run after it. Confirm the
  install finishes, the target boots, and `calamares-settings-debian` is gone.
- **BIOS bootloader.** The target fixup tries `apt-get install grub-pc`, but
  the target has no apt lists during install, so that install cannot succeed
  offline. `grub-install --target=i386-pc` should still work from
  `grub-pc-bin`. Verify a BIOS install actually boots.

## Not done yet

- **Raccy feature parity.** The bundled raccoon still lacks most of what
  `../raccy` has: poking (menu item and middle click), the GSettings schema
  with a preferences window, nag bubbles, walking, cursor chase, sparkles and
  the typing bubble. The goal is raccy's full feature set with feral and
  root access on by default.
- **Root commands block the shell.** `rootRun()` in the raccoon calls
  `communicate_utf8` synchronously, which freezes GNOME Shell until the
  command finishes. Switch to `communicate_utf8_async`.
- **Root-owned leftovers.** `~/.raccoon-stash/` and the Desktop notes are
  created by root, so the user cannot clean them up without sudo. Either chown
  them to the user or accept it as part of the joke and say so in the README.

## Smaller issues seen in the logs

- **Duplicate apt sources.** `/etc/apt/sources.list.d/contrib.list` repeats
  every line of `sources.list` with a doubled `contrib contrib` area, so every
  apt run prints a wall of "configured multiple times" warnings. It appears
  during the build, but nothing in this repo writes it yet. Find the source.
- **No hwclock in the target.** Calamares' hwclock step exits 127. On trixie
  `hwclock` lives in `util-linux-extra`, which is not in the package lists.
- **Live patching is painful.** The VM has no guest agent, so patches went in
  through `virsh send-key`, which drops and reorders characters. Adding
  `qemu-guest-agent` and `spice-vdagent` to the live package list would make
  this much easier.

## Elsewhere

- The feral-mode work in `../raccy` is still uncommitted in that repo.
