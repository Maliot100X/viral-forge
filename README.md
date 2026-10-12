# VIRAL.forge

Anything viral becomes a coin. A prompt, an X post, a hashtag, an image, a TikTok
or a trending topic goes in; an AI-forged name, ticker, lore and pixel logo come
out, ready to launch on Solana.

This is an independent reimplementation of the interaction model and information
architecture of [launcher.wtf](https://www.launcher.wtf/) — built from scratch,
with its own design system, copy and code. It is not affiliated with, endorsed
by, or derived from launcher.wtf's source.

## Stack

- **Next.js 16.4** (App Router, Turbopack, Cache Components) and **React 19.3**
- **TypeScript** end to end
- **Tailwind CSS 4** driven by a custom design-token layer in `src/app/globals.css`
- **zod** for request validation on every mutating API route
- **Vitest** for unit tests

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Hero, forge composer, live counts, recent launches, radar panel |
| `/coins` | Launch history with `all` / `live` / `simulated` / `radar` / `manual` filters |
| `/coin/<mint>` | Coin detail: logo, lore, tags, mint, share, market/trade state |
| `/coin/<mint>/opengraph-image` | Per-coin share card (SVG) |
| `/radar` | Autonomous trend radar: status, budget, source toggles, log |
| `/tokenomics` | Revenue split, the fees→treasury→buyback→burn loop |

### API

| Endpoint | Methods |
| --- | --- |
| `/api/generate` | `POST` — forge a draft (name, symbol, lore, tags, image prompt) |
| `/api/image` | `POST` — resolve a logo for a draft |
| `/api/ipfs` | `POST` — pseudo-CID metadata pointer |
| `/api/launch` | `POST` — record a launch |
| `/api/coins` | `GET`, `POST` |
| `/api/trends` | `GET` (cached), `POST` (fresh scan) |
| `/api/radar` | `GET`, `POST` (settings / start / stop / tick / recover) |
| `/api/logo/<mint>.webp` | `GET` — deterministic pixel logo |

## Launch modes

Every coin carries a `mode`. This build only ever produces **`simulated`**:

- No wallet connection, keypair, signing path or on-chain transaction exists
  anywhere in this codebase.
- `/api/launch` hardcodes `mode: "simulated"`; a client cannot request `live`.
- The radar reports `liveCapable: false` and `/api/radar` clamps `buySol` to `0`
  regardless of what a caller sends.
- Nothing in this project can move funds.

The trend radar scans Google Trends, Bluesky, Mastodon and Reddit, scores what it
finds, and forges coins from the winners — it does not trade.

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # vitest run
```

## Persistence

State lives in a JSON file at `.data/db.json`, overridable with
`VIRAL_FORGE_DATA_DIR`.

This is deliberate rather than SQLite: the app targets Vercel's serverless
runtime, whose filesystem is read-only and ephemeral, so a native database
binding would fail at build and at runtime. The store degrades safely — if the
filesystem is not writable it serves entirely from memory and the app stays
functional; records simply do not survive a cold start. For durable storage,
swap `src/lib/store.ts` for a hosted database.

## Environment

No environment variables are required to run or build. `VIRAL_FORGE_DATA_DIR` is
the only supported override.

## Credits

Interaction model and information architecture studied from
[launcher.wtf](https://www.launcher.wtf/). All code, copy and visual assets in
this repository are original.
