# Phase 4: Title Wars + Trivia Royale batch generation fix

This phase ships the **fourth and final game**: Title Wars. Players see a poem, story excerpt, or scene, then race to submit the most fitting one-line title. AI ranks all submissions by creativity, thematic fit, and resonance.

This phase also includes a **small fix to Trivia Royale**: lazy batch generation of questions so games with many players don't run out before a winner is determined.

Two commits at the end:
1. `fix(trivia-royale): batch-generate questions on demand when pool exhausted`
2. `feat(title-wars): contract + tests + frontend + integration test + AI ranking`

---

## Part A — Trivia Royale: batch question generation

### The bug

Current contract generates 8 questions on match start. With 20 players, you can have 4+ survivors after the 8th question and the contract has nothing left to ask. Game gets stuck.

### The fix

Modify `contracts/trivia_royale.py`:

1. When `resolve_round` advances to the next question AND `current_question_idx >= len(questions)` AND `len(survivors) >= 2`: trigger a new batch generation.

2. Add a new internal method `_generate_more_questions(match_id, batch_size=8)` that:
   - Sets state to `GENERATING_QUESTIONS`
   - Calls the AI to generate `batch_size` more questions on the same topic
   - Passes the existing questions as context so the AI avoids duplicates: include in the prompt "These questions have already been asked, do not repeat them: [list]"
   - Appends to the existing `questions` list
   - Returns to `ROUND_IN_PROGRESS`
   - Same retry-on-consensus-failure logic as the initial generation

3. The frontend match page already handles `GENERATING_QUESTIONS` state with a spinner — it just needs to also handle this mid-game generation. Update the spinner text to: "Generating more questions… (X players still standing)" when triggered mid-match instead of "Generating trivia questions…"

4. Hard cap: max 5 batches total (40 questions). If a match somehow runs through 40 questions with 2+ players still alive, declare it a tie and split the win across remaining survivors (or pick a tiebreaker logic — actually, just pick one randomly and call it a tiebreaker round; the test cases for this will be hard to write so a simpler "all remaining survivors share the win" is fine).

5. Update tests in `test/test_trivia_royale.py`:
   - Match with 6 players, force most to wrong answers so multiple survive past round 8 → assert a second batch generated → assert match still resolves with one winner
   - Match where 40 questions exhausted → assert tie/shared-win handling

### Constraints

- Keep batch size at 8 questions to stay under the 3000-token output limit
- Don't change the initial question generation flow
- Don't break the existing tests

---

## Part B — Title Wars game

### What it is

Creative writing title contest:
- Host creates a match by picking or providing a literary excerpt (poem, prose, scene)
- Up to 50 players join via shared link
- Host clicks Start (host-only, same pattern as Prompt Wars and Trivia Royale)
- Each player submits a one-line title (max 100 chars) within a 3-minute deadline
- After deadline OR when all submit, anyone clicks Judge
- AI ranks all titles by creativity + thematic fit + resonance with the excerpt
- Leaderboard shows ranking + AI's per-title reasoning
- Winner declared, stats roll into user_registry

This is essentially Prompt Wars with a creative-writing target instead of a task description. Most infrastructure carries over directly.

### Excerpt source

Two options:
- **A**: Host types the excerpt themselves at match creation (max 1500 chars)
- **B**: Contract has a built-in library of pre-vetted excerpts and picks one randomly

**Use A.** Same logic as the open-topic decision for Trivia — gives more variety, only minor moderation risk because the AI judges fit anyway. Have a verifiability AI check at creation that rejects non-narrative content (rambling instructions, lists, gibberish) but accepts any genuine literary fragment.

### AI judging

Use `eq_principle_prompt_comparative` (same primitive as Prompt Wars and Trivia open-ended). Prompt the AI:

```
You are judging a title submission contest. The excerpt is:

[excerpt text]

The following titles were submitted by N players:
1. [title 1]
2. [title 2]
...

Rank all N titles from best to worst by these criteria:
- Thematic fit: does the title capture the core meaning, mood, or imagery of the excerpt?
- Creativity: is it surprising, evocative, or memorable — not generic?
- Concision: short and punchy beats long and explanatory
- Avoid spoilers: a great title hints at depth without giving the ending away

Return a JSON list of submission indices in ranked order, plus a brief one-sentence reasoning for each ranking position.

Format:
{
  "ranking": [3, 1, 5, 2, 4],
  "reasoning": [
    "Submission 3 captures the central tension elegantly without naming it",
    "Submission 1 is direct and resonant, but slightly literal",
    ...
  ]
}
```

Narrow `eq_principle` to: **"Validators must agree on the ranking order. Reasoning text may vary."**

### Contract: `contracts/title_wars.py`

```python
class TitleWarsState(Enum):
    WAITING_FOR_PLAYERS = 0
    REJECTED = 1                  # excerpt failed verifiability
    OPEN_FOR_SUBMISSIONS = 2      # host started, players submitting titles
    JUDGING = 3                   # judging in progress
    JUDGED = 4                    # done, ranking available
    CANCELLED = 5                 # host cancelled before play

@dataclass
class TitleMatch:
    id: u64
    host: Address                 # creator, host-only Start
    excerpt: str                  # max 1500 chars
    max_players: u32              # default 50, min 2, max 50
    players: list[Address]
    titles: list[str]             # parallel to players, empty until submitted
    submission_times: list[u64]
    state: TitleWarsState
    rejection_reason: str         # if verifiability failed
    submission_deadline: u64      # set when host starts, +180 sec
    ranking: list[Address]        # filled when JUDGED, ordered best-to-worst
    judge_reasoning: list[str]    # parallel to ranking, one line per rank
    created_at: u64
```

### Public methods

**`create_match(excerpt: str, max_players: u32 = 50) -> u64`**
- Validates excerpt length (10 to 1500 chars)
- Validates max_players range
- Verifiability check via `eq_principle_prompt_comparative`: "Is this text a coherent literary excerpt (prose or poetry) suitable for a title contest? Reject lists, instructions, code, or gibberish. When in doubt accept."
- If accepted: state OPEN, caller is host, automatically joins as players[0]
- If rejected: state REJECTED with reason

**`join_match(match_id: u64)`**
- Adds caller if not in players list
- Reverts if state != WAITING_FOR_PLAYERS or match is full

**`start_match(match_id: u64)`**
- Only host can call (msg.sender == host)
- Requires len(players) >= 2
- Sets state = OPEN_FOR_SUBMISSIONS
- Sets submission_deadline = now + 180  (3 minutes)
- No auto-start on full

**`submit_title(match_id: u64, title: str)`**
- Only callers in players list
- Reverts if state != OPEN_FOR_SUBMISSIONS or past submission_deadline
- max 100 chars
- Updates titles[caller_index] and submission_times[caller_index]
- Allows updates within the deadline

**`judge_match(match_id: u64)`**
- Callable by anyone after either:
  - All players have submitted (titles list has no empty strings), OR
  - submission_deadline has passed
- For players who didn't submit: their title is treated as empty string, automatically ranked last
- Runs `eq_principle_prompt_comparative` to get ranking + reasoning
- Stores ranking (player addresses) and judge_reasoning (one string per rank)
- Calls `user_registry.record_match_with_rank` for each player
- State → JUDGED

**`cancel_match(match_id: u64)`**
- Host only
- Only callable when state is WAITING_FOR_PLAYERS
- State → CANCELLED, no stats

### Read methods

- `get_match(match_id) -> TitleMatch`
- `get_open_matches(limit: u32) -> list[u64]`
- `get_judged_matches(limit: u32) -> list[u64]`
- `get_matches_for_player(player) -> list[u64]`

### Tests: `test/test_title_wars.py`

Cover:
- create_match with valid literary excerpt → OPEN
- create_match with non-narrative ("buy milk, eggs, bread") → REJECTED
- create_match with too-short text → reverts
- join up to capacity, reject past capacity
- only host can start
- start with <2 players reverts
- submit_title: updates work before deadline, revert after
- judge_match with all submitted → full ranking
- judge_match with deadline passed and partial submissions → missing players rank last
- record_match_with_rank propagation to user_registry

All Phases 0/1/2/3 tests must continue to pass.

---

## Frontend: `/title-wars` route

Replace the placeholder. Same general structure as Prompt Wars and Trivia Royale.

### Lobby page (`app/src/app/title-wars/page.tsx`)

**Create New Match**
- Large textarea for the excerpt (max 1500 chars, live char counter)
- Below it, a small helper: "Paste a poem, short prose, or scene. The AI checks the text is suitable, then players race to submit the best title."
- Max players slider/input (2-50, default 10)
- "Create match" TxButton
- After creation: if REJECTED, show the AI's rejection reason inline; offer to refine

**Open matches** (state = WAITING_FOR_PLAYERS, not yet started)
- Each card: excerpt preview (first 200 chars + "..."), player count, host username, "Join match" button → `/title-wars/[matchId]`

**Active matches** (state = OPEN_FOR_SUBMISSIONS)
- Hide for v1. Same call as Trivia.

**My Matches**
- Match history for the user

### Match page (`app/src/app/title-wars/[matchId]/page.tsx`)

State-dependent rendering:

**WAITING_FOR_PLAYERS**:
- Excerpt shown in a card with serif font (it's literary content, treat it as such)
- Player count + joined usernames
- Host sees "Start Match" TxButton (enabled when >=2 joined)
- Non-host players see "Waiting for host…"
- Non-player sees "Join match" if not full
- Share link with Copy button

**OPEN_FOR_SUBMISSIONS**:
- Excerpt still shown at top (collapsible if long)
- Big 3-minute countdown timer (red below 30s)
- Text input below: "Your title" with 100-char counter
- Submit TxButton
- After submitting: "✓ Title locked in (you can update until the deadline)"
- Submission count: "X / Y players have submitted"
- DEV-only skip-to-judging button (already a pattern)

**JUDGING**:
- "AI is ranking all titles..." with spinner

**JUDGED**:
- Excerpt at top
- Trophy banner: "Winner: [username]"
- If viewer won: "🎉 That's you!"
- Leaderboard table: rank | username | submitted title | AI reasoning for that rank
- Highlight viewer's row
- "Back to lobby" link

**REJECTED**:
- "Excerpt rejected: [reason]"
- "Create a new match" CTA

**CANCELLED**:
- "Match cancelled by host"
- Back to lobby

### Helpers (`app/src/lib/genlayer.ts`)

Add:
- `createTitleWarsMatch(excerpt, maxPlayers, wallet)`
- `joinTitleWarsMatch(matchId, wallet)`
- `startTitleWarsMatch(matchId, wallet)`
- `submitTitle(matchId, title, wallet)`
- `judgeTitleMatch(matchId, wallet)`
- `cancelTitleMatch(matchId, wallet)`
- `getTitleMatch(matchId)`
- `getOpenTitleMatches(limit)`

All write helpers use the existing TxButton-friendly Promise pattern (finalization wait, returns when chain has confirmed).

### Dashboard update

The Title Wars card on `/dashboard`:
- Title: Title Wars
- Subtitle: "Submit the best title for AI-judged literary excerpts"
- Stats hint: "X open matches" from getOpenTitleMatches

---

## Integration test: `app/test-integration/test-title-wars.ts`

Script:
1. Generate 4 fresh wallets, register them
2. Wallet A creates a match with a real short poem excerpt (use Robert Frost's "Nothing Gold Can Stay" — public domain, classic, short)
3. Test rejection: try to create another match with a grocery list — should be REJECTED
4. Wallets B, C, D join the poem match
5. Wallet A starts
6. All 4 wallets submit different titles:
   - A: a genuinely thoughtful title ("Gold's Brief Hour")
   - B: a generic title ("Nature Poem")  
   - C: a creative title ("Eden's Decay")
   - D: gibberish ("asdf qwerty")
7. Anyone calls judge_match
8. Print the AI's ranking with reasoning for each rank
9. Assert: exactly one #1, exactly one last-place, D (gibberish) ranks worst
10. Print winner declaration and stats updates

The trophy moment: AI's reasoning for ranking A's title above B's, and clearly explaining why gibberish ranks last.

---

## Deploy script

`scripts/deploy_title_wars.py` — same pattern as deploy_predictions.py and deploy_trivia_royale.py (Python subprocess with `shell=True` for Windows). Auto-updates both `app/.env.local` (`NEXT_PUBLIC_TITLE_WARS_ADDRESS`) and the fallback in `app/src/lib/genlayer.ts`.

---

## Constraints

- Don't break Phases 0/1/2/3 — all 180+ pytest must still pass
- Don't break the three viem-Studio workarounds, fromMap, useActiveWallet, TxButton, finalization waits
- Use `eq_principle_prompt_comparative` with narrowed "ranking order" principle (proven pattern)
- Keep validators on Anthropic Haiku 4.5
- AI output stays well under the 3000-token validator limit — for 50-player matches, that's 50 ranked indices + 50 short reasoning strings, which is fine
- Two commits as specified at the top

---

## Verification

1. `pytest test/` all green — should be 180+ tests
2. Run `npx tsx test-integration/test-title-wars.ts` — prints AI ranking + reasoning for the Robert Frost poem
3. Run `npx tsx test-integration/test-trivia-royale.ts` again to verify the batch generation fix didn't break the simple case
4. Browser manual test:
   - Sign in as @GIFTEDLOV → create Title Wars match with a poem excerpt of your choosing
   - 2-3 incognito windows join
   - Host starts, all submit titles
   - Click Judge
   - See leaderboard with AI's per-rank reasoning
   - Dashboard counts updated for all players

### What to send back

- Pytest count
- AI ranking + reasoning output from test-title-wars.ts
- Confirmation Trivia Royale batch generation works (test passing with mid-game generation triggered)
- Browser test outcome (described in text since screenshots are limited)

---

## What's out of scope for Phase 4

- Saved excerpt library (purely host-typed for v1)
- Voting / community judging on top of AI
- Stylistic categories (poetry vs prose distinction in scoring)
- UI polish (Phase 5)

Stop after verification. Phase 5 (UI polish across all 4 games) is next.
