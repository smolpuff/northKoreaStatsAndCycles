/** Group choices persist independently of the whole-sidebar icon rail. */
export function installSidebarGroups(
  root: HTMLElement,
  isIconRail: () => boolean,
): () => void {
  const buttons = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-sidebar-group]"),
  ];
  const refresh = () => {
    for (const button of buttons) {
      const name = button.dataset.sidebarGroup!;
      const collapsed =
        localStorage.getItem(`sidebar-group-${name}-collapsed`) === "true";
      const group = root.querySelector<HTMLElement>(
        `[data-sidebar-group-content="${name}"]`,
      );
      if (group) group.hidden = collapsed && !isIconRail();
      button.setAttribute("aria-expanded", String(!collapsed));
    }
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const key = `sidebar-group-${button.dataset.sidebarGroup!}-collapsed`;
      localStorage.setItem(key, String(localStorage.getItem(key) !== "true"));
      refresh();
    });
  }
  refresh();
  return refresh;
}
