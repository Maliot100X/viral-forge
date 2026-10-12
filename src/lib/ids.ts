import { randomBytes } from "node:crypto";

// Base58 alphabet — Solana-style, no 0/O/I/l to keep mints copy-pasteable.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Deterministic-free mint generator. Produces a 44-char base58 string, which is
 * the format the reference site uses for both `mint` and the `/api/logo/<mint>.webp`
 * path segment. This is an identifier, not a keypair — no signing material exists
 * anywhere in this project.
 */
export function generateMint(len = 44): string {
  const buf = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += B58[buf[i] % B58.length];
  return out;
}

export function generateCoinId(): string {
  return "c_" + randomBytes(7).toString("hex");
}

export function shortMint(mint: string, head = 4, tail = 4): string {
  if (mint.length <= head + tail + 1) return mint;
  return `${mint.slice(0, head)}…${mint.slice(-tail)}`;
}

export function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
