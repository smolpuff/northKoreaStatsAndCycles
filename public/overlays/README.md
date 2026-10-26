# Standalone HTML overlays

Marbles Stats creates these files in the live overlay folder shown in the app. The app writes their data directly. Streamer.bot and Lumia custom-event hooks are separate optional integrations and are not required for these overlays. Lumia commands are invoked directly through its local API, without posting chat messages. Configure automation effects in your chosen integration; its master Enable switch controls automatic hooks and sidebar status visibility. Discord channel messages are also independent of overlays and can be configured on the Discord page directly above Overlays. Overlay rendering remains independent.

## In-app help

The separate **Stream Deck** integration installs two physical tracker-control keys (RaceStats and RaceCycles) through the bundled Marbles Stats Controls plugin. Keep Marbles Stats open or minimized so the keys can control trackers and display live status. These controls use the same tracker commands as the dashboard; overlay rendering and OBS setup remain as described here. MoS Drop is a separate plugin, installed with its own button on the same page.

Twitch supports optional `!mycycles` (`!mycycle` alias) and `!mystats` viewer commands, independently of overlays and automation hooks. Enable each on the Twitch page before connecting (reconnect once for chat reading permission). While the app is open, it listens in that account's own channel. `!mycycles` replies with the requester's saved RaceCycles totals, progress and missing placements. `!mystats` replies with session participation (your races out of total stream races), session earned points, and all-time tracked races/points from saved RaceStats history. Session means since app startup, not a calendar day or Twitch broadcast; stopping/starting tracking keeps it, while clearing RaceStats resets it. Race counts exclude BR; earned points include Race + BR. All-time totals depend on retained history; clearing history removes those totals. Each command allows one reply per viewer per 30 seconds, so !mystats does not suppress !mycycles. The !mycycle alias shares the !mycycles cooldown. Other viewers do not consume your cooldown, and there is no app-wide command reply cap. Duplicate-message protection remains. Disabled commands do not consume the cooldown.

Click **Help & variables** on the Overlays, Streamer.bot, Lumia Stream, Discord or Twitch page. The help dialog has illustrated setup steps, the complete custom HTML shell, a searchable field reference, examples and troubleshooting. Each overlay's **Edit HTML & variables** and each Streamer.bot event's **Variables** popup link to the full guide. Twitch and Discord message cards have **Message help**. Discord includes four matching illustrated setup cards for channel webhooks, event selection, message editing and tests; it needs no shared developer app or bot token.

The Custom HTML help tab also lists its variables directly, with player/cycle row fields, settings and separate celebration-only groups. Discord shares one Race / BR results switch, channel and message template; `{race}` identifies the match type.

The variable reference marks which fields are available in normal HTML state, WR/cycle alerts, Streamer.bot event arguments or repeated rows. Settings are listed separately and are not brace variables. The app labels variables with braces; Streamer.bot's native text fields require its own argument delimiter, which **Copy for Streamer.bot** supplies.

## Add to OBS

1. Click **Copy path** on an overlay card.
2. In OBS choose **Sources + > Browser > Local file** and paste the HTML path. Use the size shown on the card: defaults are **320 x 246** for Results, **320 x 168** for Podium, **320 x 146** for Points, or your canvas size (usually **1920 x 1080**) for celebrations.
3. Position Results, Podium and Points using their live match data. Click **Test** on World record or Cycle completed to position those celebrations.

Leave the source enabled. Results/podium/points stay visible; WR/cycle celebrations show on their events and hide after 10 seconds by default. Open **Customize** and set **Duration (seconds)** on each celebration card in the app and click **Save** (1–300 seconds). Saved durations persist and override the corresponding overlay-config.js duration; future events use them automatically. Place celebration sources above the rest. Automatic WR alerts require changed record metadata matching the completed match?s map, winner and time; old records on startup do not trigger alerts. Use **Test** to position the source without a real record.

## Basic styling in the app

Click **Customize** at the right of each card's buttons. Change width/height, background opacity and color, text/secondary/accent/gold/green colors, and header visibility or text. Results also supports visible player count and scrolling speed; its height is automatic from that count and header visibility. Background opacity uses a slider for every overlay. The thumbnail previews unsaved edits. **Save** applies that overlay's settings to the live source within its next 3-second data check. These settings persist separately for each overlay.

After resizing, set your OBS Browser Source's width and height to the updated size on the card; the app does not change OBS properties. Very small dimensions can cut off content. **Restore defaults** resets the app controls without replacing your HTML/CSS edits. An empty header uses the original heading. A custom heading is plain text, not a variable template. Generic custom.html pages retain their own styles; these controls apply to the six premade overlays.

The compact templates use small headers, 26px player rows, and the app's checkered flag / sword icons for Race / BR. Cycles uses the Race flag and stays wider to fit all ten placement counts. Existing custom sizes are preserved; choose **Restore defaults** to adopt the compact source sizes. Unmodified live templates update on the next app startup; edited HTML/CSS stays preserved. Refresh OBS after the template update. Celebrations retain their full-screen layout.

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

BR winners' earned CSV points contribute to both `{sessionPoints}` and `{seasonPoints}`. Blank earned points, including bot simulations, contribute 0; cumulative CSV season totals are not match points.

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

## Preview checks

Hover over each thumbnail to start its animation; moving away stops the sample. **Open preview** starts playback immediately and can be repeated. Samples are bundled and do not trigger Streamer.bot actions or Twitch messages. Test live output separately with OBS using the editable files in the app?s overlay folder.

## Live updates and current data limits

The HTML loads its data immediately and checks again every **3 seconds**. Keep Marbles Stats running. Save/refresh the OBS Browser Source after editing HTML or configuration; normal data changes update automatically without rewriting your layout.

Normal custom pages read `overlay-data.js`: latest match plus session/season totals. A Race or BR replaces the latest match; there are no separate last-Race/last-BR bindings. WR pages read `world-record-data.js`; cycle alerts read `cycle-complete-data.js`. Copy a celebration template to make an alert with the same data/timing; generic `custom.html` does not automatically read alert-only fields.

Dotted paths such as `{placements.0.name}` select rows in placement order. Indexes start at zero and are not placement numbers. Missing text values are blank. This works in HTML, not as a Streamer.bot argument. Only first/second/third currently have direct name/points arguments in Streamer.bot; arrays require additional custom processing there.

### Cycle status ? cycle-status.html

Use a **680 x 482** Browser Source by default. Larger 135% text and 36px rows show 10 players at once and scroll through all tracked players at 8 px/s by default (Results stays at 20 px/s). Standalone templates use `cycleScrollPixelsPerSecond` in `overlay-config.js`; app customization overrides it. Customize font size (75-200%), visible row count, width, colors and scroll speed in the app; source height adjusts automatically. Font size is available on every overlay. For scrolling tables, row height is `ceil(26 x font size / 100)` and header space is scaled with the text. After saving, copy the new source dimensions into OBS. Existing saved sizes remain until changed or restored to defaults. The Progress column shows distinct placements toward the next cycle, such as 4/10; stacked placements carry forward.

Columns show rank, player, completed cycles, total placement counts for positions 1-10, and **Left** (positions still needed for the next cycle). Completed cycles stay gold; Left uses muted text so the remaining count does not compete with completed cycles. Green cells mark positions whose counts exceed the completed-cycle count. All extra placements carry forward. The data comes from `cycleStandings`, ordered by completed cycles, current progress, then name. Empty standings hide the overlay. It uses live `overlay-data.js` and stays visible; use your source visibility controls to show it when needed.


Cycles uses Race results only. Placement counts 1-10 always accumulate; the minimum count is the number of completed cycles. Extra placements carry forward and are never reset by completion. Cycle status shows positions already filled beyond the completed cycles. Clearing current stats or Cycles results updates overlays while preserving their independent local histories; the clear dialog optionally saves a timestamped JSON backup first.

The Cycles page imports public Marble Cycle session placements into Cycles only through its **Import** dialog, without creating RaceStats results or changing normally recorded RaceStats standings. Session HTML downloads support up to 100 MB with a three-minute request timeout. RaceStats has a separate disabled Import placeholder; Import, Export and the Latest Results event picker sit at the top right, with the picker immediately after Export. Player search sits in the results header. Cycles Import and Export stay together at the right end of the watcher row, its Import button opens the session dialog, and player searches filter the tables without displaying a result count. Imported finished Race placements use the same cumulative scoring and update overlay standings; BR wins always import as cycle 1st places without increasing Race counts; historical import does not replay old celebration alerts or integration actions. Original dates/tracks unavailable from the source remain unknown. Participation counts are shown in the app's player cards and main Cycles table; older incomplete records use minimum known counts.

Confirmed world-record holders have a gold row highlight and WR badge in the app results and Results/Podium overlays, including delayed confirmations. A normal winner keeps its usual treatment until a record is confirmed.

Overlay data contains result/stat fields, not Twitch tokens or integration credentials. Result bindings insert text rather than interpreting player names as HTML. In-app previews use bundled templates under the app's security policy. Custom HTML/JavaScript in OBS runs as code you choose to trust; use reviewed templates and keep secrets out of them.

The app bundles the local Windows MoS DropGate v0.4.4.6 installer from the standalone project, including mosDropGate and the separate mosCompGate action. Open it from the Stream Deck settings page; the version comparison detects older installations.

Default settings: automatic RaceStats start, automatic RaceCycles start, and Start minimized are off. Automatic update checks and mission app promotional chat messages are on. Promotional messages require Twitch to be connected and wait 30 minutes before the first post, then repeat every 60 minutes. Saved settings retain your choices.

Saved stats remain JSON. Startup loads them in the background while the window shows its loading screen. Unused historical leaderboard copies are omitted; game results, player earnings and current totals remain available. The first successful compacted save keeps the original as `race-state-before-history-compaction.json` in the app data folder.

Overlay data, alerts, duration/customization settings and default-template metadata use buffered atomic saves. Identical state packets skip both serialization and rewriting. Saving settings refreshes existing data-file prefixes without rebuilding the saved packet; custom HTML/CSS edits remain preserved.

Mission promotion messages: edit the text in Settings > mission promotion > Options, using `{url}` for `https://www.missions.lol`. Compact timing controls sit above the 50/50 message editor and preview. The preview, test and scheduled posts use the same saved template; blank text restores the default. Timing and Twitch login requirements are unchanged. Default Twitch result intros use `{race} results ({mapName}):`; both old untouched `Race results:` and `{race} results:` default intros upgrade automatically, while custom intros/overall templates are preserved. Missing map names show Unknown track.

Twitch message editors have an **smile icon** button next to the input. Its compact popup lists only custom emotes created for the signed-in account's own channel, using 20 px images and a searchable scrolling grid. It inserts the emote code at the cursor without posting. The existing Twitch login works without additional emote permissions. Picking refreshes the text preview; Save applies the draft. Other channels' subscription emotes and global emotes are excluded. Images load from Twitch's CDN; tokens remain in native Windows credential storage.

Twitch emote pickers are available only for Twitch chat messages, including the optional mission promotion labeled **Promote Korea's Mission App on stream**. Promotion sends Twitch chat only. All Twitch player placeholders automatically use `@username`; existing `@{player}` templates also produce a single mention. Race/BR posts use **Each placement** for every position; older separate podium overrides are ignored. Discord, Lumia, Streamer.bot and overlays retain their own formats.

RaceStats and RaceCycles controls show pending feedback independently. Live Log shows newest entries first with compact timestamps, scanned filenames, Race/BR winners and cycle completions. The window uses a transparent custom title bar with minimize, maximize/restore and close controls. Lumia shows setup guidance and **Configure Lumia** until an API token is saved securely; **Remove API token** appears only after setup. The MoS DropGate preview bundles the real `rmrfkoHeart` emote for offline display.
