import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Config, LogEntry, Snapshot } from "./types";
import {
  escapeHtml,
  cycleMessagePreview,
  worldRecordMessagePreview,
  defaultWorldRecordMessage,
  twitchMessageIsCustomized,
  raceMessageIsCustomized,
  renderApplication,
  twitchPreviewMessages,
  trackingIsActive,
  type RaceCycleSort,
  type ResultsSort,
} from "./views";
import "./styles.css";
import "./reference-theme.css";
import "./themes.css";
import { applyTheme, normalizeTheme } from "./theme";
import { icons } from "./icons";
import { confirmClear } from "./confirm-dialog";
import { initializeUpdates, bindUpdateSettings } from "./updates";
import { installIntegrationHelp } from "./integration-help";
import { openOverlayVariables } from "./overlay-help";
import { openEventVariables } from "./streamer-events";
import { openOverlayPreview, installOverlayPreviewSizing } from "./overlay-view";
import { hideSidebarTooltip, installSidebarTooltips } from "./sidebar-tooltips";

import { overlayOptions, optionsFor, updateOverlayPreview, installOverlayCustomization, type OverlayName, type OverlayOptions } from "./overlay-options";

installOverlayPreviewSizing();
installIntegrationHelp();

const root = document.querySelector<HTMLDivElement>("#app")!;
let state: Snapshot = {
  cycleHistory: [],
  totalCycleRaceCount: 0,
  totalRaceCount: 0,
  totalBattleRoyaleCount: 0,
  seasonPointsEarned: 0,
  sessionResults: [],
  config: {
    theme: "default",
    autoUpdateCheckEnabled: true,
    startMinimized: false,
    seasons: { raceName: "", cycleName: "",  },
    csv: {
      path: "LastSeasonRace.csv",
      gameType: "race",
      autoStartWatcher: false,
      autoStartCycles: false,
    },
    streamerBot: {
      host: "127.0.0.1",
      port: 7474,
      events: { raceComplete: false, worldRecord: true, cycleComplete: false },
      actions: {
        gameComplete: "Marbles - Game Complete",
        worldRecord: "Marbles - World Record",
        cycleComplete: "Marbles - Cycle Complete",
      },
    },
    twitch: {
      promoteMissionApp: true,
      promotionIntervalMinutes: 60,      postWorldRecords: false,
      worldRecordMessageTemplate: defaultWorldRecordMessage,
      postResults: true,
      postCycleResults: false,
      messagePrefix: "🏁 Race results:",
      cycleMessageTemplate:
        "🎉 Congrats {player} on a cycle! You are great! That's cycle #{cycle}! 🎉",
    },
  },
  watcherStatus: "Loading",
  statsTrackingEnabled: false,
  cyclesTrackingEnabled: false,
  watcherMessage: "Connecting to the local watcher",
  streamerBotStatus: "Disabled",
  twitchStatus: "Disconnected",
  session: {
    gamesPlayed: 0,
  },
  recentResults: [],
  raceCycles: [],
  logs: [],
};
let currentPage = "home";
let sidebarCollapsed = localStorage.getItem("sidebar-collapsed") === "true";
let themeSaveInProgress = false;
let themeSaveError = "";
let overlayPreviewBR = false;
let overlayDirectory = "";
let overlaySetupError = "";
let renderedPage: string | undefined;
let pageTransitionStarted = 0;
let watcherCommandIsRunning = true;
let logFilter = "all";
let cycleSearch = "";
let editingName = false;
let exportIsRunning = false;
let raceCycleSort: RaceCycleSort = { key: "cycles", direction: "desc" };
let resultsSort: ResultsSort = { key: "placement", direction: "asc" };

function bindLogPage(): void {
  const filter = document.querySelector<HTMLSelectElement>("#log-filter")!;
  filter.value = logFilter;
  filter.addEventListener("change", () => {
    logFilter = filter.value;
    render();
  });

  const logList = document.querySelector("#log-list");
  logList?.scrollTo(0, logList.scrollHeight);
}

type ButtonFeedback = { phase: "busy" | "success" | "error"; width: number; label?: string; error?: string; expiresAt?: number };
const buttonFeedback = new Map<string, ButtonFeedback>();

function applyButtonFeedback(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-feedback-key]").forEach(button => {
    const key = button.dataset.feedbackKey!;
    const feedback = buttonFeedback.get(key);
    if (!feedback) return;
    if (feedback.expiresAt && Date.now() >= feedback.expiresAt) { buttonFeedback.delete(key); return; }
    button.style.width = `${feedback.width}px`;
    button.style.minWidth = `${feedback.width}px`;
    button.style.maxWidth = `${feedback.width}px`;
    const error = document.querySelector<HTMLElement>(`[data-error-for="${key}"]`);
    if (error) error.textContent = feedback.error ?? "";
    if (feedback.phase === "error") {
      if (button.hasAttribute("data-streamer-test")) {
        button.classList.add("button-error");
        button.innerHTML = `<span>Failed — retry</span>`;
      }
      return;
    }
    button.disabled = true;
    button.classList.toggle("button-success", feedback.phase === "success");
    button.innerHTML = `${feedback.phase === "success" ? icons.check : icons.spinner}<span>${escapeHtml(feedback.label)}</span>`;
  });
}

async function runButtonAction(key: string, action: () => Promise<void>, busyLabel = "Testing…", successLabel = "Success"): Promise<void> {
  if (buttonFeedback.get(key)?.phase === "busy") return;
  const button = document.querySelector<HTMLButtonElement>(`[data-feedback-key="${key}"]`);
  const width = button?.getBoundingClientRect().width ?? 120;
  buttonFeedback.set(key, { phase: "busy", width, label: busyLabel });
  render();
  try {
    await action();
    const feedback: ButtonFeedback = { phase: "success", width, label: successLabel, expiresAt: Date.now() + 3000 };
    buttonFeedback.set(key, feedback);
    window.setTimeout(() => {
      if (buttonFeedback.get(key) === feedback) { buttonFeedback.delete(key); render(); }
    }, 3000);
  } catch (error) {
    buttonFeedback.set(key, { phase: "error", width, error: String(error) });
  }
  render();
}

function syncFeatureSections(): void {
  document.querySelectorAll<HTMLElement>("[data-feature-section]").forEach(section => {
    const toggle = document.getElementById(section.dataset.featureSection!) as HTMLInputElement;
    const master = section.dataset.masterToggle ? document.getElementById(section.dataset.masterToggle) as HTMLInputElement : undefined;
    const disabled = !toggle.checked || toggle.disabled || (master != null && !master.checked);
    section.classList.toggle("feature-disabled", disabled);
    const content = section.querySelector<HTMLElement>(".feature-content")!;
    content.inert = disabled && !content.querySelector("[data-twitch-save]");
    content.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input, textarea, button").forEach(control => {
      control.dataset.originalDisabled ??= String(control.disabled);
      control.disabled = (disabled && !control.hasAttribute("data-twitch-save")) || control.dataset.originalDisabled === "true";
    });
  });
  applyButtonFeedback();
}

const homeButtonTransitions = new Map<string, { started: number; background: string; border: string; shadow: string; color: string }>();

function renderMainWindow(): void {
  hideSidebarTooltip();
  // Status events and button feedback must not reload playing preview iframes.
  if (currentPage === "overlays" && renderedPage === currentPage && root.querySelector(".overlays-page")?.getAttribute("data-directory") === overlayDirectory) {
    const next = document.createElement("template");
    next.innerHTML = renderApplication(state, currentPage, watcherCommandIsRunning, logFilter, raceCycleSort, editingName, resultsSort, overlayDirectory);
    const footer = root.querySelector(".sidebar-foot");
    const updatedFooter = next.content.querySelector(".sidebar-foot");
    if (footer && updatedFooter) footer.replaceWith(updatedFooter);
    // Restore default labels before applying current feedback, without replacing buttons/listeners.
    const defaults = [...next.content.querySelectorAll<HTMLButtonElement>("[data-feedback-key]")];
    root.querySelectorAll<HTMLButtonElement>("[data-feedback-key]").forEach(button => {
      const fresh = defaults.find(item => item.dataset.feedbackKey === button.dataset.feedbackKey);
      if (!fresh) return;
      button.innerHTML = fresh.innerHTML;
      button.className = fresh.className;
      button.disabled = fresh.disabled;
      for (const property of ["width", "minWidth", "maxWidth"] as const) button.style[property] = fresh.style[property];
    });
    const error = root.querySelector<HTMLElement>("#overlay-setup-error");
    if (error) error.textContent = overlaySetupError;
    applyTheme(state.config.theme);
    applyButtonFeedback();
    return;
  }
  const animateHome = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (animateHome) {
    root.querySelectorAll<HTMLButtonElement>(".home-watch-button").forEach(button => {
      const kind = button.dataset.trackingToggle as "stats" | "cycles";
      if (button.classList.contains("stop") !== trackingIsActive(state, kind)) {
        const style = getComputedStyle(button);
        homeButtonTransitions.set(kind, { started: performance.now(), background: style.background, border: style.borderColor, shadow: style.boxShadow, color: style.color });
      }
    });
  }
  // Keep unsaved form values when connection/watcher events or button feedback redraw the page.
  const viewState = renderedPage === currentPage && document.querySelector("#settings-form")
    ? { ...state, config: readSettingsForm() } : state;
  applyTheme(viewState.config.theme);
  root.innerHTML = renderApplication(
    viewState,
    currentPage,
    watcherCommandIsRunning,
    logFilter,
    raceCycleSort,
    editingName,
    resultsSort,
    overlayDirectory,
  );
  root.querySelector(".app-shell")?.classList.toggle("sidebar-collapsed", sidebarCollapsed);
  root.querySelector(".overlays-page")?.setAttribute("data-directory", overlayDirectory);
  const sidebarToggle = root.querySelector<HTMLButtonElement>("[data-collapse-sidebar]");
  if (sidebarToggle) {
    const label = sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
    sidebarToggle.title = label;
    sidebarToggle.setAttribute("aria-label", label);
    sidebarToggle.setAttribute("aria-expanded", String(!sidebarCollapsed));
    sidebarToggle.addEventListener("click", () => {
      hideSidebarTooltip();
      sidebarCollapsed = !sidebarCollapsed;
      localStorage.setItem("sidebar-collapsed", String(sidebarCollapsed));
      root.querySelector(".app-shell")?.classList.toggle("sidebar-collapsed", sidebarCollapsed);
      const label = sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
      sidebarToggle.title = label;
      sidebarToggle.setAttribute("aria-label", label);
      sidebarToggle.setAttribute("aria-expanded", String(!sidebarCollapsed));
    });
  }

  if (animateHome) {
    root.querySelectorAll<HTMLButtonElement>(".home-watch-button").forEach(button => {
      const transition = homeButtonTransitions.get(button.dataset.trackingToggle!);
      if (!transition) return;
      const elapsed = performance.now() - transition.started;
      if (elapsed >= 350) { homeButtonTransitions.delete(button.dataset.trackingToggle!); return; }
      // The page redraws on snapshots; carry the remaining crossfade across redraws.
      const overlay = document.createElement("span");
      overlay.className = "home-button-transition";
      overlay.setAttribute("aria-hidden", "true");
      Object.assign(overlay.style, { background: transition.background, borderColor: transition.border, boxShadow: transition.shadow });
      button.prepend(overlay);
      overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, delay: -elapsed, easing: "ease-out", fill: "forwards" }).onfinish = () => overlay.remove();
      button.animate([{ color: transition.color }, { color: getComputedStyle(button).color }], { duration: 350, delay: -elapsed, easing: "ease-out" });
    });
  }

  if (renderedPage !== currentPage) {
    renderedPage = currentPage;
    pageTransitionStarted = performance.now();
  }
  const elapsed = performance.now() - pageTransitionStarted;
  if (elapsed < 240) {
    const content = root.querySelector<HTMLElement>(".content")!;
    content.classList.add("page-enter");
    content.style.animationDelay = `-${elapsed}ms`;
  }

  document
    .querySelectorAll<HTMLButtonElement>("[data-page]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        editingName = false;
        currentPage = button.dataset.page!;
        render();
      });
    });

  document
    .querySelector("#watch-toggle")
    ?.addEventListener("click", () => toggleWatcher());

  document.querySelectorAll<HTMLButtonElement>("[data-tracking-toggle]").forEach(button => {
    button.addEventListener("click", () => toggleWatcher(button.dataset.trackingToggle as "stats" | "cycles"));
  });

  installOverlayCustomization(runButtonAction);
  document.querySelectorAll<HTMLButtonElement>("[data-test-overlay]").forEach(button => button.addEventListener("click", () => {
    void runButtonAction(button.dataset.feedbackKey!, () => invoke("test_overlay", {kind: button.dataset.testOverlay}), "Sending...", "Sent");
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-copy-overlay-path]").forEach(button => button.addEventListener("click", () => {
    void runButtonAction(button.dataset.feedbackKey!, () => navigator.clipboard.writeText(button.dataset.copyOverlayPath!), "Copying...", "Copied");
  }));
  document.querySelectorAll<HTMLInputElement>("[data-overlay-path]").forEach(input => input.addEventListener("click", () => input.select()));
  document.querySelectorAll<HTMLButtonElement>("[data-overlay-variables]").forEach(button => button.addEventListener("click", () => openOverlayVariables(button.dataset.overlayVariables!)));
  document.querySelectorAll<HTMLButtonElement>("[data-open-overlay-file]").forEach(button => button.addEventListener("click", () => {
    openOverlayPreview(button.dataset.openOverlayFile!, overlayPreviewBR);
  }));
  const overlayError = document.querySelector<HTMLElement>("#overlay-setup-error");
  if (overlayError) overlayError.textContent = overlaySetupError;
  const updateOverlayPreviews = () => {
    document.querySelectorAll<HTMLButtonElement>("[data-overlay-preview-type]").forEach(button => {
      button.setAttribute("aria-pressed", String((button.dataset.overlayPreviewType === "br") === overlayPreviewBR));
    });
    document.querySelectorAll<HTMLIFrameElement>(".overlay-mini-preview iframe").forEach(frame => {
      frame.dataset.previewBr = String(overlayPreviewBR);
      const name = new URL(frame.src).pathname.split("/").pop()!.replace(".html", "") as OverlayName;
      updateOverlayPreview(frame, name);
      frame.contentWindow?.postMessage({ type: "marbles-overlay-preview", br: overlayPreviewBR }, window.location.origin);
    });
  };
  document.querySelectorAll<HTMLIFrameElement>(".overlay-mini-preview iframe").forEach(frame => frame.addEventListener("load", updateOverlayPreviews));
  document.querySelectorAll<HTMLButtonElement>("[data-overlay-preview-type]").forEach(button => button.addEventListener("click", () => {
    overlayPreviewBR = button.dataset.overlayPreviewType === "br";
    updateOverlayPreviews();
  }));
  updateOverlayPreviews();
  document.querySelectorAll<HTMLElement>(".overlay-template").forEach(card => {
    const preview = card.querySelector<HTMLIFrameElement>("iframe");
    const play = (active: boolean) => preview?.contentWindow?.postMessage({type:"marbles-overlay-preview-hover", active}, window.location.origin);
    card.addEventListener("mouseenter", () => play(true));
    card.addEventListener("mouseleave", () => play(false));
    card.addEventListener("focusin", () => play(true));
    card.addEventListener("focusout", event => { if (!card.contains(event.relatedTarget as Node | null)) play(false); });
    preview?.addEventListener("load", () => play(card.matches(":hover, :focus-within")));
    play(card.matches(":hover, :focus-within"));
  });

  document.querySelector("[data-reprocess-latest]")?.addEventListener("click", () => {
    void runButtonAction("reprocess-latest", async () => {
      state = await invoke<Snapshot>("reread_last_file");
      if (state.watcherStatus === "Error" || state.watcherStatus === "File Missing") {
        throw new Error(state.watcherMessage ?? "Unable to reprocess the latest file");
      }
    }, "Reading…", "Read complete");
  });
  applyButtonFeedback();

  document.querySelectorAll<HTMLButtonElement>("[data-results-sort]").forEach(button => {
    button.addEventListener("click", () => {
      const key = button.dataset.resultsSort as ResultsSort["key"];
      resultsSort = resultsSort.key === key
        ? { key, direction: resultsSort.direction === "asc" ? "desc" : "asc" }
        : { key, direction: ["placement", "player", "time", "eliminated"].includes(key) ? "asc" : "desc" };
      render();
    });
  });

  if (["settings", "streamer", "twitch"].includes(currentPage)) {
    bindSettingsForm();
    applyButtonFeedback();
  }

  if (currentPage === "logs") {
    bindLogPage();
  }

  const saveSeason = async () => {
    const input = document.querySelector<HTMLInputElement>("#season-name");
    if (!input) return;
    const seasons = { ...state.config.seasons };
    if (currentPage === "racecycles") { seasons.cycleName = input.value.trim(); }
    else { seasons.raceName = input.value.trim(); }
    state = await invoke<Snapshot>("save_seasons", { seasons });
    editingName = false;
  };
  document.querySelector("#edit-season-name")?.addEventListener("click", () => {
    editingName = true;
    render();
    const input = document.querySelector<HTMLInputElement>("#season-name");
    input?.focus({ preventScroll: true }); input?.select();
  });
  document.querySelector<HTMLFormElement>("#season-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await saveSeason(); render(); } catch (error) { alert(String(error)); }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-export]").forEach(button => {
    if (exportIsRunning) button.disabled = true;
    button.addEventListener("click", async () => {
      if (exportIsRunning) return;
      exportIsRunning = true;
      document.querySelectorAll<HTMLButtonElement>("[data-export]").forEach(exportButton => exportButton.disabled = true);
      try {
        if (document.querySelector("#season-name")) await saveSeason();
        await invoke<string | null>("export_data", { kind: button.dataset.export });
      } catch (error) { alert(String(error)); }
      finally { exportIsRunning = false; render(); }
    });
  });
  document.querySelector("#clear-race-results")?.addEventListener("click", async () => {
    if (!await confirmClear("Clear RaceStats results?", "Reset total races, total BRs, session stats, season points, and the latest results shown on the dashboard. Saved history will remain.", "Clear results")) return;
    try { state = await invoke<Snapshot>("clear_race_results"); }
    catch (error) { alert(String(error)); }
    finally { render(); }
  });
  const search = document.querySelector<HTMLInputElement>("#cycle-search");
  if (search) {
    search.value = cycleSearch;
    const filterRows = () => {
      cycleSearch = search.value;
      let matched = 0;
      document.querySelectorAll<HTMLTableRowElement>(".cycle-table tbody tr").forEach(row => {
        row.hidden = !row.querySelector(".cycle-player")!.textContent!.toLocaleLowerCase().includes(cycleSearch.trim().toLocaleLowerCase());
        if (!row.hidden) matched++;
      });
      document.querySelector("#cycle-filter-count")!.textContent = `${matched} of ${state.raceCycles.length} racers`;
    };
    search.addEventListener("input", filterRows);
    filterRows();
  }

  if (currentPage === "history") {
    document.querySelector("#clear-cycle-history")?.addEventListener("click", async () => {
      if (!await confirmClear("Clear cycle history?", "Delete all saved cycle match history. Current players, placements, and cycle counts will remain.", "Clear history")) return;
      try { state = await invoke<Snapshot>("clear_cycle_history"); }
      catch (error) { alert(String(error)); }
      finally { render(); }
    });
    document
      .querySelector("#clear-history")
      ?.addEventListener("click", async () => {
        if (!await confirmClear("Clear race history?", "Delete all saved Race and Battle Royale history and clear the latest displayed result. Stats totals and cycle progress will remain.", "Clear history")) return;
        try {
          state = await invoke<Snapshot>("clear_history");
        } catch (error) {
          alert(String(error));
        } finally {
          render();
        }
      });
  }

  if (currentPage === "racecycles") {
    document
      .querySelectorAll<HTMLButtonElement>("[data-cycle-sort]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.dataset.cycleSort!;
          raceCycleSort =
            raceCycleSort.key === key
              ? {
                  key,
                  direction: raceCycleSort.direction === "asc" ? "desc" : "asc",
                }
              : {
                  key,
                  direction: key === "racer" ? "asc" : "desc",
                };
          render();
        });
      });

    document
      .querySelector("#clear-race-cycles")
      ?.addEventListener("click", async () => {
        if (
          !await confirmClear("Clear RaceCycles results?", "Reset all tracked players, placements, completed cycles, and tracked race counts. Saved cycle history will remain.", "Clear results")
        )
          return;
        try {
          state = await invoke<Snapshot>("clear_race_cycles");
        } catch (error) {
          alert(String(error));
        } finally {
          render();
        }
      });
  }
}

function render(): void {
  const samePage = renderedPage === currentPage;
  const scrollSelector = ".content, .table-scroll, .cycle-table-wrap, .twitch-message-preview";
  const scrollPositions = samePage
    ? [...root.querySelectorAll<HTMLElement>(scrollSelector)].map(element => ({ top: element.scrollTop, left: element.scrollLeft }))
    : [];
  const accordionStates = samePage
    ? [...root.querySelectorAll<HTMLDetailsElement>("details")].map(details => details.open)
    : [];
  const inputs = [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")];
  const draft = inputs.map(input => ({ id: input.id, value: input.value, checked: input instanceof HTMLInputElement ? input.checked : false }));
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const activeId = active?.id;
  const selection = active && ["text", "search", "textarea"].includes(active.type) ? [active.selectionStart, active.selectionEnd] : null;
  const preserve = Boolean(activeId && root.contains(active));
  renderMainWindow();
  if (samePage) {
    root.querySelectorAll<HTMLDetailsElement>("details").forEach((details, index) => {
      if (index < accordionStates.length) details.open = accordionStates[index];
    });
  }
  if (preserve && samePage) {
    for (const saved of draft) {
      const input = document.getElementById(saved.id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (input) { input.value = saved.value; if (input instanceof HTMLInputElement) input.checked = saved.checked; }
    }
    const input = document.getElementById(activeId!) as HTMLInputElement | HTMLTextAreaElement | null;
    input?.focus();
    if (input && selection) input.setSelectionRange(selection[0], selection[1]);
  }
  if (samePage) {
    root.querySelectorAll<HTMLElement>(scrollSelector).forEach((element, index) => {
      const position = scrollPositions[index];
      if (position) {
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      }
    });
  }
}

async function toggleWatcher(kind: "stats" | "cycles" = currentPage === "racecycles" ? "cycles" : "stats"): Promise<void> {
  if (watcherCommandIsRunning) return;
  const enabled = !trackingIsActive(state, kind);

  watcherCommandIsRunning = true;
  render();

  try {
    state = await invoke<Snapshot>("set_tracking_enabled", { kind, enabled });
  } catch (error) {
    alert(String(error));
  } finally {
    watcherCommandIsRunning = false;
    render();
  }
}

function readSettingsForm(): Config {
  const autoStart = document.querySelector<HTMLInputElement>("#auto-start");
  const streamerHost =
    document.querySelector<HTMLInputElement>("#streamer-host");
  const streamerPort =
    document.querySelector<HTMLInputElement>("#streamer-port");
  const gameComplete = document.querySelector<HTMLInputElement>(
    "#streamer-game-action",
  );
  const worldRecord = document.querySelector<HTMLInputElement>(
    "#streamer-record-action",
  );
  const twitchPostResults = document.querySelector<HTMLInputElement>(
    "#twitch-post-results",
  );
  const twitchMessagePrefix = document.querySelector<HTMLInputElement>(
    "#twitch-message-prefix",
  );
  const twitchCycleMessage = document.querySelector<HTMLTextAreaElement>(
    "#twitch-cycle-message",
  );
  return {
    ...state.config,
    theme: normalizeTheme(document.querySelector<HTMLSelectElement>("#appearance-theme")?.value ?? state.config.theme),
    autoUpdateCheckEnabled: document.querySelector<HTMLInputElement>("#auto-update-check")?.checked ?? state.config.autoUpdateCheckEnabled ?? true,
    startMinimized: document.querySelector<HTMLInputElement>("#start-minimized")?.checked ?? state.config.startMinimized ?? false,
    csv: {
      ...state.config.csv,
      gameType: "race",
      autoStartWatcher: autoStart?.checked ?? state.config.csv.autoStartWatcher,
      autoStartCycles: document.querySelector<HTMLInputElement>("#auto-start-cycles")?.checked ?? state.config.csv.autoStartCycles ?? false,
    },
    streamerBot: {
      ...state.config.streamerBot,
      host: streamerHost?.value.trim() || state.config.streamerBot.host,
      port: Number(streamerPort?.value) || state.config.streamerBot.port,
      events: {
        missionPromotion: document.querySelector<HTMLInputElement>("#streamer-promotion-enabled")?.checked ?? state.config.streamerBot.events?.missionPromotion ?? false,
        cycleComplete: document.querySelector<HTMLInputElement>("#streamer-cycle-enabled")?.checked ?? state.config.streamerBot.events?.cycleComplete ?? false,
        raceComplete: document.querySelector<HTMLInputElement>("#streamer-race-enabled")?.checked ?? state.config.streamerBot.events?.raceComplete ?? false,
        worldRecord: document.querySelector<HTMLInputElement>("#streamer-record-enabled")?.checked ?? state.config.streamerBot.events?.worldRecord ?? true,
      },
      actions: {
        missionPromotion: document.querySelector<HTMLInputElement>("#streamer-promotion-action")?.value.trim() || state.config.streamerBot.actions.missionPromotion || "Marbles - Mission Promotion",
        cycleComplete: document.querySelector<HTMLInputElement>("#streamer-cycle-action")?.value.trim() || state.config.streamerBot.actions.cycleComplete || "Marbles - Cycle Complete",
        gameComplete:
          gameComplete?.value.trim() ||
          state.config.streamerBot.actions.gameComplete,
        worldRecord:
          worldRecord?.value.trim() ||
          state.config.streamerBot.actions.worldRecord,
      },
    },
    twitch: {
      postWorldRecords: document.querySelector<HTMLInputElement>("#twitch-post-world-records")?.checked ?? state.config.twitch.postWorldRecords ?? false,
      promoteMissionApp: document.querySelector<HTMLInputElement>("#promote-mission-app")?.checked ?? state.config.twitch.promoteMissionApp ?? true,
      promotionIntervalMinutes: Math.max(1, Math.min(1440, Math.floor(Number(document.querySelector<HTMLInputElement>("#promotion-interval")?.value ?? state.config.twitch.promotionIntervalMinutes ?? 60)) || 60)),      worldRecordMessageTemplate: document.querySelector<HTMLTextAreaElement>("#twitch-world-record-message")?.value ?? state.config.twitch.worldRecordMessageTemplate ?? defaultWorldRecordMessage,
      postCycleResults: document.querySelector<HTMLInputElement>("#twitch-post-cycles")?.checked ?? state.config.twitch.postCycleResults,

      postResults:
        twitchPostResults?.checked ?? state.config.twitch.postResults,
      raceMessageTemplate: document.querySelector<HTMLTextAreaElement>("#twitch-race-message")?.value ?? state.config.twitch.raceMessageTemplate ?? "",
      raceEntryTemplate: document.querySelector<HTMLTextAreaElement>("#twitch-race-entry")?.value ?? state.config.twitch.raceEntryTemplate ?? "",
      raceEntrySeparator: document.querySelector<HTMLInputElement>("#twitch-race-separator")?.value ?? state.config.twitch.raceEntrySeparator ?? " | ",
      racePodiumTemplates: [1, 2, 3].map(place => document.querySelector<HTMLTextAreaElement>("#twitch-race-place-" + place)?.value ?? state.config.twitch.racePodiumTemplates?.[place - 1] ?? ""),
      messagePrefix:
        twitchMessagePrefix?.value ?? state.config.twitch.messagePrefix,
      cycleMessageTemplate:
        twitchCycleMessage?.value ?? state.config.twitch.cycleMessageTemplate,
    },
  };
}

let settingsToggleSaveQueue: Promise<void> = Promise.resolve();
let settingsToggleSavesPending = 0;
let settingsToggleSaveError = "";

function refreshToggleSaveStatus(): void {
  const status = document.querySelector<HTMLElement>("#settings-autosave-status");
  if (status) status.textContent = settingsToggleSaveError;
}

function saveSettingsToggle(): void {
  const config = readSettingsForm();
  settingsToggleSavesPending++;
  settingsToggleSaveError = "";
  refreshToggleSaveStatus();
  // Keep rapid changes in order so an older save cannot overwrite a later toggle.
  settingsToggleSaveQueue = settingsToggleSaveQueue.then(async () => {
    try {
      state = await invoke<Snapshot>("save_config", { config });
    } catch (error) {
      settingsToggleSaveError = `Unable to save changes: ${String(error)}`;
    } finally {
      settingsToggleSavesPending--;
      render();
    }
  });
}

function bindSettingsForm(): void {
  refreshToggleSaveStatus();
  bindUpdateSettings();
  const themeSelect = document.querySelector<HTMLSelectElement>("#appearance-theme");
  if (themeSelect) themeSelect.disabled = themeSaveInProgress;
  const themeStatus = document.querySelector<HTMLElement>("#theme-save-status");
  if (themeStatus) themeStatus.textContent = themeSaveError || "Changes save automatically.";
  themeSelect?.addEventListener("change", async () => {
    const theme = normalizeTheme(themeSelect.value);
    themeSaveInProgress = true;
    themeSaveError = "";
    themeSelect.disabled = true;
    applyTheme(theme);
    try {
      await invoke("save_theme", { theme });
      state.config.theme = theme;
    } catch (error) {
      themeSaveError = `Unable to save theme: ${String(error)}`;
      const currentSelect = document.querySelector<HTMLSelectElement>("#appearance-theme");
      if (currentSelect) currentSelect.value = normalizeTheme(state.config.theme);
      applyTheme(state.config.theme);
    } finally {
      themeSaveInProgress = false;
      render();
    }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-event-variables]").forEach(button => button.addEventListener("click", () => openEventVariables(button.dataset.eventVariables!)));
  const form = document.querySelector<HTMLFormElement>("#settings-form")!;
  form.querySelectorAll<HTMLElement>(".twitch-settings-section").forEach(card => {
    card.addEventListener("click", event => {
      const target = event.target as Element;
      if (target.closest("button, input, textarea, select, a, label, summary, [contenteditable]")) return;
      if (window.getSelection()?.type === "Range") return;
      const customization = card.querySelector<HTMLDetailsElement>(".twitch-message-customization");
      if (customization) customization.open = true;
    });
  });
  document.querySelectorAll<HTMLElement>("[data-customized-for]").forEach(status => {
    const field = status.dataset.customizedFor!;
    const input = document.getElementById(field) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!input) return;
    const update = () => { status.hidden = field === "twitch-message-prefix" ? !raceMessageIsCustomized(readSettingsForm().twitch) : !twitchMessageIsCustomized(field, input.value); };
    input.addEventListener("input", update);
    update();
  });
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("#twitch-message-prefix, #twitch-race-message, #twitch-race-entry, #twitch-race-separator, [id^='twitch-race-place-']").forEach(input => {
    input.addEventListener("input", () => {
      const config = readSettingsForm().twitch;
      const preview = document.querySelector<HTMLElement>("#twitch-message-preview");
      if (preview) preview.textContent = twitchPreviewMessages(config.messagePrefix, undefined, config).join("\n\n");
      const customized = input.closest(".twitch-message-customization")?.querySelector<HTMLElement>("[data-customized-for]");
      if (customized) customized.hidden = !raceMessageIsCustomized(config);
    });
  });
  const recordMessage = document.querySelector<HTMLTextAreaElement>("#twitch-world-record-message");
  const recordPreview = document.querySelector<HTMLElement>("#twitch-world-record-preview");
  recordMessage?.addEventListener("input", () => {
    if (recordPreview) recordPreview.textContent = worldRecordMessagePreview(recordMessage.value);
  });
  const cycleMessage = document.querySelector<HTMLTextAreaElement>(
    "#twitch-cycle-message",
  );
  const cyclePreview = document.querySelector<HTMLElement>(
    "#twitch-cycle-message-preview",
  );
  cycleMessage?.addEventListener("input", () => {
    if (cyclePreview) {
      cyclePreview.textContent = cycleMessagePreview(cycleMessage.value);
    }
  });

  document
    .querySelector("#twitch-connect")
    ?.addEventListener("click", async () => {
      const button =
        document.querySelector<HTMLButtonElement>("#twitch-connect")!;
      button.disabled = true;
      button.textContent = "Opening Twitch…";
      try {
        await invoke<Snapshot>("save_config", {
          config: readSettingsForm(),
        });
        state = await invoke<Snapshot>("connect_twitch");
      } catch (error) {
        alert(String(error));
      } finally {
        render();
      }
    });

  document
    .querySelector("#twitch-disconnect")
    ?.addEventListener("click", async () => {
      try {
        state = await invoke<Snapshot>("disconnect_twitch");
      } catch (error) {
        alert(String(error));
      } finally {
        render();
      }
    });

  document.querySelectorAll<HTMLButtonElement>("[data-twitch-save]").forEach(button => {
    button.addEventListener("click", async () => {
      const config = readSettingsForm();
      await runButtonAction(button.dataset.feedbackKey!, async () => {
        state = await invoke<Snapshot>("save_config", { config });
      }, "Saving...", "Saved");
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-twitch-test]").forEach(button => {
    button.addEventListener("click", async () => {
      if (state.twitchStatus !== "Connected") return;
      const kind = button.dataset.twitchTest!;
      const config = readSettingsForm().twitch;
      await runButtonAction(button.dataset.feedbackKey!, async () => {
        state = await invoke<Snapshot>("test_twitch_message", { kind, config });
      }, "Posting...", "Sent");
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-streamer-test]").forEach(button => {
    button.addEventListener("click", async () => {
      const kind = button.dataset.streamerTest!;
      const config = readSettingsForm().streamerBot;
      await runButtonAction(button.dataset.feedbackKey!, async () => {
        state = kind === "connection"
          ? await invoke<Snapshot>("test_streamer_bot_connection", { config })
          : await invoke<Snapshot>("test_streamer_bot_action", { config, kind });
      });
    });
  });
  form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(toggle => {
    toggle.addEventListener("change", () => {
      syncFeatureSections();
      saveSettingsToggle();
    });
  });
  syncFeatureSections();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const config = readSettingsForm();
    await runButtonAction("save-" + currentPage, async () => {
      state = await invoke<Snapshot>("save_config", { config });
    }, "Saving...", "Saved");
  });
}

async function initialize(): Promise<void> {
  const startupMessage = document.querySelector<HTMLElement>(".startup span");
  if (startupMessage) {
    startupMessage.textContent = "Loading local stats…";
  }

  state = await invoke<Snapshot>("get_app_snapshot");
  watcherCommandIsRunning = false;

  // Render before event registration and watcher startup. Neither is allowed to
  // hold the dashboard hostage during application launch.
  render();
  document.title = "Marbles Stats — Ready";
  void initializeUpdates(() => state.config.autoUpdateCheckEnabled ?? true).catch(error => console.error("Unable to initialize updates", error));
  void invoke<Partial<Record<OverlayName, OverlayOptions>>>("get_overlay_options").then(settings => {
    Object.assign(overlayOptions, settings);
    return invoke<{worldRecordSeconds: number; cycleSeconds: number}>("get_overlay_durations");
  }).then(durations => {
    // Preserve durations saved before the per-overlay styling controls were added.
    for (const [name, seconds] of [["world-record", durations.worldRecordSeconds], ["cycle-complete", durations.cycleSeconds]] as const) {
      if (!overlayOptions[name] && seconds !== 10) overlayOptions[name] = { ...optionsFor(name), durationSeconds: seconds };
    }
    // Initial saved customization can arrive after the gallery's first render.
    root.querySelector(".overlays-page")?.removeAttribute("data-directory");
    render();
  }).catch(error => {
    overlaySetupError = `Unable to load overlay customization: ${String(error)}`;
    render();
  });
  void invoke<string>("get_overlay_directory").then(directory => {
    overlayDirectory = directory;
    render();
  }).catch(error => {
    overlaySetupError = `Unable to prepare overlay files: ${String(error)}`;
    render();
  });

  const appStateListener = listen<Snapshot>("app-state", (event) => {
    state = event.payload;
    render();
  });

  const logListener = listen<LogEntry>("log-entry", (event) => {
    state.logs.push(event.payload);
    if (state.logs.length > 500) state.logs.shift();
    if (currentPage === "logs") render();
  });

  await Promise.all([appStateListener, logListener]);

  if (state.twitchStatus !== "Disconnected") {
    invoke<Snapshot>("validate_twitch_session")
      .then((snapshot) => {
        state = snapshot;
        render();
      })
      .catch(() => undefined);
  }

  for (const [kind, enabled] of [["stats", state.config.csv.autoStartWatcher], ["cycles", state.config.csv.autoStartCycles]] as const) {
    if (!enabled) continue;
    try {
      state = await invoke<Snapshot>("set_tracking_enabled", { kind, enabled: true });
      render();
    } catch (error) {
      console.error(`Unable to auto-start ${kind}`, error);
    }
  }

}

// Paint the complete application immediately. Backend hydration happens after
// the user can already see and resize the window.
installSidebarTooltips(() => sidebarCollapsed);
render();

initialize().catch((error) => {
  document.title = "Marbles Stats — Startup Error";
  root.innerHTML = `
    <div class="fatal">
      <h1>Unable to start</h1>
      <p>${escapeHtml(error)}</p>
    </div>
  `;
});
