# Phase 2 cleanup: test timing fix + live-data advisory

Phase 2 verification was successful — 18/19 tests passed, both AI reasoning blocks resolved correctly:
- Bitcoin 21M supply numeric market resolved cleanly
- NYSE holiday calendar binary market resolved cleanly
- "Purple moon" nonsense market correctly rejected by the verifiability AI

Two small cleanups before moving to Phase 3.

---

## Fix 1 — getProfile.total_matches state lag (the 1/19 failing test)

The cross-contract `record_match` call from `predictions.py` to `user_registry.py` finalizes after the test's 30-second poll exits. The contract is working correctly — the test is just checking too early.

Pick whichever fix is cleaner:

**Option A**: Extend the poll window in `test/test_predictions.py` (or wherever the test lives) to 90 seconds with progressive backoff (poll every 3s).

**Option B**: After calling `resolve_market`, add an explicit `waitForTransactionReceipt` with status `FINALIZED` on that transaction before checking user_registry stats. This is more deterministic than polling.

Lean toward Option B if the test infrastructure supports it cleanly.

After the fix: re-run the full Phase 2 integration test (`test-predictions.ts`) and confirm 19/19 pass.

---

## Fix 2 — Live-data advisory on the create-market form

On the lobby page (`app/src/app/predictions/page.tsx`), in the Create New Market form:

**When** `market_type === NUMERIC` AND the question text (case-insensitive) contains any of these keywords:
- `price`, `rate`, `currency`, `exchange`, `now`, `today`, `current`, `live`, `spot`, `index`, `value of`

**Show** a small yellow/amber notice below the question input (not a blocking modal, just inline guidance):

> ⚠️ **Heads up — live data warning**
>
> Frequently-changing values (like spot prices or current rates) may fail to resolve on local Studio because each simulated validator must independently fetch live data and reach consensus. Network hiccups can cause a `MAJORITY_DISAGREE` failure.
>
> **More reliable** numeric questions reference stable values:
> - Totals or supply caps (e.g. "What is the maximum supply of Bitcoin")
> - Historical facts (e.g. "What was the closing S&P 500 on January 2, 2025")
> - Fixed protocol parameters
>
> This limitation does not apply on GenLayer mainnet, where many distributed validators reach consensus reliably.

The notice is purely advisory — do NOT block submission. Users can still create live-data markets if they want.

---

## Constraints

- Don't break Phases 0/1/2 tests — all should still pass after Fix 1
- Don't touch contracts (Fix 1 is a test-side change, Fix 2 is a frontend change)
- Don't change the predictions contract address
- Single commit covering both fixes: `chore(predictions): test timing fix + live-data advisory on creation`

---

## After commit

Print:
- Pytest count (should be 127/127 or whatever the new total is, all green)
- Confirmation the advisory notice appears for live-data questions and is hidden for stable questions
- Ready-for-Phase-3 statement

Then stop and wait for the Phase 3 (Trivia Royale) brief.
