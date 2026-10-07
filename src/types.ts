export type GameType = "auto" | "race" | "battleRoyale" | "tilt";

export interface PlayerResult {
  playerName: string;
  username: string;
  displayName: string;
  platform: string;
  nameColorHex?: string;
  placement: number;
  seasonPointsEarned: number;
  seasonPointsTotal?: number;
  seasonWinsTotal?: number;
  seasonMatchesPlayedTotal?: number;
  finishTime?: number;
  eliminated?: boolean;
  rawData?: Record<string, string>;
}

export interface GameResult {
  id: string;
  sourceSnapshotId?: string;
  timestamp: string;
  gameType: GameType;
  playerCount: number;
  results: PlayerResult[];
  hasWorldRecord: boolean;
  worldRecordPlayer?: string;
  worldRecordTime?: number;
  mapName?: string;
}

export interface RaceCyclePlayer {
  playerKey: string;
  playerName: string;
  placementCounts: number[];
  cycles: number;
  cycleRaceCounts?: (number | null)[];
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface Config {
  startMinimized: boolean;
  seasons: { raceName: string; cycleName: string };
  csv: {
    path: string;
    gameType: GameType;
    autoStartWatcher: boolean;
    autoStartCycles: boolean;
  };
  streamerBot: {
    host: string;
    port: number;
    events: { raceComplete: boolean; worldRecord: boolean; cycleComplete: boolean };
    actions: {
      gameComplete: string;
      worldRecord: string;
      cycleComplete: string;
    };
  };
  twitch: {
    postWorldRecords: boolean;
    worldRecordMessageTemplate: string;
    postResults: boolean;
    postCycleResults: boolean;
    messagePrefix: string;
    cycleMessageTemplate: string;
  };
}

export interface Snapshot {
  cycleHistory: { timestamp: string; playerName: string; cycleNumber: number; mapName?: string; gameId: string; winnerName?: string; winningTime?: number; playerCount?: number; completions?: { playerName: string; cycleNumber: number }[] }[];
  totalCycleRaceCount: number;
  totalRaceCount: number;
  totalBattleRoyaleCount: number;
  seasonPointsEarned: number;
  sessionResults: GameResult[];
  config: Config;
  watcherStatus: string;
  statsTrackingEnabled: boolean;
  cyclesTrackingEnabled: boolean;
  watcherMessage?: string;
  detectedGameType?: GameType;
  lastUpdate?: string;
  cycleLastUpdate?: string;
  latestResult?: GameResult;
  streamerBotStatus: string;
  streamerBotMessage?: string;
  twitchStatus: string;
  twitchMessage?: string;
  twitchUsername?: string;
  session: {
    gamesPlayed: number;
  };
  recentResults: GameResult[];
  raceCycles: RaceCyclePlayer[];
  logs: LogEntry[];
}
