// Domain types. Field names mirror the reference site's public API exactly
// (/api/coins, /api/trends, /api/radar) so the shapes are drop-in compatible.

export type LaunchMode = "live" | "simulated";

/**
 * Which engine actually produced a coin's branding. Surfaced in the UI so a
 * template-generated coin is never presented as AI-generated.
 */
export type Provenance = "river" | "local";

/**
 * Where a coin's artwork came from.
 *   - `pollinations` — a real generated image (flux.1-schnell).
 *   - `procedural`  — the deterministic 16x16 pixel sprite fallback.
 */
export type ImageProvenance = "pollinations" | "procedural";

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
  /** Real Solana devnet/mainnet explorer link for `txSignature`. */
  explorerUrl?: string;
  /** Cluster the transaction was sent to. */
  cluster?: SolanaCluster;
  /** Which engine branded the coin. */
  provenance?: Provenance;
  /** Where the artwork came from. */
  imageProvenance?: ImageProvenance;
  /**
   * The address of this coin's bonding-curve account. Absent for records made
   * before curves existed, which is what makes them untradeable.
   */
  curveAddress?: string;
  /** SOL committed at launch, which is the curve's opening reserve. */
  initialBuySol?: number;
  /** Mint authority, read back from chain after the mint landed. */
  mintAuthority?: string;
  /** Token program that owns the mint (classic Token or Token-2022). */
  tokenProgram?: string;
}

/** Solana clusters this app can target. */
export type SolanaCluster = "devnet" | "mainnet-beta";

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
  /** Which engine produced this result. */
  provenance: Provenance;
}

export interface LaunchRequest {
  generate: GenerateResult;
  source: ForgeSource;
  sourceRef: string;
  mint: string;
}
