# Phase 2: Real-World Predictions

This phase builds the second of Gengame Arena's four games. Unlike Prompt Wars (subjective AI judging of creativity), Predictions uses **GenLayer's web-access primitive** to fetch real-world data from the internet and resolve markets objectively. This is the most GenLayer-native game — it does something no other blockchain can do without an external oracle.

The first three games will share infrastructure built in Phase 1: the user_registry contract, useActiveWallet hook, the three viem-Studio workarounds, fromMap, finalization waits, TxButton component, validator AI provider config. None of that needs rebuilding.

---

## What we're building

**Open-ended prediction markets** where:
1. A creator opens a market by writing a question and picking a resolution datetime (1-7 days out)
2. The contract uses an AI verifiability check before accepting the market: "is this question answerable from public web sources at [resolution datetime]?" — yes/no with reasoning. Reject obvious nonsense, accept anything verifiable.
3. Players join and submit a prediction (YES/NO for binary, a number for numeric)
4. When the resolution datetime arrives, any player calls `resolve_market` — the contract uses GenLayer's web-access primitive to fetch the real answer from the internet and scores all players
5. Leaderboard ranks players by accuracy
6. Stats roll into user_registry

### Two market types

**Binary**: "Will X happen by Y?" — answer is YES or NO
- Player submission: YES or NO
- Resolution: contract fetches web data, AI determines actual answer is YES or NO
- Scoring: correct prediction = win, wrong = loss
- Leaderboard: all winners ranked equally (tie-broken by submission time, earliest wins as a tiebreaker)

**Numeric**: "What will X be at exact datetime Y?" — answer is a number
- Player submission: a number
- Resolution: contract fetches the real number from the web at the resolution moment
- Scoring: ranked by absolute distance from the real value (closest wins)
- Leaderboard: ordered by accuracy, 1st = closest

### First test market

Use this as the canonical demo case:
> "What will the price of Bitcoin be on [datetime 1-2 days from now] at 12:00 UTC, in USD?"

Numeric. Resolves by fetching BTC price from a public source (Coingecko API, CoinMarketCap, or just letting the GenLayer web primitive search). The contract should be flexible about *which* source as long as the validators converge on a value within a reasonable tolerance.

---

## Reference: GenLayer web-access primitive

Read these before writing contract code:
- https://docs.genlayer.com/developers/intelligent-contracts/concepts/equivalence-principle (the consensus pattern)
- https://docs.genlayer.com/developers/intelligent-contracts/types (data types for web fetch)
- https://docs.genlayer.com/full-documentation.txt — grep for: `web`, `get_webpage`, `eq_principle_prompt_non_comparative`, `eq_principle`, `fetch`, `gl.nondet`

The pattern is something like:
```python
result = gl.eq_principle_prompt_non_comparative(
    lambda: gl.nondet.web.render(url, mode='text'),
    task="Extract the BTC/USD price from this page. Return only the number, no currency symbol or commas.",
    criteria="Output must be a numeric string. Validators must agree to within 0.5%."
)
```
The exact primitive name may differ — confirm from the docs. The principle should be narrow enough that validators converge (e.g., "agree on the integer dollar value") even though raw HTML may vary.

For market verifiability check (creator-side), it's an `eq_principle_prompt_comparative` or similar — same primitive we use in Prompt Wars judging.

---

## Contract: `contracts/predictions.py`

### Data structures

```python
class MarketType(Enum):
    BINARY = 0
    NUMERIC = 1

class MarketState(Enum):
    OPEN = 0           # accepting predictions
    RESOLVING = 1      # past resolution datetime, awaiting resolve_market call
    RESOLVED = 2       # done, leaderboard available
    REJECTED = 3       # AI verifiability check failed, market never opened
    CANCELLED = 4      # creator cancelled before any joins

@dataclass
class Market:
    id: u64
    creator: Address
    question: str                    # max 300 chars
    market_type: MarketType
    resolution_datetime: u64         # unix timestamp, must be 1-7 days from creation
    created_at: u64
    state: MarketState
    rejection_reason: str            # populated if REJECTED
    players: list[Address]
    predictions_binary: list[bool]   # parallel to players, only used if BINARY
    predictions_numeric: list[float] # parallel to players, only used if NUMERIC
    submission_times: list[u64]      # for tiebreakers
    actual_answer_binary: bool       # filled after resolve, BINARY only
    actual_answer_numeric: float     # filled after resolve, NUMERIC only
    actual_answer_source: str        # URL or description of where the answer came from
    ranking: list[Address]           # ordered, ranking[0] is winner
    resolution_reasoning: str        # AI's explanation of how it determined the answer
```

### Constraints

- `question` max 300 chars
- `resolution_datetime` must be at least 24 hours from creation and at most 7 days from creation
- max 100 players per market
- player can change their prediction freely while market is OPEN
- player can't change prediction once `resolution_datetime` has passed

### Public methods

**`create_market(question: str, market_type: u8, resolution_datetime: u64) -> u64`**
- Validates inputs (length, datetime window)
- Runs AI verifiability check using `eq_principle_prompt_comparative` (or current equivalent):
  - Prompt asks the AI: "Is the following question answerable from public web sources at [resolution_datetime]? Answer YES or NO, then briefly explain. Question: [question]"
  - If AI says NO → state = REJECTED, store reason, return market_id anyway so frontend can show the rejection
  - If AI says YES → state = OPEN
- Returns market_id

**`join_and_predict_binary(market_id: u64, prediction: bool)`**
- Only callable when state is OPEN
- Adds caller to players if not already; updates predictions_binary[caller_index] and submission_times[caller_index]
- Reverts if market_type != BINARY, or already past resolution_datetime, or market full

**`join_and_predict_numeric(market_id: u64, prediction: float)`**
- Same but for numeric markets

**`resolve_market(market_id: u64)`**
- Callable by ANY player after resolution_datetime has passed
- Uses GenLayer web-access primitive to fetch the actual answer
- For BINARY: AI determines YES/NO from web data → store actual_answer_binary
- For NUMERIC: AI extracts the number from web data → store actual_answer_numeric
- Both: store actual_answer_source (the URL or source identifier the AI used) and resolution_reasoning (AI's explanation)
- Compute ranking:
  - BINARY: all correct predictions ranked first by submission_time (earliest = best); incorrect predictions ranked last
  - NUMERIC: all players ranked by absolute distance from actual_answer_numeric, ascending
- Call `user_registry.record_match_with_rank(player, rank, total_players)` for each player
- State → RESOLVED

**`cancel_market(market_id: u64)`**
- Only callable by creator
- Only callable when state is OPEN and players list is empty (or 1 player who is the creator themselves)
- State → CANCELLED, no stats

### Read methods

- `get_market(market_id) -> Market`
- `get_open_markets(limit: u32) -> list[u64]` — for the lobby
- `get_resolved_markets(limit: u32) -> list[u64]` — for browsing past results
- `get_markets_for_player(player: Address) -> list[u64]` — for My Predictions

---

## Tests: `test/test_predictions.py`

Cover:
- create_market with valid binary and numeric questions, both accepted by verifiability AI
- create_market with obvious nonsense question → REJECTED with reason
- resolution_datetime validation (too soon, too far)
- join_and_predict for both types
- prediction update before deadline works, after deadline reverts
- resolve_market binary path: mock the web result, verify ranking
- resolve_market numeric path: mock the web result, verify ranking by distance
- cancel_market only by creator, only when empty
- cannot resolve_market twice
- cannot predict after resolve

All existing 58 prompt_wars + user_registry tests must still pass.

---

## Frontend: `/predictions` route

### Lobby page (`app/src/app/predictions/page.tsx`)

Replace the placeholder. Three sections:

**Create New Market**
- Question text area (max 300 chars, live char counter)
- Market type radio: Binary (YES/NO) | Numeric (specific value)
- Resolution datetime picker (constrained to 1-7 days from now, in 1-hour increments)
- For numeric markets, an optional "Hint about units" field (e.g. "Price in USD") — purely descriptive, included in the question text the AI sees
- TxButton "Create Market"
- After creation, if state is REJECTED, show the AI's rejection reason and offer to refine + try again

**Open Markets** (state=OPEN, deadline not yet passed)
- List sorted by resolution_datetime ascending (resolving soonest first)
- Each card: question, type badge, "resolves in X hours/days", current player count, "Join & predict" button → routes to /predictions/[marketId]

**Resolving Soon / Resolved**
- Two tabs or sections
- Resolving: deadline passed, awaiting resolve_market — show "Resolve now" button (any player can click)
- Resolved: show winner + winning prediction

**My Predictions** section if the user has any markets

### Market page (`app/src/app/predictions/[marketId]/page.tsx`)

State-dependent rendering:

**OPEN + viewer not joined**:
- Question, type badge, "resolves at [datetime]" with countdown
- Current player count and (anonymized) prediction distribution
- For binary: "Make your prediction" with YES / NO toggle buttons + TxButton submit
- For numeric: number input + TxButton submit
- Player count "X players have joined"

**OPEN + viewer joined**:
- Same as above but with viewer's current prediction shown and editable until deadline
- "Withdraw prediction" button (if useful, optional)

**RESOLVING** (deadline passed, not yet resolved):
- "Awaiting resolution — anyone can resolve this market"
- Big TxButton "Resolve Market" (calls resolve_market)
- While resolving, button changes to "Fetching real-world data via validators…" with spinner

**RESOLVED**:
- "ACTUAL ANSWER" panel with the value the AI fetched and the source/reasoning
- Leaderboard table:
  - Rank, username, their prediction, distance from actual (numeric) or correct/incorrect (binary), time of submission
  - Highlight winner, highlight the viewer's row if present
- AI resolution reasoning paragraph
- "Back to lobby" link

**REJECTED**:
- "Market rejected at creation: [rejection_reason]"
- Optional "Create a refined market" CTA back to lobby

### Helpers (`app/src/lib/genlayer.ts`)

Add:
- `createBinaryMarket(question, resolutionDatetime, wallet)`
- `createNumericMarket(question, resolutionDatetime, hint, wallet)`
- `joinAndPredictBinary(marketId, prediction, wallet)`
- `joinAndPredictNumeric(marketId, prediction, wallet)`
- `resolveMarket(marketId, wallet)`
- `cancelMarket(marketId, wallet)`
- `getMarket(marketId)`
- `getOpenMarkets(limit)`
- `getResolvedMarkets(limit)`
- `getMarketsForPlayer(address)`

All write helpers use the same TxButton-friendly pattern as Phase 1 (finalization wait, returns when chain has confirmed).

### Dashboard update

The "Predictions" card on `/dashboard` should now show:
- Card title: Predictions
- Subtitle: "Predict AI-judged real-world outcomes"
- Stats hint if available: "X open markets" pulled from getOpenMarkets

---

## Dev test fixture

Add a script `app/test-integration/test-predictions.ts` that:
1. Generates 3 fresh wallets, registers them
2. Creates a binary market: "Will the next NBA game between [pick a real team and date 2-3 days out] be won by the home team?" — should pass verifiability
3. Tries to create an obviously bad market: "Will the moon turn purple tomorrow?" — should be REJECTED
4. All 3 wallets join the binary market and predict
5. Creates a numeric market: BTC price at a specific timestamp 25 hours from now
6. All 3 wallets predict different numbers
7. **For testing**, temporarily fast-forward time on the local Studio (if possible) OR mock the resolution datetime to be in the past
8. Calls resolve_market for both
9. Prints the actual answer the AI fetched, the leaderboard, and the AI reasoning for both markets
10. Asserts ranking matches expected (closest prediction wins numeric, correct predictions win binary)

If the Studio doesn't support time fast-forwarding, create markets with resolution_datetime set to ~30 seconds in the future and have the script just wait.

---

## Constraints

- Don't break Phase 0 (user_registry) or Phase 1 (prompt_wars) tests — all 58 must still pass
- Don't break the three viem-Studio workarounds, fromMap, useActiveWallet, TxButton
- Don't redeploy or modify prompt_wars contract
- Keep validators on Anthropic Haiku — no provider switch
- Use the same hardcoded-address pattern: contract addresses in genlayer.ts (and synced to .env.local), update both
- Two commits:
  1. `feat(predictions): contract + tests + integration script`
  2. `feat(predictions): lobby + market page + helpers + dashboard card update`

---

## Verification

1. `pytest test/` all green — should be 58 (existing) + N (new) = 70+ tests
2. Run `app/test-integration/test-predictions.ts` — prints both AI-resolved markets with reasoning
3. Browser manual tests:
   - Create a binary market that should pass verifiability → market opens
   - Try to create nonsense market → see rejection screen with reason
   - 2-3 windows join different markets, predict
   - Wait for shortest resolution time OR use a market created with deadline ~30s out
   - Click Resolve Market on a window → see "Fetching real-world data via validators…" spinner
   - After 30-60s, leaderboard appears with actual answer + AI reasoning + rankings
   - Stats updated on all dashboards
4. Send screenshots: lobby with multiple markets, a resolved market's leaderboard, and the AI's resolution reasoning specifically for the BTC numeric market

---

## What's out of scope for Phase 2

- Tournament brackets (later, if any)
- Real-time WebSocket updates (3-second polling fine)
- Market categories or tags
- Comments / discussion on markets
- Multi-resolution-source disputes
- Withdrawing / changing predictions after deadline
- UI polish (Phase 5)

Stop after verification, send the artifacts, wait for Phase 3 brief.

---

## A note on AI verifiability check rejection rate

Some legitimate-seeming markets may get rejected. That's fine — the AI is being conservative. If users complain, we can later add an "appeal" path. For now, rejection is just the AI's first-pass guess and creators can rephrase.

If the verifiability check is too aggressive (rejecting valid markets), tune the prompt to be more lenient: "Reject only if the question CANNOT be answered from public web sources by the resolution datetime. When in doubt, accept."

If it's too lenient (accepting nonsense), tighten: "Reject if the answer requires private knowledge, future events that aren't publicly trackable, or subjective opinions."

Likely needs one iteration of prompt tuning after the first test market — that's normal.
