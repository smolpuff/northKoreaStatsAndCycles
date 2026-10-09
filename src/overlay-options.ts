import { invoke } from "@tauri-apps/api/core";

export type OverlayName = "results" | "podium" | "points" | "world-record" | "cycle-complete";
export interface OverlayOptions {
  width: number;
  height: number;
  opacity: number;
  background: string;
  text: string;
  secondary: string;
  accent: string;
  gold: string;
  teal: string;
  headerVisible: boolean;
  headerText: string;
  durationSeconds: number;
  visibleRows: number;
  scrollPixelsPerSecond: number;
}
export const isCelebration = (name: string) => name === "world-record" || name === "cycle-complete";
export function defaultOverlayOptions(name: OverlayName): OverlayOptions {
  return {
    width: isCelebration(name) ? 1920 : 400,
    height: isCelebration(name) ? 1080 : name === "points" ? 260 : name === "podium" ? 300 : 413,
    opacity: 80, background: "#071324", text: "#f5f5ff", secondary: "#b8c4e8",
    accent: "#ff0081", gold: "#ffe024", teal: "#00efaa", headerVisible: true,
    headerText: "", durationSeconds: isCelebration(name) ? 10 : 0,
    visibleRows: 6, scrollPixelsPerSecond: 20,
  };
}
export const overlayOptions: Partial<Record<OverlayName, OverlayOptions>> = {};
export const sourceHeight = (name: OverlayName, options: OverlayOptions) => name === "results" ? options.visibleRows * 42 + (options.headerVisible ? 161 : 106) : options.height;
export const optionsFor = (name: OverlayName) => {
  const options = overlayOptions[name] ?? defaultOverlayOptions(name);
  return { ...options, height: sourceHeight(name, options) };
};
const drafts: Partial<Record<OverlayName, OverlayOptions>> = {};
const expanded = new Set<OverlayName>();
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export const overlayIsCustomized = (name: OverlayName) => JSON.stringify(optionsFor(name)) !== JSON.stringify(defaultOverlayOptions(name));

export function renderOverlayCustomizeButton(name: OverlayName): string {
  return `<div class="overlay-customize-control"><span class="twitch-customized-state" data-overlay-customized ${overlayIsCustomized(name) ? "" : "hidden"}>&#10003; Customized</span><button type="button" class="customize-button" data-toggle-overlay-customization="${name}" aria-expanded="${expanded.has(name)}" aria-controls="overlay-options-${name}">Customize<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></button></div>`;
}

export function renderOverlayCustomization(name: OverlayName): string {
  const options = drafts[name] ?? optionsFor(name);
  const number = (key: keyof OverlayOptions, label: string, min: number, max: number) =>
    `<label class="field"><span>${label}</span><input type="number" required min="${min}" max="${max}" step="1" id="overlay-${name}-${key}" name="${key}" value="${options[key]}" /></label>`;
  return `<details class="overlay-customization" ${expanded.has(name) ? "open" : ""}><summary hidden>Customize</summary>
    <form id="overlay-options-${name}" data-overlay-options="${name}">
      <div class="overlay-options-grid">
        <div class="overlay-layout-options">
          ${number("width", "OBS width (px)", 280, 3840)}${name === "results" ? `<div class="field overlay-auto-height"><span>OBS height (auto)</span><output data-overlay-height>${sourceHeight(name, options)} px</output></div>` : number("height", "OBS height (px)", 180, 2160)}
          ${isCelebration(name) ? number("durationSeconds", "Duration (seconds)", 1, 300) : ""}
          <label class="field overlay-opacity"><span>Background opacity <output data-overlay-opacity>${options.opacity}%</output></span><input type="range" min="0" max="100" step="1" id="overlay-${name}-opacity" name="opacity" value="${options.opacity}" /></label>
          <label class="field overlay-header-text"><span>Header text</span><input id="overlay-${name}-headerText" name="headerText" maxlength="100" value="${escape(options.headerText)}" placeholder="Default overlay heading" /></label>
          <label class="overlay-header-toggle toggle-row"><input type="checkbox" role="switch" id="overlay-${name}-headerVisible" name="headerVisible" ${options.headerVisible ? "checked" : ""} /> Show header</label>
          ${name === "results" ? number("visibleRows", "Visible players", 1, 25) + number("scrollPixelsPerSecond", "Scroll speed (px/s)", 5, 100) : ""}
        </div>
        <div class="overlay-color-options">
          ${([['background','Background'],['text','Text'],['secondary','Secondary text'],['accent','Accent'],['gold','Gold'],['teal','Green / points']] as const).map(([key,label]) => `<label class="field overlay-color-field"><span>${label}</span><input type="color" id="overlay-${name}-${key}" name="${key}" value="${options[key]}" /></label>`).join("")}
        </div>
      </div>
      <p class="overlay-options-note">Changes appear in this preview. Save to apply them in OBS. After resizing, use the updated source size shown above in OBS. Blank header text uses the original heading.</p>
      <div class="overlay-options-actions"><button type="submit" class="compact-button overlay-options-save" data-feedback-key="options-${name}">Save</button><button type="button" class="compact-button" data-reset-overlay-options="${name}" data-feedback-key="reset-options-${name}">Restore defaults</button></div>
      <span class="button-feedback-error" data-error-for="options-${name}" role="alert"></span><span class="button-feedback-error" data-error-for="reset-options-${name}" role="alert"></span>
    </form></details>`;
}

export function updateOverlayPreview(frame: HTMLIFrameElement, name: OverlayName, options = optionsFor(name)): void {
  options = { ...options, height: sourceHeight(name, options) };
  const container = frame.closest(".overlay-mini-preview");
  if (container) {
    const scale = 108 / options.width;
    frame.style.width = `${options.width}px`;
    frame.style.height = `${options.height}px`;
    frame.style.transform = `scale(${scale})`;
    frame.style.marginLeft = "-54px";
    frame.parentElement!.style.height = `${Math.ceil(options.height * scale)}px`;
  } else {
    const dialog = frame.closest<HTMLDialogElement>(".overlay-sample-dialog");
    if (dialog) {
      dialog.style.width = `min(${options.width + 34}px, calc(100vw - 40px), calc((100vh - 190px) * ${options.width / options.height} + 34px))`;
      frame.style.height = "auto";
      frame.style.aspectRatio = `${options.width} / ${options.height}`;
    }
  }
  frame.contentWindow?.postMessage({ type: "marbles-overlay-options", options }, window.location.origin);
}

export function installOverlayCustomization(run: (key: string, action: () => Promise<void>, busy: string, success: string) => Promise<unknown>): void {
  document.querySelectorAll<HTMLFormElement>("[data-overlay-options]").forEach(form => {
    const name = form.dataset.overlayOptions as OverlayName;
    const details = form.parentElement as HTMLDetailsElement;
    const toggle = form.closest(".overlay-template")!.querySelector<HTMLButtonElement>("[data-toggle-overlay-customization]")!;
    toggle.addEventListener("click", () => {
      details.open = !details.open;
      toggle.setAttribute("aria-expanded", String(details.open));
      if (details.open) expanded.add(name); else expanded.delete(name);
    });
    const read = (): OverlayOptions => {
      const fields = new FormData(form);
      const options = { ...optionsFor(name) };
      for (const key of ["width", "height", "opacity", "durationSeconds", "visibleRows", "scrollPixelsPerSecond"] as const) {
        if (fields.has(key)) options[key] = Number(fields.get(key));
      }
      for (const key of ["background", "text", "secondary", "accent", "gold", "teal", "headerText"] as const) options[key] = String(fields.get(key));
      options.headerVisible = fields.has("headerVisible");
      options.height = sourceHeight(name, options);
      return options;
    };
    const preview = () => {
      if (!form.checkValidity()) return;
      drafts[name] = read();
      form.querySelector<HTMLOutputElement>("[data-overlay-opacity]")!.value = `${drafts[name]!.opacity}%`;
      const height = form.querySelector<HTMLOutputElement>("[data-overlay-height]");
      if (height) height.value = `${drafts[name]!.height} px`;
      form.closest(".overlay-template")!.querySelector(".overlay-source-size")!.innerHTML = `<b>OBS source size:</b> ${drafts[name]!.width} × ${drafts[name]!.height} px`;
      const frame = form.closest(".overlay-template")?.querySelector<HTMLIFrameElement>("iframe");
      if (frame) updateOverlayPreview(frame, name, read());
    };
    form.addEventListener("input", preview);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      void run(`options-${name}`, async () => {
        const options = read();
        expanded.add(name);
        overlayOptions[name] = await invoke<OverlayOptions>("save_overlay_options", { kind: name, options });
        delete drafts[name];
        const size = form.closest(".overlay-template")!.querySelector<HTMLElement>(".overlay-source-size")!;
        size.innerHTML = `<b>OBS source size:</b> ${options.width} × ${options.height} px`;
        (form.closest(".overlay-template")!.querySelector("[data-overlay-customized]") as HTMLElement).hidden = !overlayIsCustomized(name);
        preview();
      }, "Saving...", "Saved");
    });
    form.querySelector<HTMLButtonElement>("[data-reset-overlay-options]")!.addEventListener("click", () => {
      void run(`reset-options-${name}`, async () => {
        expanded.add(name);
        await invoke("reset_overlay_options", { kind: name });
        delete overlayOptions[name];
        delete drafts[name];
        const defaults = defaultOverlayOptions(name);
        for (const [key, value] of Object.entries(defaults)) {
          const input = form.elements.namedItem(key) as HTMLInputElement | null;
          if (!input) continue;
          if (typeof value === "boolean") input.checked = value;
          else input.value = String(value);
        }
        (form.closest(".overlay-template")!.querySelector("[data-overlay-customized]") as HTMLElement).hidden = true;
        form.closest(".overlay-template")!.querySelector(".overlay-source-size")!.innerHTML = `<b>OBS source size:</b> ${defaults.width} × ${defaults.height} px`;
        preview();
      }, "Restoring...", "Restored");
    });
  });
}
