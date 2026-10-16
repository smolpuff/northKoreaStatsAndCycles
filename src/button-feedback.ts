import { icons } from "./icons";

/** Shared markup keeps integration buttons and their feedback in the same layout. */
export function feedbackButton(
  key: string,
  label: string,
  attributes = "",
  icon = "play",
  type = "button",
): string {
  const escapedLabel = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<span class="inline-action"><button class="compact-button" type="${type}" data-feedback-key="${key}" ${attributes}>${icons[icon]}<span>${escapedLabel}</span></button><span class="button-feedback-error" data-error-for="${key}" role="alert"></span></span>`;
}
