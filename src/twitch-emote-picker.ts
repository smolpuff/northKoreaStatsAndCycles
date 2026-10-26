import { invoke } from "@tauri-apps/api/core";
import { showAnimatedDialog } from "./dialog-motion";
import { icons } from "./icons";
import type { Snapshot } from "./types";

type MessageField = HTMLInputElement | HTMLTextAreaElement;
interface Emote { id: string; name: string; imageUrl: string }
interface EmoteList { login: string; needsAuthorization: boolean; emotes: Emote[] }
const fieldIds = ["promotion-message", "twitch-message-prefix", "twitch-race-message", "twitch-race-entry", "twitch-race-separator", "twitch-cycle-message", "twitch-world-record-message"];
let cached: { login: string; loaded: number; emotes: Emote[] } | undefined;
let pending: { login: string; result: Promise<EmoteList> } | undefined;
let previewLogin: string | undefined;
let previewAttempt: { login: string; time: number } | undefined;
const previewIds = ["promotion-message-preview", "twitch-message-preview", "twitch-cycle-message-preview", "twitch-world-record-preview"];

async function channelEmotes(login: string): Promise<EmoteList> {
  const existing = cached;
  if (existing?.login === login && Date.now() - existing.loaded < 5 * 60_000) return { login, needsAuthorization: false, emotes: existing.emotes };
  if (pending?.login === login) return pending.result;
  const result = invoke<EmoteList>("list_twitch_emotes").then(list => {
    if (list.login !== login) throw new Error("Twitch account changed. Reopen the emote picker.");
    list.emotes = list.emotes.filter(emote => {
      try { const url = new URL(emote.imageUrl); return url.protocol === "https:" && url.hostname === "static-cdn.jtvnw.net" && url.pathname.startsWith("/emoticons/v2/") && !url.username && !url.password && !url.port; }
      catch { return false; }
    });
    if (!list.needsAuthorization && previewLogin === login) cached = { login, loaded: Date.now(), emotes: list.emotes };
    return list;
  });
  pending = { login, result };
  try { return await result; }
  finally { if (pending?.result === result) pending = undefined; }
}

function renderEmotePreviews(): void {
  if (!cached || cached.login !== previewLogin) return;
  const names = new Map(cached.emotes.map(emote => [emote.name, emote]));
  for (const id of previewIds) {
    const preview = document.getElementById(id);
    if (!preview) continue;
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const text of texts) {
      const parts = text.data.split(/(\s+)/);
      if (!parts.some(part => names.has(part))) continue;
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        const emote = names.get(part);
        if (!emote) { fragment.append(document.createTextNode(part)); continue; }
        const image = document.createElement("img");
        image.className = "twitch-inline-emote";
        image.src = emote.imageUrl;
        image.alt = image.title = emote.name;
        image.width = image.height = 20;
        image.referrerPolicy = "no-referrer";
        fragment.append(image);
      }
      text.replaceWith(fragment);
    }
  }
}

export function emoteInsertion(value: string, name: string, start: number, end: number): { value: string; caret: number } {
  start = Math.max(0, Math.min(start, value.length));
  end = Math.max(start, Math.min(end, value.length));
  const before = value.slice(0, start);
  const after = value.slice(end);
  const inserted = `${before && !/\s$/.test(before) ? " " : ""}${name}${!after || !/^\s/.test(after) ? " " : ""}`;
  return { value: before + inserted + after, caret: before.length + inserted.length };
}

export function installTwitchEmotePickers(state: Snapshot, update: (snapshot: Snapshot) => void): void {
  previewLogin = state.twitchUsername;
  if (cached?.login !== previewLogin) cached = undefined;
  renderEmotePreviews();
  const login = state.twitchUsername;
  if (!fieldIds.some(id => document.getElementById(id))) return;
  if (login && state.twitchStatus === "Connected" && (!previewAttempt || previewAttempt.login !== login || Date.now() - previewAttempt.time > 30_000)) {
    previewAttempt = { login, time: Date.now() };
    void channelEmotes(login).then(() => renderEmotePreviews()).catch(() => {});
  }
  for (const id of fieldIds) {
    const field = document.getElementById(id) as MessageField | null;
    const button = document.querySelector<HTMLButtonElement>(`[data-emote-target="${id}"]`);
    if (!field || !button || button.dataset.emoteBound) continue;
    button.dataset.emoteBound = "true";
    field.closest("label")?.setAttribute("for", id);
    field.addEventListener("input", () => queueMicrotask(renderEmotePreviews));
    button.addEventListener("click", event => {
      event.preventDefault();
      if (!field.disabled && !field.readOnly) openPicker(field, state, update);
    });
  }
}

function openPicker(target: MessageField, state: Snapshot, update: (snapshot: Snapshot) => void): void {
  if (document.querySelector("#twitch-emote-dialog")) return;
  const targetId = target.id;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  const dialog = document.createElement("dialog");
  dialog.id = "twitch-emote-dialog";
  dialog.className = "overlay-preview-dialog twitch-emote-dialog";
  dialog.setAttribute("aria-labelledby", "twitch-emote-title");
  dialog.innerHTML = `<header><h2 id="twitch-emote-title">Your channel emotes</h2><button type="button" class="compact-button modal-close" aria-label="Close">${icons.close}</button></header>
    <input type="search" data-emote-search placeholder="Search your emotes…" aria-label="Search your Twitch emotes" />
    <p data-emote-status role="status" aria-live="polite">Loading your emotes…</p>
    <div class="twitch-emote-grid" data-emote-grid></div>
    <footer><button type="button" class="compact-button" data-emote-more hidden>Show more</button><button type="button" class="compact-button" data-emote-retry hidden>Retry</button><button type="button" class="compact-button" data-emote-connect hidden>Reconnect Twitch</button></footer>`;
  const search = dialog.querySelector<HTMLInputElement>("[data-emote-search]")!;
  const status = dialog.querySelector<HTMLElement>("[data-emote-status]")!;
  const grid = dialog.querySelector<HTMLElement>("[data-emote-grid]")!;
  const more = dialog.querySelector<HTMLButtonElement>("[data-emote-more]")!;
  const retry = dialog.querySelector<HTMLButtonElement>("[data-emote-retry]")!;
  const connect = dialog.querySelector<HTMLButtonElement>("[data-emote-connect]")!;
  let emotes: Emote[] = [];
  let visible = 60;
  let busy = false;
  const position = () => {
    const field = document.getElementById(targetId);
    if (!field) { dialog.close(); return; }
    const anchor = field.getBoundingClientRect();
    const box = dialog.getBoundingClientRect();
    dialog.style.left = `${Math.max(16, Math.min(anchor.right - box.width, window.innerWidth - box.width - 16))}px`;
    dialog.style.top = `${Math.max(16, Math.min(anchor.bottom + 6, window.innerHeight - box.height - 16))}px`;
  };
  const render = () => {
    const term = search.value.trim().toLowerCase();
    const matches = emotes.filter(emote => emote.name.toLowerCase().includes(term));
    grid.replaceChildren();
    for (const emote of matches.slice(0, visible)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "twitch-emote-choice";
      button.title = emote.name;
      button.setAttribute("aria-label", `Insert ${emote.name}`);
      const image = document.createElement("img");
      image.src = emote.imageUrl;
      image.alt = "";
      image.width = image.height = 20;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      button.append(image);
      button.addEventListener("click", () => {
        const field = document.getElementById(targetId) as MessageField | null;
        if (!field || field.disabled || field.readOnly) { status.textContent = "This message field is no longer available. Close and reopen the picker."; return; }
        const insertion = emoteInsertion(field.value, emote.name, start, end);
        if (field.maxLength >= 0 && insertion.value.length > field.maxLength) { status.textContent = "That emote would exceed this field’s length limit."; return; }
        field.value = insertion.value;
        field.setSelectionRange(insertion.caret, insertion.caret);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        dialog.close();
      });
      grid.append(button);
    }
    status.textContent = matches.length ? `${Math.min(visible, matches.length)} of ${matches.length} emotes · click to insert` : term ? "No matching emotes." : "Your channel has no custom emotes.";
    more.hidden = matches.length <= visible;
    position();
  };
  const load = async () => {
    if (busy) return;
    busy = true;
    retry.hidden = connect.hidden = true;
    status.textContent = "Loading your emotes…";
    try {
      if (state.twitchStatus !== "Connected" && state.twitchStatus !== "Saved") {
        connect.hidden = false;
        status.textContent = "Connect Twitch to browse your available emotes. Your message will stay unchanged.";
        return;
      }
        const list = await channelEmotes(state.twitchUsername ?? "");
        if (!dialog.isConnected) return;
        if (list.needsAuthorization) {
          status.textContent = "Reconnect Twitch to load your channel emotes. Your message will stay unchanged.";
          connect.hidden = false;
          return;
        }
        emotes = list.emotes;
      renderEmotePreviews();
      render();
    } catch (error) {
      if (dialog.isConnected) {
        status.textContent = String(error);
        retry.hidden = false;
        if (/No Twitch account|Connect Twitch|reconnect Twitch/i.test(String(error))) connect.hidden = false;
      }
    } finally { busy = false; if (dialog.isConnected) position(); }
  };
  connect.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    connect.disabled = true;
    status.textContent = "Authorize Twitch in your browser, then return here…";
    const drafts = fieldIds.flatMap(id => {
      const field = document.getElementById(id) as MessageField | null;
      return field ? [{ id, value: field.value, start: field.selectionStart, end: field.selectionEnd }] : [];
    });
    try {
      state = await invoke<Snapshot>("connect_twitch");
      if (!dialog.isConnected) return;
      update(state);
      for (const draft of drafts) {
        const field = document.getElementById(draft.id) as MessageField | null;
        if (!field) continue;
        field.value = draft.value;
        if (draft.start != null && draft.end != null) field.setSelectionRange(draft.start, draft.end);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      cached = undefined;
      if (state.twitchStatus !== "Connected") throw new Error(state.twitchMessage || "Twitch authorization did not complete. Try again.");
      busy = false;
      if (dialog.isConnected) await load();
    } catch (error) { if (dialog.isConnected) status.textContent = String(error); }
    finally { busy = false; connect.disabled = false; }
  });
  dialog.querySelector(".modal-close")!.addEventListener("click", () => dialog.close());
  search.addEventListener("input", () => { visible = 60; if (emotes.length) render(); });
  more.addEventListener("click", () => { visible += 60; render(); });
  retry.addEventListener("click", () => { void load(); });
  dialog.addEventListener("close", () => {
    window.removeEventListener("resize", position);
    dialog.remove();
    document.getElementById(targetId)?.focus();
  }, { once: true });
  document.body.append(dialog);
  showAnimatedDialog(dialog);
  position();
  window.addEventListener("resize", position);
  search.focus();
  void load();
}
