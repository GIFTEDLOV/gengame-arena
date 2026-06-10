# Phase 4.5: Batch record_match + security audit + console easter egg

This phase fixes the cross-contract nonce-collision race that's causing Title Wars' integration test to fail at step 14, and bundles in a small security and presentation pass. Five workstreams. Do them in this order so we never have a broken intermediate state.

## Settled context — do not relitigate

- Phase 4 contracts (Title Wars, Trivia Royale, Predictions, Prompt Wars) are functionally correct
- The emit() cross-contract pattern is the only supported mechanism on GenLayer Studio (FIXME #748 confirms direct calls are unimplemented)
- The bug is in the Studio's `_emit_messages` code path: when a game contract emits N record_match calls in a loop after judge_match, all N child transactions get assigned the same nonce because `get_transaction_count(contract)` is called N times before any insert commits. The duplicate-hash collision causes SQLAlchemy `UniqueViolation`, the batch is rolled back, and zero child transactions land in the database. The Studio's error handler swallows this with a `print()` and never raises.
- Forensic evidence: judge_match transaction `0x135a33...` finalized at 11:24:57 with consensus reached, but the 4 record_match emits never persisted. Two `UniqueViolation` errors logged for child hash `0xec704f77...`
- We are working around the Studio bug from our side rather than patching the Studio container. This keeps us fully inside GenLayer's intended developer infrastructure.

## The architectural fix — one emit per match, not N

Currently each game contract loops over players and emits N separate `record_match` calls — one per player. Each emit becomes a child transaction. The nonce-collision race triggers because all N child transactions are generated before any of them commit.

The fix: collapse N emits into ONE emit by adding a batch method on UserRegistry.

This is more idiomatic on any blockchain anyway (batched writes save consensus rounds at scale). It also makes the system faster — one settled transaction in ~5-10 seconds instead of N transactions in 17-38 seconds.

---

## Workstream 1 — UserRegistry batch method (do first)

In `contracts/user_registry.py`, add a new public method:

```python
@gl.public.write
def record_match_batch(self, entries: list[dict]) -> None:
    """
    Record stats for multiple players in one call.
    
    entries: list of {"player": Address, "rank": int, "total_players": int}
    
    Internally calls the existing per-player record logic for each entry.
    Single transaction, no cross-contract emits.
    """
    for entry in entries:
        player = entry["player"]
        rank = entry["rank"]
        total_players = entry["total_players"]
        # Reuse the existing per-player logic — extract it into a helper
        # if record_match_with_rank's body is currently inlined
        self._record_match_with_rank_internal(player, rank, total_players)
```

If the existing per-player logic is currently in `record_match_with_rank(player, rank, total_players)`, extract its body into an internal helper `_record_match_with_rank_internal(player, rank, total_players)` and have BOTH the existing public method AND the new batch method call it. This way:

- Existing single-player call sites keep working (backward compatible during migration)
- New batch call sites use the new method
- No code duplication

Add pytest cases in `test/test_user_registry.py`:
- record_match_batch with 4 entries updates all 4 player profiles correctly
- record_match_batch with 1 entry equivalent to record_match_with_rank
- record_match_batch with 50 entries (max match size) works
- record_match_batch with empty list is a safe no-op
- Stats counters increment correctly across batch members

All existing UserRegistry tests must still pass.

---

## Workstream 2 — Update game contracts to use the batch

For each of: `contracts/title_wars.py`, `contracts/trivia_royale.py`, `contracts/prompt_wars.py`, `contracts/predictions.py`:

Find the section in `judge_match` (or whatever the resolution method is called) where it loops over players and calls `self.user_registry.emit().record_match_with_rank(player, rank, total_players)`.

Replace the loop with a single batch emit:

```python
# Build the rankings list
entries = []
for i, player in enumerate(self.ranking):
    entries.append({
        "player": player,
        "rank": i + 1,  # 1-indexed rank
        "total_players": len(self.ranking)
    })

# Single emit instead of N
self.user_registry.emit().record_match_batch(entries)
```

Adjust the exact code to match each contract's data model — some games may have a `ranking` field, others a `survivors`/`eliminated` pair, predictions has a different structure entirely. Use the same per-player ranking logic that was previously in the loop; just wrap the result in one batch call.

For each game contract:
- Update tests in `test/test_<game>.py` to reflect the new batch emit
- All existing game tests must still pass

---

## Workstream 3 — Security audit of frontend exposure

Read `app/.env.local`. Categorize every variable into ONE of these:

**Public-safe** — variables prefixed `NEXT_PUBLIC_*`. These ARE intentionally exposed to the browser. Must be safe to be public. Examples:
- `NEXT_PUBLIC_PRIVY_APP_ID` — Privy designs this to be public, safe
- `NEXT_PUBLIC_*_ADDRESS` — Contract addresses are public on-chain, safe
- `NEXT_PUBLIC_GENLAYER_RPC` — The RPC endpoint URL, public, safe

**Server-secret** — variables WITHOUT the `NEXT_PUBLIC_` prefix. These should NEVER be readable in the browser bundle. Examples that should NOT appear in `.env.local` in this category for THIS project:
- `ANTHROPIC_API_KEY` — Should only exist in the Studio's `.env` (not the dapp's `.env.local`)
- Any private keys
- Any seed phrases
- Any signing keys

**Report:**
1. List every variable in `.env.local` and its category
2. Flag any `NEXT_PUBLIC_` variable that contains anything sensitive (API key, signing secret, etc.)
3. Flag any non-public variable that's in `.env.local` but should be elsewhere (e.g. server-only secrets that don't belong in a Next.js public-readable env file)
4. Confirm `app/.env.local` is in `.gitignore` (it should already be — verify)
5. Search the entire `app/src/` directory for hardcoded strings that look like API keys, secrets, or private keys. Report any findings with file path and line number. Patterns to grep for:
   - `sk-ant-` (Anthropic key prefix)
   - `sk-proj-` (OpenAI key prefix)
   - 0x followed by 64 hex chars (private keys; contract addresses are 40 hex so length filter matters)
   - `eyJ` (JWT prefix)
   - `BEGIN PRIVATE KEY`
   - `_SECRET`, `_KEY`, `apikey`, `apiKey`, `api_key` (case-insensitive)

Report findings. **Do not modify anything yet** — just present the audit results so I can decide which (if any) need remediation.

If the audit is fully clean (no secrets exposed), just say so explicitly.

---

## Workstream 4 — Console easter egg

In `app/src/app/layout.tsx` (the root layout) or wherever the top-level client component lives, add a small `useEffect` that runs once on mount and prints a friendly message in the browser console.

The message should:
- Welcome curious users who opened DevTools
- Use a bit of styled console output (CSS via `console.log("%cHello", "color: ...; font-size: ...")`)
- Acknowledge the openness of the web is intentional, not a leak
- Mention the project name, mention it's built on GenLayer
- Be friendly, not snarky

Something like (use your judgment on the exact wording):

```js
useEffect(() => {
  console.log(
    "%cGengame Arena 🎮",
    "color: #7c3aed; font-size: 32px; font-weight: bold; padding: 8px 0;"
  )
  console.log(
    "%cThe chain is the truth — the browser is just the view.",
    "color: #a78bfa; font-size: 14px; font-style: italic;"
  )
  console.log(
    "%cAll game logic runs as intelligent contracts on GenLayer. AI judges every match via on-chain validator consensus. Cheating the browser doesn't cheat the chain.",
    "color: #9ca3af; font-size: 12px; line-height: 1.5;"
  )
  console.log(
    "%cBuilt by @GIFTEDLOV · Learn more about GenLayer: https://genlayer.com",
    "color: #6b7280; font-size: 11px;"
  )
}, [])
```

Wrap this in a guard so it only runs in production AND in the browser:

```js
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  // ... the console messages
}
```

So during local dev (where we WANT to see error logs) the easter egg doesn't add noise. It only shows up in the production build that real users will see.

---

## Workstream 5 — Redeploy all 5 contracts and verify

In this order (UserRegistry MUST be first because the games depend on its new batch method):

1. Run `python scripts/deploy_user_registry.py` — auto-updates `.env.local` and the fallback in `genlayer.ts`
2. Run `python scripts/deploy_prompt_wars.py` — auto-updates addresses
3. Run `python scripts/deploy_predictions.py`
4. Run `python scripts/deploy_trivia_royale.py`
5. Run `python scripts/deploy_title_wars.py`

After all 5 deploys, print the final canonical address table. Then restart the dev server so it picks up `.env.local` changes.

Then run the Title Wars integration test:

```
cd app && npx tsx test-integration/test-title-wars.ts
```

Expected result with the batch fix:
- All 14 steps PASS
- The single record_match_batch transaction settles in 5-15 seconds (not 17-38s like before, because it's one transaction now not four)
- All 4 wallets show total_matches=1 within the first or second polling attempt
- The 300-second polling budget is wildly more than needed; consider trimming it back to 30 seconds in a follow-up commit

If the test passes, also run the other three integration tests to confirm we didn't break anything:
- `npx tsx test-integration/test-trivia-royale.ts`
- `npx tsx test-integration/test-predictions.ts`
- `npx tsx test-integration/critical-path.ts` (the Prompt Wars one — check the actual filename)

All four should pass.

---

## Commits

Three commits, in this order:

1. `fix(user-registry): add record_match_batch for single-emit cross-contract stats updates`
2. `refactor(games): use record_match_batch to avoid nonce collision in cross-contract emits`
3. `chore(frontend): console easter egg + security audit notes`

Plus a fourth commit if the security audit reveals anything that needs fixing:
4. `security: <whatever the specific fix is>`

---

## Constraints

- Do NOT use direct cross-contract calls (`registry.method()` without emit). FIXME #748 confirms unsupported.
- Do NOT patch the Studio container.
- Do NOT propose changes to `_emit_messages` in `/app/backend/consensus/base.py`.
- Do NOT remove the existing `record_match_with_rank` single-player method even though it'll be unused — leave it as backward-compatible API.
- Do NOT change the integration test polling logic until after the batch fix is verified working.
- Do NOT modify any of the three viem-Studio compatibility workarounds in `genlayer.ts`.

## Report at the end

When all 5 workstreams are complete and verified:

1. Final canonical contract addresses for all 5 contracts (new addresses since we redeployed)
2. Pytest count (expect ~225+ tests passing)
3. Title Wars integration test summary — specifically how fast record_match_batch settled (compare to old 17-38s range)
4. Confirmation all 4 integration tests pass
5. Security audit summary — what was checked, anything flagged
6. Confirmation the console easter egg works (do a production build `npm run build && npm start` and report the console output)

End of prompt.
