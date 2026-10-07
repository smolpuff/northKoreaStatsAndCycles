(function () {
  "use strict";
  const config = Object.assign({title:"Marbles Stats", scale:1, worldRecordSeconds:12, cycleSeconds:12}, window.MarblesOverlayConfig);
  const root = document.getElementById("overlay");
  if (!root) return;
  const kind = document.body.dataset.overlay || "custom";
  const preview = new URLSearchParams(window.location.search).get("preview") === "1";
  document.body.dataset.preview = String(preview);
  if (preview) { config.worldRecordSeconds = 0; config.cycleSeconds = 0; config.scrollPixelsPerSecond = 150; config.scrollPauseSeconds = .8; }
  for (const key of ["accent", "teal", "gold", "scale"]) {
    if (config[key] != null) document.documentElement.style.setProperty("--" + key, config[key]);
  }
  root.style.setProperty("--visible-rows", Math.max(1, Math.min(25, Number(config.visibleRows ?? config.maxResults) || 10)));
  const motion = config.animate !== false && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let previewPlaying = false;
  const animate = () => motion && (!preview || previewPlaying);
  const textTemplates = new WeakMap();
  const attributeTemplates = new WeakMap();
  const repeats = new WeakMap();
  let numbers = new WeakMap();
  const activeCounters = new Set();
  let numberFrame, scrollFrame, hideTimer, exitAnimation;
  let lastPacket = "", lastAlert = "";

  // Resolve fields by name, including dotted paths. Never interpret data as HTML.
  function value(data, path) {
    return path.split(".").reduce((current, key) => current != null && Object.hasOwn(current, key) ? current[key] : undefined, data);
  }
  function interpolate(template, data) {
    return template.replace(/\{([A-Za-z][\w.]*)\}/g, (_, key) => {
      const found = value(data, key);
      return found == null || typeof found === "object" ? "" : String(found);
    });
  }
  function numericText(number, decimals, suffix) {
    return (decimals ? number.toFixed(decimals) : Math.round(number).toLocaleString()) + suffix;
  }
  function tickNumbers(now) {
    for (const counter of activeCounters) {
      const fraction = Math.min(1, Math.max(0, (now - counter.began) / counter.duration));
      counter.current = counter.start + (counter.target - counter.start) * (1 - Math.pow(1 - fraction, 3));
      if (fraction === 1) counter.current = counter.target;
      counter.element.textContent = numericText(counter.current, counter.decimals, counter.suffix);
      if (fraction === 1 || !counter.element.isConnected) activeCounters.delete(counter);
    }
    numberFrame = activeCounters.size ? window.requestAnimationFrame(tickNumbers) : undefined;
  }
  function bindNumber(element, data) {
    const target = value(data, element.dataset.number);
    const previous = numbers.get(element);
    if (previous) activeCounters.delete(previous);
    if (target == null || target === "" || !Number.isFinite(Number(target))) {
      element.textContent = "\u2014";
      numbers.delete(element);
      return;
    }
    const decimals = Math.max(0, Math.min(6, Number(element.dataset.decimals) || 0));
    const suffix = element.dataset.suffix || "";
    const duration = Math.max(0, Math.min(5000, Number(config.countMilliseconds ?? 750) || 0));
    const counter = {element, target:Number(target), current:previous?.current ?? 0, start:previous?.current ?? 0, decimals, suffix, duration, began:performance.now()};
    numbers.set(element, counter);
    if (animate() && duration && window.requestAnimationFrame && counter.start !== counter.target) {
      activeCounters.add(counter);
      element.textContent = numericText(counter.start, decimals, suffix);
      if (numberFrame == null) numberFrame = window.requestAnimationFrame(tickNumbers);
    } else {
      counter.current = counter.target;
      element.textContent = numericText(counter.target, decimals, suffix);
    }
  }
  function bindRepeat(container, data) {
    let state = repeats.get(container);
    if (!state) {
      const template = [...container.children].find(child => child.tagName === "TEMPLATE");
      if (!template) return;
      state = {template, rows:new Map()};
      repeats.set(container, state);
    }
    const source = value(data, container.dataset.repeat);
    let items = Array.isArray(source) ? source : [];
    if (container.dataset.limit) items = items.slice(0, Math.max(0, Number(container.dataset.limit) || 0));
    const kept = new Set();
    items.forEach((item, index) => {
      const baseKey = container.dataset.key ? value(item, container.dataset.key) : index;
      let key = String(baseKey ?? index);
      // Preserve even duplicate keys instead of silently dropping a player.
      if (kept.has(key)) key += ":" + index;
      kept.add(key);
      let nodes = state.rows.get(key);
      if (!nodes) {
        const fragment = state.template.content.cloneNode(true);
        nodes = [...fragment.childNodes];
        state.rows.set(key, nodes);
      }
      const scope = Object.assign({}, data, item);
      for (const node of nodes) {
        container.appendChild(node);
        bindNode(node, scope);
      }
    });
    for (const [key, nodes] of state.rows) {
      if (!kept.has(key)) {
        for (const node of nodes) node.remove();
        state.rows.delete(key);
      }
    }
  }
  function bindNode(node, data) {
    if (node.nodeType === 3) {
      if (!textTemplates.has(node)) textTemplates.set(node, node.textContent);
      const template = textTemplates.get(node);
      if (/\{[A-Za-z][\w.]*\}/.test(template)) node.textContent = interpolate(template, data);
      return;
    }
    if (node.nodeType !== 1 || ["SCRIPT", "STYLE", "TEMPLATE"].includes(node.tagName)) return;
    if (node.hasAttribute("data-show")) node.hidden = !value(data, node.dataset.show);
    if (node.dataset.class) {
      for (const entry of node.dataset.class.split(/\s+/)) {
        const [className, field] = entry.split(":");
        if (className && field) node.classList.toggle(className, Boolean(value(data, field)));
      }
    }
    if (!attributeTemplates.has(node)) {
      attributeTemplates.set(node, ["title", "aria-label", "alt"].filter(name => node.hasAttribute(name)).map(name => [name, node.getAttribute(name)]));
    }
    for (const [name, template] of attributeTemplates.get(node)) node.setAttribute(name, interpolate(template, data));
    if (node.dataset.repeat) { bindRepeat(node, data); return; }
    if (node.dataset.number) { bindNumber(node, data); return; }
    for (const child of node.childNodes) bindNode(child, data);
  }
  // Layout and the confetti element live in HTML; clone its template once.
  root.querySelectorAll("[data-confetti]").forEach(container => {
    const template = container.querySelector("template");
    if (!template) return;
    const amount = Math.max(0, Math.min(500, Number(container.dataset.confetti) || 100));
    const colors = ["#ffe024", "#ffb937", "#fff2a3", "#ff0081", "#00efaa"];
    for (let index = 0; index < amount; index++) {
      const piece = template.content.firstElementChild.cloneNode(true);
      for (const [key, val] of Object.entries({x:Math.random()*100+"%", drift:Math.random()*360-180+"px", delay:Math.random()*-12+"s", duration:3+Math.random()*4+"s", spin:Math.random()*1440-720+"deg", "confetti-color":colors[index%colors.length]})) piece.style.setProperty("--"+key, val);
      container.appendChild(piece);
    }
  });
  function stopScroll() {
    if (scrollFrame != null) window.cancelAnimationFrame?.(scrollFrame);
    scrollFrame = undefined;
  }
  function scrollResults() {
    stopScroll();
    const viewport = root.querySelector(".results-viewport");
    if (!viewport) return;
    viewport.scrollTop = 0;
    if (!animate() || !window.requestAnimationFrame) return;
    const distance = viewport.scrollHeight - viewport.clientHeight;
    if (distance <= 0) return;
    const speed = Math.max(5, Math.min(150, Number(config.scrollPixelsPerSecond) || 24));
    const pause = Math.max(0, Number(config.scrollPauseSeconds ?? 2))*1000;
    let previous = performance.now(), pausedUntil = previous + pause, direction = 1, position = 0;
    function step(now) {
      const elapsed = Math.min(100, now-previous); previous = now;
      if (now >= pausedUntil) {
        position = Math.max(0, Math.min(distance, position + direction*speed*elapsed/1000));
        viewport.scrollTop = position;
        if (position >= distance || position <= 0) { direction *= -1; pausedUntil = now + pause; }
      }
      scrollFrame = window.requestAnimationFrame(step);
    }
    scrollFrame = window.requestAnimationFrame(step);
  }
  function hide() {
    const card = root.firstElementChild;
    if (animate() && card?.animate) {
      exitAnimation?.cancel();
      exitAnimation = card.animate([{opacity:1, transform:"scale(1)"}, {opacity:0, transform:"scale(1.08)"}], {duration:280, easing:"ease-in", fill:"forwards"});
      exitAnimation.onfinish = () => { root.hidden = true; stopScroll(); };
    } else { root.hidden = true; stopScroll(); }
  }
  function remaining(data, seconds) {
    if (!(seconds > 0)) return 0;
    const received = Date.parse(data.receivedAt || "");
    const left = Number.isFinite(received) ? seconds - Math.max(0, (Date.now()-received)/1000) : seconds;
    return left > 0 ? left : -1;
  }
  function scope(data) {
    const br = data.gameType === "battleRoyale";
    const placements = [...(data.placements || [])].sort((a,b) => a.place-b.place).map(player => Object.assign({}, player, {
      playerKey:String(player.platform || "") + ":" + String(player.username || player.name),
      winner:player.place === 1, dead:br && player.place !== 1, ordinary:player.place !== 1 && !br,
    }));
    const result = Object.assign({}, data, {brand:config.title, race:br ? "Battle Royale" : "Race", br, placements, hasRecordPoints:data.wrplayerpoints != null,
      cycleCompletions:(data.cycleCompletions || []).map(player => Object.assign({}, player, {completionKey:player.playerName+":"+player.cycleNumber, hasRaceCount:player.races != null})),
    });
    // Boolean race/BR visibility is separate from the printable {race} label.
    result.isRace = !br;
    for (const [field, rowField] of [["cycleplayer", "playerName"], ["cyclenumber", "cycleNumber"], ["cycleraces", "races"]]) {
      if (result[field] == null) result[field] = result.cycleCompletions.map(player => player[rowField] ?? "").join(", ");
    }
    for (const [index, prefix] of ["first", "second", "third"].entries()) {
      const player = placements.find(player => player.place === index+1);
      for (const [suffix, field] of [["place", "name"], ["placepoints", "points"], ["placetime", "time"]]) {
        if (result[prefix+suffix] == null) result[prefix+suffix] = player?.[field] ?? null;
      }
    }
    return result;
  }
  window.MarblesOverlay = {
    setPreviewActive(active) {
      if (!preview || previewPlaying === (active === true)) return;
      previewPlaying = active === true;
      document.body.classList.toggle("preview-playing", previewPlaying);
      activeCounters.clear();
      if (numberFrame != null) window.cancelAnimationFrame?.(numberFrame);
      numberFrame = undefined; numbers = new WeakMap(); lastPacket = "";
      exitAnimation?.cancel(); stopScroll();
      // Preserve CSS effects: cancelling their animations permanently removes confetti on hover.
      root.getAnimations?.({subtree:true}).forEach(animation => { if (!("animationName" in animation)) animation.cancel(); });
    },
    update(data) {
      if (!data || typeof data !== "object" || !data.eventType) return;
      const packet = JSON.stringify(data);
      if (packet === lastPacket) return;
      lastPacket = packet;
      let seconds = 0;
      if (kind === "world-record" || kind === "cycle-complete") {
        if (kind === "world-record" ? data.eventType !== "worldRecord" && !data.hasWorldRecord : !data.cycleCompletions?.length) return;
        const id = String(data.eventId || data.gameId || data.timestamp || "");
        if (id && id === lastAlert) return;
        lastAlert = id;
        seconds = remaining(data, kind === "world-record" ? config.worldRecordSeconds : config.cycleSeconds);
        if (seconds < 0) return;
      }
      clearTimeout(hideTimer); exitAnimation?.cancel();
      const dataScope = scope(data);
      bindNode(root, dataScope);
      if ((kind === "results" || kind === "podium") && !dataScope.placements.length) { hide(); return; }
      root.hidden = false;
      const card = root.firstElementChild;
      if (animate() && card?.animate) {
        const celebration = card.classList.contains("celebration");
        card.animate(celebration ? [{opacity:0, transform:"scale(.35)"}, {opacity:1, transform:"scale(1.04)", offset:.8}, {opacity:1, transform:"scale(1)"}] : [{opacity:.5, transform:"translateY(6px)"}, {opacity:1, transform:"translateY(0)"}], {duration:celebration ? 950 : 280, easing:"cubic-bezier(.2,.7,.3,1)"});
      }
      scrollResults();
      if (seconds > 0) hideTimer = setTimeout(hide, seconds*1000);
      // Custom templates may listen for data without depending on Streamer.bot.
      root.dispatchEvent(new CustomEvent("marbles:update", {detail:dataScope}));
    },
  };
  function refresh() {
    const script = document.createElement("script");
    const source = document.body.dataset.source || (kind === "world-record" ? "world-record-data.js" : kind === "cycle-complete" ? "cycle-complete-data.js" : "overlay-data.js");
    script.src = source + "?t=" + Date.now();
    script.onload = script.onerror = () => script.remove();
    document.head.appendChild(script);
  }
  if (preview) {
    const script = document.createElement("script"); script.src = "preview-data.js"; document.head.appendChild(script);
  } else { refresh(); setInterval(refresh, 3000); }
})();
