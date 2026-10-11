import type { GameResult, PlayerResult } from "./types";

export interface MarbleCyclePage {
  games: GameResult[];
  resultEntries: number;
  playerEntries: number;
}

export function parseMarbleCyclePage(html: string, sessionUrl: string): MarbleCyclePage {
  const document = new DOMParser().parseFromString(html, "text/html");
  const summaries = [...document.querySelectorAll("#marbleRaceResults tr.race-summary")];
  if (!summaries.length) throw new Error("This session does not expose historical race results.");
  const games = summaries.map(summary => {
    const cells = [...summary.children].map(cell => cell.textContent?.trim() ?? "");
    const id = summary.id;
    if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) || cells.length !== 5) throw new Error("Unrecognized Marble Cycle race summary.");
    const number = Number(cells[0]);
    const count = Number(cells[2]);
    const finishers = Number(cells[3]);
    const rows = [...(document.getElementById(`tbl-${id}`)?.querySelector("table")?.querySelector("tbody")?.children ?? [])];
    if (!Number.isInteger(number) || number < 1 || !Number.isInteger(count) || count < 1 || rows.length !== count || !Number.isInteger(finishers) || finishers < 0 || finishers > count) throw new Error(`Incomplete participants for race ${number}. Nothing was imported.`);
    const timeParts = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(cells[4]);
    const winnerTime = timeParts ? Number(timeParts[1]) * 3600 + Number(timeParts[2]) * 60 + Number(timeParts[3]) : undefined;
    const results = rows.map((row): PlayerResult => {
      const values = [...row.children].map(cell => cell.textContent?.trim() ?? "");
      if (values.length !== 4 || !values[1] || !values[0]) throw new Error(`Incomplete player result in race ${number}.`);
      const placement = Number(values[0]);
      const points = Number(values[2]);
      const eliminations = Number(values[3]);
      if (![placement, points, eliminations].every(Number.isSafeInteger) || placement < 1 || placement > count || points < 0 || eliminations < 0) throw new Error(`Invalid player result in race ${number}.`);
      return { playerName: values[1], displayName: values[1], username: values[1].replace(/^@/, ""), platform: "Twitch",
        placement, seasonPointsEarned: points,
        finishTime: placement === 1 ? winnerTime : undefined,
        rawData: { MarbleCycleSessionUrl: sessionUrl, MarbleCycleRaceId: id, MarbleCycleRaceNumber: cells[0],
          SeasonPointsEarned: values[2],
          MarbleCycleFinishers: cells[3], MarbleCycleWinnerTime: cells[4], MarbleCycleEliminations: values[3],
          MarbleCycleMissingFields: "timestamp,track,individualFinishTimes,worldRecord" },
      };
    }).sort((a, b) => a.placement - b.placement);
    if (new Set(results.map(result => result.username.toLowerCase())).size !== results.length) throw new Error(`Duplicate players in race ${number}.`);
    const br = winnerTime == null && results.some(result => Number(result.rawData!.MarbleCycleEliminations) > 0);
    if (winnerTime == null && !br) throw new Error(`Race ${number} has no reliable Race/BR classification. Nothing was imported.`);
    for (const result of results) {
      if (br) result.rawData!.MatchKills = result.rawData!.MarbleCycleEliminations;
      else result.eliminated = result.placement > finishers;
    }
    // The public page supplies sequence, not dates/tracks. Leave missing values absent.
    return { id, sourceSnapshotId: id, timestamp: "", gameType: br ? "battleRoyale" : "race",
      playerCount: count, results, hasWorldRecord: false } as GameResult;
  });
  games.sort((a, b) => Number(a.results[0].rawData!.MarbleCycleRaceNumber) - Number(b.results[0].rawData!.MarbleCycleRaceNumber) || a.id.localeCompare(b.id));
  return { games, resultEntries: summaries.length, playerEntries: document.querySelectorAll("#marbleSessionResults tbody tr").length };
}
