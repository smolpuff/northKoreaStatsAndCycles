import { renderGuideHeader, renderGuideStep } from "./guide-illustrations";
import { showAnimatedDialog } from "./dialog-motion";
import { iconInput } from "./input-field";
import { icons } from "./icons";
import { sidebarArtwork } from "./sidebar-icons";

import { optionsFor, renderOverlayCustomization, renderOverlayCustomizeButton, updateOverlayPreview, type OverlayName } from "./overlay-options";

const templates = [
  [
    "results",
    "Results",
    "Every Race or BR player, smoothly scrolling down and back up. BR adds kills and damage.",
  ],
  ["cycle-status", "Cycle status", "Large standings table with 20 visible players, completed cycles, positions 1?10 and positions left. Green marks positions collected in the current cycle; counts include all placements. Scrolls through every tracked player."],
  ["podium", "Podium", "The top three players and their earned points."],
  [
    "world-record",
    "World record",
    "Full-screen gold celebration, record time, player, points, and confetti.",
  ],
  [
    "points",
    "Points",
    "Latest match points and session points together, plus the season total. Includes Race + BR.",
  ],
  [
    "cycle-complete",
    "Cycle completed",
    "Full-screen celebration with confetti, player, cycle number, and matches taken.",
  ],
] as const;

const escapePath = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function installOverlayPreviewSizing(): void {
  window.addEventListener("message", (event) => {
    if (
      event.origin !== window.location.origin ||
      !["marbles-overlay-preview-size", "marbles-overlay-preview-ready"].includes(event.data?.type)
    )
      return;
    document
      .querySelectorAll<HTMLIFrameElement>(".overlay-mini-preview iframe, .overlay-sample-dialog iframe")
      .forEach((frame) => {
        if (event.source !== frame.contentWindow) return;
        if (event.data.type === "marbles-overlay-preview-ready") {
          const name = new URL(frame.src).pathname.split("/").pop()!.replace(".html", "") as OverlayName;
          updateOverlayPreview(frame, name);
          frame.contentWindow?.postMessage({ type: "marbles-overlay-preview", br: frame.dataset.previewBr === "true" }, window.location.origin);
          const card = frame.closest(".overlay-template");
          const dialog = frame.closest<HTMLDialogElement>(".overlay-sample-dialog");
          frame.contentWindow?.postMessage({ type: "marbles-overlay-preview-hover", active: Boolean(dialog?.open || card?.matches(":hover, :focus-within")) }, window.location.origin);
          return;
        }
        const height = Number(event.data.height);
        if (!Number.isFinite(height) || height <= 0 || height > 4000) return;
        if (frame.closest(".overlay-sample-dialog")) {
          // Sized to its configured source aspect ratio by updateOverlayPreview.
          return;
        }
        const scale = new DOMMatrixReadOnly(getComputedStyle(frame).transform)
          .a;
        frame.parentElement!.style.height = `${Math.ceil(height * scale)}px`;
      });
  });
}

export function openOverlayPreview(name: string, br: boolean): void {
  const template = templates.find(([file]) => `${file}.html` === name);
  if (!template) return;
  document.querySelector<HTMLDialogElement>("#overlay-preview-dialog")?.close();
  const dialog = document.createElement("dialog");
  dialog.id = "overlay-preview-dialog";
  dialog.className = `overlay-preview-dialog overlay-sample-dialog ${template[0] === "world-record" || template[0] === "cycle-complete" ? "overlay-celebration-dialog" : "overlay-card-dialog"}`;
  dialog.setAttribute("aria-label", `${template[1]} preview`);
  dialog.innerHTML = `<header><h2>${template[1]} preview</h2><button type="button" class="compact-button modal-close" aria-label="Close" title="Close" data-close-preview>${icons.close}</button></header><p>Animated sample preview. Use <b>Copy path</b> on the card to add the live overlay in OBS.</p><div class="overlay-large-preview"><iframe title="${template[1]} animated sample"></iframe></div>`;
  const frame = dialog.querySelector<HTMLIFrameElement>("iframe")!;
  frame.dataset.previewBr = String(br);
  updateOverlayPreview(frame, template[0]);
  frame.addEventListener("load", () => {
    updateOverlayPreview(frame, template[0]);
    frame.contentWindow?.postMessage(
      { type: "marbles-overlay-preview", br },
      window.location.origin,
    );
    frame.contentWindow?.postMessage(
      { type: "marbles-overlay-preview-hover", active: true },
      window.location.origin,
    );
  });
  frame.src = `/overlays/${name}?preview=1`;
  dialog
    .querySelector("[data-close-preview]")!
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  showAnimatedDialog(dialog);
}

export function overlaysPage(
  directory: string,
  testButton: (file: string, kind: string) => string,
): string {
  return `<div class="overlays-page">
    <div class="page-head"><div class="race-heading"><i class="race-heading-icon">${sidebarArtwork("overlays", "header-overlays")}</i><div><h1>Overlays</h1><p>Editable HTML sources for OBS, updated by Marbles Stats.</p></div></div></div>
    <section class="panel custom-overlay-intro">${renderGuideHeader("Custom HTML overlays", "Make your own design with the same live match data.", "custom", "file")}<div class="panel-body"><p>Copy <code>custom.html</code> to a new HTML file in the live overlay folder. Edit its HTML and CSS, combine the supported variables you want, then add that page as one OBS Browser Source. The custom-overlay help includes a starter shell and the full variable reference.</p></div></section>
    <section class="panel"><header><h2>Overlay templates</h2></header><div class="panel-body">
      <p id="overlay-setup-error" role="alert"></p>
      <p>The app creates and updates these files automatically. Add their HTML files as OBS Browser Sources. No Streamer.bot action is required for these premade overlays. These previews use sample data. Hover any card to play its animation loop. Results, Cycle status, Podium and Points stay visible with live data. Use Test on World record or Cycle completed to play their celebrations in OBS.</p>
      <label class="overlay-folder">Live overlay folder${iconInput(icons.file, `<input readonly data-overlay-path value="${escapePath(directory)}" placeholder="Loading overlay folder..." />`)}</label>
      <div class="overlay-preview-controls"><span id="overlay-preview-type-label">Preview match type</span><div class="overlay-match-selector" role="group" aria-labelledby="overlay-preview-type-label"><button type="button" class="compact-button" data-overlay-preview-type="race" aria-pressed="true">Race</button><button type="button" class="compact-button" data-overlay-preview-type="br" aria-pressed="false">Battle Royale</button></div></div>
      <div class="overlay-gallery">${templates
        .map(([file, title, description]) => {
          const path = escapePath(
            directory ? directory + "\\" + file + ".html" : "",
          );
          const options = optionsFor(file);
          const sourceSize = `${options.width} &times; ${options.height} px`;
          return `<article class="overlay-template"><div class="overlay-mini-preview" style="height:${file === "world-record" || file === "cycle-complete" ? 61 : file === "results" || file === "cycle-status" ? 100 : 47}px"><iframe title="${title} sample preview" src="/overlays/${file}.html?preview=1" loading="lazy" tabindex="-1" aria-hidden="true"></iframe></div><div class="overlay-template-copy"><div class="overlay-template-heading"><h3>${title}</h3>${file === "world-record" || file === "cycle-complete" ? `<div class="overlay-test-action">${testButton(file, file === "world-record" ? "worldRecord" : "cycleComplete")}</div>` : ""}</div><p class="overlay-description">${description}</p><p class="overlay-source-size"><b>OBS source size:</b> ${sourceSize}</p><div class="overlay-source-path"><p class="overlay-file-path" title="${path}">${path || "Loading file path..."}</p><div class="overlay-file-actions"><button type="button" class="compact-button" data-copy-overlay-path="${path}" data-feedback-key="copy-overlay-${file}" ${directory ? "" : "disabled"}>Copy path</button><button class="compact-button" type="button" data-open-overlay-file="${file}.html">Open preview</button><button class="overlay-inline-link" type="button" data-overlay-variables="${file}">Edit HTML &amp; variables</button>${renderOverlayCustomizeButton(file)}</div><span class="button-feedback-error" data-error-for="copy-overlay-${file}" role="alert"></span></div></div>${renderOverlayCustomization(file)}</article>`;
        })
        .join("")}</div>
    </div></section>
    <section class="panel overlays-setup-guide">${renderGuideHeader("Setup Guide", "Add the overlays you want to OBS.", "overlays")}<div class="panel-body overlay-instructions">
      <ol class="guide-steps">
        ${renderGuideStep(1, "Copy the path", "Choose an overlay above and click Copy path. Each overlay you choose gets one Browser Source.", "overlay-path")}
        ${renderGuideStep(2, "Add a Browser Source", "In OBS: Sources + > Browser. Enable Local file and select the HTML page.", "browser-source")}
        ${renderGuideStep(3, "Test and position", "Position the overlay sources in OBS. For World record and Cycle completed, click Test to show their celebrations without counting a match.", "obs-results")}
        ${renderGuideStep(4, "Let the data update", "Keep Marbles Stats running. Browser pages check new data every 3 seconds. No Streamer.bot action is needed.", "live-data")}
      </ol>
      <p>Leave the sources' eyes enabled. Results, cycle status, podium, and points stay visible; WR and cycle celebrations appear for events and hide themselves after 10 seconds by default. Open Customize on either celebration card to change its duration and save. Put celebration sources above your other sources in OBS.</p>
      <details><summary>Blank source?</summary><p>Live sources wait for data; <b>Open preview</b> always shows an animated sample. Results, Podium and Points need a processed match. Use Test for WR or Cycle celebrations to position them in OBS. Keep Marbles Stats running with the watchers enabled. Automatic WR detection from the current CSV is not available yet.</p><p><a href="https://obsproject.com/kb/browser-source" target="_blank" rel="noreferrer">OBS Browser Source help</a></p></details>
    </div></section>

  </div>`;
}
