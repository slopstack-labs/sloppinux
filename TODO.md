# Open items

What is still unproven or unfinished after the October 2026 round. The
installer (BIOS and UEFI, erase disk, ext4), the offline grub-pc swap, the
zsh default and the raccoon's root mischief were verified on 2026-10-06 by
installing the ISO into QEMU VMs and booting the results. What is listed
here was not.

## Needs a real test

- **Encrypted install.** `cryptsetup-initramfs` and `keyutils` now ship in the
  image and are marked manual so the installer's autoremove keeps them, but
  no LUKS install was run. Tick "Encrypt system" once and see if it boots.
- **Raccoon input tantrums.** Root mischief was observed on GNOME 48 (it
  stashed a file and left a Desktop note, both owned by the user). The cursor
  drag and keyboard mash were not: they use Clutter virtual input devices
  (`create_virtual_device`, `notify_absolute_motion`, `notify_keyval`), wrapped
  in try/catch with a cosmetic fallback, so a wrong API name fails quietly.
  Check `journalctl -b | grep raccoon` for "no virtual pointer" / "no virtual
  keyboard". To get tantrums quickly: `gsettings --schemadir
  /usr/share/gnome-shell/extensions/raccoon@sloppinux.local/schemas set
  org.gnome.shell.extensions.raccoon boredom-max 2`.
- **Raccoon odds and ends.** Not looked at in a session: the Settings window,
  middle click poking without opening the menu (`vfunc_event` override on
  `PanelMenu.Button`), the walker / chase / sparkle overlays, and the gsettings
  pranks reverting after `auto-revert-seconds` and on disable.

## Decisions for a human

- **NVIDIA drivers ride along by accident.** ollama's install script detects
  the build host's GPU, so a build on an NVIDIA machine bakes about 50
  `cuda-*` / `nvidia-*` packages (and the CUDA apt repo) into the ISO, and a
  build elsewhere does not. That is roughly 0.9 GB, and
  `nvidia-persistenced.service` then fails on every machine without the card.
  Either make it deliberate (always install, or never) or hide the GPU from
  the installer in hook 0010.
- **Installed apt sources are Debian's, not ours.** Calamares' `sources-final`
  step (from `calamares-settings-debian`) overwrites `/etc/apt/sources.list`
  with `main non-free-firmware` plus backports. The live image has
  `main contrib non-free non-free-firmware`. Override the step if the
  installed system should keep the wider set.

## Smaller issues seen while testing

- **Boot menus are stock.** Booting the ISO under BIOS shows live-build's
  default isolinux menu ("Debian GNU/Linux 1.0 (trixie)", hard-hat logo);
  under UEFI it is a bare GRUB list. Neither is branded and both wait for
  Enter instead of counting down.
- **Installer window is taller than a 1024x768 screen.** On the Summary page
  the Install button ends up below the edge. Alt+I still works.
- **fastfetch logo.** The ASCII logo prints a stray "ard" at the left edge of
  an 80-column terminal.
- **`live-tools` warning.** The packages step logs "Could not remove package
  live-tools": it was already autoremoved together with `live-boot`. Harmless,
  which is what `try_remove` is for.

## Elsewhere

- The feral-mode work in `../raccy` is still uncommitted in that repo.
