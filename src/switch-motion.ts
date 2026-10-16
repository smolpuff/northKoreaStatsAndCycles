type SwitchFrame = {
  element: HTMLInputElement;
  thumb: string;
  background: string;
  border: string;
};

// Preserve the visible position across settings-save and status redraws.
export function captureSwitchFrames(
  root: HTMLElement,
): Map<string, SwitchFrame> {
  const frames = new Map<string, SwitchFrame>();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    return frames;
  root
    .querySelectorAll<HTMLInputElement>(
      'input[role="switch"], .toggle-row input[type="checkbox"]',
    )
    .forEach((input) => {
      if (!input.id) return;
      const style = getComputedStyle(input);
      frames.set(input.id, {
        element: input,
        thumb: getComputedStyle(input, "::before").transform,
        background: style.backgroundColor,
        border: style.borderColor,
      });
    });
  return frames;
}

export function restoreSwitchFrames(
  root: HTMLElement,
  frames: Map<string, SwitchFrame>,
): void {
  const restored: HTMLInputElement[] = [];
  root
    .querySelectorAll<HTMLInputElement>(
      'input[role="switch"], .toggle-row input[type="checkbox"]',
    )
    .forEach((input) => {
      const previous = frames.get(input.id);
      if (!previous || input === previous.element) return;
      input.classList.add("switch-motion-reset");
      input.style.setProperty("--switch-thumb-transform", previous.thumb);
      input.style.backgroundColor = previous.background;
      input.style.borderColor = previous.border;
      restored.push(input);
    });
  if (!restored.length) return;
  void root.offsetWidth;
  for (const input of restored) input.classList.remove("switch-motion-reset");
  requestAnimationFrame(() => {
    for (const input of restored) {
      if (!input.isConnected) continue;
      input.style.removeProperty("--switch-thumb-transform");
      input.style.removeProperty("background-color");
      input.style.removeProperty("border-color");
    }
  });
}
