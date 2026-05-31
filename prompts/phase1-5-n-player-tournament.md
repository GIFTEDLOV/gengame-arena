# Phase 1.5: N-player matches + timing fixes + progress feedback

This phase has FOUR fixes. The first three are quick. The fourth is a bigger refactor that turns Prompt Wars from 2-player into an N-player tournament where AI ranks all participants. Doing the refactor now (before Phases 2-4) saves redoing matchmaking infrastructure for Trivia Royale and Title Wars.

Order matters — do 1-3 first as one commit, then 4 as a separate commit. This way if anything goes wrong in #4, we still have the timing and feedback improvements locked in.

---

## Fix 1 — Submission deadline starts ONLY when match is full

Current bug: `create_match` sets `submission_deadline = created_at + 5min`, so the timer starts before anyone has joined. Player 1 burns clock just trying to share the link.

Required behavior:
- On `create_match`: `submission_deadline` is set to a sentinel value `u64.max` (or `0`) meaning "not started"
- Once the match reaches its player capacity (becomes "full"): `submission_deadline = block.timestamp + 300` (5 minutes from full)
- For the 2-player version this means joining the second player starts the clock. For the N-player version (Fix 4) it means joining the Nth player starts the clock.

UI consequence: Match page must show "Waiting for opponent(s) to join…" with NO timer countdown until the match is full. Only render the countdown once the deadline is a real future timestamp.

Add a pytest case proving the timer doesn't start until full.

---

## Fix 2 — DEV "Skip to judging" button hangs

Currently the DEV skip button is supposed to fast-forward through the timer and resolve the match in ~30 seconds, but it hangs until the natural deadline expires.

Likely cause: `devForceJudge` is awaiting transaction finalization on placeholder submit calls sequentially. If any of those waits use the wrong status (`FINALIZED` instead of `ACCEPTED`) or block on consensus that hasn't reached the expected state, the whole flow stalls.

Debug:
- Trace `devForceJudge` in `app/src/lib/genlayer.ts`
- Check what status each `await client.waitForTransactionReceipt(...)` uses
- If submits are sequential, parallelize them with `Promise.all`
- If state is already `BOTH_SUBMITTED` (or after Fix 4, "all submitted"), skip the placeholder submit phase entirely and go straight to `judge_match`

Verify: click DEV Skip on a brand-new match → results screen appears within 60 seconds total (most of that being the actual AI judging call).

---

## Fix 3 — Progress feedback on every contract-writing button

Right now every write-button (Create Match, Join Match, Submit Prompt, Judge Now, Claim Forfeit, Cancel, DEV Skip) just sits there during the 5-30s wait, looking frozen.

Required behavior for each button:
- **Idle**: normal label and color
- **Pending**: disabled, label changes to "Awaiting validator consensus…" with a small inline spinner
- **Success**: brief "✓ Done" before whatever post-action navigation
- **Error**: label reverts, error message appears below button in red

Don't make transactions faster — make the wait feel intentional instead of broken. The user must always know whether the system is working or stuck.

Centralize this if possible: a small `<TxButton>` wrapper component that takes a handler returning a Promise and manages these states automatically. Then replace existing buttons with it. Don't over-engineer though — if the wrapper is more complex than just patching each button, do the simpler thing.

---

## Fix 4 — Convert Prompt Wars from 2-player to N-player (up to 50)

This is the biggest change. We're turning Prompt Wars into a tournament where up to 50 players can join a single match, all submit prompts, and the AI ranks all submissions from 1st to last with reasoning.

### Contract changes (`contracts/prompt_wars.py`)

**Match struct:**
- Replace `player1: Address`, `player2: Address` with:
  ```
  players: list[Address]              # ordered by join time
  prompts: list[str]                  # prompts[i] is players[i]'s submission (empty string if not yet submitted)
  outputs: list[str]                  # LLM outputs after judging (filled in by judge_match)
  ranking: list[Address]              # final ranking, ranking[0] = winner. Empty until JUDGED.
  ```
- Add `max_players: u32` field set at creation time. Default cap: 50. Minimum to start judging: 2.
- Match state stays the same enum: WAITING_FOR_PLAYERS / FULL / SUBMITTING / JUDGED / CANCELLED. Drop `BOTH_JOINED`, `ONE_SUBMITTED`, `BOTH_SUBMITTED` — they don't make sense for N. Replace with `FULL` (all slots filled, deadline started, submissions open) and `SUBMITTING` (at least one but not all submitted). Pick names that work for N players.

**create_match(max_players: u32 = 50) → u64**
- Defaults to 50 if not specified
- Reverts if `max_players < 2` or `max_players > 50`
- Initializes `players = []`, deadline as sentinel

**join_match(match_id)**
- Adds `msg.sender` to `players` if not already in it
- Reverts if match is full (`len(players) >= max_players`) or already past WAITING_FOR_PLAYERS
- If after adding, `len(players) == max_players`: state → FULL, set `submission_deadline = now + 300`

**add a new method: start_match(match_id)**
- Callable by ANY player in the match (or just creator? prefer "any player" so any participant can kick it off)
- Only callable when state is WAITING_FOR_PLAYERS AND `len(players) >= 2`
- Sets state → FULL and `submission_deadline = now + 300`
- This lets a match start before reaching max_players. Example: 30 people joined, organizer doesn't want to wait, anyone clicks "Start now"

**submit_prompt(match_id, prompt: str)**
- Same caller-must-be-player check, max 500 chars
- Update `prompts[caller_index]`
- No state transition needed — once all players have non-empty prompts, anyone can call judge_match. Simpler than tracking SUBMITTING vs ALL_SUBMITTED.

**judge_match(match_id)**
- Reverts if not all players have submitted AND deadline hasn't passed (must wait for either condition)
- If deadline passed, treat missing submissions as empty strings — those players auto-rank last
- AI judging principle (using `eq_principle_prompt_comparative` or whatever the current correct primitive is):
  - Build a prompt that asks Anthropic Haiku to: read the target, read all N prompts, simulate running each prompt through an LLM, rank all N outputs from best to worst match with the target, return a JSON list of player indices in ranked order plus a brief reasoning paragraph for the top 3 and the overall ranking decision
  - The eq_principle narrowing should be on the ranking list itself ("validators must agree on the ranking order"), not on the reasoning text (which will vary)
- Write `ranking` array (addresses in finishing order) and a `judge_reasoning` string to the match
- Update `user_registry.record_match` for each player — but the existing `record_match(player, won)` signature doesn't fit. Either:
  - Option A: Add `record_match_with_rank(player, rank, total_players)` to user_registry that the contract calls per player. UserProfile gains a `total_matches`, `total_wins` (rank 1), maybe `total_top3` fields.
  - Option B: Keep `record_match(player, won)` and just call it with `won=true` for the winner only.
  - Pick whichever is cleaner. Lean toward A so we have richer leaderboards later.

**Forfeit/cancel paths:**
- If state is WAITING_FOR_PLAYERS past some abandonment threshold (e.g. 24 hours after create) AND only 1 player ever joined: `cancel_match` available to that player, returns to CANCELLED, no stats
- If state is FULL/SUBMITTING past deadline with 0 submissions: no-contest, no stats
- If state is FULL/SUBMITTING past deadline with 1+ submissions: judge whoever submitted, missing players auto-rank last with a "no-submit penalty" recorded

### Test cases (must add to `test/test_prompt_wars.py`)

- create_match with default 50, with custom max (e.g. 4), invalid (1, 51) reverts
- join up to capacity, joining past capacity reverts
- start_match works with 2+ joined, reverts with <2
- submit_prompt only by players, idempotent updates allowed
- judge_match with all submitted: ranking has all N players
- judge_match with deadline passed and partial submissions: missing players rank at the bottom
- ranking order is deterministic for the same inputs (validator consensus test)
- record_match_with_rank correctly updates user_registry counters

All existing 43 tests must still pass after the refactor. Update old test cases that assumed 2-player.

### Frontend changes

**Match page (`app/src/app/prompt-wars/[matchId]/page.tsx`)**

Replace the 2-player UI with N-player:

- **Header**: Match #X — "12 / 50 players joined" (live count)
- **Lobby view (state = WAITING_FOR_PLAYERS)**: 
  - Share link with Copy button
  - List of joined player usernames
  - "Join match" button if viewer is not in it
  - "Start match now" button (visible to any joined player, only enabled when >=2 joined)
  - No timer
- **Submission view (state = FULL)**:
  - Timer counting down from 5 min (starts the moment Nth player joins or Start button is clicked)
  - Prompt input box (500 char limit) + Submit button if viewer hasn't submitted
  - "✓ You submitted" if viewer has submitted
  - Submitted count: "Submitted: 8 / 12 players"
  - DEV skip button (dev only)
- **Judging view (state transitioning)**:
  - "Judging in progress…" with spinner
  - Shown after Judge Now is clicked, until JUDGED state reads back
- **Results view (state = JUDGED)**:
  - Leaderboard table: rank | username | submitted prompt | (optionally) simulated output
  - AI reasoning paragraph at the top
  - Winner highlighted
  - "Back to lobby" link

**Lobby page (`app/src/app/prompt-wars/page.tsx`)**

- "Create new match" → opens a small modal asking "Max players" (default 50, min 2, max 50). On submit, creates the match with that cap.
- Recent Matches and My Matches list rows now show "X / Y players" instead of two avatar slots
- Sort recent by most recently judged or most active

**Helpers (`app/src/lib/genlayer.ts`)**

- `createPromptWarsMatch(wallet, maxPlayers: number = 50)` — add the maxPlayers arg
- `joinPromptWarsMatch` unchanged signature, but contract handles N-player
- `startMatch(matchId, wallet)` — new helper for the Start button
- `submitPrompt` unchanged
- `judgeMatch` unchanged
- `getMatch` — return type now has `players: Address[]`, `prompts: string[]`, `outputs: string[]`, `ranking: Address[]`, `maxPlayers: number`
- Add `getMatchPlayers(matchId)` if needed for lobby join-count polling (or just use getMatch)

### Constraints

- Don't break Phase 0 (user_registry) tests
- Don't break the three viem-Studio workarounds (fillTransaction, estimateGas, consensus init)
- Don't break `fromMap`, `useActiveWallet`, or auth flows
- Keep the new contract address synced in both `genlayer.ts` (hardcoded) and `.env.local`
- All commits clean, two commits total for this phase:
  1. `fix(prompt-wars): timer-on-join + dev skip fix + progress feedback`
  2. `feat(prompt-wars): n-player tournament with AI ranking up to 50 players`

### Verification

After all four fixes:

1. `pytest test/` all green (new and existing tests)
2. Run the integration test (`judge-real-match.ts`) — should still pass, possibly updated to test ranking
3. Manual browser tests:
   - Create a match with max 3 players
   - Join from 2 other browser windows (3 total players)
   - Watch the "Waiting for players" view → click Start match (no timer until clicked)
   - All 3 submit prompts within timer
   - Click Judge Now
   - See leaderboard with all 3 ranked + AI reasoning
   - All 3 dashboards show updated stats
4. Edge cases:
   - Create with max 2 → fills automatically on second join → 5-min timer starts
   - DEV skip on a 4-player match → resolves in <60s with leaderboard
5. Send terminal output of pytest + screenshot of the leaderboard

### What's out of scope

- UI polish / design (Phase 5 later)
- Tournament brackets across multiple matches (later phase)
- Spectator mode
- Real-time WebSocket updates (3-second polling still fine)
- Matchmaking queues (open join via link still the model)
- Other 3 games (Phases 2, 3, 4)

Stop after verification. Report:
- Both commit hashes
- Pytest count
- New contract address
- Screenshot of leaderboard with AI reasoning
