import { icons } from "./icons";
import { showAnimatedDialog } from "./dialog-motion";

export async function confirmClear(title: string, description: string, action: string): Promise<boolean> {
  return (await clearDialog(title, description, action, false)).confirmed;
}

export function confirmClearWithBackup(title: string, description: string): Promise<{ confirmed: boolean; backup: boolean }> {
  return clearDialog(title, description, "Clear results", true);
}

function clearDialog(title: string, description: string, action: string, offerBackup: boolean): Promise<{ confirmed: boolean; backup: boolean }> {
  // A second click must not create another pending destructive action.
  if (document.querySelector("#clear-confirmation-dialog")) return Promise.resolve({ confirmed: false, backup: false });

  const dialog = document.createElement("dialog");
  dialog.id = "clear-confirmation-dialog";
  dialog.className = "overlay-preview-dialog confirmation-dialog";
  dialog.setAttribute("aria-labelledby", "clear-confirmation-title");
  dialog.setAttribute("aria-describedby", "clear-confirmation-description");
  dialog.innerHTML = `<header><h2 id="clear-confirmation-title"></h2><button type="button" class="compact-button modal-close" aria-label="Close" title="Close" data-close>${icons.close}</button></header>
    <p id="clear-confirmation-description"></p>
    ${offerBackup ? `<label class="backup-choice"><input type="checkbox" data-backup /> Back up current results before clearing (choose where to save)</label>` : ""}
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
      resolve({ confirmed: dialog.returnValue === "confirmed", backup: dialog.querySelector<HTMLInputElement>("[data-backup]")?.checked ?? false });
    }, { once: true });
    document.body.append(dialog);
    showAnimatedDialog(dialog);
  });
}

export function chooseExportFormat(): Promise<"json" | "csv" | undefined> {
  const dialog = document.createElement("dialog");
  dialog.className = "overlay-preview-dialog confirmation-dialog";
  dialog.setAttribute("aria-labelledby", "export-format-title");
  dialog.innerHTML = `<header><h2 id="export-format-title">Export format</h2><button type="button" class="compact-button modal-close" aria-label="Close">${icons.close}</button></header>
    <p>Choose a format, then choose where to save the file.</p>
    <footer class="confirmation-actions"><button type="button" class="compact-button" data-format="cancel">Cancel</button><button type="button" class="compact-button" data-format="json">JSON</button><button type="button" class="compact-button" data-format="csv">CSV</button></footer>`;
  return new Promise(resolve => {
    dialog.querySelector(".modal-close")!.addEventListener("click", () => dialog.close());
    dialog.querySelectorAll<HTMLButtonElement>("[data-format]").forEach(button => button.addEventListener("click", () => dialog.close(button.dataset.format)));
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue === "json" || dialog.returnValue === "csv" ? dialog.returnValue : undefined);
    }, { once: true });
    document.body.append(dialog);
    showAnimatedDialog(dialog);
  });
}
