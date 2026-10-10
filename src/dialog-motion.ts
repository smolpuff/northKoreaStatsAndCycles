// Keep the modal in the top layer until its exit animation has finished.
// Wrapping this instance's close also covers existing buttons and programmatic closes.
const animatedDialogs = new WeakSet<HTMLDialogElement>();

export function showAnimatedDialog(dialog: HTMLDialogElement): void {
  if (animatedDialogs.has(dialog)) { dialog.showModal(); return; }
  animatedDialogs.add(dialog);
  const nativeClose = dialog.close.bind(dialog);
  let closing = false;

  dialog.close = (returnValue?: string) => {
    if (closing) return;
    if (!dialog.open || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nativeClose(returnValue);
      return;
    }
    closing = true;
    dialog.classList.add("dialog-closing");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      dialog.removeEventListener("animationend", onEnd);
      nativeClose(returnValue);
      dialog.classList.remove("dialog-closing");
      closing = false;
    };
    const onEnd = (event: AnimationEvent) => {
      if (event.target === dialog && event.animationName === "app-dialog-out") finish();
    };
    dialog.addEventListener("animationend", onEnd);
    // Still close if an animation is cancelled, or styles are unavailable.
    const timeout = window.setTimeout(finish, 300);
  };

  dialog.addEventListener("cancel", event => {
    // The updater can prevent Escape while installation is in progress.
    if (event.defaultPrevented) return;
    event.preventDefault();
    dialog.close();
  });
  dialog.showModal();
}
