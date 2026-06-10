# Redeploy four game contracts after emit() → direct call fix

## Context

The emit() → record_match diagnosis is complete. All four game contracts have been patched to use direct synchronous calls instead of emit()-triggered transactions. Diffs were already shown and approved:

- `contracts/title_wars.py` — 1 change in `judge_match` ranking loop
- `contracts/trivia_royale.py` — 2 changes in `resolve_round` (single-winner + 40q shared-win)
- `contracts/predictions.py` — 1 change in `resolve_market` ranking loop
- `contracts/prompt_wars.py` — 3 changes (2-player early-exit + full ranking loop)

`user_registry.py` was NOT modified and is NOT being redeployed.

## Critical constraints

1. **DO NOT redeploy `user_registry.py`.** Its current address is `0x66B41A5866F8AD6704F00bCd8c8A668D99564032` and must remain unchanged. The four game contracts hold references to this address. If UserRegistry is redeployed, every existing username registration is orphaned and the game contracts will no longer find users in the registry.

2. **Only four contracts are being redeployed:** `prompt_wars.py`, `predictions.py`, `trivia_royale.py`, `title_wars.py`.

3. **Sequential deploys only.** Do not deploy in parallel. Stop after each deploy and wait for explicit go-ahead from the user before moving to the next contract.

4. **Verify both address locations after each deploy:**
   - `app/.env.local` — the corresponding `NEXT_PUBLIC_*_ADDRESS` env var
   - `app/src/lib/genlayer.ts` — the hardcoded fallback constant for that contract

5. **Do not run `docker compose down -v`. Do not run `genlayer up`.** The chain is in a clean working state — leave it.

## Procedure

### Step 1 — Confirm scope

Before deploying anything, confirm in writing:
- "user_registry.py is NOT being redeployed"
- "Only four game contracts will be redeployed in this order: prompt_wars, predictions, trivia_royale, title_wars"
- "I will stop after each deploy and wait for explicit go-ahead before the next"

### Step 2 — Deploy PromptWars

Run: `python scripts/deploy_prompt_wars.py`

After it completes, show:
- The new contract address
- The line in `app/.env.local` showing `NEXT_PUBLIC_PROMPT_WARS_ADDRESS=<new address>`
- The line in `app/src/lib/genlayer.ts` showing `PROMPT_WARS_ADDRESS = ... ?? "<new address>"`

Both must match. Stop and wait for go-ahead.

### Step 3 — Deploy Predictions

Only after explicit go-ahead from the user. Run: `python scripts/deploy_predictions.py`

Same verification format. Stop and wait.

### Step 4 — Deploy TriviaRoyale

Only after explicit go-ahead. Run: `python scripts/deploy_trivia_royale.py`

Same verification format. Stop and wait.

### Step 5 — Deploy TitleWars

Only after explicit go-ahead. Run: `python scripts/deploy_title_wars.py`

Same verification format. Stop and wait.

### Step 6 — Final summary

Once all four deploys are confirmed clean, print a summary table:

```
Contract     | New Address                                 | env.local | genlayer.ts
PromptWars   | 0x...                                       | ✓         | ✓
Predictions  | 0x...                                       | ✓         | ✓
TriviaRoyale | 0x...                                       | ✓         | ✓
TitleWars    | 0x...                                       | ✓         | ✓
UserRegistry | 0x66B41A5866F8AD6704F00bCd8c8A668D99564032 | (unchanged) | (unchanged)
```

Then stop. Do NOT run any integration tests yet. Do NOT commit yet. Wait for the next instruction.

## What comes after this prompt (do not act on this yet)

After all four contracts are redeployed and verified:

1. Re-run `app/test-integration/test-title-wars.ts` — confirm step 14 settles in 1–3s, not 17–38s
2. Re-run `app/test-integration/test-trivia-royale.ts` — confirm no regression in the existing verified game
3. Run any existing integration tests for Predictions and PromptWars — confirm no regression
4. Four separate commits, one per contract change
5. Update `PROJECT_HANDOFF.md` with the new addresses and the emit() learning

These steps come after, and only after, all four deploys are confirmed clean.
