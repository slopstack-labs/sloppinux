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
- **Raccoon odds and ends.** Not looked at in a session: middle click on the
  panel icon poking without opening the menu (`vfunc_event` override on
  `PanelMenu.Button`), the emoji walker / chase / sparkle overlays (only used
  when the desktop pet is switched off), and the gsettings pranks reverting
  after `auto-revert-seconds` and on disable.
- **Desktop pet, the parts a screenshot cannot show.** Seen working in a
  live GNOME 48 session (Wayland, software rendering, 100% scale): the
  sprite animations, roaming, pick up / dangle, throw / tumble / sulk,
  petting with hearts, feeding with the fullness meter, "Go to your room"
  and "Let it out", the Settings window, and cursor theft: the pointer
  follows the raccoon, the real cursor is hidden while it is carried, and a
  couple of seconds of wiggling shakes it off. Not confirmed:
  - cursor theft in GNOME Boxes / SPICE and on real hardware. It was tested
    in plain QEMU with software cursors. With an absolute pointer the host
    draws the cursor, so the trick there rests entirely on the guest hiding
    it (`set_pointer_visible(false)`, reapplied every tick); if the host
    cursor stays visible, nothing looks stolen;
  - HiDPI and fractional scaling (the pet's size is fixed when it is
    created, and the sheet is scaled by St, so expect soft pixels at 200%);
  - hiding while a window is fullscreen (`in-fullscreen-changed`);
  - the hungry walk, the zzz and anger effects, middle click, and an X11
    session (the pet is a plain uiGroup child with no input-region
    tracking, which only Wayland forgives);
  - disabling the extension in the middle of a drag.
  The pet's hit box is the full 96px square, so clicks on the transparent
  corners are eaten.

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
