# Phase 4 finalization: diagnose `record_match` settlement latency

## Context

Phase 4 (Title Wars) is built and committed. All 5 contracts are freshly redeployed today against a clean Studio chain:

- UserRegistry: `0x66B41A5866F8AD6704F00bCd8c8A668D99564032`
- PromptWars: `0x7e2Ade15e759ae59Cf0fe3DB631e05427Ce68d93`
- Predictions: `0xb33F9d4e691Acd4230701F4A1BfE0AC5fa583662`
- TriviaRoyale: `0xeb6c5cD9f9e8e65C26e6Ae85eaaC67dbD9c99Ee5`
- TitleWars: `0x3773f31b4Ca90dF72DC134326456791B8a1491A7`

When we ran `app/test-integration/test-title-wars.ts` against the previous TitleWars deployment, steps 1–13 passed (including full AI ranking with the expected verdict — Wallet A's thoughtful title #1, Wallet D's gibberish #4). Step 14 failed: `getUserProfile(walletA.address)` returned `total_matches: 0` immediately after `judge_match` returned `ACCEPTED`.

The earlier diagnosis was "stats not yet visible because of async emit() timing — add a sleep." On a second read of the consensus backend (`/app/backend/consensus/base.py`), the claim is now stronger: `registry.emit().record_match(...)` does NOT execute inline. It queues 4 separate triggered transactions that each independently flow through the consensus pipeline (validator voting, leader selection, ACCEPTED). 4 emits = 4 independent consensus rounds queued AFTER `judge_match` itself settles.

**We need to verify this empirically before changing any shipped contracts.** Trivia Royale uses the same `emit()` pattern in `resolve_round`. If the diagnosis is correct, both contracts have a UX-affecting issue, not just a test issue.

## What this prompt does

Measures the real settlement latency for the 4 `record_match` emits triggered by `judge_match`. Reports wall-clock data and the raw transaction queue. Does NOT modify any contracts. Does NOT modify the integration test except to extend the polling window.

## Constraints

- DO NOT modify any contract code (`contracts/*.py`).
- DO NOT alter the existing 13 integration-test steps. Only extend step 14's polling.
- DO NOT run `docker compose down -v`. Do not run `genlayer up` either — the chain is clean, the contracts are deployed, leave it.
- DO NOT propose fixes in this prompt's run. Measurement only.
- All addresses, env vars, and `genlayer.ts` fallbacks are already in sync from today's redeploy — do not re-deploy.

## Procedure

### Step 1 — Extend step 14 polling in the integration test

In `app/test-integration/test-title-wars.ts`, modify ONLY step 14 to do the following for each of the 4 wallets (A, B, C, D), in parallel where possible (each wallet polled independently):

- Record `t0` = wall-clock time when `judge_match` returned ACCEPTED (this is the moment step 8's `pollUntil` resolves; capture it before step 14 begins).
- For each wallet, poll `getUserProfile(wallet.address)` once per second, for up to 300 seconds (5 minutes).
- On each poll, log: `[wallet X] attempt N at +Ts: total_matches=M`.
- The moment `total_matches >= 1` for a wallet, capture `t_settle[wallet]` = seconds since `t0`, and stop polling that wallet.
- After all 4 wallets settle (or after the 300s budget exhausts for any wallet), print a final table:
  ```
  Wallet | settled at (s) | total_matches | total_wins
  A      | xx.x           | 1             | 1 (or 0)
  B      | xx.x           | 1             | 0
  C      | xx.x           | 1             | 0
  D      | xx.x           | 1             | 0
  ```
- Step 14 passes if all 4 wallets reach `total_matches >= 1` within the 300s budget. Fail otherwise, but still print the table with whatever was observed.

Do NOT replace `judge_match` calls, `pollUntil`, or anything in steps 1–13. Only step 14 changes.

### Step 2 — Show the diff before running

Display the diff of `app/test-integration/test-title-wars.ts` before executing. Do not run the test until I confirm the diff looks right.

### Step 3 — Run the test

After I confirm the diff: run `npx tsx test-integration/test-title-wars.ts` from `app/`. Show me the full output, including:

- All 13 prior steps' PASS/FAIL
- The per-attempt poll log for step 14 (it will be long — that's fine; truncate the middle if needed but keep the first 5 and last 10 lines per wallet)
- The final latency table
- The AI ranking output again (sanity check it's stable across re-runs)

### Step 4 — Dump the transaction queue

Immediately after the test finishes (do this even if step 14 failed), run:

```
docker exec genlayer-postgres-1 psql -U postgres -d genlayer_state -c "SELECT hash, status, type, leader_only, created_at FROM transactions ORDER BY created_at DESC LIMIT 30;"
```

Show me the full output. I want to see:
- Whether `record_match` calls appear as their own rows in the transactions table
- Their status (`FINALIZED`, `ACCEPTED`, `ACTIVATED`, etc.)
- The time gap between `judge_match`'s row and the `record_match` rows
- Whether they're marked as triggered / internal transactions or treated like regular calls

If the `type` or `leader_only` columns don't exist, drop them from the SELECT and re-run; show me what columns the `transactions` table actually has.

### Step 5 — Report

Summarize:
1. Wall-clock latency for each of the 4 wallets (from the table)
2. Whether all 4 settled within the 300s budget
3. What the transaction dump revealed about how `record_match` is queued
4. **Do NOT recommend a fix.** Just present the data. I will decide between Option A (contract change to direct call) and Option B (test-side retry with appropriate budget) based on what the numbers show.

## What we're going to do with the data

- **All 4 settle within ~10 seconds:** test budget was too tight; retry loop with a 30s budget fixes it. No contract change. Optimistic UI in Phase 5 will mask the residual delay in the live app.
- **Some take 30–120 seconds:** `emit()` is genuinely slow. We change to direct synchronous calls in both `title_wars.py` and `trivia_royale.py`, redeploy both, retest. Optimistic UI in Phase 5 becomes more important.
- **Any wallet exceeds 300 seconds or never settles:** the diagnosis is incomplete; there's something else going on. We stop and re-read the consensus code together.

Run the procedure. Report data only.
