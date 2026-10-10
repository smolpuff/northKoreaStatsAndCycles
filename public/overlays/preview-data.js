(function () {
  let br = false;
  let active = false;
  let tick = 0;
  let loop;
  let revision = 0;
  const reportSize = () => window.parent.postMessage({type:"marbles-overlay-preview-size", height:document.getElementById("overlay").offsetHeight}, "*");
  new ResizeObserver(reportSize).observe(document.getElementById("overlay"));
  function sample(kind) {
    const wr = kind === "world-record";
    return {
      eventType: wr ? "worldRecord" : "raceComplete",
      eventId: "preview:" + kind + ":" + ++revision,
      receivedAt: new Date().toISOString(),
      gameId: "sample",
      gameType: br ? "battleRoyale" : "race",
      mapName: br ? "Grasslands" : "My masters machine",
      seasonName: "Season 72", cycleSeasonName: "Season 72",
      hasWorldRecord: wr, wrplayer: "MarbleChampion", wrplayerpoints: 112, wrrecordtime: 77.526,
      matchPoints: br ? 508 : 420, sessionPoints: br ? 4070 : 3842, seasonPoints: br ? 36392 : 36164,
      sessionRaces: 7, sessionBRs: 2, sessionPlayers: 30,
      cyclePlayers: 30, cycleRaces: 9,
      cycleLeaders: [
        {playerName: "MarbleChampion", cycles: 3, placementCounts: [4,4,4,3,4,3,4,3,4,3], currentCyclePositions:[1,2,3,5,7,9], cycleProgress:6},
        {playerName: "SecondPlayer", cycles: 2, placementCounts: [2,3,3,3,2,2,2,2,3,2], currentCyclePositions:[2,3,4,9], cycleProgress:4},
        {playerName: "VeryLongPlayerNameThatWillTruncateNeatly", cycles: 1, placementCounts: [1,2,1,1,2,1,1,1,2,1], currentCyclePositions:[2,5,9], cycleProgress:3},
      ],
      cycleCompletions: [{playerName: "MarbleChampion", cycleNumber: 3, races: 823}],
      placements: Array.from({length: 30}, (_, index) => ({
        place: index + 1,
        name: ["MarbleChampion", "SecondPlayer", "VeryLongPlayerNameThatWillTruncateNeatly"][index] || "Player" + (index + 1),
        points: Math.max(0, 112 - index * 7), time: 77.526 + index * 1.4, kills: Math.max(0, 5 - index), damage: Math.max(0, 2189 - index * 100),
      })),
    };
  }
  function render() {
    const kind = document.body.dataset.overlay;
    const data = sample(kind);
    if (active && tick % 2) {
      data.matchPoints += 170; data.sessionPoints += 350; data.seasonPoints += 350;
      data.sessionRaces += 1; data.sessionBRs += 1; data.sessionPlayers += 6;
      data.wrplayer = "SecondPlayer"; data.wrrecordtime = 75.421; data.wrplayerpoints = 148;
      data.cycleCompletions = [{playerName:"SecondPlayer",cycleNumber:4,races:672}];
      data.cycleLeaders[0].cycles = 4;
      data.cycleLeaders[0].placementCounts = [5,5,5,4,5,4,5,4,5,4];
      data.cycleLeaders[0].currentCyclePositions = [1];
      data.cycleLeaders[0].cycleProgress = 1;
      data.cycleLeaders.reverse();
      if (kind === "podium") {
        data.placements[0].name = "SecondPlayer";
        data.placements[1].name = "MarbleChampion";
        data.placements[0].points = 156;
        data.placements[1].points = 120;
      }
    }
    data.cycleStandings = Array.from({length:30}, (_, index) => {
      const leader = data.cycleLeaders[index];
      if (leader) return {...leader, playerKey:"preview:" + leader.playerName};
      const positions = Array.from({length:Math.max(0, 7 - Math.floor(index / 4))}, (_, i) => (i + index) % 10 + 1);
      return {playerKey:"preview:" + index, playerName:"Player" + (index + 1), cycles:0, currentCyclePositions:positions, placementCounts:Array.from({length:10}, (_, i) => positions.includes(i + 1) ? 1 : 0)};
    });
    window.MarblesOverlay.update(data);
    reportSize();
  }
  function setActive(value) {
    if (value === active) return;
    active = value;
    clearInterval(loop);
    tick = 0;
    window.MarblesOverlay.setPreviewActive(active);
    render();
    if (active && ! ["results", "cycle-status"].includes(document.body.dataset.overlay)) {
      loop = setInterval(() => { tick++; render(); }, document.body.dataset.overlay === "world-record" || document.body.dataset.overlay === "cycle-complete" ? 4500 : 3000);
    }
  }
  window.addEventListener("message", event => {
    if (event.source !== window.parent) return;
    if (event.data?.type === "marbles-overlay-preview-hover") { setActive(event.data.active === true); return; }
    if (event.data?.type !== "marbles-overlay-preview") return;
    br = event.data.br === true;
    render();
  });
  render();
  // Parent load/hover messages may precede this dynamically loaded script.
  window.parent.postMessage({type:"marbles-overlay-preview-ready"}, "*");
})();
