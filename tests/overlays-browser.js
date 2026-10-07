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
    check(results.root.querySelector('[data-show="isRace"]').hidden && !results.root.querySelector('[data-show="br"]').hidden, "BR hides race columns and shows kills/damage");
    check(results.root.querySelector("tbody tr.dead") != null, "BR non-winners get the dead styling");
    results.update({...packet,eventId:"match-3",placements:Array.from({length:200},(_,i)=>({place:i+1,name:"Racer"+(i+1),username:"player"+i,points:1,time:1}))});
    check(results.root.querySelectorAll("tbody tr").length === 200 && results.root.textContent.includes("Racer200"), "HTML row template includes all 200 players");
    results.update({...packet,eventId:"match-4",placements:[]});
    check(results.root.hidden && !results.root.querySelector("tbody tr"), "Reset data removes rows and hides empty results");
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
    record.root.hidden=true; record.update({...packet,eventType:"worldRecord",eventId:"newwr",wrplayer:"Changed"});
    check(record.root.hidden,"Duplicate WR identity cannot replay an alert");
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
    for(let elapsed=100;elapsed<=distance/24*1000+5000;elapsed+=100){advance(start+elapsed);furthest=Math.max(furthest,viewport.scrollTop)}
    check(furthest>=distance-1&&viewport.scrollTop<furthest,"All-player results scroll to the bottom and back up");
    check(results.document.querySelectorAll('[data-confetti]').length===0&&cycle.root.querySelectorAll('.confetti-piece').length===300,"Confetti comes from the celebration HTML template");
    status.textContent += "\n\nALL OVERLAY BINDING CHECKS PASSED";
  } catch(error) {status.textContent += "\nFAIL " + error.stack;}
  finally {frames.forEach(frame=>frame.remove());}
})();
