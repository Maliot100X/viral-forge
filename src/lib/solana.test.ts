import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
  activeCluster,
  explorerUrl,
  launchWallet,
  mainnetEnabled,
  walletAddress,
} from "./solana";

const ORIGINAL = { ...process.env };

// A throwaway keypair generated per test run. Never a real wallet.
const TEST_KEY = bs58.encode(Keypair.generate().secretKey);

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL);
  delete process.env.SOLANA_CLUSTER;
  delete process.env.ENABLE_MAINNET;
  delete process.env.DEVNET_WALLET_KEY;
  delete process.env.SOLANA_MAINNET_WALLET_KEY;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL);
});

describe("activeCluster", () => {
  it("defaults to devnet when unset", () => {
    expect(activeCluster()).toBe("devnet");
  });

  it("defaults to devnet for an unknown value", () => {
    process.env.SOLANA_CLUSTER = "testnet";
    expect(activeCluster()).toBe("devnet");
  });

  it("recognises mainnet-beta", () => {
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    expect(activeCluster()).toBe("mainnet-beta");
  });
});

describe("mainnetEnabled — the double gate", () => {
  it("is false by default", () => {
    expect(mainnetEnabled()).toBe(false);
  });

  it("stays false with only the cluster set", () => {
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    expect(mainnetEnabled()).toBe(false);
  });

  it("stays false with only the explicit flag set", () => {
    process.env.ENABLE_MAINNET = "true";
    expect(mainnetEnabled()).toBe(false);
  });

  it("is true only when both switches are set", () => {
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    process.env.ENABLE_MAINNET = "true";
    expect(mainnetEnabled()).toBe(true);
  });

  it("requires the literal string 'true', not any truthy value", () => {
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    process.env.ENABLE_MAINNET = "1";
    expect(mainnetEnabled()).toBe(false);
  });
});

describe("launchWallet", () => {
  it("returns null when no key is configured", () => {
    expect(launchWallet()).toBeNull();
  });

  it("loads a valid devnet key", () => {
    process.env.DEVNET_WALLET_KEY = TEST_KEY;
    const kp = launchWallet();
    expect(kp).not.toBeNull();
    expect(kp!.publicKey.toBase58()).toBe(
      Keypair.fromSecretKey(bs58.decode(TEST_KEY)).publicKey.toBase58(),
    );
  });

  it("rejects a malformed key rather than throwing", () => {
    process.env.DEVNET_WALLET_KEY = "not-a-key";
    expect(launchWallet()).toBeNull();
  });

  it("rejects a wrong-length key", () => {
    process.env.DEVNET_WALLET_KEY = bs58.encode(new Uint8Array(32));
    expect(launchWallet()).toBeNull();
  });

  it("will NOT use a devnet key on mainnet", () => {
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    process.env.ENABLE_MAINNET = "true";
    process.env.DEVNET_WALLET_KEY = TEST_KEY;
    expect(launchWallet()).toBeNull();
  });

  it("refuses any wallet on mainnet while mainnet is disabled", () => {
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    process.env.SOLANA_MAINNET_WALLET_KEY = TEST_KEY;
    expect(launchWallet()).toBeNull();
  });

  it("uses the mainnet key once both switches are on", () => {
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    process.env.ENABLE_MAINNET = "true";
    process.env.SOLANA_MAINNET_WALLET_KEY = TEST_KEY;
    expect(launchWallet()).not.toBeNull();
  });

  it("exposes the address, or null when unconfigured", () => {
    expect(walletAddress()).toBeNull();
    process.env.DEVNET_WALLET_KEY = TEST_KEY;
    expect(walletAddress()).toBe(
      Keypair.fromSecretKey(bs58.decode(TEST_KEY)).publicKey.toBase58(),
    );
  });
});

describe("explorerUrl", () => {
  it("uses the cluster query param on devnet", () => {
    const u = explorerUrl("sig123", "tx", "devnet");
    expect(u).toBe("https://explorer.solana.com/tx/sig123?cluster=devnet");
  });

  it("omits the query param on mainnet", () => {
    const u = explorerUrl("sig123", "tx", "mainnet-beta");
    expect(u).toBe("https://explorer.solana.com/tx/sig123");
  });

  it("supports address links", () => {
    const u = explorerUrl("addr1", "address", "devnet");
    expect(u).toBe("https://explorer.solana.com/address/addr1?cluster=devnet");
  });
});
