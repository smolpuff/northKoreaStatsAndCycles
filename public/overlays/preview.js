(function () {
  let br = false;
  const frames = [...document.querySelectorAll("iframe")];
  function update(frame) {
    frame.contentWindow.postMessage({type: "marbles-overlay-preview", br}, "*");
    frame.contentWindow.postMessage({type:"marbles-overlay-preview-hover", active:frame.closest("section").matches(":hover, :focus-within")}, "*");
  }
  window.addEventListener("message", event => {
    if (event.data?.type !== "marbles-overlay-preview-ready") return;
    const frame = frames.find(frame => frame.contentWindow === event.source);
    if (frame) update(frame);
  });
  for (const frame of frames) frame.addEventListener("load", () => update(frame));
  for (const frame of frames) {
    const card = frame.closest("section");
    const play = active => frame.contentWindow.postMessage({type:"marbles-overlay-preview-hover", active}, "*");
    card.addEventListener("mouseenter", () => play(true));
    card.addEventListener("mouseleave", () => play(false));
    card.addEventListener("focusin", () => play(true));
    card.addEventListener("focusout", event => { if (!card.contains(event.relatedTarget)) play(false); });
  }
  function select(value) {
    br = value;
    document.getElementById("race").classList.toggle("active", !br);
    document.getElementById("br").classList.toggle("active", br);
    frames.forEach(update);
  }
  document.getElementById("race").onclick = () => select(false);
  document.getElementById("br").onclick = () => select(true);
})();
