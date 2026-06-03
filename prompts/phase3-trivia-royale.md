# Phase 3: Trivia Royale + Host-Start Refactor

This phase builds the third of Gengame Arena's four games — **Trivia Royale**, a multi-round battle-royale where AI generates questions on a creator-chosen topic, players race to answer, wrong answers eliminate them, and the last player standing wins.

This phase also includes a **small refactor to Prompt Wars** so both games share the same match-start pattern: **host-only start button, no auto-start**. The host clicks Start when ready; until then, the match stays open.

Two commits at the end:
1. `refactor(matches): host-only start across prompt-wars and trivia-royale`
2. `feat(trivia-royale): contract, AI question generation, AI answer verification, frontend, integration test`

---

## Part A — Host-only start refactor (applies to Prompt Wars too)

### Behavior change

Currently in Prompt Wars:
- `start_match` can be called by ANY player in the match
- Match auto-starts when the player list reaches `max_players`

New behavior across both games:
- `start_match` can only be called by `match.creator` / `match.host` (the player who created it)
- No auto-start. Even when player list hits max_players, the host must click Start
- Host can start any time `len(players) >= 2`

### Contract changes

In `contracts/prompt_wars.py`:
- Add a check in `start_match`: `assert msg.sender == self.matches[match_id].players[0]` (creator is always players[0] by convention) OR add an explicit `creator: Address` field if cleaner. Pick whichever is less invasive.
- In `join_match`: remove the auto-start-on-full logic. When full, state stays `WAITING_FOR_PLAYERS` until host calls start. Possibly add a new state `FULL_WAITING_FOR_HOST` to make the UI clearer, or just keep `WAITING_FOR_PLAYERS` with a derived "is full" check.
- Update existing tests to match (any test that relied on auto-start on full needs to call start_match explicitly now)

Same logic in `contracts/trivia_royale.py` (Part B below).

### Frontend changes

On the match page for Prompt Wars (`app/src/app/prompt-wars/[matchId]/page.tsx`):
- "Start match now" button → "Start Match" button visible **only to the host** (caller's address === host)
- Other players see a status: "Waiting for host to start the match…"
- The button remains visible even when the lobby is full — full ≠ auto-start
- Once host clicks Start: the 5-min timer kicks in and the existing submission flow takes over

Same on the Trivia Royale match page (built in Part B).

### Tests

Update `test/test_prompt_wars.py`:
- Existing tests calling start_match must use the creator wallet
- Add new test: non-creator calling start_match reverts
- Add new test: joining the Nth (max) player does NOT automatically start — state remains waiting until host calls start

---

## Part B — Trivia Royale game

### What it is

A multi-round battle-royale trivia game:
- Host creates a match with a topic and player cap
- Players join the lobby
- Host clicks Start when ready (need at least 2 players)
- At start, AI generates a question pool on the topic (committed on-chain so all players see identical questions)
- Game runs in rounds. Each round, all surviving players see the same question simultaneously and have a fixed time to answer
- Multiple-choice questions: 10 seconds. Open-ended questions: 15 seconds.
- Wrong answer or no answer = eliminated. Right answer = survive to next round.
- Last player standing wins. If multiple survive the final question, run tiebreaker rounds with harder questions.
- Stats roll into user_registry (winner gets a win recorded, all participants get a match recorded).

### Match topics

Open-ended (creator types the topic at match creation). Examples:
- "Football transfers"  
- "Crypto history"
- "1980s sci-fi movies"
- "World capitals"
- "Programming languages"
- "Olympic gold medalists"

For the first test match, use: **"Football transfers"** (verifiable history, short answers, broadly playable).

At creation, run an AI verifiability check (same pattern as Predictions): "Is this topic suitable for generating 10+ trivia questions with verifiable factual answers? Reject if the topic is too subjective, requires private knowledge, or has no public answers." If rejected, show the reason to the creator.

### Question generation

When the host calls `start_match`, the contract uses an `eq_principle_prompt_comparative` call to ask the AI to generate a batch of trivia questions on the topic. Use this prompt structure (Claude Code can refine):

```
Generate 15 trivia questions on the topic: "[topic]".

Mix the types: 11 multiple-choice (with 4 options labeled A/B/C/D and one correct), 4 open-ended (no options, expects a short factual answer).

Vary difficulty: start with widely-known facts, gradually harder.

For multiple-choice questions: provide the question, four options as a list, and the index (0-3) of the correct answer.

For open-ended questions: provide the question and the canonical correct answer. Also provide 2-3 acceptable alternate phrasings (e.g. "Leonardo da Vinci", "da Vinci", "Leonardo").

Return strict JSON in this shape:
{
  "questions": [
    {"type": "multiple_choice", "question": "...", "options": ["A", "B", "C", "D"], "correct_index": 2},
    {"type": "open_ended", "question": "...", "canonical_answer": "...", "alternates": ["...", "..."]},
    ...
  ]
}
```

Narrow the `eq_principle` to: **"Validators must agree on the question list ordering and answer correctness. Question wording may vary slightly across validator outputs."** This is similar to how the Prompt Wars judging was narrowed.

If consensus fails (validators disagree on the question set), the contract retries up to 2 times. If it still fails, the match is auto-cancelled and the creator can try a different topic.

Store the question pool on-chain in the match. Each player's view of the question is identical because they read it from contract state.

### Round mechanics

Match has a `current_round` index and a `current_question` reference. State machine:
- `WAITING_FOR_PLAYERS` — lobby, players join
- `GENERATING_QUESTIONS` — host called start, AI generating
- `ROUND_IN_PROGRESS` — players have time to submit an answer
- `ROUND_RESOLVING` — round time expired, AI verifying open-ended answers (multiple-choice are deterministic)
- `MATCH_ENDED` — winner declared OR all eliminated

For each round:
1. Contract sets `round_deadline = now + (10 if multiple_choice else 15)`
2. Surviving players see the current question and submit their answer via `submit_answer(match_id, answer: str)`
3. When all surviving players have submitted OR deadline passes, anyone can call `resolve_round(match_id)`
4. The contract eliminates players who answered wrong or didn't answer
5. If 1 player remains: they win, match ends
6. If 0 players remain (everyone wrong on the same round): tiebreaker — the players who survived the *previous* round come back and play a sudden-death question (mark as "tiebreaker_round")
7. If 2+ remain: advance to next question

### Open-ended answer verification

For open-ended questions, the contract uses AI to judge if a player's answer matches. Prompt:

```
The trivia question was: "[question]"
The canonical correct answer is: "[canonical_answer]"
Acceptable alternates include: [alternates list]

The player submitted: "[player_answer]"

Is the player's answer correct? Account for:
- Minor typos
- Different valid phrasings (full name vs surname, abbreviations)
- Case insensitivity
- Extra words that don't change meaning

Reject if the player's answer references the wrong entity, has a fundamentally different meaning, or is gibberish/empty.

Return only: CORRECT or INCORRECT, then a brief one-sentence reason.
```

Narrow `eq_principle` to: **"Validators must agree on CORRECT vs INCORRECT verdict."** Reasoning text can vary.

### Multiple-choice verification

Deterministic in the contract — `submit_answer` for a multiple-choice question takes the index (0-3), `resolve_round` just compares to `correct_index`. No AI call needed. Fast and cheap.

### Contract: `contracts/trivia_royale.py`

```python
class TriviaState(Enum):
    WAITING_FOR_PLAYERS = 0
    GENERATING_QUESTIONS = 1
    ROUND_IN_PROGRESS = 2
    ROUND_RESOLVING = 3
    MATCH_ENDED = 4
    CANCELLED = 5

@dataclass
class TriviaQuestion:
    type: str                       # "multiple_choice" | "open_ended"
    question: str
    options: list[str]              # length 4 for MC, empty for OE
    correct_index: i32              # 0-3 for MC, -1 for OE
    canonical_answer: str           # only for OE
    alternates: list[str]           # only for OE

@dataclass
class TriviaMatch:
    id: u64
    host: Address                   # creator and only one who can start
    topic: str
    max_players: u32
    players: list[Address]
    state: TriviaState
    rejection_reason: str           # if topic was rejected
    questions: list[TriviaQuestion]
    current_round: u32              # 0-indexed
    current_question_idx: u32       # index into questions[]
    round_deadline: u64
    survivors: list[Address]        # players still in the match (eliminated removed)
    eliminated: list[Address]       # in elimination order, last eliminated = nearly-winner
    round_answers: TreeMap[Address, str]  # cleared between rounds; player -> their submitted answer this round
    winner: Address                 # filled when MATCH_ENDED
    created_at: u64
```

### Public methods

**`create_match(topic: str, max_players: u32 = 50) -> u64`**
- Validates topic length, max_players range
- Runs AI verifiability check on topic
- If accepted: state = WAITING_FOR_PLAYERS, caller is host, automatically joins as players[0]
- If rejected: state = CANCELLED with rejection_reason

**`join_match(match_id: u64)`**
- Adds caller if not already in players list
- Reverts if state != WAITING_FOR_PLAYERS or match is full

**`start_match(match_id: u64)`**
- Only host can call
- Requires len(players) >= 2
- State → GENERATING_QUESTIONS
- Calls AI to generate questions (eq_principle_prompt_comparative)
- On success: questions stored, state → ROUND_IN_PROGRESS, current_round=0, current_question_idx=0, round_deadline set based on question type, survivors = players.copy()
- On AI consensus failure: retry up to 2 times, then state → CANCELLED with reason

**`submit_answer(match_id: u64, answer: str)`**
- Only callers in survivors can submit
- Reverts if state != ROUND_IN_PROGRESS or past round_deadline
- Stores answer in round_answers (overwrites if player already submitted this round, allowing change-of-mind within the deadline)

**`resolve_round(match_id: u64)`**
- Callable by anyone after all survivors submitted OR deadline passed
- For each survivor, determine correct/incorrect:
  - Multiple-choice: compare index to correct_index, deterministic
  - Open-ended: call AI verifier (eq_principle_prompt_comparative), gets CORRECT/INCORRECT
- Update survivors and eliminated lists
- If len(survivors) == 1: state → MATCH_ENDED, winner = that player, record_match_with_rank for all
- If len(survivors) == 0: tiebreaker — restore survivors from previous round, pick next question, mark as tiebreaker (set current_round += 1, current_question_idx += 1)
- If len(survivors) >= 2: advance current_question_idx, set new round_deadline, state stays ROUND_IN_PROGRESS

**`cancel_match(match_id: u64)`**
- Host can cancel any time before state == ROUND_IN_PROGRESS
- Sets state → CANCELLED

### Read methods

- `get_match(match_id) -> TriviaMatch`
- `get_open_matches(limit: u32) -> list[u64]`  — for lobby
- `get_active_matches(limit: u32) -> list[u64]` — matches in progress
- `get_matches_for_player(player) -> list[u64]`
- `get_current_question(match_id) -> TriviaQuestion` — convenience, players poll this

### Tests: `test/test_trivia_royale.py`

Cover:
- create_match with a good topic → OPEN
- create_match with a bad topic ("personal opinions about my dog") → REJECTED with reason
- join up to capacity, reject past capacity
- only host can start_match (non-host reverts)
- start_match reverts with <2 players
- start_match generates a valid question pool
- multiple-choice answers verified deterministically
- open-ended answers verified by AI (mock or real test)
- correct answer = survive, wrong = eliminated
- timer expiration eliminates non-submitters
- single survivor wins, match ends
- tiebreaker logic when all wrong on the same round
- cancel_match by host before play starts

All Phase 0/1/2 tests must still pass (currently 126).

---

## Frontend: `/trivia-royale` route

Replace the placeholder page with a full implementation.

### Lobby page (`app/src/app/trivia-royale/page.tsx`)

Three sections:

**Create new match**
- Topic text input (max 80 chars)
- Max players slider/input (2-50, default 10)
- "Create match" TxButton
- After creation: if state is CANCELLED (topic rejected), show the AI's rejection reason inline; offer to refine

**Open matches** (state = WAITING_FOR_PLAYERS, not yet started)
- List with topic, player count "X / Y", host's username, "Join match" button → `/trivia-royale/[matchId]`

**Active matches** (state = ROUND_IN_PROGRESS or ROUND_RESOLVING)
- Read-only spectator view? Or just hide until ended. **Choose: hide until ended for v1.** Simpler.

**My Matches**
- Match history for the user

### Match page (`app/src/app/trivia-royale/[matchId]/page.tsx`)

State-dependent rendering:

**WAITING_FOR_PLAYERS**:
- Topic shown
- Joined players list with usernames (anonymized for non-participants)
- Player count "X / max"
- Viewer is host: "Start Match" TxButton (enabled when >=2 joined)
- Viewer is non-host player: "Waiting for host to start…" status
- Non-player: "Join match" button if not full
- Share link with Copy button

**GENERATING_QUESTIONS**:
- "Generating trivia questions… (validators agreeing on the question pool)" with spinner
- This may take 30-60s

**ROUND_IN_PROGRESS** (the main game UI):
- Big header: "ROUND X" + question count "Question X of 15"
- Live countdown timer (10s or 15s based on question type), red below 3s
- Question text large and centered
- For multiple-choice: 4 large buttons A/B/C/D, each shows the option text, click = submit
- For open-ended: text input + Submit button, focus on the input on mount
- After submitting: show "✓ Answer locked in" + "Waiting for other players… (X of Y answered)"
- Survivor count badge: "X players remaining"
- Eliminated banner if viewer was eliminated last round (red/grey): "You were eliminated in round X — you may continue watching"

**ROUND_RESOLVING**:
- "Resolving round — validators checking answers…" with spinner
- Show "Correct answer was: [answer]" once available
- Survivor diff: "X players advanced, Y eliminated"
- After 3-5 seconds, auto-advance to next ROUND_IN_PROGRESS

**MATCH_ENDED**:
- Trophy / confetti banner: "Winner: [username]"
- If viewer won: extra celebration ("🎉 That's you!")
- Full elimination history (table): rank, username, eliminated in round X
- "Back to lobby" link

**CANCELLED**:
- "Match cancelled" + reason if topic was rejected at AI verifiability check
- "Create a new match" button back to lobby

### Helpers (`app/src/lib/genlayer.ts`)

Add:
- `createTriviaMatch(topic, maxPlayers, wallet)`
- `joinTriviaMatch(matchId, wallet)`
- `startTriviaMatch(matchId, wallet)`  — host only, enforced contract-side
- `submitTriviaAnswer(matchId, answer, wallet)`
- `resolveTriviaRound(matchId, wallet)`
- `cancelTriviaMatch(matchId, wallet)`
- `getTriviaMatch(matchId)`
- `getOpenTriviaMatches(limit)`
- `getCurrentTriviaQuestion(matchId)` — polled during ROUND_IN_PROGRESS

All write helpers wrap with TxButton-friendly Promise pattern (finalization wait).

### Polling cadence

Trivia is more time-sensitive than other games. Poll `getTriviaMatch(matchId)` every **2 seconds** during ROUND_IN_PROGRESS and ROUND_RESOLVING (faster than the 3s default elsewhere). Reduce to 5 seconds when state is WAITING_FOR_PLAYERS.

### Dashboard update

The Trivia Royale card on `/dashboard`:
- Title: Trivia Royale
- Subtitle: "AI-judged trivia battle royale"
- Stats hint if available: "X open matches" from getOpenTriviaMatches

---

## Integration test: `app/test-integration/test-trivia-royale.ts`

Script:
1. Generate 4 fresh wallets, register them
2. Wallet A creates a match with topic "Football transfers", max 4 players
3. Wallets B, C, D join
4. Wallet A starts the match
5. Wait for question generation (poll state until ROUND_IN_PROGRESS)
6. Print the generated question pool (first 3 questions in detail, just the count after)
7. For each round, all survivors submit answers programmatically — answers chosen as:
   - For multiple-choice: a random index, with wallet A always choosing the correct index (so A is consistently good), wallets B/C/D choose randomly. This way wallet A is expected to survive longest.
   - For open-ended: A submits the canonical answer, B submits a typo of canonical, C submits an alternate, D submits gibberish. Demonstrates AI's tolerance.
8. After each round, print the round results: who survived, who was eliminated, AI reasoning for any open-ended judgments
9. Continue until match ends
10. Print the winner and full elimination order
11. Assert: at least one round ran, at least one elimination happened, exactly one winner

Run it, paste the full terminal output. The trophy moment is seeing the AI's per-round verdicts for open-ended answers — especially how it handles typos vs alternates vs gibberish.

---

## Constraints

- Don't break Phases 0/1/2 — all 126+ pytest must still pass
- Don't break the three viem-Studio workarounds, fromMap, useActiveWallet, TxButton, finalization waits
- Use the same `eq_principle_prompt_comparative` pattern for AI calls (it's working reliably)
- Don't change auth, wallet, or sign-in flows
- Keep validators on Anthropic Haiku 4.5
- Use the same deploy script pattern (Windows `shell=True` for subprocess) for `deploy_trivia_royale.py`
- Sync the new contract address in both `genlayer.ts` (hardcoded fallback) and `.env.local`

---

## Verification

1. `pytest test/` all green — should be 126 + N new = roughly 160-180 tests
2. Run `app/test-integration/test-trivia-royale.ts` — prints AI-generated question pool, per-round verdicts, final winner
3. Browser manual test:
   - Sign in as @GIFTEDLOV → create Trivia match with topic "Football transfers", max 4
   - Open 3 incognito windows, guest in each, all 3 join
   - As @GIFTEDLOV (host), click Start Match
   - Watch question generation spinner
   - Play through several rounds, answering different things in each window to demonstrate elimination
   - See the winner declared in all 4 windows
   - Dashboard counts updated
4. Also verify Part A: in Prompt Wars, create a match, join from a second window, confirm the Start button only shows for the host

### Send back

- Pytest output
- Terminal output from `test-trivia-royale.ts` showing per-round AI verdicts (especially open-ended answer judgments)
- Screenshots: lobby with open matches, a round in progress with the timer and question visible, the winner screen
- Confirmation that the host-only-start refactor works in Prompt Wars

---

## What's out of scope for Phase 3

- Spectator mode for active matches (deferred)
- Per-question difficulty progression beyond "later questions are harder"
- Custom question pools (always AI-generated)
- Public leaderboards / win streaks (beyond the basic user_registry stats)
- UI polish (Phase 5)

Stop after verification. Don't start Phase 4 (Title Wars) yet.
