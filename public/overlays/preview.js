(function () {
  let br = false;
  const frames = [...document.querySelectorAll("iframe")];
  function update(frame) {
    frame.contentWindow.postMessage({type: "marbles-overlay-preview", br}, "*");
  }
  for (const frame of frames) frame.addEventListener("load", () => update(frame));
  for (const frame of frames) {
    const card = frame.closest("section");
    const play = active => frame.contentWindow.postMessage({type:"marbles-overlay-preview-hover", active}, "*");
    card.addEventListener("mouseenter", () => play(true));
    card.addEventListener("mouseleave", () => play(false));
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
