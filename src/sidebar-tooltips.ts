let tooltip: HTMLElement | undefined;
let owner: HTMLElement | undefined;
let originalTitle = "";

export function hideSidebarTooltip(): void {
  if (owner && originalTitle) owner.title = originalTitle;
  tooltip?.remove();
  tooltip = undefined;
  owner = undefined;
}

export function installSidebarTooltips(isCollapsed: () => boolean): void {
  const show = (event: Event) => {
    const target = (event.target as Element).closest<HTMLElement>(".sidebar .nav-item, .sidebar .sidebar-watcher, .sidebar .sidebar-collapse-button");
    if (!isCollapsed() || !target || owner === target) return;
    hideSidebarTooltip();
    const label = target.title || target.getAttribute("aria-label");
    if (!label) return;
    owner = target;
    originalTitle = target.title;
    target.removeAttribute("title");
    tooltip = document.createElement("div");
    tooltip.className = "sidebar-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.textContent = label;
    document.body.append(tooltip);
    const rect = target.getBoundingClientRect();
    const aside = target.closest(".sidebar")!.getBoundingClientRect();
    tooltip.style.left = `${aside.right + 8}px`;
    tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - tooltip.offsetHeight - 8, rect.top + (rect.height - tooltip.offsetHeight) / 2))}px`;
  };
  document.addEventListener("pointerover", show);
  document.addEventListener("focusin", show);
  document.addEventListener("pointerout", event => {
    if (owner && !owner.contains((event as PointerEvent).relatedTarget as Node | null)) hideSidebarTooltip();
  });
  document.addEventListener("focusout", hideSidebarTooltip);
  document.addEventListener("pointerdown", hideSidebarTooltip);
  window.addEventListener("resize", hideSidebarTooltip);
}
