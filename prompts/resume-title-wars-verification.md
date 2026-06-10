# Resume Title Wars verification — report only, no modifications

## Settled facts — do not relitigate

I'm resuming the Gengame Arena project after a session that went sideways yesterday. Before doing anything, read these facts and confirm you understand them:

1. **Phase 4 (Title Wars) contracts are deployed and working.** The `emit()` pattern for cross-contract calls is CORRECT and is the only supported pattern on GenLayer Studio. FIXME #748 in the SDK confirms direct cross-contract calls (`registry.method()` instead of `registry.emit().method()`) are unimplemented stubs that `assert False` in the Python host. **Do not propose changing `emit()` to direct calls.**

2. The only outstanding issue is: the Title Wars integration test step 14 (assertion on `getUserProfile` `total_matches`) reads stats too quickly after `judge_match` returns. Empirical measurement from yesterday shows `record_match` cross-contract calls settle in 17-38 seconds for a 4-player match. The handoff confirms this is expected behavior, not a bug.

3. **The fix is in the test file, NOT in any contract.** Specifically: extend the polling window for the `getUserProfile` assertion to 90 seconds with 3-second retries.

4. `NonGenVMContract()` errors in consensus logs are non-fatal noise emitted by Hardhat when `ghostContracts[recipient] == false`. They are logged and ignored. Do not chase them as causes.

## Current canonical contract addresses

Chain state survived yesterday's shutdown intact — 287 FINALIZED transactions verified, all 4 GenLayer containers up and healthy:

- UserRegistry: `0x66B41A5866F8AD6704F00bCd8c8A668D99564032`
- PromptWars: `0x0dA3B9e6ecf8D2c7D715BD3373FD0dFD176E8aD4`
- Predictions: `0xfAFd4231F5F25ad0eF5397283e0fd69843315E95`
- TriviaRoyale: `0xC96E666CAc114bD6d8aE7dBd8be427E4DaA5C3D6`
- TitleWars: `0xf0936D33B8d6f6dbf9cc7A3dD871F94350093bcF`

## What to do now — REPORT ONLY, do not modify any file

Run these four checks in order and report results clearly:

1. `git status` — show me what's uncommitted (if anything)

2. `git log --oneline -10` — show me the last 10 commits, so I can verify the Phase 4 commits landed

3. `cat app/.env.local` — print contents and confirm the 5 contract addresses listed there match the 5 canonical ones above. Call out any mismatch.

4. Open `app/test-integration/test-title-wars.ts` and show me two specific sections:
   - Lines 1-30 (file header, imports, top-level setup)
   - The section that asserts on `total_matches` around step 14 — show ~20 lines of context around that assertion

## Constraints

- Do not propose fixes yet. Just report state.
- Do not modify any file.
- Do not propose contract changes. The contracts are correct.
- Do not run the integration test yet — I want to see the test code first.
- If anything in the four checks above looks wrong or surprising, flag it but do not act on it without my explicit go-ahead.

End of prompt. Begin reporting.
