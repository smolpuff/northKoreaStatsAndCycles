import { icons } from "./icons";
import { showAnimatedDialog } from "./dialog-motion";

export function confirmClear(title: string, description: string, action: string): Promise<boolean> {
  // A second click must not create another pending destructive action.
  if (document.querySelector("#clear-confirmation-dialog")) return Promise.resolve(false);

  const dialog = document.createElement("dialog");
  dialog.id = "clear-confirmation-dialog";
  dialog.className = "overlay-preview-dialog confirmation-dialog";
  dialog.setAttribute("aria-labelledby", "clear-confirmation-title");
  dialog.setAttribute("aria-describedby", "clear-confirmation-description");
  dialog.innerHTML = `<header><h2 id="clear-confirmation-title"></h2><button type="button" class="compact-button modal-close" aria-label="Close" title="Close" data-close>${icons.close}</button></header>
    <p id="clear-confirmation-description"></p>
    <footer class="confirmation-actions"><button type="button" class="compact-button" data-cancel autofocus>Cancel</button><button type="button" class="compact-button btn-error" data-confirm></button></footer>`;
  dialog.querySelector("h2")!.textContent = title;
  dialog.querySelector("p")!.textContent = description;
  dialog.querySelector("[data-confirm]")!.textContent = action;

  return new Promise(resolve => {
    dialog.querySelector("[data-close]")!.addEventListener("click", () => dialog.close("cancel"));
    dialog.querySelector("[data-cancel]")!.addEventListener("click", () => dialog.close("cancel"));
    dialog.querySelector("[data-confirm]")!.addEventListener("click", () => dialog.close("confirmed"));
    // Escape and every other dismissal cancel; only the explicit action approves.
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue === "confirmed");
    }, { once: true });
    document.body.append(dialog);
    showAnimatedDialog(dialog);
  });
}
