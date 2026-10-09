# Standalone HTML overlays

Marbles Stats creates these files in the live overlay folder shown in the app. The app writes their data directly. Streamer.bot custom-event hooks are a separate integration and are not required for these overlays.

## In-app help

Click **Help & variables** on the Overlays, Streamer.bot or Twitch page. The help dialog has illustrated setup steps, the complete custom HTML shell, a searchable field reference, examples and troubleshooting. Each overlay's **Edit HTML & variables** and each Streamer.bot event's **Variables** popup link to the full guide. Twitch cards have **Message help**.

The variable reference marks which fields are available in normal HTML state, WR/cycle alerts, Streamer.bot event arguments or repeated rows. Settings are listed separately and are not brace variables. The app labels variables with braces; Streamer.bot's native text fields require its own argument delimiter, which **Copy for Streamer.bot** supplies.

## Add to OBS

1. Click **Copy path** on an overlay card.
2. In OBS choose **Sources + > Browser > Local file** and paste the HTML path. Use the size shown on the card: defaults are **400 x 413** for Results, **400 x 300** for Podium, **400 x 260** for Points, or your canvas size (usually **1920 x 1080**) for celebrations.
3. Position Results, Podium and Points using their live match data. Click **Test** on World record or Cycle completed to position those celebrations.

Leave the source enabled. Results/podium/points stay visible; WR/cycle celebrations show on their events and hide after 10 seconds by default. Open **Customize** and set **Duration (seconds)** on each celebration card in the app and click **Save** (1–300 seconds). Saved durations persist and override the corresponding overlay-config.js duration; future events use them automatically. Place celebration sources above the rest. WR requires a confirmed record; automatic WR detection from the current CSV is not available yet, but the test works.

## Basic styling in the app

Click **Customize** at the right of each card's buttons. Change width/height, background opacity and color, text/secondary/accent/gold/green colors, and header visibility or text. Results also supports visible player count and scrolling speed; its height is automatic from that count and header visibility. Background opacity uses a slider for every overlay. The thumbnail previews unsaved edits. **Save** applies that overlay's settings to the live source within its next 3-second data check. These settings persist separately for each overlay.

After resizing, set your OBS Browser Source's width and height to the updated size on the card; the app does not change OBS properties. Very small dimensions can cut off content. **Restore defaults** resets the app controls without replacing your HTML/CSS edits. An empty header uses the original heading. A custom heading is plain text, not a variable template. Generic custom.html pages retain their own styles; these controls apply to the five premade overlays.

## Customize the HTML

Every overlay's layout is in its HTML file. JavaScript binds values and repeats the row template; it does not replace the page layout.

1. Copy the file path from the app. In Notepad choose **File > Open**, paste it, and select **All files** if necessary.
2. Edit the markup inside `<main id="overlay">`. For example:

```html
<p>{race} winner: {firstplace} (+{firstplacepoints} points)</p>
```

3. Save the HTML and refresh that OBS Browser Source. Normal overlays use the latest processed match. For WR or Cycle celebrations, use their **Test** button in the app to see sample data.

These braces work in HTML text inside `#overlay`, and in `title`, `alt`, and `aria-label` attributes. **They do not work in OBS's own text field or in Streamer.bot text fields.** OBS displays the browser page; `overlay.js` fills the page's bindings from the app's data files. Missing values are blank. Names are inserted as text, so player-supplied markup cannot become HTML.

The **Edit HTML & variables** link on each app card has a copyable example and the relevant page/row fields. Built-in app thumbnails show bundled samples, not your edited live files. View your edited live HTML in OBS or a browser.

| HTML file | Page variables | Row template variables |
| --- | --- | --- |
| `results.html` | `{race}`, `{mapName}`, `{firstplace}`, `{firstplacepoints}` | In `placements`: `{name}`, `{place}`, `{time}`, `{points}`, `{kills}`, `{damage}` |
| `podium.html` | `{firstplace}`, `{firstplacepoints}`; equivalent `secondplace` / `thirdplace` fields | Same player fields as Results; `data-limit="3"` limits the HTML repeater |
| `points.html` | `{matchPoints}`, `{sessionPoints}`, `{seasonPoints}` (all Race + BR player points combined) | None |
| `world-record.html` | `{wrplayer}`, `{wrrecordtime}`, `{wrplayerpoints}`, `{mapName}` | None |
| `cycle-complete.html` | `{cycleSeasonName}` | In `cycleCompletions`: `{playerName}`, `{cycleNumber}`, `{races}` |

`{name}` belongs inside a player-row template. For the winner outside the table, use `{firstplace}`. A repeating template receives the page values plus the current item's values.

## Editable repeated rows

Edit the markup inside `<template>` to change each player's row. Keep the `data-repeat` container and the template:

```html
<ul data-repeat="placements" data-key="playerKey">
  <template>
    <li>{place}. {name}: {points} points</li>
  </template>
</ul>
```

JavaScript clones this HTML once per player and reuses its nodes on later updates. Remove `data-limit` to show every player. Results already shows everyone and scrolls smoothly down and back up.

## Number animations and visibility

Plain `{sessionPoints}` text changes immediately. To count smoothly between values:

```html
<span data-number="sessionPoints">{sessionPoints}</span>
<span data-number="firstplacetime" data-decimals="3" data-suffix="s">{firstplacetime}</span>
```

Numeric bindings show a dash for unavailable values. `data-show="br"` shows an element for Battle Royales; `data-show="isRace"` shows it for Races. Player rows also expose `winner`, `dead`, and `ordinary` booleans. `data-class="winner:winner dead:dead"` applies those row classes. These are binding attributes, not OBS settings.

## Make a new overlay

Copy `custom.html` in the live folder to a new name, edit its HTML/styles, and add that new file as an OBS **Local-file Browser Source**. Keep `id="overlay"`, the script links, and the file beside `overlay.js` and the data files. No additional action or server is needed.

For a custom WR/cycle celebration, copy `world-record.html` / `cycle-complete.html` instead. Keep its body's `data-overlay` value so the binder reads the correct alert file and preserves event deduplication and expiry.

Edit `overlay.css` for shared styling, or add a `<style>` block to your own HTML for its individual design. `overlay-config.js` controls branding, colors, scale, scrolling speed, alert duration, and count speed. `animate: false` disables motion; `countMilliseconds` sets counting duration. Refresh OBS after design edits.

The app preserves custom HTML/CSS/config edits and recreates missing defaults. During normal updates it writes only the data scripts. Startup restores saved display data without recounting matches; session totals start at zero. Resetting stats updates the corresponding overlays.

## Blank source?

Send an overlay test, check OBS uses the exact HTML path with **Local file** enabled, and keep Marbles Stats running. Check Live log for an `[Overlay]` write warning. WR/cycle alerts expire, so test again to show them. **Open preview** in the app always shows an animated bundled sample.

## Binding checks

Run `node tests/overlays.mjs` from the repo for template contract checks. For actual DOM checks, serve the repo as static files on localhost and open `tests/overlays-browser.html`. These checks do not launch or compile the Tauri application.

## Live updates and current data limits

The HTML loads its data immediately and checks again every **3 seconds**. Keep Marbles Stats running. Save/refresh the OBS Browser Source after editing HTML or configuration; normal data changes update automatically without rewriting your layout.

Normal custom pages read `overlay-data.js`: latest match plus session/season totals. A Race or BR replaces the latest match; there are no separate last-Race/last-BR bindings. WR pages read `world-record-data.js`; cycle alerts read `cycle-complete-data.js`. Copy a celebration template to make an alert with the same data/timing; generic `custom.html` does not automatically read alert-only fields.

Dotted paths such as `{placements.0.name}` select rows in placement order. Indexes start at zero and are not placement numbers. Missing text values are blank. This works in HTML, not as a Streamer.bot argument. Only first/second/third currently have direct name/points arguments in Streamer.bot; arrays require additional custom processing there.
