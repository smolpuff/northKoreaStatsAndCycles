(function () {
  "use strict";
  const config = Object.assign({title:"Marbles Stats", scale:1, worldRecordSeconds:10, cycleSeconds:10}, window.MarblesOverlayConfig);
  const root = document.getElementById("overlay");
  if (!root) return;
  const kind = document.body.dataset.overlay || "custom";
  const preview = new URLSearchParams(window.location.search).get("preview") === "1";
  document.body.dataset.preview = String(preview);
  if (preview) { config.worldRecordSeconds = 0; config.cycleSeconds = 0; }
  for (const key of ["accent", "teal", "gold", "scale"]) {
    if (config[key] != null) document.documentElement.style.setProperty("--" + key, config[key]);
  }
  root.style.setProperty("--visible-rows", Math.max(1, Math.min(25, (kind === "cycle-status" ? 20 : Number(config.visibleRows ?? config.maxResults) || 6))));
  let previewOptions;
  let previousOptions = "";
  let customHeading;
  function applyOptions() {
    let options = previewOptions || window.MarblesOverlayOptions?.[kind];
    if (options && (kind === "results" || kind === "cycle-status")) options = { ...options, height: options.visibleRows * (kind === "cycle-status" ? 60 : 42) + (kind === "cycle-status" ? (options.headerVisible ? 192 : 114) : (options.headerVisible ? 161 : 106)) };
    const signature = JSON.stringify(options || null) + ":" + innerWidth + ":" + innerHeight;
    if (signature === previousOptions) return;
    previousOptions = signature;
    const page = document.documentElement;
    for (const key of ["background", "opacity", "ink", "muted", "accent", "gold", "teal", "border-start", "border-end"]) page.style.removeProperty("--overlay-" + key);
    root.style.removeProperty("width"); root.style.removeProperty("height"); root.style.removeProperty("min-height"); root.style.removeProperty("transform");
    document.body.classList.toggle("overlay-customized", !!options);
    const heading = root.querySelector(".heading") || root.querySelector(".celebration-content > h1:not(.custom-overlay-heading)");
    const title = root.querySelector(".heading h1") || heading;
    const headingIcon = root.querySelector(".celebration-content > .celebration-icon");
    if (headingIcon) headingIcon.style.display = options?.headerVisible === false ? "none" : "";
    if (heading) heading.style.display = options?.headerVisible === false ? "none" : "";
    if (title && title !== heading) title.style.display = "";
    customHeading?.remove(); customHeading = null;
    root.style.setProperty("--visible-rows", Math.max(1, Math.min(25, (kind === "cycle-status" ? 20 : Number(config.visibleRows ?? config.maxResults) || 6))));
    if (!options) { if (!root.hidden) scrollResults(); return; }
    page.style.setProperty("--overlay-background", options.background);
    page.style.setProperty("--overlay-opacity", options.opacity / 100);
    page.style.setProperty("--overlay-border-start", options.borderStart || "#493064");
    page.style.setProperty("--overlay-border-end", options.borderEnd || "#28395d");
    for (const [key, variable] of [["text","ink"],["secondary","muted"],["accent","accent"],["gold","gold"],["teal","teal"]]) {
      page.style.setProperty("--overlay-" + variable, options[key]);
    }
    const celebration = kind === "world-record" || kind === "cycle-complete";
    root.style.setProperty("--overlay-width", `${options.width}px`);
    root.style.setProperty("--overlay-height", `${options.height}px`);
    root.style.width = `${celebration ? options.width : options.width - 36}px`;
    root.style.height = `${celebration ? options.height : options.height - 36}px`;
    root.style.minHeight = "0";
    if (preview) root.style.transform = `scale(${Math.min(1, innerWidth / options.width, innerHeight / options.height)})`;
    root.style.setProperty("--visible-rows", options.visibleRows);
    if (options.headerVisible && options.headerText && title) {
      title.style.display = "none";
      customHeading = document.createElement("h1");
      customHeading.className = "custom-overlay-heading";
      customHeading.textContent = options.headerText;
      title.after(customHeading);
    }
    if (!root.hidden) scrollResults();
  }
  window.addEventListener("resize", applyOptions);
  if (preview) window.addEventListener("message", event => {
    if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.type !== "marbles-overlay-options") return;
    previewOptions = event.data.options;
    applyOptions();
    scrollResults();
  });
  const motion = config.animate !== false && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let previewPlaying = false;
  const animate = () => motion && (!preview || previewPlaying);
  const textTemplates = new WeakMap();
  const attributeTemplates = new WeakMap();
  const repeats = new WeakMap();
  let numbers = new WeakMap();
  const activeCounters = new Set();
  let numberFrame, scrollFrame, hideTimer, exitAnimation, cycleTimer, cycleStartTimer, cycleFade;
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
      for (const [key, val] of Object.entries({x:Math.random()*100+"%", drift:Math.random()*360-180+"px", delay:Math.random()*2+"s", duration:3+Math.random()*4+"s", spin:Math.random()*1440-720+"deg", "confetti-color":colors[index%colors.length]})) piece.style.setProperty("--"+key, val);
      container.appendChild(piece);
    }
  });
  function stopScroll() {
    if (scrollFrame != null) window.cancelAnimationFrame?.(scrollFrame);
    scrollFrame = undefined;
  }
  function stopCycleCarousel() {
    clearInterval(cycleTimer); cycleTimer = undefined;
    clearTimeout(cycleStartTimer); cycleStartTimer = undefined;
    if (cycleFade) { cycleFade.onfinish = null; cycleFade.cancel(); cycleFade = undefined; }
  }
  function cycleCarousel(data) {
    stopCycleCarousel();
    const items = [...root.querySelectorAll("[data-cycle-carousel] > .celebration-completion")];
    const received = Date.parse(data.receivedAt || "");
    const elapsed = !preview && Number.isFinite(received) ? Math.max(0, Date.now() - received) : 0;
    let current = items.length ? Math.floor(elapsed / 3000) % items.length : 0;
    items.forEach((item, index) => { item.hidden = index !== current; });
    if (items.length < 2 || (preview && !previewPlaying)) return;
    const advance = () => {
      const old = items[current];
      const showNext = () => {
        if (cycleFade) { cycleFade.onfinish = null; cycleFade.cancel(); cycleFade = undefined; }
        old.hidden = true;
        current = (current + 1) % items.length;
        const next = items[current]; next.hidden = false;
        if (animate() && next.animate) cycleFade = next.animate([{opacity:0}, {opacity:1}], {duration:300, fill:"both"});
      };
      cycleFade?.cancel();
      if (animate() && old.animate) {
        cycleFade = old.animate([{opacity:1}, {opacity:0}], {duration:300, fill:"both"});
        cycleFade.onfinish = showNext;
      } else showNext();
    };
    cycleStartTimer = setTimeout(() => {
      cycleStartTimer = undefined;
      advance();
      cycleTimer = setInterval(advance, 3000);
    }, 3000 - elapsed % 3000);
  }
  function scrollResults() {
    stopScroll();
    const viewport = root.querySelector(".results-viewport");
    if (!viewport) return;
    viewport.scrollTop = 0;
    if (!animate() || !window.requestAnimationFrame) return;
    const distance = viewport.scrollHeight - viewport.clientHeight;
    if (distance <= 0) return;
    const speed = Math.max(5, Math.min(150, Number((previewOptions || window.MarblesOverlayOptions?.[kind])?.scrollPixelsPerSecond ?? config.scrollPixelsPerSecond) || 20));
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
  let entranceAnimations = [];
  function cancelEntrance() {
    entranceAnimations.forEach(animation => animation.cancel());
    entranceAnimations = [];
  }
  function hide() {
    const card = root.firstElementChild;
    if (animate() && card?.animate) {
      exitAnimation?.cancel();
      exitAnimation = card.animate([{opacity:1}, {opacity:0}], {duration:280, easing:"ease-in", fill:"both"});
      exitAnimation.onfinish = () => { root.hidden = true; cancelEntrance(); stopScroll(); stopCycleCarousel(); };
    } else { root.hidden = true; stopScroll(); stopCycleCarousel(); }
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
      // Rows arrive in backend standings order; only derive presentation fields here.
      cycleStandings:(data.cycleStandings || []).map((player, index) => {
        const positions = new Set(player.currentCyclePositions || []);
        const missing = Array.from({length:10}, (_, i) => i + 1).filter(position => !positions.has(position));
        const row = Object.assign({}, player, {rank:index + 1, left:missing.length, missingPositions:missing.join(", ") || "None"});
        for (let position = 1; position <= 10; position++) row["position" + position] = {count:player.placementCounts?.[position - 1] ?? 0, ready:positions.has(position)};
        return row;
      }),
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
      exitAnimation?.cancel(); stopScroll(); stopCycleCarousel();
      cancelEntrance();
      // Preserve CSS effects: cancelling their animations permanently removes confetti on hover.
      root.getAnimations?.({subtree:true}).forEach(animation => { if (!("animationName" in animation)) animation.cancel(); });
    },
    update(data) {
      applyOptions();
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
        let duration = window.MarblesOverlayOptions?.[kind]?.durationSeconds ?? window.MarblesOverlayDurations?.[kind === "world-record" ? "worldRecordSeconds" : "cycleSeconds"] ?? (kind === "world-record" ? config.worldRecordSeconds : config.cycleSeconds);
        if (kind === "cycle-complete" && duration > 0) duration = Math.max(duration, data.cycleCompletions.length * 3);
        seconds = remaining(data, preview ? 0 : duration);
        if (seconds < 0) return;
      }
      clearTimeout(hideTimer);
      if (exitAnimation) { exitAnimation.onfinish = null; exitAnimation.cancel(); exitAnimation = undefined; }
      cancelEntrance();
      stopCycleCarousel();
      const dataScope = scope(data);
      bindNode(root, dataScope);
      if ((kind === "results" || kind === "podium") && !dataScope.placements.length) { hide(); return; }
      if (kind === "cycle-status" && !dataScope.cycleStandings.length) { hide(); return; }
      root.hidden = false;
      const card = root.firstElementChild;
      if (animate() && card?.animate) {
        const celebration = card.classList.contains("celebration");
        if (celebration) {
          entranceAnimations.push(card.animate([{opacity:0}, {opacity:1}], {duration:300, fill:"both"}));
          const content = card.querySelector(".celebration-content");
          if (content) entranceAnimations.push(content.animate(
            [{opacity:0, transform:"scale(.35)"}, {opacity:1, transform:"scale(1.04)", offset:.8}, {opacity:1, transform:"scale(1)"}],
            {duration:950, easing:"cubic-bezier(.2,.7,.3,1)", fill:"both"}));
          const lights = card.querySelector(".party-lights");
          if (lights) entranceAnimations.push(lights.animate(
            [{transform:"translateY(100%)"}, {transform:"translateY(0)"}],
            {duration:850, easing:"cubic-bezier(.2,.7,.3,1)", fill:"both"}));
          card.querySelectorAll(".confetti-piece").forEach(piece => {
            piece.getAnimations().forEach(animation => { animation.currentTime = 0; });
          });
        } else {
          entranceAnimations.push(card.animate([{opacity:.5, transform:"translateY(6px)"}, {opacity:1, transform:"translateY(0)"}], {duration:280, easing:"cubic-bezier(.2,.7,.3,1)", fill:"both"}));
        }
      }
      scrollResults();
      cycleCarousel(dataScope);
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
