# Fix: Stuck match resolution + forfeit-by-timeout + dev timer skip

## Context — current state

Match #4 on the `prompt_wars` contract is stuck in state `ONE_SUBMITTED`:
- Player 1 (the human tester) submitted a prompt before the 5-minute deadline
- Player 2 never submitted before the deadline expired
- Timer shows "Time's up"
- No UI path forward; no Judge button is shown anywhere

The contract addresses, RPC plumbing, wallet flow, and join-match sync between two browser windows are all proven working from this match. The blocker is now: the contract assumes both players submit before judging, and the frontend has no recovery state for a one-sided submission.

This prompt has two parts. **Part 1 must finish before Part 2 starts** — Part 1 also serves as the final proof that the Anthropic-Haiku validator judging actually works end-to-end on a real match (the only piece we haven't seen run in the browser yet).

---

## Part 1 — Diagnostic: prove AI judging works end-to-end

Write a one-off script `app/test-integration/judge-real-match.ts` that runs against the live local Studio and produces a fully-judged match with AI reasoning printed to terminal.

Logic:

1. Check the on-chain state of match #4 via `getMatch(4)`. Print the state and players.
2. Decide which path to take:
   - **Path A** — if match #4 state is `ONE_SUBMITTED` AND Player 2 slot is filled AND the contract still accepts late submission for Player 2: load Player 2's wallet (you'll need to know its private key — if it was a guest from incognito the key is gone, so this path probably fails; that's fine, fall through to Path B). Submit a prompt as Player 2, then call `judgeMatch(4)`.
   - **Path B** (most likely the working path) — create a fresh match #5 entirely via script:
     1. Generate two fresh viem private keys → wallets A and B
     2. Register both with the user_registry (`register_user("judge_test_a", walletA)` and `register_user("judge_test_b", walletB)`)
     3. As walletA, call `createPromptWarsMatch(walletA)` → get matchId (likely 5)
     4. As walletB, call `joinPromptWarsMatch(matchId, walletB)`
     5. As walletA, call `submitPrompt(matchId, "...prompt A...", walletA)` — write a real prompt that attempts the target
     6. As walletB, call `submitPrompt(matchId, "...prompt B...", walletB)` — write a different real prompt
     7. As walletA, call `judgeMatch(matchId, walletA)` — this triggers Anthropic Haiku via the validators
     8. After judgement, call `getMatch(matchId)` and pretty-print: target, both prompts, both LLM outputs, winner, AI reasoning text

3. Print the AI reasoning text in a clearly-marked block (`=== AI REASONING ===` ... `=== END ===`) so it's easy to read in the terminal.

This script is permanent — keep it next to the existing `critical-path.ts` and mention it in the README as the "prove AI judging" smoke test.

Run it, paste the full terminal output (especially the AI reasoning block) into the response.

If `judgeMatch` fails or hangs, STOP and report the error before proceeding to Part 2.

---

## Part 2 — Frontend: handle deadline edge cases + dev timer skip

Once Part 1 confirms judging works, fix the UI so a human can complete matches in the browser without losing to the timer.

### 2a. Check contract behavior for partial submissions

Read `contracts/prompt_wars.py`. For `judge_match(match_id)`:

- If the function reverts when state is not `BOTH_SUBMITTED`: modify it to also accept `ONE_SUBMITTED` AND deadline-passed as a forfeit case. The submitting player wins by forfeit; the non-submitter loses. Update stats accordingly via `user_registry.record_match` for both.
- If both players failed to submit before deadline: state `BOTH_JOINED` AND deadline-passed → no winner, both get a "no contest" (don't record either as a win or loss; or record both as losses — pick one; document the choice).
- Add a new public method `cancel_match(match_id)` callable only by Player 1, only when state is `WAITING_FOR_P2` AND deadline-passed. Sets state to `CANCELLED`. No stats recorded.

If contract changes are required:
1. Add corresponding pytest cases in `test/test_prompt_wars.py`
2. All existing tests must still pass
3. Redeploy `prompt_wars.py` to local Studio
4. Update the new contract address in BOTH `app/src/lib/genlayer.ts` (hardcoded) AND `app/.env.local` (NEXT_PUBLIC_PROMPT_WARS_ADDRESS)
5. Restart dev server so the change is live

### 2b. Update match page UI (`app/src/app/prompt-wars/[matchId]/page.tsx`)

Add state handling:

- **`WAITING_FOR_P2` + deadline NOT passed**: existing behavior (show join link to share)
- **`WAITING_FOR_P2` + deadline passed**: show "No opponent joined" + a **"Cancel match"** button (calls `cancel_match`) for Player 1 only. Non-players see "Match expired."
- **`BOTH_JOINED` or `ONE_SUBMITTED` + deadline NOT passed**: existing prompt-submission UI
- **`ONE_SUBMITTED` + deadline passed**: if caller is the submitter, show "Opponent didn't submit in time" + **"Claim win by forfeit"** button (calls `judge_match` — contract will award them the win). If caller is the non-submitter, show "You missed the deadline. Opponent can claim forfeit." with no button.
- **`BOTH_JOINED` + deadline passed (neither submitted)**: show "Match expired without submissions" + **"Mark no-contest"** button (calls `judge_match` — contract handles the no-contest path).
- **`BOTH_SUBMITTED`**: existing "Judge now" button (anyone can click)
- **`JUDGED`**: existing results view
- **`CANCELLED`**: show "Match cancelled" + back-to-lobby link

### 2c. Dev-only timer skip

In the same match page, when `process.env.NODE_ENV === 'development'`:

- Show a small "DEV: Skip to judging" button next to the timer
- When clicked, calls a new helper `devForceJudge(matchId, wallet)` in `genlayer.ts` that submits empty/placeholder prompts for any player who hasn't submitted, then calls `judge_match`. ONLY active in dev. Hide entirely in production builds.
- This lets a single human test full flows without racing the 5-minute clock.

Put the button somewhere obviously different from the real game UI (different color, small text, clearly marked "DEV").

---

## Verification

1. Part 1 script prints AI reasoning for a fully-judged match. Save the output to the response.
2. After Part 2:
   - `pytest test/test_prompt_wars.py` all green (including new test cases)
   - Restart dev server, hard-refresh browser
   - **Manual test in two browser windows**:
     a. @GIFTEDLOV creates match #6 → wait the full deadline without submitting → page should now show "Cancel match" → click it → state goes to CANCELLED
     b. Create match #7 → only @GIFTEDLOV submits → wait deadline → page should show "Claim win by forfeit" → click → state goes to JUDGED with @GIFTEDLOV winning, opponent_guest with a loss recorded
     c. Create match #8 → both submit before deadline → click "Judge now" → results screen with AI reasoning
     d. Create match #9 → click the DEV "Skip to judging" button → match resolves with placeholder prompts judged by AI
   - Dashboard counts update correctly across all four matches

## Constraints

- Don't break the three viem-Studio workarounds in `clientFromWallet`
- Don't break the `fromMap` decoder
- Don't change auth or wallet code
- Don't touch other game placeholders
- DEV button must be invisible in production builds — verify with a quick `NEXT_PUBLIC_NODE_ENV` or `process.env.NODE_ENV !== 'production'` guard

## Commit

Two separate commits:
- `feat(prompt-wars): add judge-real-match.ts script that proves end-to-end AI judging`
- `feat(prompt-wars): forfeit-by-timeout, match cancellation, no-contest, and dev skip-timer button`

## Report back with

1. AI reasoning block from Part 1 script
2. New contract address if redeployed
3. Pytest output
4. Confirmation of manual test results for matches #6, #7, #8, #9
