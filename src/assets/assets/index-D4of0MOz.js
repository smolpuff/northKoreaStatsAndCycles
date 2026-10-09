(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))a(r);new MutationObserver(r=>{for(const c of r)if(c.type==="childList")for(const i of c.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&a(i)}).observe(document,{childList:!0,subtree:!0});function o(r){const c={};return r.integrity&&(c.integrity=r.integrity),r.referrerPolicy&&(c.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?c.credentials="include":r.crossOrigin==="anonymous"?c.credentials="omit":c.credentials="same-origin",c}function a(r){if(r.ep)return;r.ep=!0;const c=o(r);fetch(r.href,c)}})();function ve(e,t=!1){return window.__TAURI_INTERNALS__.transformCallback(e,t)}async function g(e,t={},o){return window.__TAURI_INTERNALS__.invoke(e,t,o)}var J;(function(e){e.WINDOW_RESIZED="tauri://resize",e.WINDOW_MOVED="tauri://move",e.WINDOW_CLOSE_REQUESTED="tauri://close-requested",e.WINDOW_DESTROYED="tauri://destroyed",e.WINDOW_FOCUS="tauri://focus",e.WINDOW_BLUR="tauri://blur",e.WINDOW_SCALE_FACTOR_CHANGED="tauri://scale-change",e.WINDOW_THEME_CHANGED="tauri://theme-changed",e.WINDOW_CREATED="tauri://window-created",e.WINDOW_SUSPENDED="tauri://suspended",e.WINDOW_RESUMED="tauri://resumed",e.WEBVIEW_CREATED="tauri://webview-created",e.DRAG_ENTER="tauri://drag-enter",e.DRAG_OVER="tauri://drag-over",e.DRAG_DROP="tauri://drag-drop",e.DRAG_LEAVE="tauri://drag-leave"})(J||(J={}));async function ge(e,t){window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(e,t),await g("plugin:event|unlisten",{event:e,eventId:t})}async function Y(e,t,o){var a;const r=(a=void 0)!==null&&a!==void 0?a:{kind:"Any"};return g("plugin:event|listen",{event:e,target:r,handler:ve(t)}).then(c=>async()=>ge(e,c))}const h={monitor:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="14" rx="1"/><path d="M9 17v4m6-4v4M2 21h20"/></svg>',points:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v5c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 10v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5M4 15v4c0 1.7 3.6 3 8 3s8-1.3 8-3v-4"/></svg>',statRaceFlag:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V3m0 1c5-4 10 4 16 0v11c-6 4-11-4-16 0M4 9.5c5-4 10 4 16 0M9 3.5v11m6-10v11"/></svg>',skull:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21v-3H7v-4a8 8 0 1 1 10 0v4h-2v3ZM12 18v3"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="m12 13-1 2h2Z"/></svg>',watcherStart:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/></svg>',watcherStop:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/></svg>',test:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6l-6 10a1.3 1.3 0 0 0 1.1 2h13.8a1.3 1.3 0 0 0 1.1-2L14 9V3M7 15h10"/></svg>',check:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>',book:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 5C8 2 4 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-2-1-6-2-10 1ZM12 5v16"/></svg>',trophy:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10v5a5 5 0 0 1-10 0V3ZM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4M12 13v5m-4 3h8m-7-3h6v3H9Z"/></svg>',podium:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M8 21V10h8v11M2 21V14h6M16 17h6v4M1 21h22M12 2l1.1 2.3 2.5.4-1.8 1.8.4 2.5L12 7.8 9.8 9l.4-2.5-1.8-1.8 2.5-.4Z"/></svg>',home:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2 2 10v2h3v10h5v-7h4v7h5V12h3v-2L12 2Z"/></svg>',racers:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/></svg>',cycles:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9a8 8 0 0 0-14-3L3 9m0-5v5h5M4 15a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></svg>',raceFlag:'<svg viewBox="0 0 48 56" aria-hidden="true"><defs><pattern id="race-flag-checks" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M0 0h8v8H0ZM8 8h8v8H8Z" fill="#081024"/></pattern></defs><path d="M5 53V5" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M7 10C19-1 29 20 43 9v28C29 48 19 27 7 38Z" fill="currentColor"/><path d="M9 11C20 1 29 21 41 12v22C29 44 20 25 9 35Z" fill="url(#race-flag-checks)"/><path d="M7 10C19-1 29 20 43 9v28C29 48 19 27 7 38" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>',file:'<svg viewBox="0 0 28 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 2h12l8 8v20H4ZM16 2v9h8M8 16h12M8 21h12M8 26h12"/></svg>',clock:'<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="16" cy="16" r="13"/><path d="M16 7v10l7 4"/></svg>',chain:'<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m12 20 8-8M11 14l-5 5a6 6 0 0 0 8 8l5-5M21 18l5-5a6 6 0 0 0-8-8l-5 5"/></svg>',track:'<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 27H7a4 4 0 1 1 0-8h11a4 4 0 1 0 0-8h-6a4 4 0 1 1 0-8h13M21 3l5 5-5 5"/></svg>',stopwatch:'<svg viewBox="0 0 32 36" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="16" cy="21" r="12"/><path d="M16 12v9M12 2h8M16 2v7m8 3 3-3"/></svg>',overview:`
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 3h6v6H3V3Zm8 0h6v4h-6V3ZM3 11h6v6H3v-6Zm8-2h6v8h-6V9Z" />
    </svg>
  `,racecycles:`
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.5a7.5 7.5 0 0 1 6.6 3.94l1.15-1.15V9h-3.71l1.4-1.4A6 6 0 1 0 16 11h1.5A7.5 7.5 0 1 1 10 2.5Zm-.75 3h1.5v4.1l2.9 1.67-.75 1.3-3.65-2.1V5.5Z" />
    </svg>
  `,history:`
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3a7 7 0 1 1-6.2 3.75L2 5h5v5L4.95 7.95A5.5 5.5 0 1 0 10 4.5V3Zm-.75 3h1.5v4.15l2.8 1.7-.78 1.28-3.52-2.15V6Z" />
    </svg>
  `,settings:`
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m11 2 .45 1.8c.5.18.98.45 1.4.8l1.78-.54 1.3 2.25-1.34 1.28c.05.27.08.54.08.82s-.03.55-.08.82l1.34 1.28-1.3 2.25-1.78-.54c-.42.35-.9.62-1.4.8L11 14.82H9l-.45-1.8a5.5 5.5 0 0 1-1.4-.8l-1.78.54-1.3-2.25L5.4 9.23a4.5 4.5 0 0 1 0-1.64L4.07 6.31l1.3-2.25 1.78.54c.42-.35.9-.62 1.4-.8L9 2h2Zm-1 4a2.4 2.4 0 1 0 0 4.8A2.4 2.4 0 0 0 10 6Z" />
    </svg>
  `,streamer:`
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM5.2 5.2a6.8 6.8 0 0 0 0 9.6l-1.06 1.06a8.3 8.3 0 0 1 0-11.72L5.2 5.2Zm9.6 0 1.06-1.06a8.3 8.3 0 0 1 0 11.72L14.8 14.8a6.8 6.8 0 0 0 0-9.6ZM7.3 7.3a3.8 3.8 0 0 0 0 5.4l-1.06 1.06a5.3 5.3 0 0 1 0-7.52L7.3 7.3Zm5.4 0 1.06-1.06a5.3 5.3 0 0 1 0 7.52L12.7 12.7a3.8 3.8 0 0 0 0-5.4Z" />
    </svg>
  `,twitch:`
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 2.5h14v10l-4 4h-3l-2 2v-2H5V14H3V2.5Zm2 2v7.5h2v2h2v-2h4l2-2V4.5H5Zm4 2h1.5v4H9v-4Zm3 0h1.5v4H12v-4Z" />
    </svg>
  `,logs:`
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 3h14v14H3V3Zm3 3v2h2V6H6Zm4 .25v1.5h4v-1.5h-4ZM6 10v2h2v-2H6Zm4 .25v1.5h4v-1.5h-4Z" />
    </svg>
  `,play:`
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 3.5v13l10-6.5L5 3.5Z" />
    </svg>
  `,stop:`
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4.5" y="4.5" width="11" height="11" rx="1.5" />
    </svg>
  `,spinner:`
    <svg class="spinner" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3a7 7 0 0 1 7 7" />
    </svg>
  `};h.overlays=h.monitor;const ce=[["results","Results","Every Race or BR player, smoothly scrolling down and back up. BR adds kills and damage."],["podium","Podium","The top three players and their earned points."],["world-record","World record","Full-screen gold celebration, record time, player, points, and confetti."],["points","Points","Latest match points and session points together, plus the season total. Includes Race + BR."],["cycle-complete","Cycle completed","Full-screen celebration with confetti, player, cycle number, and matches taken."]],we=[["eventType","raceComplete or worldRecord. Race complete also covers Battle Royales."],["eventId","Unique event identifier used to prevent replaying alerts."],["gameId","Stable result fingerprint."],["snapshotId","Marbles snapshot identifier, when available."],["gameType","race or battleRoyale."],["timestamp","Processed match timestamp (ISO date/time)."],["seasonName","RaceStats season label."],["cycleSeasonName","RaceCycles season label."],["mapName","Track/map name, or null if unavailable."],["playerCount","Players in this match."],["firstplace","First-place display name."],["firstplacepoints","First-place points earned this match."],["firstplacetime","First-place time in seconds, or null."],["secondplace","Second-place display name."],["secondplacepoints","Second-place points earned this match."],["secondplacetime","Second-place time in seconds, or null."],["thirdplace","Third-place display name."],["thirdplacepoints","Third-place points earned this match."],["thirdplacetime","Third-place time in seconds, or null."],["matchPoints","Sum of all players' earned points in the latest match."],["sessionPoints","Sum of all players' Race + BR points since this app opened."],["seasonPoints","Combined Race + BR points since RaceStats was reset."],["sessionRaces","Races processed this app session."],["sessionBRs","Battle Royales processed this app session."],["sessionPlayers","Unique players across session matches; repeat players count once."],["cyclePlayers","Unique players tracked by RaceCycles."],["cycleRaces","Matches tracked since RaceCycles was reset."],["hasWorldRecord","Whether a new record was confirmed for this match."],["placements","Array of all match results. See row fields below."],["placementsJson","The same placements array encoded as JSON text."],["cycleLeaders","Top three cycle players. See row fields below."],["cycleCompletions","Cycles completed by this match; empty array when none."],["overlayDataJson","Complete data packet as JSON text. Available to custom Streamer.bot actions; the built-in overlays do not require it."],["isTest","true on test events only; sample data does not change app stats."]],fe=[["wrplayer","Record player's display name."],["wrplayerpoints","Record player's earned points, or null if unknown."],["wrrecordtime","Record time in seconds, or null if unknown."],["playerUsername","Record player's login name, if found in the results."]],be=[["place","Placement number."],["name","Display name shown on stream."],["username","Account/login name used to identify the player."],["platform","Player platform, such as Twitch."],["points","Points earned this match."],["seasonTotal","Player's season total from the CSV, or null."],["time","Finish time in seconds, or null."],["eliminated","Elimination flag when available."],["kills","BR kills, or null for races."],["damage","BR damage, or null for races."]],$e=[["playerName","Display name."],["playerKey","Stable player identity key."],["cycles","Completed cycles."],["placementCounts","Ten counts for positions 1 through 10, including duplicates."],["cycleRaceCounts","Matches entered for each in-progress cycle, including duplicate placements."]];function M(e,t=!0){return`<div class="overlay-reference"><table><thead><tr><th>${t?"Argument":"JSON field"}</th><th>Contains</th></tr></thead><tbody>${e.map(([o,a])=>`<tr><td><code>${t?`{${o}}`:o}</code></td><td>${a}</td></tr>`).join("")}</tbody></table></div>`}const Q=e=>e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");function Se(){window.addEventListener("message",e=>{if(e.origin!==window.location.origin||e.data?.type!=="marbles-overlay-preview-size")return;const t=Number(e.data.height);!Number.isFinite(t)||t<=0||t>4e3||document.querySelectorAll(".overlay-mini-preview iframe").forEach(o=>{if(e.source!==o.contentWindow)return;const a=new DOMMatrixReadOnly(getComputedStyle(o).transform).a;o.parentElement.style.height=`${Math.ceil(t*a)}px`})})}function ke(e,t){const o=ce.find(([c])=>`${c}.html`===e);if(!o)return;document.querySelector("#overlay-preview-dialog")?.close();const a=document.createElement("dialog");a.id="overlay-preview-dialog",a.className="overlay-preview-dialog",a.setAttribute("aria-label",`${o[1]} preview`),a.innerHTML=`<header><h2>${o[1]} preview</h2><button type="button" class="compact-button" data-close-preview>Close</button></header><p>Animated sample preview. Use <b>Copy path</b> on the card to add the live overlay in OBS.</p><div class="overlay-large-preview"><iframe title="${o[1]} animated sample"></iframe></div>`;const r=a.querySelector("iframe");r.addEventListener("load",()=>{r.contentWindow?.postMessage({type:"marbles-overlay-preview",br:t},window.location.origin),r.contentWindow?.postMessage({type:"marbles-overlay-preview-hover",active:!0},window.location.origin)}),r.src=`/overlays/${e}?preview=1`,a.querySelector("[data-close-preview]").addEventListener("click",()=>a.close()),a.addEventListener("close",()=>a.remove(),{once:!0}),document.body.append(a),a.showModal()}function Ce(e,t){return`<div class="overlays-page">
    <div class="page-head"><div class="race-heading"><i class="race-heading-icon">${h.monitor}</i><div><h1>Overlays</h1><p>Editable HTML sources for OBS, updated by Marbles Stats.</p></div></div></div>
    <section class="panel"><header><h2>Overlay templates</h2><div class="overlay-actions">${t}</div></header><div class="panel-body">
      <p id="overlay-setup-error" role="alert"></p>
      <p>The app creates and updates these files automatically. Add their HTML files as OBS Browser Sources. These previews use sample data. Hover any card to play its animation loop.</p>
      <label class="overlay-folder">Live overlay folder<input readonly data-overlay-path value="${Q(e)}" placeholder="Loading overlay folder..." /></label>
      <div class="overlay-preview-controls"><span>Preview match type</span><button type="button" class="compact-button" data-overlay-preview-type="race" aria-pressed="true">Race</button><button type="button" class="compact-button" data-overlay-preview-type="br" aria-pressed="false">Battle Royale</button></div>
      <div class="overlay-gallery">${ce.map(([o,a,r])=>{const c=Q(e?e+"\\"+o+".html":"");return`<article class="overlay-template"><div class="overlay-mini-preview" style="height:${o==="world-record"||o==="cycle-complete"?61:o==="results"?100:47}px"><iframe title="${a} sample preview" src="/overlays/${o}.html?preview=1" loading="lazy" tabindex="-1" aria-hidden="true"></iframe></div><div class="overlay-template-copy"><h3>${a}</h3><p class="overlay-description">${r}</p><div class="overlay-source-path"><p class="overlay-file-path" title="${c}">${c||"Loading file path..."}</p><div class="overlay-file-actions"><button type="button" class="compact-button" data-copy-overlay-path="${c}" data-feedback-key="copy-overlay-${o}" ${e?"":"disabled"}>Copy path</button><button class="compact-button" type="button" data-open-overlay-file="${o}.html">Open preview</button></div><span class="button-feedback-error" data-error-for="copy-overlay-${o}" role="alert"></span></div></div></article>`}).join("")}</div>
    </div></section>
    <section class="panel"><header><h2>Add to OBS</h2></header><div class="panel-body overlay-instructions">
      <p><b>Pick only the overlays you want.</b> Each one you choose gets its own Browser Source.</p>
      <ol>
        <li>Click <b>Copy path</b> on an overlay card.</li>
        <li>In OBS: <b>Sources + &gt; Browser &gt; Local file</b>. Paste the path. Use <b>600 &times; 900</b> for Results, <b>600 &times; 500</b> for small cards, or your canvas size (usually <b>1920 &times; 1080</b>) for WR/cycle celebrations.</li>
        <li>Click <b>Test overlays</b> or <b>Test WR</b> here, then position the source in OBS.</li>
      </ol>
      <p>Leave the sources' eyes enabled. Results, podium, and points stay visible; WR and cycle celebrations appear for events and hide themselves after 12 seconds. Put celebration sources above your other sources in OBS.</p>
      <details><summary>Blank source?</summary><p>Live sources wait for data; <b>Open preview</b> always shows an animated sample. Send a test to see/position the live source in OBS. Keep Marbles Stats running with the watchers enabled. Automatic WR detection from the current CSV is not available yet.</p><p><a href="https://obsproject.com/kb/browser-source" target="_blank" rel="noreferrer">OBS Browser Source help</a></p></details>
    </div></section>
    <section class="panel"><div class="panel-body overlay-instructions"><details><summary>Customize the overlays</summary><p>Edit <code>overlay-config.js</code> in the live folder for colors, scale, alert duration, and animation speed; edit <code>overlay.css</code> for fonts/layout. Refresh the OBS source after edits. Your custom edits are preserved when the app restarts.</p></details></div></section>
    <section class="panel"><div class="panel-body overlay-instructions"><details><summary>Event data reference &mdash; {} arguments</summary>
      <p>The supplied HTML templates already use this data; you do not need to enter placeholders to set them up. For custom text, <code>{firstplace}</code> means the argument named <code>firstplace</code>. Use the brace formatter on the Streamer.bot page for custom <code>{}</code> text; Streamer.bot's own text fields do not automatically expand this brace format.</p>
      <h3>Race complete and World record</h3>${M(we)}
      <h3>Extra World record arguments</h3>${M(fe)}
      <h3>Each row in placements</h3><p>Read these fields from <code>placements</code> or parse <code>placementsJson</code>. They are array row fields, not standalone replacement arguments. <code>name</code> is the readable display name; <code>username</code> is the account login.</p>${M(be,!1)}
      <h3>Each row in cycleLeaders</h3>${M($e,!1)}
      <h3>Each row in cycleCompletions</h3>${M([["playerName","Player who completed the cycle."],["cycleNumber","Which cycle they completed."],["races","Matches they entered to collect all ten positions, including duplicates; null for unknown historical counts."]],!1)}
      <h3>Alert timestamp</h3><p><code>receivedAt</code> is the UTC time the app saved an alert. Alert pages use it to avoid replaying expired alerts when reopened.</p>
      <details><summary>Older argument names (still supported)</summary><p><code>{firstName}</code>, <code>{firstPoints}</code>, <code>{firstUsername}</code>, <code>{firstTime}</code>, and equivalent <code>second</code>/<code>third</code> names remain available. For WR, <code>{playerName}</code>, <code>{playerUsername}</code>, <code>{playerPoints}</code>, <code>{recordTime}</code>, <code>{player}</code>, <code>{playerpoints}</code>, and <code>{recordtime}</code> remain available. Use <code>{firstplace}</code> and <code>{wrplayer}</code> for new custom text.</p></details>
    </details></div></section>
  </div>`}function Re(e,t){const o=a=>{switch(t.key){case"placement":return a.placement;case"player":return a.playerName;case"time":return a.finishTime;case"kills":case"damage":{const r=a.rawData?.[t.key==="kills"?"MatchKills":"MatchDamageDealt"]?.trim();return r&&Number.isFinite(Number(r))?Number(r):void 0}case"points":return e.gameType==="battleRoyale"&&a.rawData&&!a.rawData.SeasonPointsEarned?.trim()?void 0:a.seasonPointsEarned;case"total":return a.seasonPointsTotal;case"eliminated":return a.eliminated==null?void 0:Number(a.eliminated)}};return[...e.results].sort((a,r)=>{const c=o(a),i=o(r);if(c==null&&i!=null)return 1;if(i==null&&c!=null)return-1;const s=c==null||i==null?0:typeof c=="string"&&typeof i=="string"?c.localeCompare(i,void 0,{sensitivity:"base",numeric:!0}):Number(c)-Number(i);return(t.direction==="asc"?s:-s)||a.placement-r.placement})}function l(e){return String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function X(e){return e?new Date(e).toLocaleString():"Never"}function I(e){return e==null?"—":`${e.toFixed(3)}s`}function G(e){return e?e.replace(/([A-Z])/g," $1").replace(/^./,t=>t.toUpperCase()):"—"}function re(e,t){const o=[{placement:1,playerName:"rmrfkorea",seasonPointsEarned:123},{placement:2,playerName:"PlayerTwo",seasonPointsEarned:90},{placement:3,playerName:"PlayerThree",seasonPointsEarned:70},{placement:4,playerName:"PlayerFour",seasonPointsEarned:45}],a=(t?.results??o).filter(p=>p.seasonPointsEarned>0),r=e.trim().replaceAll("%race%","{race}").replaceAll("{race}",G(t?.gameType??"race")).slice(0,120),c=r?`${r} `:"",i=[];let s=c,n=0;for(const p of a){const w=`${{1:"🥇",2:"🥈",3:"🥉"}[p.placement]??`#${p.placement}`} ${p.playerName} +${p.seasonPointsEarned}pts`;n&&(s+(n?" | ":"")+w).length>500&&(i.push(s),s=c,n=0),s+=`${n?" | ":""}${w}`,n+=1}return n&&i.push(s),i.length?i:[`${c}No point-scoring racers`]}function ne(e){const o=e.trim()||"🎉 Congrats {player} on a cycle! You are great! That's cycle #{cycle}! 🎉",a=o.replaceAll("{player}","rmrfkorea").replaceAll("{cycle}","1").replaceAll("{races}","823"),r=" Only took 823 races for this cycle!";return o.includes("{races}")?a.slice(0,500):a.slice(0,500-r.length)+r}function K(e){return e.watcherStatus==="Watching"||e.watcherStatus==="Processing"}function ie(e){return e.streamerBotStatus==="Connected"?"good":e.streamerBotStatus==="Unavailable"?"bad":"warn"}function le(e){return e.twitchStatus==="Connected"?"good":e.twitchStatus==="Unavailable"||e.twitchStatus==="Expired"?"bad":"warn"}function ee(e,t,o,a="",r=""){return`
    <section class="panel ${a}">
      <header>
        <div>
          <h2>${l(e)}</h2>
        </div>
        ${r}
      </header>
      <div class="panel-body">
        ${o}
      </div>
    </section>
  `}function x(e,t){const o={"Session races":"file","Last update":"clock","Last updated":"clock","Tracked racers":"racers","Completed cycles":"cycles","Streamer.bot":"chain"}[e];return`<span class="summary-item">${o?`<i class="summary-icon ${o}">${h[o]}</i>`:""}<span class="summary-copy"><span>${l(e)}</span><b class="${e==="Streamer.bot"&&t==="Connected"?"connected-value":""}">${l(t)}</b></span></span>`}function $(e,t,o="",a="play",r="button"){return`<span class="inline-action"><button class="compact-button" type="${r}" data-feedback-key="${e}" ${o}>${h[a]}<span>${l(t)}</span></button><span class="button-feedback-error" data-error-for="${e}" role="alert"></span></span>`}function P(e,t){return(t==="stats"?e.statsTrackingEnabled:e.cyclesTrackingEnabled)??K(e)}function de(e,t,o){const a=P(e,o),r=t||a&&e.watcherStatus==="Processing";return`<div class="head-actions">
    <button id="watch-toggle" class="action ${a?"stop":"start"}" ${t?"disabled":""}>
      ${r?h.spinner:a?h.stop:h.play}
      <span>${t?"Please wait":a?"Stop watcher":"Start watcher"}</span>
    </button>
  </div>`}function pe(e,t,o=!1){const a=l(e.nameColorHex??"94a3b8"),r=e.eliminated==null?"—":e.eliminated?"Yes":"No",c=n=>l(e.rawData?.[n]?.trim()||"—"),i=t&&e.placement!==1;return`
    <tr class="${i?"royale-dead":`p${e.placement}`}">
      <td>
        ${i?`<span class="dead-placement" role="img" aria-label="Eliminated, placement ${e.placement}" title="Eliminated — placement ${e.placement}">${h.skull}</span>`:`<b class="place p${e.placement}">${e.placement}</b>`}
      </td>
      <td>
        <div class="player">
          <span>
            <b title="${l(e.playerName)}" style="--player-color:#${a}">${l(e.playerName)}</b>
          </span>
        </div>
      </td>
      ${t?"":`<td class="mono">${I(e.finishTime)}</td>`}
      ${t?`<td>${c("MatchKills")}</td><td>${c("MatchDamageDealt")}</td>`:""}
      <td class="points">${t&&e.rawData?c("SeasonPointsEarned"):e.seasonPointsEarned}</td>
      ${o?"":`<td>${e.seasonPointsTotal??"—"}</td><td>${r}</td>`}
    </tr>
  `}function Ee(e,t){if(!e)return`
      <div class="empty-state">
        <b>No race processed yet</b>
        <span>Start the watcher to read Race and Battle Royale results.</span>
      </div>
    `;const o=e.results[0],a=e.gameType==="battleRoyale",r=!a&&["kills","damage"].includes(t.key)||a&&t.key==="time"?{key:"placement",direction:"asc"}:t,c=(i,s)=>{const n=r.key===i,p=n?r.direction==="asc"?"▲":"▼":"";return`<th aria-sort="${n?r.direction==="asc"?"ascending":"descending":"none"}"><button type="button" class="cycle-sort ${n?"active":""}" data-results-sort="${i}">${s}<span>${p}</span></button></th>`};return`
    <div class="race-context">
      <span class="track-item"><i>${h.raceFlag}</i><span><small>Game Type</small><b>${G(e.gameType)}</b></span></span>
      <span class="track-item"><i>${h.track}</i><span><small>Track</small><b>${l(e.mapName??"Unknown track")}</b></span></span>
      <span class="track-item"><i>${h.stopwatch}</i><span><small>${e.gameType==="battleRoyale"?"Survival time":"Winning time"}</small><b class="mono">${I(o?.finishTime)}</b></span></span>
    </div>
    <div class="table-frame"><div class="table-scroll">
      <table class="${a?"battle-royale-results":"race-results"}">
        <colgroup>
          <col class="rank-column" />
          <col class="player-column" />
          ${a?"":'<col class="time-column" />'}
          ${a?'<col class="kills-column" /><col class="damage-column" />':""}
          <col class="earned-column" />
          <col class="total-column" />
          <col class="eliminated-column" />
        </colgroup>
        <thead>
          <tr>
            ${c("placement","#")}
            ${c("player","Player")}
            ${a?c("kills","Kills")+c("damage","Damage"):c("time","Race time")}
            ${c("points",a?"Points earned":"Season points earned")}
            ${c("total","Season total")}
            ${c("eliminated","Eliminated")}
          </tr>
        </thead>
        <tbody>
          ${Re(e,r).map(i=>pe(i,a)).join("")}
        </tbody>
      </table>
    </div></div>
  `}function Te(e,t,o,a){const r=e.config.csv.path.split(/[\\/]/).pop()||"LastSeasonRace.csv";return`
    <div class="overview-page">
      <div class="page-head tracking-page-head">
        <div>
          <div class="race-heading">
            <i class="race-heading-icon">${h.raceFlag}</i>
            <div><h1>RaceStats</h1><p>${l(r)} · Race + Battle Royale</p></div>
          </div>
        </div>

      <div class="summary-row">
        ${x("Session races",e.sessionResults.filter(c=>c.gameType==="race").length)}
        ${x("Session BRs",e.sessionResults.filter(c=>c.gameType==="battleRoyale").length)}
        ${x("Last update",e.lastUpdate?new Date(e.lastUpdate).toLocaleTimeString():"Never")}
      </div>

        <div class="head-actions tracking-controls">
          ${de(e,t,"stats")}
          ${$("reprocess-latest","Reprocess latest file",'data-reprocess-latest title="Reprocess the most recently modified Race or Battle Royale for stats and cycles"',"cycles")}
        </div>
      </div>

      <section class="panel results-panel">
        <header class="results-header">
          ${ue(e.config.seasons.raceName||r,o)}
          <div class="results-actions-group">
            <div class="results-actions">
              <button data-export="race" class="compact-button" type="button" ${e.latestResult?"":"disabled"}>Export race</button>
              <button data-export="session" class="compact-button" type="button">Export session</button>
            </div>
            <button id="clear-race-results" class="compact-button btn-error" type="button" ${e.latestResult||e.sessionResults.length||e.totalRaceCount||e.totalBattleRoyaleCount||e.seasonPointsEarned?"":"disabled"}>Clear Results</button>
          </div>
        </header>
        <div class="panel-body">${Ee(e.latestResult,a)}</div>
      </section>
    </div>
  `}function xe(e){const t=[...e.recentResults].reverse(),o=[...e.cycleHistory??[]].reverse(),a=o.length?`<div class="table-frame"><div class="table-scroll"><table><thead><tr><th>Date</th><th>Track</th><th>Winner</th><th>Winning time</th><th>Players</th><th>Completions</th><th>Fingerprint</th></tr></thead><tbody>${o.map(c=>{const i=c.completions?.length?c.completions:c.cycleNumber>0?[{playerName:c.playerName,cycleNumber:c.cycleNumber}]:[];return`<tr><td>${X(c.timestamp)}</td><td>${l(c.mapName??"Unknown track")}</td><td>${l(c.winnerName??"—")}</td><td class="race-time">${I(c.winningTime)}</td><td>${c.playerCount??"—"}</td><td>${i.length?i.map(s=>`${l(s.playerName)}: cycle #${s.cycleNumber}`).join(" | "):"—"}</td><td class="mono">${l(c.gameId.slice(0,12))}</td></tr>`}).join("")}</tbody></table></div></div>`:'<div class="empty-state">No races processed by Cycles yet.</div>',r=t.length?`
      <div class="table-frame"><div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Track</th>
              <th>Winner</th>
              <th>Winning time</th>
              <th>Players</th>
              <th>Type</th>
              <th>Fingerprint</th>
            </tr>
          </thead>
          <tbody>
            ${t.map(c=>`
                  <tr>
                    <td>${X(c.timestamp)}</td>
                    <td>${l(c.mapName??"Unknown track")}</td>
                    <td><b>${l(c.results[0]?.playerName??"Unknown")}</b></td>
                    <td class="race-time">${I(c.results[0]?.finishTime)}</td>
                    <td>${c.playerCount}</td>
                    <td>${G(c.gameType)}</td>
                    <td class="mono">${l(c.id.slice(0,12))}</td>
                  </tr>
                `).join("")}
          </tbody>
        </table>
      </div></div>
    `:'<div class="empty-state">No saved races yet.</div>';return`
    <div class="history-view">
    <div class="page-head">
      <div class="race-heading"><i class="race-heading-icon">${h.history}</i><div><h1>History</h1><p>Saved races processed by Stats and Cycles.</p></div></div>
    </div>

    <div class="history-panels">
    ${ee("Processed races","Recent first",r,"history-panel",`<button id="clear-history" class="compact-button btn-error" type="button" ${t.length?"":"disabled"}>Clear history</button>`)}
    ${ee("Processed cycle races","Recent first",a,"history-panel",`<button id="clear-cycle-history" class="compact-button btn-error" type="button" ${o.length?"":"disabled"}>Clear history</button>`)}
    </div>
    </div>
  `}function te(e,t="settings"){const o=(A,q,u,v,S)=>`
    <label class="toggle-row settings-option">
      <i aria-hidden="true">${h[q]}</i>
      <span><b>${u}</b><small>${v}</small></span>
      <input id="${A}" type="checkbox" role="switch" ${S?"checked":""} />
    </label>`,a=`
   

      ${o("auto-start","watcherStart","Start RaceStats automatically","Count races and Battle Royales when the app opens.",e.config.csv.autoStartWatcher)}
      ${o("auto-start-cycles","cycles","Start RaceCycles automatically","Count cycle placements when the app opens.",e.config.csv.autoStartCycles)}
      ${o("start-minimized","monitor","Start minimized","Start the application minimized to the Windows taskbar.",e.config.startMinimized)}
  `,r=e.config.streamerBot,c=`
    <div class="twitch-connection-heading">
      <div class="twitch-layout-heading"><i>${h.chain}</i><div><h2 class="connection-title">Streamer.bot Connection${e.streamerBotStatus==="Connected"?`<span class="connection-check">${h.check}</span>`:""}</h2></div></div>
      <div class="watch-state ${ie(e)}"><i></i><span>${l(e.streamerBotStatus)}</span></div>
    </div>
    <div class="fields-grid connection-fields">
      <label class="field"><span>Host</span><input id="streamer-host" value="${l(r.host)}" /></label>
      <label class="field port-field"><span>Port</span><input id="streamer-port" type="number" min="1" max="65535" value="${r.port}" /></label>
      ${$("streamer-connection","Test connection",'data-streamer-test="connection"',"test")}
    </div>
    <div class="twitch-layout-heading streamer-event-heading"><i>${h.chain}</i><h2>Event actions</h2><p>When an enabled event occurs, this app sends its results to Streamer.bot and runs the action with the exact name entered below. Create that action in Streamer.bot and add your own steps; no Streamer.bot trigger is needed.</p></div>
    <div class="twitch-settings-grid">
      <section class="twitch-settings-section" data-feature-section="streamer-record-enabled">
        <label class="toggle-row twitch-feature-heading"><i>${h.stopwatch}</i><span><b>World record</b><small>Send a confirmed new record, player name, and record time.</small></span><input id="streamer-record-enabled" type="checkbox" role="switch" ${r.events?.worldRecord??!0?"checked":""} /></label>
        <div class="feature-content"><label class="field"><span>Action name</span><input id="streamer-record-action" value="${l(r.actions.worldRecord)}" /></label>
        
        ${$("streamer-record","Test world record",'data-streamer-test="worldRecord"',"test")}</div>
      </section>
      <section class="twitch-settings-section" data-feature-section="streamer-race-enabled">
        <label class="toggle-row twitch-feature-heading"><i>${h.raceFlag}</i><span><b>Race complete</b><small>Send full results and podium data to your action.</small></span><input id="streamer-race-enabled" type="checkbox" role="switch" ${r.events?.raceComplete??!1?"checked":""} /></label>
        <div class="feature-content"><label class="field"><span>Action name</span><input id="streamer-game-action" value="${l(r.actions.gameComplete)}" /></label>
        ${$("streamer-race","Test race complete",'data-streamer-test="gameComplete"',"test")}</div>
      </section>
    </div>
  `,i=`
    <ol class="setup-steps twitch-setup-steps">
      <li class="twitch-settings-section"><b>Step 1</b><p>In Streamer.bot, open <b>Servers/Clients ? HTTP Server</b>. Use your configured host and port (defaults: <code>127.0.0.1</code>, <code>7474</code>), enable <b>Auto Start</b>, and start the server.</p></li>
      <li class="twitch-settings-section"><b>Step 2</b><p>Create enabled actions in <b>Actions & Queues ? Actions</b>. Enter their exact names above. No Streamer.bot trigger is needed: the app calls your action directly.</p></li>
      <li class="twitch-settings-section"><b>Step 3</b><p>Enable only the events you want, enable Streamer.bot, save settings, and use <b>Test connection</b> and the event test buttons. Tests send sample data without counting a race.</p></li>
      <li class="twitch-settings-section"><b>Step 4</b><p>Open <b>Action Queues ? Action History</b> and inspect the arguments sent to your action.</p></li>
    </ol>
    <h3>Your own visuals</h3>
    <p class="event-note">Create and style your own OBS text sources, scenes, media, or browser overlays. In Streamer.bot, add the sub-actions that update those sources and show, animate, or hide them. Marbles Stats sends data; Streamer.bot handles the presentation.</p>
    <p class="event-note">Example race template: <code>Winner: {firstplace} (+{firstplacepoints} pts)</code>. Example record template: <code>New record: {wrplayer} (+{wrplayerpoints} pts) ? {wrrecordtime}s on {mapName}</code>.</p>
    <p class="event-note">Use these brace placeholders in your overlay or action script. Streamer.bot's built-in text fields use its own variable syntax; the formatter below expands brace templates from the supplied arguments.</p>
    <div class="table-scroll event-arguments"><table><thead><tr><th>Event</th><th>Arguments</th></tr></thead><tbody>
      <tr><td>Race complete</td><td><code>{firstplace}</code>, <code>{firstplacepoints}</code>, <code>{firstplacetime}</code>, <code>{secondplace}</code>, <code>{secondplacepoints}</code>, <code>{secondplacetime}</code>, <code>{thirdplace}</code>, <code>{thirdplacepoints}</code>, <code>{thirdplacetime}</code>, <code>{playerCount}</code>, <code>{placementsJson}</code></td></tr>
      <tr><td>World record</td><td><code>{wrplayer}</code>, <code>{wrplayerpoints}</code>, <code>{wrrecordtime}</code></td></tr>
      <tr><td>Both</td><td><code>{eventType}</code>, <code>{gameId}</code>, <code>{gameType}</code>, <code>{mapName}</code>, <code>{seasonName}</code></td></tr>
    </tbody></table></div>
    <p class="event-note">Player placeholders contain display names. Username means the platform login and remains available to existing actions. Points are earned in this match, not season totals. Times are seconds. Full placements JSON includes each player's name, username, platform, earned points, season total, time, and eliminated state.</p>
    <details class="event-note"><summary>Use brace templates in a Streamer.bot C# action</summary><p>Add an Execute C# Code sub-action. Change the template below as needed; the formatted text is saved as the <code>overlayText</code> argument for your following sub-actions or overlay script.</p><pre><code>${l(String.raw`using System;
using System.Globalization;
using System.Text.RegularExpressions;
public class CPHInline
{
    public bool Execute()
    {
        string template = "Winner: {firstplace} (+{firstplacepoints} pts)";
        string text = Regex.Replace(template, @"\{([A-Za-z][A-Za-z0-9]*)\}", match =>
        {
            object value;
            return CPH.TryGetArg(match.Groups[1].Value, out value)
                ? Convert.ToString(value, CultureInfo.InvariantCulture) ?? ""
                : "";
        });
        CPH.SetArgument("overlayText", text);
        return true;
    }
}`)}</code></pre></details>
    <p class="event-note"><a href="https://docs.streamer.bot/api/http/requests/do-action" target="_blank" rel="noreferrer">Streamer.bot event API</a> ? <a href="https://docs.streamer.bot/api/sub-actions/obs-studio/sources/set-gdi-text" target="_blank" rel="noreferrer">Text source setup</a></p>
  `,s=e.config.twitch,n=e.twitchStatus==="Connected",p=re(s.messagePrefix,e.latestResult),m=ne(s.cycleMessageTemplate),w=`
  <div class="twitch-connection-heading">
    <div class="twitch-layout-heading"><i>${h.chain}</i><div><h2 class="connection-title">Twitch Connection${n?`<span class="connection-check">${h.check}</span>`:""}</h2></div></div>
  <div class="watch-state ${le(e)}">
    <i></i>

      <span>${l(n&&e.twitchUsername?`Connected as ${e.twitchUsername}`:e.twitchStatus)}</span>
  </div>
  </div>
  <div class="test-actions integration-connection-controls">
    ${n?'<button id="twitch-disconnect" class="twitch-disconnect-button" type="button">Disconnect Twitch</button>':'<button id="twitch-connect" class="twitch-connect-button" type="button">Connect Twitch</button>'}
  </div>

  <div class="twitch-settings-grid">
    <section class="twitch-settings-section" data-feature-section="twitch-post-results">
      <label class="toggle-row twitch-feature-heading">
        <i>${h.raceFlag}</i>
        <span><b>Post Race Results</b><small>Post race results to Twitch chat.</small></span>
        <input
          id="twitch-post-results"
          type="checkbox" role="switch"
          ${s.postResults?"checked":""}
        />

      </label>
      <div class="feature-content">

      <label class="field">
        <span>Message intro</span>

        <input
          id="twitch-message-prefix"
          type="text"
          maxlength="120"
          value="${l(s.messagePrefix.replaceAll("%race%","{race}"))}"
          placeholder="🏁 {race} winner:"
        />
        <small>Use <code>{race}</code> for the match type: <b>Race</b> or <b>Battle Royale</b>. Example: <code>{race} winner:</code></small>
      </label>

      <div class="twitch-message-preview">
        <span>Preview</span>

        <p id="twitch-message-preview">${p.map(l).join("<br><br>")}</p>
      </div>
      ${$("twitch-race","Test race results",`data-twitch-test="race" ${n?"":"disabled"}`,"test")}
      </div>
    </section>

    <section class="twitch-settings-section" data-feature-section="twitch-post-cycles">
      <label class="toggle-row twitch-feature-heading">
        <i>${h.trophy}</i>
        <span><b>Post Cycle Completions</b><small>Post cycle completions to Twitch.</small></span>
        <input
          id="twitch-post-cycles"
          type="checkbox" role="switch"
          ${s.postCycleResults?"checked":""}
        />

      </label>
      <div class="feature-content">
     

      <label class="field">
        <span>Cycle complete message</span>

        <textarea
          id="twitch-cycle-message"
          maxlength="500"
          rows="3"
          placeholder="🎉 Congrats {player} on a cycle! That's cycle #{cycle}! 🎉"
        >${l(s.cycleMessageTemplate)}</textarea>

        <small>
          Use <code>{player}</code> for the racer and
          <code>{cycle}</code> for their completed cycle number, and
          <code>{races}</code> for matches taken by that particular cycle.
        </small>
      </label>

      <div class="twitch-message-preview">
        <span>Preview</span>

        <p id="twitch-cycle-message-preview">${l(m)}</p>
      </div>
      ${$("twitch-cycle","Test cycle message",`data-twitch-test="cycles" ${n?"":"disabled"}`,"test")}
      </div>
    </section>
  </div>


`,f={settings:{eyebrow:"Integrations",title:"Settings",description:"smol korea is the best!",content:`<section class="panel settings-panel"><div class="panel-body">${a}</div></section>`},streamer:{eyebrow:"Automation",title:"Streamer.bot",description:"Send race events to your local Streamer.bot actions.",content:`<section class="panel settings-panel streamer-panel twitch-connection-panel"><div class="panel-body">${c}</div></section><div class="integration-save">${$("save-streamer","Save settings","","file","submit")}</div><section class="panel settings-panel overlay-templates-panel"><header><div class="twitch-layout-heading"><i>${h.file}</i><div><h2>Basic overlays</h2><p>Editable HTML pages for OBS Browser Sources.</p></div></div></header><div class="panel-body"><p>Find the automatically updated HTML overlays, previews, event data, and simple OBS setup on the <button type="button" class="overlay-inline-link" data-page="overlays">Overlays page</button>.</p></div></section><section class="panel settings-panel streamer-panel twitch-guide-panel"><header><div class="twitch-layout-heading"><i>${h.book}</i><div><h2>Setup Guide</h2><p>Connect Streamer.bot and configure your own actions.</p></div></div></header><div class="panel-body">${i}</div></section>`},twitch:{eyebrow:"Chat",title:"Twitch",description:"Authorize the account you want to use to post results to chat.",content:`<section class="panel settings-panel streamer-panel twitch-connection-panel"><div class="panel-body">${w}</div></section><div class="integration-save">${$("save-twitch","Save settings","","file","submit")}</div><section class="panel settings-panel streamer-panel twitch-guide-panel"><header><div class="twitch-layout-heading"><i>${h.book}</i><div><h2>Setup Guide</h2><p>Follow these steps to connect Twitch and start posting to chat.</p></div></div></header><div class="panel-body">
    <ol class="setup-steps twitch-setup-steps">
      <li class="twitch-settings-section"><b>1. Click Connect Twitch</b><p>Press <b>Connect Twitch</b> to open Twitch's authorization page in your normal Windows browser.</p></li>
      <li class="twitch-settings-section"><b>2. Approve Twitch Access</b><p>Approve the single <code>user:write:chat</code> permission. There is no Client ID, code, or token to enter. Tokens are stored in Windows Credential Manager.</p></li>
      <li class="twitch-settings-section"><b>3. Choose What to Post</b><p>Choose Race Results and Cycle Completions independently above. Race posting is enabled by default and includes every racer with positive <code>SeasonPointsEarned</code>, with additional messages when needed.</p></li>
      <li class="twitch-settings-section"><b>4. Test &amp; Go Live</b><p>Use the race or cycle test button above to verify chat posting. The authenticated account posts into its own Twitch channel.</p></li>
    </ol>
  </div></section>`}}[t];return`
    <div class="page-head simple">
      <div class="race-heading">
        <i class="race-heading-icon ${t==="twitch"?"twitch-heading-icon":""}">${h[t==="twitch"?"twitch":t==="settings"?"settings":"chain"]}</i><div>
        <h1>${f.title}</h1>
        <p>${f.description}</p>
        </div>
      </div>
    </div>

    <form id="settings-form" class="integration-page-layout ${t}-page-layout">
      ${f.content}
      ${t!=="settings"?"":$("save-settings","Save settings","","file","submit")}
    </form>
  `}function k(e,t,o){return`
    <button
      data-page="${e}"
      class="nav-item ${t===e?"active":""}"
    >
      ${h[e]}
      <span>${o}</span>
    </button>
  `}function ue(e,t){return`<form id="season-form" class="results-name">
    ${t?`<input id="season-name" maxlength="120" value="${l(e)}" aria-label="Results name" />`:`<h2>${l(e)}</h2>`}
    <button id="edit-season-name" type="button" class="compact-button edit-name" aria-label="Edit name" title="Edit name"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m13.8 2.2 4 4-10.6 10.6-5.3 1.3 1.3-5.3L13.8 2.2Zm-9 11.3-.6 2.3 2.3-.6 8.8-8.8-1.7-1.7-8.8 8.8Z" fill="currentColor" /></svg></button>
    ${t?'<button type="submit" class="compact-button">Save</button>':""}
  </form>`}function Le(e,t,o,a){const r=[...e.raceCycles].sort((n,p)=>{let m;if(t.key==="racer")m=n.playerName.localeCompare(p.playerName,void 0,{sensitivity:"base"});else if(t.key==="cycles")m=n.cycles-p.cycles;else{const w=Number(t.key.replace("position-",""))-1;m=(n.placementCounts[w]??0)-(p.placementCounts[w]??0)}return m===0&&(m=n.playerName.localeCompare(p.playerName,void 0,{sensitivity:"base"})),t.direction==="asc"?m:-m}),c=(n,p)=>{const m=t.key===n,w=m?t.direction==="asc"?"▲":"▼":"";return`<th><button type="button" class="cycle-sort ${m?"active":""}" data-cycle-sort="${n}">${p}<span>${w}</span></button></th>`},i=r.reduce((n,p)=>n+p.cycles,0),s=r.map((n,p)=>`
        <tr>
          <td class="cycle-rank"><b class="place">${p+1}</b></td>
          <td class="cycle-player">
            ${l(n.playerName)}
          </td>
          <td class="cycle-total">${n.cycles}</td>
          ${Array.from({length:10},(m,w)=>{const R=n.placementCounts[w]??0;return`<td class="cycle-count ${R>n.cycles?"ready":""}">${R}</td>`}).join("")}
        </tr>
      `).join("");return`
    <div class="cycles-view">
    <div class="page-head tracking-page-head">
      <div class="race-heading">
        <i class="race-heading-icon">${h.racecycles}</i>
        <div><h1>RaceCycles</h1>
        <p>Extra finishes roll into later cycles.</p></div>
      </div>
    <div class="summary-row">
      ${x("Tracked racers",r.length)}
      ${x("Completed cycles",i)}
      ${x("Last updated",e.cycleLastUpdate?new Date(e.cycleLastUpdate).toLocaleTimeString():"Never")}
    </div>

      <div class="tracking-controls">${de(e,a,"cycles")}
        ${$("reprocess-latest","Reprocess latest file",'data-reprocess-latest title="Reprocess the most recently modified Race or Battle Royale for stats and cycles"',"cycles")}
      </div>
    </div>

    <section class="panel fill-panel cycles-panel">
      <header class="results-header">
        ${ue(e.config.seasons.cycleName||"Cycle progress",o)}
        <div class="results-actions">
          <input id="cycle-search" class="cycle-search" type="search" placeholder="Search players" aria-label="Search players" />
          <span id="cycle-filter-count" aria-live="polite"></span>
          <div class="results-actions-group">
            <button data-export="cycles" class="compact-button" title="Export entire cycles list">Export</button>
            <button id="clear-race-cycles" class="compact-button btn-error" type="button" ${r.length||e.totalCycleRaceCount?"":"disabled"}>Clear Results</button>
          </div>
        </div>
      </header>
      <div class="panel-body">
        ${r.length?`<div class="table-frame"><div class="table-wrap cycle-table-wrap">
                <table class="cycle-table">
                  <thead><tr><th>#</th>${c("racer","Racer")}${c("cycles","Cycles")}${Array.from({length:10},(n,p)=>c(`position-${p+1}`,String(p+1))).join("")}</tr></thead>
                  <tbody>${s}</tbody>
                </table>
              </div></div>`:'<div class="empty-state"><b>No cycle placements recorded yet</b><span>New Race results will populate this page automatically.</span></div>'}
      </div>
    </section>
    </div>
  `}function Me(e,t){const o=e.latestResult,a=o?.gameType==="battleRoyale",r=u=>u.reduce((v,S)=>v+S.results.reduce((H,E)=>H+E.seasonPointsEarned,0),0),c=r(e.sessionResults),i=e.seasonPointsEarned??r(e.recentResults),s=e.totalBattleRoyaleCount??e.recentResults.filter(u=>u.gameType==="battleRoyale").length,n=e.totalBattleRoyaleCount==null?Math.max(0,e.totalRaceCount-s):e.totalRaceCount,p=[1,2,3].map(u=>o?.results.find(v=>v.placement===u)),m=u=>u.placementCounts.filter(v=>v>u.cycles).length,w=[...e.raceCycles].sort((u,v)=>v.cycles-u.cycles||m(v)-m(u)||u.playerName.localeCompare(v.playerName)),R=w.slice(0,3),f=(u,v,S)=>`<span><i class="home-stat-icon" aria-hidden="true">${h[S]}</i><span class="home-stat-copy"><small>${l(u)}</small><b>${v}</b></span></span>`,A=u=>`<p class="home-table-updated"><i aria-hidden="true">${h.clock}</i><span>Last updated: ${u?`<time datetime="${l(u)}" title="${l(new Date(u).toLocaleString())}">${l(new Date(u).toLocaleTimeString())}</time>`:"Never"}</span></p>`,q=(u,v,S,H)=>{const E=P(e,u),ye=E&&K(e);return`<section class="panel home-watcher">
      <header><div class="home-card-heading"><i>${h[S]}</i><h2>${v}</h2></div><div class="watch-state ${ye?"good":"bad"}"><i></i><span>${E?l(e.watcherStatus):"Stopped"}</span></div></header>
      <div class="panel-body"><p class="home-season">${l(H)}</p>
        <button class="action ${E?"stop":"start"} home-watch-button" data-tracking-toggle="${u}" ${t?"disabled":""}>${t||E?h.spinner:h.watcherStart}<span>${E?"Stop":"Start"} ${v}</span></button>
      </div>
    </section>`};return`<div class="home-page">
    <header class="page-head"><div class="race-heading"><i class="race-heading-icon">${h.home}</i><div><h1>Home</h1></div></div>${$("reprocess-latest","Reprocess latest file",'data-reprocess-latest title="Reprocess the most recently modified Race or Battle Royale for stats and cycles"',"cycles")}</header>
    <div class="home-watchers">${q("stats","RaceStats","raceFlag",e.config.seasons.raceName)}${q("cycles","RaceCycles","racecycles",e.config.seasons.cycleName)}</div>
    <div class="home-results">
      <section class="panel"><header><div class="home-card-heading"><i>${h.podium}</i><h2>${a?"Latest Battle Royale":"Latest Race podium"}</h2></div><button class="action home-view-button" data-page="overview">View results</button></header><div class="panel-body">
        ${A(o?e.lastUpdate??o.timestamp:null)}
        ${o?`<div class="table-frame home-table-frame"><div class="table-scroll"><table class="home-summary-table ${a?"battle-royale-results":"race-results"}"><thead><tr><th>#</th><th>Player</th>${a?"<th>Kills</th><th>Damage</th>":""}<th>Points</th>${a?"":"<th>Season total</th>"}</tr></thead><tbody>${a?p.filter(u=>u!=null).map(u=>pe(u,!0,!0)).join(""):p.map((u,v)=>`<tr class="p${v+1}"><td><b class="place p${v+1}">${v+1}</b></td><td title="${l(u?.playerName??"")}" >${l(u?.playerName??"—")}</td><td class="points">${l(u?.seasonPointsEarned??"—")}</td><td>${l(u?.seasonPointsTotal??"—")}</td></tr>`).join("")}</tbody></table></div></div>`:'<p class="home-empty">No results scanned yet.</p>'}
        <div class="home-card-summary">${f("Total races",n,"statRaceFlag")}${f("Total BRs",s,"skull")}${f("Players",o?.playerCount??0,"racers")}${f("Session races",e.sessionResults.filter(u=>u.gameType==="race").length,"clock")}${f("Session BRs",e.sessionResults.filter(u=>u.gameType==="battleRoyale").length,"skull")}</div>
      </div></section>
      <section class="panel"><header><div class="home-card-heading"><i>${h.cycles}</i><h2>Cycle leaders</h2></div><button class="action home-view-button" data-page="racecycles">View cycles</button></header><div class="panel-body">
        ${A(e.cycleLastUpdate)}
        ${R.length?`<div class="table-frame home-table-frame"><div class="table-scroll"><table class="home-summary-table"><thead><tr><th>#</th><th>Player</th><th>Cycles</th><th>Next cycle</th></tr></thead><tbody>${R.map(u=>`<tr><td><b class="place">${w.findIndex(S=>S.cycles===u.cycles&&m(S)===m(u))+1}</b></td><td>${l(u.playerName)}</td><td class="cycle-total">${u.cycles}</td><td>${m(u)}/10</td></tr>`).join("")}</tbody></table></div></div>`:'<p class="home-empty">No cycle results yet.</p>'}
        <div class="home-card-summary">${f("Players",e.raceCycles.length,"racers")}${f("Races",e.totalCycleRaceCount,"statRaceFlag")}${f("Complete",e.raceCycles.reduce((u,v)=>u+v.cycles,0),"cycles")}</div>
      </div></section>
      <section class="panel home-points-panel" aria-label="Points totals"><div class="panel-body">
        <div class="home-card-summary home-points-summary">${f("Session points",c,"points")}${f("Season points",i,"points")}</div>
      </div></section>
    </div>
  </div>`}function Be(e,t){return`
    <aside class="sidebar">

      <nav>
        <span>Merbz</span>
        ${k("home",t,"Home")}
        ${k("overview",t,"RaceStats")}
        ${k("racecycles",t,"RaceCycles")}
        ${k("history",t,"History")}
         ${k("logs",t,"Live log")}

        <span>Integrations</span>
        ${k("twitch",t,"Twitch")}
        ${k("streamer",t,"Streamer.bot")}
        ${k("overlays",t,"Overlays")}
        ${k("settings",t,"Settings")}
       
      </nav>

      <div class="sidebar-foot">
        <div class="watcher-statuses connection-statuses">
        <div class="sidebar-watcher" title="Twitch: ${l(e.twitchUsername??e.twitchStatus)} — ${l(e.twitchStatus)}">
          <small>Twitch</small>
          <div class="watch-state ${le(e)}"><i></i><span>${l(e.twitchUsername&&e.twitchStatus==="Connected"?e.twitchUsername:e.twitchStatus)}</span></div>
        </div>
       
        <div class="sidebar-watcher" title="Streamer.bot: ${l(e.streamerBotStatus)}">
          <small>Streamer.bot</small>
          <div class="watch-state ${ie(e)}"><i></i><span>${l(e.streamerBotStatus)}</span></div>
        </div>
        </div>
        <div class="watcher-statuses">
          ${["stats","cycles"].map(o=>{const a=P(e,o)&&K(e),r=o==="stats"?"Stats":"Cycles";return`<div class="sidebar-watcher" title="${r}: ${a?"Watching":"Stopped"}"><small>${r}</small><div class="watch-state ${a?"good":"bad"}"><i></i><span>${a?"Watching":"Stopped"}</span></div></div>`}).join("")}
        </div>
      </div>
    </aside>
  `}function Ne(e,t,o,a,r,c=!1,i={key:"placement",direction:"asc"},s=""){const n=t==="home"?Me(e,o):t==="overview"?Te(e,o,c,i):t==="racecycles"?Le(e,r,c,o):t==="history"?xe(e):t==="logs"?Pe(e,a):t==="overlays"?Ce(s,$("test-overlays","Test overlays",'data-test-overlay="gameComplete"',"test")+$("test-overlay-wr","Test WR",'data-test-overlay="worldRecord"',"test")):t==="streamer"||t==="twitch"?te(e,t):te(e);return`
    <div class="app-shell">
      ${Be(e,t)}
      <main class="content">
        ${n}
      </main>
    </div>
  `}function Pe(e,t){const o=e.logs.filter(a=>t==="all"||a.level===t);return`
    <section class="log-window">
      <header class="page-head">
        <div class="race-heading"><i class="race-heading-icon">${h.logs}</i><div><h1>Live log</h1><p>Watcher and parser activity updates here as it happens.</p></div></div>

        <div class="log-actions">
          <select id="log-filter">
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>
      </header>

      <div id="log-list" class="log-list">
        ${o.length?o.map(a=>`
                    <div class="log-row ${l(a.level)}">
                      <time>${new Date(a.timestamp).toLocaleTimeString()}</time>
                      <b>${l(a.level.toUpperCase())}</b>
                      <span>${l(a.message)}</span>
                    </div>
                  `).join(""):'<div class="empty-state">No matching entries.</div>'}
      </div>
    </section>
  `}Se();const T=document.querySelector("#app");let d={cycleHistory:[],totalCycleRaceCount:0,totalRaceCount:0,totalBattleRoyaleCount:0,seasonPointsEarned:0,sessionResults:[],config:{startMinimized:!1,seasons:{raceName:"",cycleName:""},csv:{path:"LastSeasonRace.csv",gameType:"race",autoStartWatcher:!1,autoStartCycles:!1},streamerBot:{host:"127.0.0.1",port:7474,events:{raceComplete:!1,worldRecord:!0},actions:{gameComplete:"Marbles - Game Complete",worldRecord:"Marbles - World Record"}},twitch:{postResults:!0,postCycleResults:!1,messagePrefix:"🏁 Race results:",cycleMessageTemplate:"🎉 Congrats {player} on a cycle! You are great! That's cycle #{cycle}! 🎉"}},watcherStatus:"Loading",statsTrackingEnabled:!1,cyclesTrackingEnabled:!1,watcherMessage:"Connecting to the local watcher",streamerBotStatus:"Disabled",twitchStatus:"Disconnected",session:{gamesPlayed:0},recentResults:[],raceCycles:[],logs:[]},b="home",_=!1,he="",me="",Z,ae=0,N=!0,V="all",F="",W=!1,D=!1,O={key:"racer",direction:"asc"},U={key:"placement",direction:"asc"};function Ae(){const e=document.querySelector("#log-filter");e.value=V,e.addEventListener("change",()=>{V=e.value,y()});const t=document.querySelector("#log-list");t?.scrollTo(0,t.scrollHeight)}const C=new Map;function z(){document.querySelectorAll("[data-feedback-key]").forEach(e=>{const t=e.dataset.feedbackKey,o=C.get(t);if(!o)return;if(o.expiresAt&&Date.now()>=o.expiresAt){C.delete(t);return}e.style.width=`${o.width}px`,e.style.minWidth=`${o.width}px`,e.style.maxWidth=`${o.width}px`;const a=document.querySelector(`[data-error-for="${t}"]`);a&&(a.textContent=o.error??""),o.phase!=="error"&&(e.disabled=!0,e.classList.toggle("button-success",o.phase==="success"),e.innerHTML=`${o.phase==="success"?h.check:h.spinner}<span>${l(o.label)}</span>`)})}async function L(e,t,o="Testing…",a="Success"){if(C.get(e)?.phase==="busy")return;const c=document.querySelector(`[data-feedback-key="${e}"]`)?.getBoundingClientRect().width??120;C.set(e,{phase:"busy",width:c,label:o}),y();try{await t();const i={phase:"success",width:c,label:a,expiresAt:Date.now()+3e3};C.set(e,i),window.setTimeout(()=>{C.get(e)===i&&(C.delete(e),y())},3e3)}catch(i){C.set(e,{phase:"error",width:c,error:String(i)})}y()}function se(){document.querySelectorAll("[data-feature-section]").forEach(e=>{const t=document.getElementById(e.dataset.featureSection),o=e.dataset.masterToggle?document.getElementById(e.dataset.masterToggle):void 0,a=!t.checked||t.disabled||o!=null&&!o.checked;e.classList.toggle("feature-disabled",a);const r=e.querySelector(".feature-content");r.inert=a,r.querySelectorAll("input, textarea, button").forEach(c=>{c.dataset.originalDisabled??=String(c.disabled),c.disabled=a||c.dataset.originalDisabled==="true"})}),z()}const j=new Map;function qe(){const e=!window.matchMedia("(prefers-reduced-motion: reduce)").matches;e&&T.querySelectorAll(".home-watch-button").forEach(s=>{const n=s.dataset.trackingToggle;if(s.classList.contains("stop")!==P(d,n)){const p=getComputedStyle(s);j.set(n,{started:performance.now(),background:p.background,border:p.borderColor,shadow:p.boxShadow,color:p.color})}});const t=Z===b&&document.querySelector("#settings-form")?{...d,config:B()}:d;T.innerHTML=Ne(t,b,N,V,O,W,U,he),e&&T.querySelectorAll(".home-watch-button").forEach(s=>{const n=j.get(s.dataset.trackingToggle);if(!n)return;const p=performance.now()-n.started;if(p>=350){j.delete(s.dataset.trackingToggle);return}const m=document.createElement("span");m.className="home-button-transition",m.setAttribute("aria-hidden","true"),Object.assign(m.style,{background:n.background,borderColor:n.border,boxShadow:n.shadow}),s.prepend(m),m.animate([{opacity:1},{opacity:0}],{duration:350,delay:-p,easing:"ease-out",fill:"forwards"}).onfinish=()=>m.remove(),s.animate([{color:n.color},{color:getComputedStyle(s).color}],{duration:350,delay:-p,easing:"ease-out"})}),Z!==b&&(Z=b,ae=performance.now());const o=performance.now()-ae;if(o<240){const s=T.querySelector(".content");s.classList.add("page-enter"),s.style.animationDelay=`-${o}ms`}document.querySelectorAll("[data-page]").forEach(s=>{s.addEventListener("click",()=>{W=!1,b=s.dataset.page,y()})}),document.querySelector("#watch-toggle")?.addEventListener("click",()=>oe()),document.querySelectorAll("[data-tracking-toggle]").forEach(s=>{s.addEventListener("click",()=>oe(s.dataset.trackingToggle))}),document.querySelectorAll("[data-test-overlay]").forEach(s=>s.addEventListener("click",()=>{L(s.dataset.feedbackKey,()=>g("test_overlay",{kind:s.dataset.testOverlay}),"Sending...","Sent")})),document.querySelectorAll("[data-copy-overlay-path]").forEach(s=>s.addEventListener("click",()=>{L(s.dataset.feedbackKey,()=>navigator.clipboard.writeText(s.dataset.copyOverlayPath),"Copying...","Copied")})),document.querySelectorAll("[data-overlay-path]").forEach(s=>s.addEventListener("click",()=>s.select())),document.querySelectorAll("[data-open-overlay-file]").forEach(s=>s.addEventListener("click",()=>{ke(s.dataset.openOverlayFile,_)}));const a=document.querySelector("#overlay-setup-error");a&&(a.textContent=me);const r=()=>{document.querySelectorAll("[data-overlay-preview-type]").forEach(s=>{s.setAttribute("aria-pressed",String(s.dataset.overlayPreviewType==="br"===_))}),document.querySelectorAll(".overlay-mini-preview iframe").forEach(s=>{s.contentWindow?.postMessage({type:"marbles-overlay-preview",br:_},window.location.origin)})};document.querySelectorAll(".overlay-mini-preview iframe").forEach(s=>s.addEventListener("load",r)),document.querySelectorAll("[data-overlay-preview-type]").forEach(s=>s.addEventListener("click",()=>{_=s.dataset.overlayPreviewType==="br",r()})),r(),document.querySelectorAll(".overlay-template").forEach(s=>{const n=s.querySelector("iframe"),p=m=>n?.contentWindow?.postMessage({type:"marbles-overlay-preview-hover",active:m},window.location.origin);s.addEventListener("mouseenter",()=>p(!0)),s.addEventListener("mouseleave",()=>p(!1)),s.addEventListener("focusin",()=>p(!0)),s.addEventListener("focusout",m=>{s.contains(m.relatedTarget)||p(!1)}),n?.addEventListener("load",()=>p(s.matches(":hover, :focus-within")))}),document.querySelector("[data-reprocess-latest]")?.addEventListener("click",()=>{L("reprocess-latest",async()=>{if(d=await g("reread_last_file"),d.watcherStatus==="Error"||d.watcherStatus==="File Missing")throw new Error(d.watcherMessage??"Unable to reprocess the latest file")},"Reading…","Read complete")}),z(),document.querySelectorAll("[data-results-sort]").forEach(s=>{s.addEventListener("click",()=>{const n=s.dataset.resultsSort;U=U.key===n?{key:n,direction:U.direction==="asc"?"desc":"asc"}:{key:n,direction:["placement","player","time","eliminated"].includes(n)?"asc":"desc"},y()})}),["settings","streamer","twitch"].includes(b)&&(_e(),z()),b==="logs"&&Ae();const c=async()=>{const s=document.querySelector("#season-name");if(!s)return;const n={...d.config.seasons};b==="racecycles"?n.cycleName=s.value.trim():n.raceName=s.value.trim(),d=await g("save_seasons",{seasons:n}),W=!1};document.querySelector("#edit-season-name")?.addEventListener("click",()=>{W=!0,y();const s=document.querySelector("#season-name");s?.focus(),s?.select()}),document.querySelector("#season-form")?.addEventListener("submit",async s=>{s.preventDefault();try{await c(),y()}catch(n){alert(String(n))}}),document.querySelectorAll("[data-export]").forEach(s=>{D&&(s.disabled=!0),s.addEventListener("click",async()=>{if(!D){D=!0,document.querySelectorAll("[data-export]").forEach(n=>n.disabled=!0);try{document.querySelector("#season-name")&&await c(),await g("export_data",{kind:s.dataset.export})}catch(n){alert(String(n))}finally{D=!1,y()}}})}),document.querySelector("#clear-race-results")?.addEventListener("click",async()=>{if(confirm("Reset RaceStats: total races, total BRs, session stats, and season points? Saved history will remain."))try{d=await g("clear_race_results")}catch(s){alert(String(s))}finally{y()}});const i=document.querySelector("#cycle-search");if(i){i.value=F;const s=()=>{F=i.value;let n=0;document.querySelectorAll(".cycle-table tbody tr").forEach(p=>{p.hidden=!p.querySelector(".cycle-player").textContent.toLocaleLowerCase().includes(F.trim().toLocaleLowerCase()),p.hidden||n++}),document.querySelector("#cycle-filter-count").textContent=`${n} of ${d.raceCycles.length} racers`};i.addEventListener("input",s),s()}b==="history"&&(document.querySelector("#clear-cycle-history")?.addEventListener("click",async()=>{if(confirm("Clear saved cycle history? Current cycle counts will stay unchanged."))try{d=await g("clear_cycle_history")}catch(s){alert(String(s))}finally{y()}}),document.querySelector("#clear-history")?.addEventListener("click",async()=>{if(confirm("Clear all saved race history?"))try{d=await g("clear_history")}catch(s){alert(String(s))}finally{y()}})),b==="racecycles"&&(document.querySelectorAll("[data-cycle-sort]").forEach(s=>{s.addEventListener("click",()=>{const n=s.dataset.cycleSort;O=O.key===n?{key:n,direction:O.direction==="asc"?"desc":"asc"}:{key:n,direction:n==="racer"?"asc":"desc"},y()})}),document.querySelector("#clear-race-cycles")?.addEventListener("click",async()=>{if(confirm("Reset RaceCycles: all players, placements, completed cycles, and tracked races? Saved history will remain."))try{d=await g("clear_race_cycles")}catch(s){alert(String(s))}finally{y()}}))}function y(){const t=[...T.querySelectorAll("input, textarea")].map(i=>({id:i.id,value:i.value,checked:i instanceof HTMLInputElement?i.checked:!1})),o=document.activeElement,a=o?.id,r=o&&["text","search","textarea"].includes(o.type)?[o.selectionStart,o.selectionEnd]:null,c=!!(a&&T.contains(o));if(qe(),c){for(const s of t){const n=document.getElementById(s.id);n&&(n.value=s.value,n instanceof HTMLInputElement&&(n.checked=s.checked))}const i=document.getElementById(a);i?.focus(),i&&r&&i.setSelectionRange(r[0],r[1])}}async function oe(e=b==="racecycles"?"cycles":"stats"){if(N)return;const t=!P(d,e);N=!0,y();try{d=await g("set_tracking_enabled",{kind:e,enabled:t})}catch(o){alert(String(o))}finally{N=!1,y()}}function B(){const e=document.querySelector("#auto-start"),t=document.querySelector("#streamer-host"),o=document.querySelector("#streamer-port"),a=document.querySelector("#streamer-game-action"),r=document.querySelector("#streamer-record-action"),c=document.querySelector("#twitch-post-results"),i=document.querySelector("#twitch-message-prefix"),s=document.querySelector("#twitch-cycle-message");return{...d.config,startMinimized:document.querySelector("#start-minimized")?.checked??d.config.startMinimized??!1,csv:{...d.config.csv,gameType:"race",autoStartWatcher:e?.checked??d.config.csv.autoStartWatcher,autoStartCycles:document.querySelector("#auto-start-cycles")?.checked??d.config.csv.autoStartCycles??!1},streamerBot:{...d.config.streamerBot,host:t?.value.trim()||d.config.streamerBot.host,port:Number(o?.value)||d.config.streamerBot.port,events:{raceComplete:document.querySelector("#streamer-race-enabled")?.checked??d.config.streamerBot.events?.raceComplete??!1,worldRecord:document.querySelector("#streamer-record-enabled")?.checked??d.config.streamerBot.events?.worldRecord??!0},actions:{gameComplete:a?.value.trim()||d.config.streamerBot.actions.gameComplete,worldRecord:r?.value.trim()||d.config.streamerBot.actions.worldRecord}},twitch:{postCycleResults:document.querySelector("#twitch-post-cycles")?.checked??d.config.twitch.postCycleResults,postResults:c?.checked??d.config.twitch.postResults,messagePrefix:i?.value??d.config.twitch.messagePrefix,cycleMessageTemplate:s?.value??d.config.twitch.cycleMessageTemplate}}}function _e(){const e=document.querySelector("#settings-form"),t=document.querySelector("#twitch-message-prefix"),o=document.querySelector("#twitch-message-preview");t?.addEventListener("input",()=>{o&&(o.textContent=re(t.value,d.latestResult).join(`

`))});const a=document.querySelector("#twitch-cycle-message"),r=document.querySelector("#twitch-cycle-message-preview");a?.addEventListener("input",()=>{r&&(r.textContent=ne(a.value))}),document.querySelector("#twitch-connect")?.addEventListener("click",async()=>{const c=document.querySelector("#twitch-connect");c.disabled=!0,c.textContent="Opening Twitch…";try{await g("save_config",{config:B()});const i=crypto.randomUUID();await g("open_twitch_authorization",{desktopId:i});const s=await We(i);d=await g("complete_twitch_oauth",s)}catch(i){alert(String(i))}finally{y()}}),document.querySelector("#twitch-disconnect")?.addEventListener("click",async()=>{try{d=await g("disconnect_twitch")}catch(c){alert(String(c))}finally{y()}}),document.querySelectorAll("[data-twitch-test]").forEach(c=>{c.addEventListener("click",async()=>{if(d.twitchStatus!=="Connected")return;const i=c.dataset.twitchTest,s=B().twitch;await L(c.dataset.feedbackKey,async()=>{d=await g("test_twitch_message",{kind:i,config:s})},"Posting...","Sent")})}),document.querySelectorAll("[data-streamer-test]").forEach(c=>{c.addEventListener("click",async()=>{const i=c.dataset.streamerTest,s=B().streamerBot;await L(c.dataset.feedbackKey,async()=>{d=i==="connection"?await g("test_streamer_bot_connection",{config:s}):await g("test_streamer_bot_action",{config:s,kind:i})})})}),e.querySelectorAll('input[type="checkbox"]').forEach(c=>{c.addEventListener("change",se)}),se(),e.addEventListener("submit",async c=>{c.preventDefault();const i=B();await L("save-"+b,async()=>{d=await g("save_config",{config:i})},"Saving...","Saved")})}async function We(e){for(let t=0;t<600;t+=1){const o=await fetch(`/api/public/auth/twitch/result?desktop=${encodeURIComponent(e)}`,{cache:"no-store"});if(o.ok&&o.status!==204)return await o.json();await new Promise(a=>window.setTimeout(a,1e3))}throw new Error("Twitch authorization timed out. Try Connect Twitch again.")}async function De(){const e=document.querySelector(".startup span");e&&(e.textContent="Loading local stats…"),d=await g("get_app_snapshot"),N=!1,y(),document.title="Marbles Stats — Ready",g("get_overlay_directory").then(a=>{he=a,y()}).catch(a=>{me=`Unable to prepare overlay files: ${String(a)}`,y()});const t=Y("app-state",a=>{d=a.payload,y()}),o=Y("log-entry",a=>{d.logs.push(a.payload),d.logs.length>500&&d.logs.shift(),b==="logs"&&y()});await Promise.all([t,o]),d.twitchStatus!=="Disconnected"&&g("validate_twitch_session").then(a=>{d=a,y()}).catch(()=>{});for(const[a,r]of[["stats",d.config.csv.autoStartWatcher],["cycles",d.config.csv.autoStartCycles]])if(r)try{d=await g("set_tracking_enabled",{kind:a,enabled:!0}),y()}catch(c){console.error(`Unable to auto-start ${a}`,c)}}y();De().catch(e=>{document.title="Marbles Stats — Startup Error",T.innerHTML=`
    <div class="fatal">
      <h1>Unable to start</h1>
      <p>${l(e)}</p>
    </div>
  `});
