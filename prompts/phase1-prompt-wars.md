# Phase 1: Prompt Wars (core game loop) + Phase 0 cleanup fixes

This phase delivers the first working game: **Prompt Wars**, a 1v1 challenge where two players write prompts trying to match a target, and a GenLayer AI consensus picks the winner. We're building the **core game loop only** — no tournament brackets, no scheduled events, no matchmaking queue. Those come in a later phase once all 4 games have working core loops.

This phase also fixes two small bugs surfaced during Phase 0 verification.

---

## Part A — Fix two Phase 0 issues first

Do these before starting Prompt Wars work.

### A1. Fix Predictions card wording

In the dashboard, the Predictions card currently says **"Bet on AI-adjudicated outcomes"**. We are free-to-play, no wagering. Change it to:

> **"Predict AI-judged real-world outcomes"**

Locate the dashboard component (likely `app/src/app/dashboard/page.tsx`) and update the string. No other changes.

### A2. Fix guest mode skipping the username flow

Currently, when a user clicks "Continue as guest" in incognito, they land on `/dashboard` showing "Welcome, player" — a hardcoded fallback. The guest flow should match the other 3 sign-in methods: generate wallet → route to `/sign-in/username` → user picks a name → register on the on-chain `user_registry` contract → land on dashboard showing the picked name.

The bug is most likely in either `src/lib/guest.ts` (skipping the redirect) or `src/components/AuthGuard.tsx` (incorrectly treating guests as already-registered).

Fix:
1. After guest wallet generation, route to `/sign-in/username` like any other sign-in method does
2. Make sure the username-picking page calls `register_user(username)` on the user_registry contract using the guest wallet to sign the transaction
3. The dashboard must read the username from the on-chain user_registry, not from a local "player" fallback. If there's no on-chain profile, redirect to `/sign-in/username` instead of showing a default name
4. Verify: incognito → guest → must see username picker → must pick a name → dashboard must show that name → close incognito, reopen incognito, sign in as guest again with a *different* username → should also work without conflict

Commit after Part A with message: `fix(phase0): predictions card wording + guest mode username registration flow`.

---

## Part B — Build Prompt Wars

### B1. Game design (read this carefully before coding)

**One match = two players + one target + one AI judgment.**

1. Player 1 creates a match. The contract picks a random challenge target from a built-in list of 30 prompts (e.g. "write a prompt that would produce a haiku about autumn leaves falling in a Tokyo park").
2. Player 1 gets back a `match_id`. They share the join link (`/prompt-wars/<match_id>`) with Player 2 via any channel (Discord, text, etc.). For MVP we are not building friend lists or matchmaking — sharing a link is the matchmaking.
3. Player 2 opens the link, clicks "Join match." Both players are now in the match.
4. Both players see the target. Each types their prompt (max 500 characters). 5-minute submission window enforced by the contract.
5. Once both submit, anyone (either player, or the frontend automatically) can call `judge_match(match_id)`. The contract runs both prompts through an LLM, compares each output's similarity to the target, and declares a winner.
6. Result page shows: target, both prompts, both LLM-generated outputs, the AI's reasoning, and the winner's username.
7. Contract calls `user_registry.record_match(player, won)` for both players.

### B2. Contract: `contracts/prompt_wars.py`

Reference docs while writing:
- https://docs.genlayer.com/developers/intelligent-contracts/first-contract
- https://docs.genlayer.com/developers/intelligent-contracts/types
- https://docs.genlayer.com/developers/intelligent-contracts/storage
- https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle — critical for the LLM judging step

Use `gl.eq_principle_prompt_comparative` (or the current equivalent — check live docs) for the AI judgment. This is GenLayer's pattern for letting validators converge on an LLM-based comparison.

**Spec:**

Dataclass `Match`:
- `id: u64`
- `target_text: str`
- `player1: Address`
- `player2: Address` (zero address if not joined yet)
- `player1_prompt: str` (empty until submitted)
- `player2_prompt: str` (empty until submitted)
- `player1_output: str` (filled during judging)
- `player2_output: str` (filled during judging)
- `state: u8` — enum: 0=WAITING_FOR_P2, 1=BOTH_JOINED, 2=ONE_SUBMITTED, 3=BOTH_SUBMITTED, 4=JUDGED
- `winner: Address` (zero address until judged)
- `judge_reasoning: str` (filled during judging)
- `created_at: u64`
- `submission_deadline: u64` — created_at + 5 minutes

Storage:
- `matches: TreeMap[u64, Match]`
- `next_match_id: u64`
- `targets: list[str]` — hardcoded list of 30 challenge prompts, included as a class constant. Examples: "A prompt that produces a 4-line poem about silence", "A prompt that produces instructions for making perfect scrambled eggs in under 50 words", "A prompt that produces a riddle whose answer is 'a mirror'", etc. Pick varied, fun ones.

Constructor: takes the `user_registry_address: Address` and stores it.

Public write methods:
- `create_match() -> u64` — caller becomes player1. Contract picks a random target via deterministic hash of (block_number + caller_address) modulo 30. Returns match_id.
- `join_match(match_id: u64)` — caller becomes player2. Reverts if match doesn't exist, already has player2, or caller is player1 (can't play yourself).
- `submit_prompt(match_id: u64, prompt: str)` — caller submits their prompt. Reverts if not a player in this match, already submitted, past deadline, or prompt longer than 500 chars.
- `judge_match(match_id: u64)` — anyone can call. Reverts if state != BOTH_SUBMITTED. Uses `eq_principle_prompt_comparative` to:
  1. Run player1_prompt through LLM → store as player1_output
  2. Run player2_prompt through LLM → store as player2_output
  3. Compare both outputs to target_text, pick whichever is closer
  4. Store winner and reasoning
  5. Set state to JUDGED
  6. Call user_registry.record_match(player1, p1_won) and user_registry.record_match(player2, p2_won)

Public read methods:
- `get_match(match_id: u64) -> Match`
- `get_recent_matches(limit: u32) -> list[Match]` — returns most recent, for the lobby page
- `get_matches_for_player(player: Address) -> list[u64]` — match IDs this player is in

### B3. Tests: `test/test_prompt_wars.py`

Cover:
- create_match: returns incrementing IDs, picks a real target from the list, sets state to WAITING_FOR_P2
- join_match: succeeds for different player, reverts when player1 tries to self-join, reverts when match already full
- submit_prompt: only players can submit, can't submit twice, can't exceed 500 chars
- state transitions: WAITING_FOR_P2 → BOTH_JOINED → ONE_SUBMITTED → BOTH_SUBMITTED → JUDGED
- judge_match: only callable when BOTH_SUBMITTED, declares one winner, calls record_match on user_registry for both players
- judging produces consistent winner across multiple validator runs (use eq principle test helpers)
- get_recent_matches returns correct order

All tests must pass.

### B4. Deploy contract

Deploy via `genlayer deploy contracts/prompt_wars.py` to the local Studio. Pass the existing user_registry address as the constructor arg. Save the deployed prompt_wars address into `app/.env.local` as `NEXT_PUBLIC_PROMPT_WARS_ADDRESS`.

### B5. Frontend: replace the `/prompt-wars` placeholder

Build three views:

**1. Lobby — `app/src/app/prompt-wars/page.tsx`**
- "Create new match" button — calls `create_match()` on the contract, shows loading state, on success routes to `/prompt-wars/<id>`
- "Join match" input — paste a match ID or full link, routes to that match's page
- "Recent matches" section — calls `get_recent_matches(10)`, lists them with: target text snippet, both players (or "Waiting for player 2..."), state badge (Waiting / In progress / Judged), and winner if judged. Each row links to its match page.

**2. Match page — `app/src/app/prompt-wars/[matchId]/page.tsx`** (dynamic route)
- Reads `match_id` from URL, calls `get_match(matchId)` and polls every 3 seconds (use SWR or simple setInterval)
- Renders one of four views based on state:
  - **WAITING_FOR_P2**: show target, show share link with "Copy link" button (the full URL of current page), countdown to deadline
  - **BOTH_JOINED / ONE_SUBMITTED**: show target, large textarea for caller's prompt (max 500 chars, live char counter), "Submit prompt" button. Show opponent status: "Opponent: thinking..." or "Opponent: submitted ✓"
  - **BOTH_SUBMITTED**: show "Both prompts in. Resolving..." with a "Judge now" button that calls `judge_match`. After it returns, transition to results view
  - **JUDGED**: show full results — target, both prompts side by side, both LLM outputs, AI's reasoning, winner declared with their username (look up via user_registry). "Back to lobby" button

Add the AuthGuard wrapper so unauthenticated users get redirected to sign-in.

**3. Update dashboard Prompt Wars card** — make it actually link to `/prompt-wars`. Make sure the description reads "Compete with AI prompt engineering" (already correct from Phase 0).

### B6. GenLayerJS helpers — extend `app/src/lib/genlayer.ts`

Add typed helpers:
- `createPromptWarsMatch(): Promise<{ matchId: number, txHash: string }>`
- `joinPromptWarsMatch(matchId: number): Promise<TxHash>`
- `submitPrompt(matchId: number, prompt: string): Promise<TxHash>`
- `judgeMatch(matchId: number): Promise<TxHash>`
- `getMatch(matchId: number): Promise<Match | null>`
- `getRecentMatches(limit: number): Promise<Match[]>`

---

## Verification (must all pass before declaring Phase 1 done)

1. **Contract tests**: `pytest test/test_prompt_wars.py` — all green.
2. **Phase 0 regression**: `pytest test/test_user_registry.py` — still all green.
3. **Manual end-to-end test** (this is the real proof Prompt Wars works):
   - Open two browser windows: one regular (signed in as @GIFTEDLOV via GitHub) and one incognito (signed in as a fresh guest with username `guest_player`)
   - In the regular window: Dashboard → click Prompt Wars card → click "Create new match"
   - Copy the match link
   - In the incognito window: paste link → click "Join match"
   - Both windows now show the same target prompt
   - Each window types a different prompt and submits
   - Either window clicks "Judge now"
   - Both windows show the same results screen with one declared winner
   - Go back to dashboards in both windows — `total_matches` should be 1 for both players, `total_wins` should be 1 for the winner and 0 for the loser
   - Refresh the lobby — the completed match should appear in "Recent matches"

If the dashboards don't show updated stats, the `record_match` call from the contract is broken — fix before declaring done.

---

## Deliverables to print at the end

1. Deployed `prompt_wars` contract address
2. Pytest output for both `test_user_registry.py` and `test_prompt_wars.py`
3. Confirmation each of the 3 verification steps passed
4. List of any open TODOs (especially around the matchmaking/scheduling work we deferred to a later phase)
5. Git log showing checkpoint commits
6. A screenshot or text dump of one completed match's AI reasoning (so we can sanity-check the LLM judgment quality)

---

## Out of scope for Phase 1 — do NOT build

- Tournament brackets, scheduling, registration windows
- Matchmaking queues (random pairings)
- Friend lists, invites by username
- Spectator mode
- Chat
- Achievements, leaderboards beyond the user_registry counter
- Real-time WebSocket updates (3-second polling is fine for now)
- Mobile-specific UI tweaks

If any of those feel important, list them as TODOs and we'll prioritize in a later phase.

---

Stop after Phase 1 verification and wait for the next prompt.
