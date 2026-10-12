// Domain types. Field names mirror the reference site's public API exactly
// (/api/coins, /api/trends, /api/radar) so the shapes are drop-in compatible.

export type LaunchMode = "live" | "simulated";

export type ForgeSource =
  | "prompt"
  | "x"
  | "hashtag"
  | "image"
  | "tiktok"
  | "trend";

export type LogoStyle =
  | "auto"
  | "meme"
  | "cartoon"
  | "3d"
  | "realistic"
  | "anime";

export interface Coin {
  id: string;
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  imagePrompt: string;
  imageStyle: Exclude<LogoStyle, "auto">;
  tags: string[];
  vibe: string;
  source: ForgeSource;
  sourceRef: string;
  mint: string;
  createdAt: string;
  mode: LaunchMode;
  launchedBy: "user" | "radar";
  pumpUrl: string;
  txSignature?: string;
}

export interface Trend {
  id: string;
  source: "google" | "bluesky" | "mastodon" | "reddit";
  title: string;
  score: number;
  startedAt: string;
  url: string;
  context: string;
  firstSeenAt: string;
  isNew: boolean;
}

export interface RadarSources {
  google: boolean;
  bluesky: boolean;
  mastodon: boolean;
  reddit: boolean;
}

export interface RadarSettings {
  enabled: boolean;
  intervalSec: number;
  maxPerTick: number;
  buySol: number;
  minScore: number;
  dailyBudgetSol: number;
  sources: RadarSources;
}

export interface RadarLogEntry {
  at: string;
  message: string;
}

export interface RadarState {
  settings: RadarSettings;
  running: boolean;
  liveCapable: boolean;
  seen: string[];
  ticks: number;
  budget: {
    spentSol: number;
    launchesToday: number;
    resetsAt: string;
  };
  log: RadarLogEntry[];
  recentTitles: string[];
  adminRequired: boolean;
}

export interface GenerateRequest {
  source: ForgeSource;
  input: string;
  style: LogoStyle;
}

export interface GenerateResult {
  name: string;
  symbol: string;
  description: string;
  tags: string[];
  vibe: string;
  imagePrompt: string;
  imageStyle: Exclude<LogoStyle, "auto">;
}

export interface LaunchRequest {
  generate: GenerateResult;
  source: ForgeSource;
  sourceRef: string;
  mint: string;
}
