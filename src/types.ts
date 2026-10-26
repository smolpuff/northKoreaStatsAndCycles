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
  totalRaces?: number;
  totalRacesComplete?: boolean;
  playerKey: string;
  playerName: string;
  placementCounts: number[];
  cycles: number;
  currentCyclePositions?: number[] | null;
  cycleRaceCounts?: (number | null)[];
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export type AppearanceTheme = "default" | "dark" | "minimal";

export interface LumiaConfig {
  enabled: boolean;
  port: number;
  events: Config["streamerBot"]["events"];
  actions: Config["streamerBot"]["actions"];
}

export type DiscordEventKind = "race" | "battleRoyale" | "cycleComplete" | "worldRecord";
export interface DiscordEvent {
  enabled: boolean;
  target: string;
  messageTemplate: string;
  placementTemplate: string;
}
export interface DiscordConfig {
  enabled: boolean;
  targets: string[];
  events: Record<DiscordEventKind, DiscordEvent>;
}

export interface Config {
  discord: DiscordConfig;
  lumia: LumiaConfig;
  theme: AppearanceTheme;
  autoUpdateCheckEnabled: boolean;
  startMinimized: boolean;
  seasons: { raceName: string; cycleName: string };
  csv: {
    path: string;
    gameType: GameType;
    autoStartWatcher: boolean;
    autoStartCycles: boolean;
  };
  streamerBot: {
    enabled: boolean;
    host: string;
    port: number;
    events: { raceComplete: boolean; worldRecord: boolean; cycleComplete: boolean; missionPromotion?: boolean };
    actions: {
      missionPromotion?: string;
      gameComplete: string;
      worldRecord: string;
      cycleComplete: string;
    };
  };
  twitch: {
    myCycleCommand?: boolean;
    myStatsCommand?: boolean;
    myCycleCommandAlias?: string;
    myStatsCommandAlias?: string;
    promoteMissionApp?: boolean;
    promotionIntervalMinutes?: number;
    promotionStartDelayMinutes?: number;
    promotionMessageTemplate?: string;
    postWorldRecords: boolean;
    worldRecordMessageTemplate: string;
    postResults: boolean;
    postCycleResults: boolean;
    messagePrefix: string;
    raceMessageTemplate?: string;
    raceEntryTemplate?: string;
    racePodiumTemplates?: string[];
    raceEntrySeparator?: string;
    cycleMessageTemplate: string;
  };
}

export interface Snapshot {
  discordStatus: string;
  discordMessage?: string;
  eventResultIds?: string[];
  cycleHistory: { timestamp: string; playerName: string; cycleNumber: number; mapName?: string; gameId: string; winnerName?: string; winningTime?: number; playerCount?: number; standings?: RaceCyclePlayer[]; game?: GameResult; earnings?: { playerKey: string; playerName: string; placement: number; pointsEarned: number; cyclesEarned: number; cycleNumber: number; placementCounts: number[] }[]; completions?: { playerName: string; cycleNumber: number }[] }[];
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
  lumiaConfigured?: boolean;
  lumiaStatus: string;
  lumiaMessage?: string;
  streamerBotStatus: string;
  streamerBotMessage?: string;
  twitchStatus: string;
  twitchChatMessage?: string;
  twitchMessage?: string;
  twitchUsername?: string;
  session: {
    gamesPlayed: number;
  };
  recentResults: GameResult[];
  raceCycles: RaceCyclePlayer[];
  logs: LogEntry[];
}
