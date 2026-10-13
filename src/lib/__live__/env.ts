// Environment loading for live probes.
//
// This exists as its own module for a reason. `src/lib/db.ts` reads
// `DATABASE_URL` ONCE, at module evaluation time, into a module-level constant.
// ESM hoists every static `import` above the importing module's body, so a
// probe that calls a `loadEnv()` helper and then statically imports `./store`
// gets `db.ts` evaluated BEFORE the env is set. `durable()` is then false, the
// store silently falls back to per-process memory, and a probe reports "0
// coins" as though the database were empty.
//
// Importing this module first — and only dynamic-importing the database-backed
// modules afterwards — is what makes that ordering explicit.
//
// A static `import "./env"` at the top of a probe is enough: this module's own
// top-level side effect runs before any later-imported module's body.

import { readFileSync } from "node:fs";

const ENV_PATH = process.env.PROBE_ENV_PATH ?? "/home/coder/.env";

function load(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // No env file is a valid state: real deployments inject env vars directly.
    return;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

load(ENV_PATH);

if (!process.env.DATABASE_URL && !process.env.PROBE_QUIET) {
  console.warn(
    `[probe-env] DATABASE_URL is not set after loading ${ENV_PATH}; the store will ` +
      `fall back to per-process memory and reads will look empty.`,
  );
}
