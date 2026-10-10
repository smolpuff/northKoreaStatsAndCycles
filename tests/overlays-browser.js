// Browser DOM checks against the actual HTML templates and their binding script.
(async function () {
  const status = document.getElementById("status"), messages = [], frames = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); messages.push("PASS " + message); status.textContent = messages.join("\n"); };
  async function load(kind, preview = true) {
    const frame = document.createElement("iframe"); frames.push(frame);
    frame.src = "../public/overlays/"+kind+".html"+(preview ? "?preview=1" : "");
    const loaded = new Promise(resolve => frame.onload = resolve); document.body.append(frame); await loaded;
    return {frame, window:frame.contentWindow, document:frame.contentDocument, root:frame.contentDocument.getElementById("overlay"), update:frame.contentWindow.MarblesOverlay.update};
  }
  const packet = {eventType:"raceComplete",eventId:"match-1",gameType:"race",mapName:"A & B",placements:[
    {place:2,name:"Second",username:"second",points:8,time:43.2,kills:1,damage:65},
    {place:1,name:"<script>bad</script>",username:"winner",points:10,time:42.1,kills:3,damage:2189}],
    matchPoints:18,sessionPoints:100,seasonPoints:1000,
    cycleCompletions:[{playerName:"Winner",cycleNumber:1,races:823}]};
  try {
    const standings = await load("cycle-status");
    const cyclePlayers = Array.from({length:30}, (_, i) => ({playerKey:"p"+i, playerName:i === 0 ? "<b>Player</b>" : "Player"+i, cycles:2, placementCounts:[3,4,2,2,2,2,2,2,2,2], currentCyclePositions:[1,4]}));
    standings.update({...packet, cycleStandings:cyclePlayers, placements:[]});
    const standingsRow = standings.root.querySelector("tbody tr");
    check(!standings.root.hidden && standings.root.querySelectorAll("tbody tr").length === 30, "Cycle standings include every player even without a latest match");
    check(standingsRow.querySelector(".name").textContent === "<b>Player</b>" && !standingsRow.querySelector("b"), "Cycle player names bind as safe text");
    check(standingsRow.querySelectorAll("td.ready").length === 2 && standingsRow.querySelector(".cycle-left").textContent === "8", "Cycle highlights and positions left use current progress, not historical counts");
    check(standingsRow.getBoundingClientRect().height === 60, "Cycle rows have breathing room and fit the configured twenty-row viewport without clipping");
    check(standings.root.style.getPropertyValue("--visible-rows") === "20", "Cycle standings default to twenty visible rows");
    standings.update({...packet, eventId:"cycle-update", cycleStandings:[{...cyclePlayers[0],currentCyclePositions:[2]}]});
    check(standings.root.querySelector("tbody tr") === standingsRow && standingsRow.querySelectorAll("td.ready").length === 1 && standingsRow.querySelector(".cycle-left").textContent === "9", "Cycle updates reuse rows and remove stale progress highlights");
    standings.update({...packet, eventId:"cycle-empty", cycleStandings:[]});
    check(standings.root.hidden, "Empty cycle standings hide after a reset");
    const results = await load("results"); results.update(packet);
    const card = results.root.firstElementChild, firstRow = results.root.querySelector("tbody tr");
    check(!results.root.hidden && firstRow.querySelector(".name").textContent === "<script>bad</script>", "Bindings insert player names as safe text");
    check(!firstRow.querySelector("script"), "Player markup is never executed or inserted as HTML");
    check(results.root.querySelector("h1").textContent === "Race results", "Plain {race} text binds in the actual HTML");
    check(results.root.querySelector(".subtitle").textContent === "A & B", "Text and ampersands bind without HTML encoding artifacts");
    check(firstRow.querySelector(".name").title === "<script>bad</script>", "Attribute bindings update titles safely");
    results.update({...packet,eventId:"match-2",gameType:"battleRoyale",placements:packet.placements.map(p=>({...p,points:20}))});
    check(results.root.firstElementChild === card && results.root.querySelector("tbody tr") === firstRow, "Updates preserve the card and existing row DOM nodes");
    check(results.root.querySelector("h1").textContent === "Battle Royale results", "Original brace templates remain bound on later updates");
    check(firstRow.querySelector('[data-number="points"]').textContent === "20", "Reused row values update");
    check(!results.root.querySelector('[data-number="time"]') && !results.root.querySelector('[data-show="br"]').hidden, "Results omit time and show BR kills/damage");
    check(results.root.querySelector("tbody tr.dead") != null, "BR non-winners get the dead styling");
    results.update({...packet,eventId:"match-3",placements:Array.from({length:200},(_,i)=>({place:i+1,name:"Racer"+(i+1),username:"player"+i,points:1,time:1}))});
    check(results.root.querySelectorAll("tbody tr").length === 200 && results.root.textContent.includes("Racer200"), "HTML row template includes all 200 players");
    results.update({...packet,eventId:"match-4",placements:[]});
    check(results.root.hidden && !results.root.querySelector("tbody tr"), "Reset data removes rows and hides empty results");
    const styling = await load("results");
    styling.update(packet);
    let updates = 0;
    styling.root.addEventListener("marbles:update", () => updates++);
    styling.window.MarblesOverlayOptions = { results: {width:520,height:360,opacity:65,background:"#123456",text:"#ffffff",secondary:"#aabbcc",accent:"#ff0081",gold:"#ffe024",teal:"#00efaa",headerVisible:true,headerText:"<b>My results</b>",durationSeconds:0,visibleRows:4,scrollPixelsPerSecond:30} };
    styling.update(packet);
    check(styling.root.style.width === "484px" && styling.root.style.height === "293px", "Saved source size reserves browser padding and resizes the actual overlay");
    check(styling.root.querySelector(".custom-overlay-heading").textContent === "<b>My results</b>" && !styling.root.querySelector(".custom-overlay-heading b"), "Custom heading stays safe plain text");
    check(styling.window.getComputedStyle(styling.document.body).getPropertyValue("--ink").trim() === "#ffffff", "Per-overlay colors reach the real template");
    check(styling.window.getComputedStyle(styling.root.firstElementChild).backgroundColor.includes("0.65"), "Background opacity is applied without fading the text");
    styling.window.MarblesOverlayOptions.results.borderStart = "#ff1122";
    styling.window.MarblesOverlayOptions.results.borderEnd = "#3344ff";
    styling.update(packet);
    const border = styling.window.getComputedStyle(styling.root.firstElementChild, "::before");
    check(border.backgroundImage.includes("255, 17, 34") && border.backgroundImage.includes("51, 68, 255"), "Both saved colors reach the actual gradient border");
    check(/exclude|xor/.test(border.maskComposite || border.webkitMaskComposite), "Gradient is masked to the outline rather than filling the card");
    check(updates === 0, "Styling changes do not replay a match update");
    styling.window.MarblesOverlayOptions.results.headerVisible = false;
    styling.update(packet);
    check(styling.root.querySelector(".heading").style.display === "none", "Header visibility hides the whole card heading");
    styling.window.MarblesOverlayOptions = {};
    styling.update(packet);
    check(!styling.root.querySelector(".custom-overlay-heading") && styling.root.querySelector(".heading").style.display === "" && styling.root.style.width === "", "Restoring defaults removes custom sizing and restores the original heading");
    const podium = await load("podium"); podium.update({...packet, placements:Array.from({length:10},(_,i)=>({place:i+1,name:"Player"+i,points:i}))});
    check(podium.root.querySelectorAll("tbody tr").length === 3, "Podium limit is defined in its HTML");
    const custom = await load("custom"); custom.update(packet);
    check(custom.root.querySelector("h1").textContent === "Race winner: <script>bad</script>", "Custom starter binds {firstplace} without Streamer.bot");
    custom.update({...packet,eventId:"custom2",sessionPoints:0,placements:[{place:1,name:"New winner",points:0}]});
    check(custom.root.textContent.includes("New winner") && custom.root.textContent.includes("Session points: 0"), "Custom bindings update again and preserve zero values");
    custom.root.insertAdjacentHTML("beforeend", '<p id="dotted">{placements.0.name} {doesNotExist}</p>');
    custom.update({...packet,eventId:"custom3"});
    check(custom.root.querySelector("#dotted").textContent === "<script>bad</script> ", "Dotted paths work and missing fields are blank");
    const cycle = await load("cycle-complete"); cycle.update(packet);
    check(cycle.root.textContent.includes("823 races") && cycle.root.querySelectorAll(".celebration-completion").length === 1, "Cycle completion HTML repeats and binds race counts");
    cycle.update({...packet,eventId:"cycle2",cycleCompletions:[{playerName:"Other",cycleNumber:2,races:null},{playerName:"Third",cycleNumber:1,races:20}]});
    check(cycle.root.querySelectorAll(".celebration-completion").length === 2 && cycle.root.querySelector(".celebration-points").hidden, "Multiple cycle completions render; unknown race counts are hidden");
    const record = await load("world-record",false);
    record.update(packet); check(record.root.hidden,"Ordinary events cannot show a WR alert");
    record.update({...packet,eventType:"worldRecord",eventId:"oldwr",receivedAt:"2000-01-01T00:00:00Z",wrplayer:"Winner",wrrecordtime:42.1});
    check(record.root.hidden,"Expired alerts are not replayed");
    record.update({...packet,eventType:"worldRecord",eventId:"newwr",receivedAt:new Date().toISOString(),wrplayer:"Winner",wrrecordtime:42.1,wrplayerpoints:0});
    check(!record.root.hidden && record.root.querySelector(".celebration-player").textContent === "Winner" && !record.root.querySelector(".celebration-points").hidden,"WR template binds player/time/zero points");
    function checkEntrance(overlay, label) {
      const card = overlay.root.firstElementChild;
      const entry = card.getAnimations().find(animation => !("animationName" in animation));
      check(entry.effect.getKeyframes()[0].opacity === "0" && entry.effect.getTiming().fill === "both", label + " starts transparent without a visible first-frame flash");
      check(entry.effect.getKeyframes().every(frame => !frame.transform), label + " keeps the background and confetti at full size");
      const text = card.querySelector(".celebration-content").getAnimations()[0];
      check(text.effect.getKeyframes()[0].transform === "scale(0.35)", label + " zooms only the celebration text");
      const lights = card.querySelector(".party-lights").getAnimations()[0];
      check(lights.effect.getKeyframes()[0].transform === "translateY(100%)", label + " brings lights upward from below");
      check([...card.querySelectorAll(".confetti-piece")].every(piece => parseFloat(piece.style.getPropertyValue("--delay")) >= 0), label + " starts confetti above the frame");
      return entry;
    }
    const oldEntry = checkEntrance(record, "WR");
    record.update({...packet,eventType:"worldRecord",eventId:"replacementwr",receivedAt:new Date().toISOString(),wrplayer:"New winner",wrrecordtime:41,wrplayerpoints:12});
    check(oldEntry.playState === "idle", "A replacement alert cancels the old entrance animation");
    checkEntrance(record, "Replacement WR");
    const liveCycle = await load("cycle-complete", false);
    let finishCycle;
    liveCycle.window.setTimeout = callback => { finishCycle = callback; return 1; };
    liveCycle.update({...packet,eventId:"livecycle",eventType:"cycleComplete",receivedAt:new Date().toISOString()});
    checkEntrance(liveCycle, "Cycle");
    finishCycle();
    const fade = liveCycle.root.firstElementChild.getAnimations().find(animation => animation.effect.getTiming().duration === 280);
    check(fade.effect.getKeyframes().every(frame => !frame.transform), "Celebration exits fade without shrinking the effects");
    liveCycle.update({...packet,eventId:"replacementcycle",eventType:"cycleComplete",receivedAt:new Date().toISOString()});
    check(fade.playState === "idle" && fade.onfinish === null && !liveCycle.root.hidden, "A new cycle cancels the previous fade and its hide callback");
    let carouselTick, carouselDelay;
    liveCycle.window.setInterval = (callback, delay) => { carouselTick = callback; carouselDelay = delay; return 123; };
    liveCycle.window.setTimeout = (callback, delay) => { if (delay <= 3000) {carouselTick = callback; carouselDelay = delay;} return 124; };
    const carouselNow = Date.now(); liveCycle.window.Date.now = () => carouselNow;
    liveCycle.update({...packet,eventId:"multi-cycle",eventType:"cycleComplete",receivedAt:new Date(carouselNow).toISOString(),cycleCompletions:[
      {playerName:"User A",cycleNumber:2,races:13},{playerName:"User B",cycleNumber:4,races:15},{playerName:"User C",cycleNumber:1,races:20}]});
    const visibleCompletion = () => [...liveCycle.root.querySelectorAll(".celebration-completion")].filter(item=>!item.hidden);
    check(carouselDelay === 3000 && visibleCompletion().length === 1 && visibleCompletion()[0].textContent.includes("User A"), "Multiple cycle winners start with one player and a three-second interval");
    carouselTick();
    const userAFade = visibleCompletion()[0].getAnimations().find(animation=>animation.effect.getTiming().duration===300);
    check(userAFade.effect.getKeyframes().at(-1).opacity === "0", "Cycle player details fade out before switching");
    userAFade.finish();
    await new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    check(visibleCompletion().length===1 && visibleCompletion()[0].textContent.includes("User B"), "The next player's name, cycle and race count replace the previous player together");
    const refreshedCycle = await load("cycle-complete", false);
    let remainingMilliseconds, firstSwitchMilliseconds;
    refreshedCycle.window.setTimeout = (_,delay) => { remainingMilliseconds=delay; if(delay<=3000) firstSwitchMilliseconds=delay; return 1; };
    refreshedCycle.window.Date.now = () => carouselNow;
    refreshedCycle.window.MarblesOverlayOptions = {"cycle-complete":{durationSeconds:1}};
    refreshedCycle.update({...packet,eventId:"refreshed-multi",eventType:"cycleComplete",receivedAt:new Date(carouselNow-4000).toISOString(),cycleCompletions:[
      {playerName:"User A",cycleNumber:2,races:13},{playerName:"User B",cycleNumber:4,races:15},{playerName:"User C",cycleNumber:1,races:20}]});
    check(!refreshedCycle.root.hidden && remainingMilliseconds>4500 && remainingMilliseconds<=5000, "Refreshed multi-player alerts use the extended duration minus elapsed time");
    check([...refreshedCycle.root.querySelectorAll(".celebration-completion")].find(item=>!item.hidden).textContent.includes("User B"), "Refreshing resumes the current player's three-second turn");
    check(firstSwitchMilliseconds>1800 && firstSwitchMilliseconds<=2000, "A refreshed carousel switches at the original three-second boundary");
    record.root.hidden=true; record.update({...packet,eventType:"worldRecord",eventId:"replacementwr",wrplayer:"Changed"});
    check(record.root.hidden,"Duplicate WR identity cannot replay an alert");
    const celebration = await load("world-record");
    celebration.window.MarblesOverlayOptions = { "world-record": {width:1920,height:1080,opacity:80,background:"#071324",text:"#f5f5ff",secondary:"#b8c4e8",accent:"#ff0081",gold:"#ffe024",teal:"#00efaa",headerVisible:true,headerText:"",durationSeconds:10,visibleRows:6,scrollPixelsPerSecond:20} };
    celebration.update({...packet,eventId:"large-celebration",eventType:"worldRecord",hasWorldRecord:true,wrplayer:"Winner",wrrecordtime:42,wrplayerpoints:112});
    check(parseFloat(celebration.window.getComputedStyle(celebration.root.querySelector("h1")).fontSize) >= 153, "Celebration heading keeps its large canvas size before preview scaling");
    check(parseFloat(celebration.window.getComputedStyle(celebration.root.querySelector(".celebration-time")).fontSize) === 172, "WR gold point count retains its large celebration size");
    const points = await load("points",false);
    let clock=0, nextId=0; const pending=new Map();
    Object.defineProperty(points.window.performance,"now",{value:()=>clock});
    points.window.requestAnimationFrame=fn=>{pending.set(++nextId,fn);return nextId}; points.window.cancelAnimationFrame=id=>pending.delete(id);
    function advance(time) {clock=time;const calls=[...pending.values()];pending.clear();calls.forEach(fn=>fn(time));}
    const metric=()=>Number(points.root.querySelector('[data-number="matchPoints"]').textContent.replace(/,/g,""));
    points.update({...packet,matchPoints:100});check(metric()===0,"Animated values start at zero");
    advance(375);check(metric()>0&&metric()<100,"Count animation advances through intermediate values");advance(750);check(metric()===100,"Count animation reaches its target");
    points.update({...packet,eventId:"points2",matchPoints:10});check(metric()===100,"Count decreases start at their previous displayed value");advance(1125);check(metric()>10&&metric()<100,"Decreases animate smoothly");advance(1500);check(metric()===10,"Decreases finish at their exact target");
    const hover = await load("points"); hover.update({...packet,matchPoints:100});
    hover.window.requestAnimationFrame=fn=>{pending.set(++nextId,fn);return nextId}; hover.window.cancelAnimationFrame=id=>pending.delete(id);Object.defineProperty(hover.window.performance,"now",{value:()=>clock});
    hover.window.MarblesOverlay.setPreviewActive(true);hover.update({...packet,eventId:"hover1",matchPoints:100});
    check(hover.root.querySelector('[data-number="matchPoints"]').textContent==="0","Hover starts the number loop immediately");
    hover.window.MarblesOverlay.setPreviewActive(false);hover.update({...packet,eventId:"hover2",matchPoints:100});
    check(hover.root.querySelector('[data-number="matchPoints"]').textContent==="100","Leaving the card restores the idle values");
    const scrolling = await load("results",false);
    scrolling.window.requestAnimationFrame=fn=>{pending.set(++nextId,fn);return nextId};scrolling.window.cancelAnimationFrame=id=>pending.delete(id);Object.defineProperty(scrolling.window.performance,"now",{value:()=>clock});
    scrolling.update({...packet,eventId:"scroll",placements:Array.from({length:200},(_,i)=>({place:i+1,name:"Racer"+i,points:1,time:1}))});
    const viewport=scrolling.root.querySelector(".results-viewport"), distance=viewport.scrollHeight-viewport.clientHeight;let furthest=0;const start=clock;
    for(let elapsed=100;elapsed<=distance/scrolling.window.MarblesOverlayConfig.scrollPixelsPerSecond*1000+5000;elapsed+=100){advance(start+elapsed);furthest=Math.max(furthest,viewport.scrollTop)}
    check(furthest>=distance-1&&viewport.scrollTop<furthest,"All-player results scroll to the bottom and back up");
    check(results.document.querySelectorAll('[data-confetti]').length===0&&cycle.root.querySelectorAll('.confetti-piece').length===300,"Confetti comes from the celebration HTML template");
    status.textContent += "\n\nALL OVERLAY BINDING CHECKS PASSED";
  } catch(error) {status.textContent += "\nFAIL " + error.stack;}
  finally {frames.forEach(frame=>frame.remove());}
})();
