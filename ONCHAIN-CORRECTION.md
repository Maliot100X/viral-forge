# CORRECTION — the "proven" buy/sell was NOT real token trading

Written after catching my own false success. This is the most important note in
the repo for anyone continuing this work.

## What I claimed

I ran `src/lib/__live__/curve-roundtrip.ts` on devnet and reported:

```
MINT: 81pW4Z4FVn7rFXFHXuksRXGypReo8jJqYLHkYerMfTvqf
BUY SIG: ...besbK3F...  reserve 1.0 -> 1.2 SOL
SELL SIG: ...3QEbeTA...  reserve 1.2 -> 1.199959846 SOL
ROUNDTRIP_OK
```

and told the user buy and sell were proven working.

## What was actually true then

The four transactions are real and landed with `err=null` (verified
independently via `getTransaction`). But **no tokens were ever transferred.**

Verified by reading the mint and its holders:

```
MINT parsed: decimals=6, supply=1000000000000000, mintAuthority=null
largest token accounts:
  25psrSDbD6Ui97jBB3zQq4aDD67dWUYEuFYB5kEWDNKt
    amount=1000000000000000   owner=WqGWzwaVNUiAHaNCpUHzDc77fpf92PNGwrHZH3ho92M
wallet token-2022 accounts: 0
```

Three separate facts broke the claim:

1. **The whole supply was in one account owned by `WqGWzwaV...`**, the creation
   service's own account. Not our launch wallet, not the curve.
2. **Our wallet held zero tokens**, and would hold zero after a "buy".
3. **`mintAuthority` was null.** The supply was fixed at creation, so the curve
   could never mint tokens out as buyers arrived.

`buyToken` sent SOL into a curve account and returned a `quoteBuy()` number. The
SOL moved; the tokens did not. That is precisely the fake buy/sell the user had
been complaining about.

Two further bugs found at the same time:

- `decimals` was **6**, not the **9** `curve.ts` hardcoded, so every token amount
  was off by 1000x.
- The probe **could not fail**: it never called `getTokenAccountBalance` at any
  point and asserted `ROUNDTRIP_OK` after two successful SOL transfers. A test
  that cannot fail proves nothing.

## What changed

1. **We create the mint ourselves** (`onchain.ts` → `createCoin`), with the
   launch wallet as mint authority, in a single transaction that allocates the
   mint, initialises it, opens the creator ATA, opens the curve ATA, mints
   `RESERVED_SUPPLY` (20%) to the creator and `CURVE_SUPPLY` (80%) to the curve,
   then revokes the mint authority. Partial failure cannot leave a mint with no
   tokens behind it.
2. **`createCoin` reads the mint back** and refuses to report success unless the
   curve's token account really holds `CURVE_SUPPLY`.
3. **`buyToken` refuses to report a buy** when the buyer's token balance is still
   zero after confirmation. It also checks the curve holds enough tokens before
   taking any SOL.
4. **`sellToken` checks the trader really holds the tokens**, moves them back into
   the curve, caps the payout at the curve's spendable balance (rent floor
   respected), and requires the curve account to co-sign its own payout.
5. **Both sides move in the same transaction.** A one-sided transfer is no longer
   representable.

## The verified result (2026-10-13)

`npx tsx src/lib/__live__/curve-roundtrip.ts` → **`ROUNDTRIP_OK`**

```
MINT: EYqCJVBV66A5dGWgMDzPd8ysb66YkAijL84jNjcPeNxs
CREATE 3WYHLbd5JqhY…  slot 510448316  err=null
curve lamports after create: 1000000000   reserve 1.0 SOL
BUY    2T5KFDgzL3R1…  slot 510448330  err=null
buy in: 200000000 out: 4913466330554688 fee: 2000000
BUY VERIFIED: buyer gained 4913466330554688 tokens (exactly the quote)
curve token balance after buy: 795086533669445312
SELL   57cYHd1bHfZT…  slot 510448337  err=null
sell payout lamports: 40154 fee: 405
SELL VERIFIED: 1000000000000 tokens returned to the curve for 40154 lamports
```

Independently re-verified off-chain with `probe-supply.mts`, which reads holders
without going through our code:

| Token account | Owner | Amount |
|---|---|---|
| `3ujCvyo89GWTMSuKKfzkZ4aHma1p4vxTMb1DeFZbWqcY` | `BQNqMCx7…` (our curve) | 795087533.669445312 |
| `6tXkxCfYy49eL887ZtMKhh6HTBzoqPBx8a9ni7VumaL6` | `CMhM6MXV…` (our wallet) | 204912466.330554688 |

Mint owner is the **classic SPL Token program**, decimals **9**, and the supply
splits 80/20 between our curve and our wallet. The buyer's post-buy balance is
204,912,466.33 — the 200M creator allocation plus exactly the 4,913,466.330554688
tokens the buy delivered.

## What must stay true

- A buy is verified by a **token balance delta**, never by a returned number. The
  trader already holds the creator allocation, so the assertion is on the delta,
  not the absolute balance.
- A sell is verified by the trader's balance falling by exactly the tokens sold
  **and** the curve's balance rising by the same amount.
- `TOKEN_DECIMALS` must match what the mint reports. It is read back, not assumed.
- `curve.ts` pure math (33 unit tests) remains sound and unaffected throughout.
