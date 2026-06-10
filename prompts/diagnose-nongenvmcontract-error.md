# Diagnose NonGenVMContract() error on direct cross-contract calls

## Context

We just redeployed all four game contracts (PromptWars, Predictions, TriviaRoyale, TitleWars) after switching `registry.emit().record_match(...)` to direct `registry.record_match(...)` calls. The goal was to eliminate the 17–38 second post-judging latency we measured with `emit()`.

When the Title Wars integration test ran against the new TitleWars deployment, judge_match consistently failed. The consensus service logs show every cross-contract sub-call reverting with:

```
Error: VM Exception while processing transaction:
reverted with custom error 'NonGenVMContract()'
```

Because the call reverts, the parent `judge_match` transaction also reverts. The match never reaches STATE_JUDGED. The match stays stuck in STATE_OPEN_FOR_SUBMISSIONS.

This is worse than the `emit()` situation — at least with `emit()`, the match was reaching STATE_JUDGED (stats were just lagging behind).

## Critical constraints

- **DO NOT modify any contract code (`contracts/*.py`).** Diagnosis only.
- **DO NOT redeploy anything.** All addresses are current and on-chain.
- **DO NOT propose or implement workarounds.** No try/except wrapping. No client-side record_match calls. No design changes. We are investigating, not fixing.
- **DO NOT run `docker compose down -v` or `genlayer up`.** Studio is in a clean working state.
- **DO NOT pick between options or recommend a path forward in this run.** Report findings only.

## Current canonical addresses

- UserRegistry: `0x66B41A5866F8AD6704F00bCd8c8A668D99564032`
- PromptWars: `0xA88d120583A661582D08CEE93DeaF70162E3AAF1`
- Predictions: `0xD6F0B40D9DEa1Df0c65479B1bf2C41fe945749DB`
- TriviaRoyale: `0xc1BfC190b5A9B0F5E9514272C994fd66e05531d1`
- TitleWars: `0x46733a63fB32a26874f2988E4D5eb99519c878C4`

## What we need to know

The `NonGenVMContract()` error originates in the ConsensusMain Solidity contract on Hardhat. It is emitted when a forwarded sub-call targets an address that the consensus layer does not recognize as a registered GenVM contract. We need to understand WHY UserRegistry's address is being rejected, given that:

- UserRegistry was deployed by `python scripts/deploy_user_registry.py` against this same chain
- The deploy transaction is FINALIZED on-chain (confirmed earlier in this session)
- All four game contracts read UserRegistry's address from their `self.user_registry_address` field and call `gl.get_contract_at()` on it
- The `emit()`-based version of these same calls (before we changed them to direct calls) did NOT raise this error — it queued triggered transactions that completed successfully, just slowly

There are several real possibilities to distinguish between, and we cannot fix anything until we know which one is true.

## Investigation procedure

### Step 1 — Verify UserRegistry is callable from outside

UserRegistry is at `0x66B41A5866F8AD6704F00bCd8c8A668D99564032`. Run an external read call against it (e.g., `get_user_count`, or any zero-argument read method that exists in `contracts/user_registry.py`).

If you do not know which read methods exist, first `view contracts/user_registry.py` and identify a zero-argument read method, then call it.

The call should use the same RPC and SDK path that the integration tests use (i.e., `client.readContract` from `app/src/lib/genlayer.ts` or equivalent). It should return data successfully.

Report:
- Which read method you called
- Whether the call succeeded
- The returned value

### Step 2 — Check the on-chain deploy record for UserRegistry

Run:

```
docker exec genlayer-postgres-1 psql -U postgres -d genlayer_state -c "SELECT hash, status, type, created_at FROM transactions WHERE LOWER(to_address) = LOWER('0x66B41A5866F8AD6704F00bCd8c8A668D99564032') ORDER BY created_at LIMIT 10;"
```

Then also run:

```
docker exec genlayer-postgres-1 psql -U postgres -d genlayer_state -c "SELECT COUNT(*), MIN(created_at), MAX(created_at) FROM transactions WHERE LOWER(to_address) = LOWER('0x66B41A5866F8AD6704F00bCd8c8A668D99564032');"
```

Report:
- Whether a `type=1` (contract deploy) transaction exists for UserRegistry
- The status of that deploy transaction (should be FINALIZED)
- Total number of transactions sent to that address and the date range

### Step 3 — Locate the source of NonGenVMContract()

The error is a Solidity custom error thrown by ConsensusMain. Find its emission site so we can read the exact condition under which it fires.

Search inside the running Studio containers for the error string. Try:

```
docker exec genlayer-jsonrpc-1 grep -r "NonGenVMContract" /app/backend 2>/dev/null | head -30
```

If the Solidity source is elsewhere, try:

```
docker exec genlayer-hardhat-1 sh -c "grep -r 'NonGenVMContract' / 2>/dev/null | grep -v node_modules | head -20"
```

Also check the JSON-RPC service:

```
docker exec genlayer-jsonrpc-1 sh -c "find / -name 'ConsensusMain*' 2>/dev/null | head -20"
```

Once you find the file that defines or emits the error, `view` the relevant lines (the function or modifier where the revert happens) and show me the exact code. This tells us what condition the consensus contract checks to decide an address is "not a GenVM contract."

### Step 4 — Check whether other game contracts would hit the same wall

The Predictions, TriviaRoyale, and PromptWars contracts now also contain the same direct `registry.record_match(...)` pattern. We have not yet exercised any of their judge/resolve paths since the redeploy.

Without running any test, examine:
- `contracts/predictions.py` — find the `resolve_market` method and confirm it uses `registry.record_match(addr, ...)` exactly as title_wars does
- `contracts/trivia_royale.py` — find both call sites in `resolve_round` and confirm the pattern
- `contracts/prompt_wars.py` — find both call sites in `judge_match` and confirm the pattern

For each, paste the relevant lines so I can see they all use the identical pattern that just failed.

### Step 5 — Read what gl.get_contract_at() actually does

Find the genlayer-py SDK source for `gl.get_contract_at()` (and the wrapper it returns). This is likely inside the genlayer Python package shipped with the GenVM runtime, or in the genlayer-genvm container.

Try:

```
docker exec genlayer-jsonrpc-1 sh -c "find / -name 'gl' -type d 2>/dev/null | head -10"
docker exec genlayer-jsonrpc-1 sh -c "find / -name '*.py' -path '*genlayer*' 2>/dev/null | xargs grep -l 'get_contract_at' 2>/dev/null | head -5"
```

Once you find the source of `get_contract_at`, view its body. We want to know:
- Does it perform any registration step before allowing calls?
- Does the returned wrapper have a difference between `.emit().method()` (which we used before) and `.method()` (which we are using now)?
- Is the direct call pattern documented as supported for cross-contract calls between intelligent contracts?

Show me the relevant code.

## What to report

For each of the 5 steps, paste the relevant output and the relevant code. At the end, summarize:

1. Does UserRegistry exist and respond to external reads? (Yes/No, with evidence)
2. Is its deploy transaction FINALIZED on the current chain? (Yes/No, with hash)
3. What is the exact condition that triggers `NonGenVMContract()`?
4. Do all four game contracts have the same direct-call pattern that just failed?
5. What does `gl.get_contract_at()` do, and does it support direct (non-`emit()`) calls?

Do NOT recommend a fix. Do NOT pick an option. Just report findings.
