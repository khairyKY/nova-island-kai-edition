<div align="center">

# Nova Island · Kai Edition

**An unofficial edition of [Nova Island](https://github.com/NOVA-TECH-KIT/nova-island) by AmerTech, tuned for smoothness.**

[**Download the latest release**](../../releases/latest) · Windows 10/11 (64-bit) · GPL v3, like the original

![Meet Nova Island](promo/en/01-hero.png)

</div>

> This is a fork, not the official app. All credit for Nova Island goes to its creator, [NOVA-TECH-KIT](https://github.com/NOVA-TECH-KIT/nova-island). Please report problems with this edition here, not to the original project.

## What's different in this edition

- **Smoother:** spring morph between island sizes, sliding tab highlight, cross-faded glass, smoothed audio meter, and no main-thread screen capture (the glass samples a few pixels through the native helper), so hover and Alt+Tab never freeze.
- **Media:** player logos, artwork-coloured controls, a live 5-band meter, a paused player stays on the island, and an optional Spotify "like" button.
- **Companions:** Phoenix and Zaher, alongside classic Nova.
- **Kai's Flow:** botanical themes and Kai's Flow notifications (bundled plugin).

## Install

1. Download `Nova-Island-Kai-Edition-Setup-x.y.z.exe` from [Releases](../../releases/latest) and run it.
2. Windows may show "Windows protected your PC" because the app isn't code-signed. Choose **More info → Run anyway**.
3. The island appears at the top of your screen. Press **Ctrl + Alt + I** to open it.

**Already have Nova Island?** This edition installs as a separate app, with its own folder and settings (it copies your Nova Island settings on first run). If the original is running, it asks once whether to turn it off: that closes it and removes it from startup, without uninstalling it. Choose **Keep both** to leave it alone. You can uninstall either from Windows Settings → Apps.

Updates come from this repository's releases (never the original's) and install when you quit the app. Turn them off with **Auto-update** in Settings.

## Features

### Say hi to Nova
A little companion who lives in your island. Nova keeps you company while you focus, welcomes you back, cheers your wins, and reminds you to drink water and rest your eyes.

![Nova](promo/en/02-nova.png)

### Keeps playing while you browse
Title, artwork and live waveforms of whatever is playing, plus a floating mini player in one click.

![Browser](promo/en/03-browser.png)

### Never miss a prayer
Prayer times with a heads-up before the adhan, plus dhikr, du'a and Qur'an verses in the KFGQPC Hafs script, as often as you choose.

![Prayer](promo/en/06-faith.png)

### Downloads, at a glance
Progress, speed and time left while you work, with IDM Nova — pause, resume or open a file in one click.

![Downloads](promo/en/04-downloads.png)

### Make it yours
13 free themes in Settings → Themes, from liquid glass to pure black, sakura pink and pixel green. None of them makes Nova heavier, and the solid ones are even lighter.

![Themes](promo/en/08-themes.png)

### Smart about what you do
Copy a link, a sum or a color and the island knows what to do with it. It also lets you know when an app turns on your mic or camera.

![Smart](promo/en/05-smart.png)

### Your island, your way
Turn on only what you need from one simple settings window. Vertical on the screen edge, hides in full screen, starts with Windows.

![Settings](promo/en/07-settings.png)

## Build from source

```bash
npm install
npm start          # run it
npm run dist       # build the installer into dist/
```

### Local Kai’s Flow plugin

The installer adds the bundled Kai’s Flow plugin on first run (also in `local-plugins/kais-flow.nvp`, for **Settings → Plugins → Install from file**). It is signed with this edition's own key, which this build trusts alongside the original's.

The plugin enables **Kai’s Flow · Day Garden**, **Night Garden**, **Pressed Fern Day** and **Pressed Fern Night** under **Settings → Themes**. All four use Nova's captured desktop glass with botanical tint, reflective edges and artwork accents. Remove blur, battery saver and screen recording retain the theme's solid colours. Its **Kai’s Flow notifications** switch mirrors local focus and task reminder toasts from the patched Windows build of Kai’s Flow over a local named pipe.

The **Opera GX docking** switch uses an estimated toolbar slot when GX leaves its address bar out of Windows UI Automation. Rest the pointer over the pill briefly, then move into the expanded panel. The **Alt+Tab behavior** switch hides the island during task switching and restores its position for the next foreground window.

The browser's idle stats slide adds battery level and a compact local clock beside CPU and RAM. It trims icons and bars, then hides extra readings as space gets tighter, accounting for the island's scale. Battery is omitted on devices without one; desktop and side-docked stats keep their existing layout.

All island clocks use 12-hour time with AM/PM. The island stays visible in Windows screenshots: glass derives its soft backdrop colours from outside the overlay window, avoiding recursive captures without enabling Windows content protection. This is an ambient approximation of the surrounding screen rather than an exact capture underneath the island.

### Media sources and Spotify

The pill, source badge and Media tab display the selected player's logo. **Settings → Island → Browser media sources** opens the companion folder. Load it once as an unpacked extension in Opera GX, Chrome or Edge. The packaged app registers its native messaging host automatically. Browser metadata stays local and temporary. Uncertain, conflicting or stale matches retain the browser icon. No tabs are activated and browser UI Automation is not used for source detection.

The media pill and Now Playing panel use the current artwork's colours when available (the play button uses a saturated version). Sessions without usable artwork use the player's colour instead.

Now Playing meters show five bands from the default Windows playback mix, from 45–180 Hz on the left to 4.5–12 kHz on the right. The middle bands cover 180–500 Hz, 500 Hz–1.5 kHz and 1.5–4.5 kHz. Samples stay in the native helper, and analysis runs only while the meter is visible and playback is active. Bars flatten on pause or mute. The Spotify heart has its own space beside the meter.

The panel opens after the cursor rests on the pill for a quarter second and closes a moment after it leaves; its hitbox jumps to the final size while the island springs there. On side docks, the idle pill splits the clock and AM/PM for readability. Text notices, media previews, reminders and scenes open inward. Volume and brightness retain their narrow meters.

Under **Settings → Island → Spotify**, enter a personal Spotify application's public Client ID. Register `http://127.0.0.1:8989/login` in its developer dashboard, then select Connect Spotify. Authorization uses PKCE without a client secret and persists the session with Windows encryption. The heart saves or removes the identified track from Liked Songs. It appears only for Spotify, waits for a matching track ID, and restores its previous state when a write fails. Native playback continues independently of API requests. This integration does not create or manage Spotify Jams.

Windows media-session events refresh the player as tracks, playback and position change, backed by a 500 ms poll. Spotify lookups run quietly for the heart: rapid skips cancel obsolete lookups, recent matches restore immediately, and background checks never block a known heart. Cloud delays and ads do not add a waiting banner; connection diagnostics remain in Settings. Save confirmations dismiss automatically.

### Phoenix companion

**Settings → Companion** selects Phoenix, Zaher seated, Zaher standing, Classic Nova or Hidden. Phoenix and seated Zaher each have 13 poses, with a saved toggle and preview per state. Standing Zaher adds a separate idle pose and uses the seated artwork for reminders. Disabling artwork leaves the reminder text and action buttons available.

Idle poses follow the existing nearby-pointer dwell behavior, and resting appears while away. Focus completion moves through completion, celebration and break poses; logging water uses drinking and celebrates the daily goal. Phoenix shares the island's window, scales with it and supports browser and side docking. The source PNGs are preserved. `npm run prepare:phoenix` (add `-- --zaher` for Zaher) prepares 384-pixel transparent copies, cropped to the figure, under `assets/*-v1/ui`; only those copies are packaged.

Scene activation ignores delayed frames after expiry, dismissal or replacement, so waking or showing the window cannot leave a welcome card behind without its companion. Closing also clears an already orphaned card.

## Support the original creator ☕

Nova Island is free, with no ads and no tracking. If this edition makes your day a little better, support the people who made Nova Island:

- **Ko-fi** (cards, PayPal): [ko-fi.com/binamer](https://ko-fi.com/binamer)
- **InstaPay** (Egypt): [Send via InstaPay](https://ipn.eg/S/binamerbm/instapay/38txJO)

Stars ⭐ and sharing it with a friend help a lot too.

## License

Nova Island is free software, licensed under the [GNU General Public License v3.0](LICENSE). This edition is a modified version under the same license.

Copyright © 2026 Nova Island by AmerTech. Kai Edition changes © 2026 Khairy Shaheen.

The Qur'an font in `fonts/` (KFGQPC HAFS Uthmanic Script by the King Fahd Glorious Quran Printing Complex) is included unmodified under its own license — see [fonts/KFGQPC-LICENSE.txt](fonts/KFGQPC-LICENSE.txt). It is not covered by the GPL.

The name "Nova Island" and its logo are not covered by the GPL; please use a different name for modified versions.
