/** Shared leading-icon treatment for editable and read-only single-line controls. */
export const iconInput = (icon: string, control: string) =>
  `<span class="icon-input"><i aria-hidden="true">${icon}</i>${control}</span>`;
