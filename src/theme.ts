import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppearanceTheme } from "./types";

let appliedTheme: AppearanceTheme | undefined;

export function normalizeTheme(value: unknown): AppearanceTheme {
  return value === "dark" || value === "minimal" ? value : "default";
}

export function applyTheme(value: unknown): void {
  const theme = normalizeTheme(value);
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("theme-plain", theme !== "default");
  if (appliedTheme !== theme) {
    appliedTheme = theme;
    void getCurrentWindow().setTheme(theme === "minimal" ? "light" : "dark")
      .catch(error => console.warn("Unable to apply Windows window theme", error));
  }
}
