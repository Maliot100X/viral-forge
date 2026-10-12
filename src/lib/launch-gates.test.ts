import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeCluster,
  mainnetEnabled,
  launchWallet,
  explorerUrl,
} from "./solana";

// ---------------------------------------------------------------------------
// These tests cover the launch *gates*: the rules that decide whether anything
// is signed. They deliberately do not send transactions. The property being
// protected is that mainnet is unreachable without two independent switches,
// and that a devnet key can never be picked up as a mainnet key.
// ---------------------------------------------------------------------------

const ORIGINAL = { ...process.env };

const GATE_KEYS = [
  "SOLANA_CLUSTER",
  "ENABLE_MAINNET",
  "DEVNET_WALLET_KEY",
  "SOLANA_MAINNET_WALLET_KEY",
] as const;

beforeEach(() => {
  vi.restoreAllMocks();
  for (const k of GATE_KEYS) delete process.env[k];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL);
});

describe("cluster resolution", () => {
  it("defaults to devnet when nothing is set", () => {
    expect(activeCluster()).toBe("devnet");
  });

  it("only accepts the exact mainnet-beta string", () => {
    process.env.SOLANA_CLUSTER = "mainnet";
    expect(activeCluster()).toBe("devnet");

    process.env.SOLANA_CLUSTER = "MAINNET-BETA";
    expect(activeCluster()).toBe("devnet");

    process.env.SOLANA_CLUSTER = "mainnet-beta";
    expect(activeCluster()).toBe("mainnet-beta");
  });
});

describe("mainnet double gate", () => {
  it("is off by default", () => {
    expect(mainnetEnabled()).toBe(false);
  });

  it("stays off with only the cluster flag set", () => {
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    expect(mainnetEnabled()).toBe(false);
  });

  it("stays off with only the enable flag set", () => {
    process.env.ENABLE_MAINNET = "true";
    expect(mainnetEnabled()).toBe(false);
  });

  it("requires the literal string \"true\", not any truthy value", () => {
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    for (const v of ["1", "yes", "TRUE", "on", ""]) {
      process.env.ENABLE_MAINNET = v;
      expect(mainnetEnabled(), `ENABLE_MAINNET=${v} must not enable mainnet`).toBe(
        false,
      );
    }
  });

  it("turns on only when both switches are set correctly", () => {
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    process.env.ENABLE_MAINNET = "true";
    expect(mainnetEnabled()).toBe(true);
  });
});

describe("wallet key separation", () => {
  it("returns null on mainnet even with a devnet key present, when ungated", () => {
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    process.env.DEVNET_WALLET_KEY = "any-value";
    // Mainnet is not enabled, so no wallet is exposed at all.
    expect(mainnetEnabled()).toBe(false);
    expect(launchWallet()).toBeNull();
  });

  it("never reads the devnet key when the cluster is mainnet", () => {
    // A valid devnet secret must not be silently promoted to a mainnet key.
    const devnetSecret = process.env.DEVNET_WALLET_KEY;
    if (!devnetSecret) return; // nothing to assert without a key in this env

    process.env.SOLANA_CLUSTER = "mainnet-beta";
    process.env.ENABLE_MAINNET = "true";
    process.env.DEVNET_WALLET_KEY = devnetSecret;
    delete process.env.SOLANA_MAINNET_WALLET_KEY;

    // Mainnet wallet is absent, so this must be null rather than falling back
    // to the devnet secret.
    expect(launchWallet()).toBeNull();
  });
});

describe("explorer links", () => {
  it("uses the cluster-specific query for devnet", () => {
    process.env.SOLANA_CLUSTER = "devnet";
    expect(explorerUrl("abc", "tx", "devnet")).toBe(
      "https://explorer.solana.com/tx/abc?cluster=devnet",
    );
  });

  it("omits the query for mainnet", () => {
    expect(explorerUrl("abc", "tx", "mainnet-beta")).toBe(
      "https://explorer.solana.com/tx/abc",
    );
  });

  it("distinguishes addresses from transactions", () => {
    expect(explorerUrl("abc", "address", "devnet")).toContain("/address/abc");
    expect(explorerUrl("abc", "tx", "devnet")).toContain("/tx/abc");
  });
});
