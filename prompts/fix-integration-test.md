# Fix regression + build a self-verifying integration test for genlayer.ts

## Current state — a regression was introduced

Last change added a `fromMap()` Map→object converter and FINALIZED waits. After it:

1. **GitHub user → Create Match**: white-screen crash "Application error: a client-side exception has occurred"
2. **Guest signup**: still loops back to `/sign-in/username` after submitting a username

Both symptoms at once strongly implicate the newest shared code: `fromMap()` (touches every read) and/or the FINALIZED await (can throw unhandled). The contract itself is fine — 51/51 pytest tests pass. The bug is in `app/src/lib/genlayer.ts` and possibly the pages that consume it.

## New approach — stop using the human as the test harness

We have been verifying by having a person click through the browser and screenshot results. That is too slow. Build a Node integration test that exercises the REAL helpers from `genlayer.ts` end-to-end against the running Studio, and iterate until it passes 100% BEFORE asking for any browser test.

## Step 1 — Build the integration test

Create `app/test-integration/critical-path.mjs` (Node ESM script, runnable with `node`). It must import and call the ACTUAL exported helpers from `src/lib/genlayer.ts` — not reimplement them. If TS import from a .mjs is awkward, compile genlayer.ts with esbuild/tsx first, or write the test in TS and run with `npx tsx`. Use whatever runs cleanly; the requirement is that it calls the real functions the frontend calls.

The test must generate two fresh guest-style wallets (viem `generatePrivateKey` + the same `ActiveWallet` shape the app builds) and run the full critical path, asserting at each step:

```
PLAYER A and PLAYER B = two fresh generated wallets

1.  registerUser("itest_alice", walletA)          → assert no throw
2.  getProfile(walletA.address)                    → assert result.username === "itest_alice"   (THIS is where fromMap is verified)
3.  registerUser("itest_bob", walletB)             → assert no throw
4.  getProfile(walletB.address)                    → assert username === "itest_bob"
5.  isUsernameTaken("itest_alice")                 → assert true
6.  isUsernameTaken("totally_unused_xyz")          → assert false
7.  createPromptWarsMatch(walletA)                 → assert returns a numeric matchId, no throw
8.  getMatch(matchId)                              → assert match exists, player1 === walletA.address, target text non-empty
9.  joinPromptWarsMatch(matchId, walletB)          → assert no throw
10. getMatch(matchId)                              → assert player2 === walletB.address
11. submitPrompt(matchId, "alice's prompt", walletA) → assert no throw
12. submitPrompt(matchId, "bob's prompt", walletB)   → assert no throw
13. judgeMatch(matchId, walletA)                   → assert no throw
14. getMatch(matchId)                              → assert state === JUDGED, winner is one of the two players, judge_reasoning non-empty
15. getProfile(walletA.address)                    → assert total_matches === 1
16. getRecentMatches(10)                            → assert the match appears
17. getMatchesForPlayer(walletA.address)           → assert matchId present
```

Print a clear PASS/FAIL line for each step with the actual values. On any failure, print the full error and the RAW value returned (pre-fromMap) alongside the converted value, so we can see exactly what fromMap received vs produced.

## Step 2 — Run it and fix what breaks

Run the test. Fix `genlayer.ts` (and only what's necessary) until ALL 17 steps pass. Likely problem areas to inspect:

- **fromMap()**: does it handle nested Maps? null/undefined fields? non-Map values (numbers, strings, bigints, addresses)? empty results when a record doesn't exist? It must not throw on a missing profile — getProfile of an unregistered address should return null cleanly, NOT crash.
- **getProfile null path**: when no profile exists, the read should return null without throwing. The white-screen crash and the guest loop both point at getProfile throwing instead of returning null.
- **FINALIZED await**: make sure a thrown/rejected finalization doesn't become an unhandled rejection. Wrap appropriately and surface a real error.
- **bigint/u32/u64 fields**: total_matches etc. may come back as bigint — ensure comparisons and rendering handle that (convert to Number where safe).

Iterate: fix → re-run test → repeat until 17/17 PASS.

## Step 3 — Fix the consuming pages for the crash + loop

Once the test is green, the helpers are correct. Now make the pages robust:

- `app/src/app/sign-in/username/page.tsx`: after `registerUser` resolves, call `getProfile` once to confirm, THEN redirect to `/dashboard`. If getProfile still returns null after a successful registerUser (shouldn't happen now), show an on-page error instead of silently redirecting back. Never loop silently.
- `app/src/app/dashboard/page.tsx` and the prompt-wars pages: guard against a null/undefined profile or match — render a graceful empty/loading state, never crash. The "client-side exception" means a page tried to read a property off null. Find every `.username` / `.player1` / etc. access on a read result and ensure the value is checked first.
- Wrap the prompt-wars match page render in defensive checks so a not-yet-finalized or missing match shows "Loading…" then "Match not found" only after a real confirmed null — not a crash.

## Step 4 — Verify

1. `node app/test-integration/critical-path.mjs` (or the tsx equivalent) → 17/17 PASS
2. Restart dev server clean (`taskkill /F /IM node.exe`, then `cd app; npm run dev`, port 3000)
3. Browser, hard refresh:
   - Guest signup → username `browser_test_1` → Continue → lands on dashboard showing the name (NO loop)
   - Dashboard refresh → name persists
   - Create Match → match page with target (NO crash, NO "Match not found")
   - Full match across two windows → results screen with winner + reasoning
4. Report the integration test output (all 17 lines) AND the browser result.

## Constraints

- Keep the three client workarounds (fillTransaction/estimateGas/consensus init) and the FINALIZED waits.
- Don't touch contracts.
- Don't upgrade packages.
- The integration test is a permanent asset — keep it in `app/test-integration/` and mention it in the README so we can re-run it after every future change.

## Commit

`fix(genlayer): robust Map decoding + null-safe reads + integration test for full critical path`

## If a contract-level problem is found

If the integration test reveals the WRITE genuinely doesn't persist (e.g. step 2 fails even with correct fromMap, because the on-chain value truly isn't there), STOP and report — that's a contract or deployment issue, not a frontend one, and needs different handling.
