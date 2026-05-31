# Fix: write transactions not awaited to finality — username page loops, "Match not found"

## Symptom

After the three-workaround client fix, the blocking RPC errors (eth_fillTransaction, eth_estimateGas, ConsensusMain init) are GONE. But:

1. Guest/user submits a username on `/sign-in/username`, clicks Continue → page loops back to `/sign-in/username` instead of advancing to `/dashboard`.
2. Create Match → routes to a match page that shows "Match not found."

Console at the time shows ONLY harmless noise: Privy `analytics_events` CORS/422, Lit dev-mode notice, favicon 404. No contract-write errors.

## Hypothesis

The write transactions submit successfully and return a tx hash, but the frontend reads the result (getProfile / getMatch) BEFORE GenLayer finalizes the transaction. So the read returns null/empty, and:
- username flow: getProfile returns null → redirect logic sends user back to pick-username
- create match: the new match isn't queryable yet → "Match not found"

This is a transaction-confirmation race. The fix is to await FINALIZATION (not just submission) in every write helper before the UI acts on the result.

## Step 1 — DIAGNOSE first (do not fix yet)

Prove or disprove the hypothesis with a standalone script that bypasses the frontend entirely.

Write a temporary script `scripts/diag_write.py` (or .ts/.mjs — whatever's easiest with the installed tooling) that:

1. Uses a fresh test private key / account
2. Calls `register_user("diag_test_user")` on the deployed user_registry contract
3. IMMEDIATELY (no delay) calls `get_profile(address)` and prints the result
4. Waits 5 seconds, calls `get_profile(address)` again and prints the result
5. Waits another 10 seconds, calls `get_profile(address)` a third time and prints the result

Run it and report all three outputs.

Interpretation:
- If the FIRST read is null but LATER reads return the profile → CONFIRMED: it's a finalization timing race. Proceed to Step 2.
- If ALL THREE reads are null → the write itself is failing silently. Different problem — STOP and report the script, the tx hash returned by register_user, and any tx receipt/status you can fetch. Do not proceed to Step 2.
- If the FIRST read already returns the profile → timing isn't the issue; the bug is in the frontend redirect logic itself. Report this and proceed to Step 3 only.

Also, while diagnosing, check the genlayer-js API for how to wait for a transaction to be FINALIZED. Look for: `waitForTransactionReceipt`, `getTransactionReceipt`, a `status` field (values like ACCEPTED / FINALIZED / etc.), or a `waitForTransaction` helper. Read:
- https://docs.genlayer.com/api-references/genlayer-js
- https://docs.genlayer.com/full-documentation.txt (grep: `waitForTransactionReceipt`, `FINALIZED`, `ACCEPTED`, `status`, `receipt`)
- `node_modules/genlayer-js` types file

Report what the finalization-wait API is before changing code.

## Step 2 — FIX (only if Step 1 confirms timing race)

In `app/src/lib/genlayer.ts`, every write helper must wait for the transaction to reach FINALIZED status before returning:

For each of `registerUser`, `createPromptWarsMatch`, `joinPromptWarsMatch`, `submitPrompt`, `judgeMatch`:
1. Submit the write, get the tx hash
2. Await the genlayer-js finalization helper on that hash (e.g. `await client.waitForTransactionReceipt({ hash, status: 'FINALIZED' })` — use the actual API found in Step 1)
3. Only then return

For `createPromptWarsMatch` specifically: after finalization, the match ID must be reliably retrievable. If the contract emits the new match ID or it can be derived from the receipt, parse it from the finalized receipt rather than guessing/incrementing. If the current code optimistically computes the ID before finalization, fix it to read the real ID post-finalization. This is why "Match not found" appears — the redirect uses an ID that isn't queryable yet (or is wrong).

## Step 3 — Frontend feedback during the wait

Finalization can take several seconds. The UI must not look frozen or bounce the user.

On `/sign-in/username`:
- When Continue is clicked: disable the button, show "Registering on-chain… this can take a few seconds"
- Only redirect to `/dashboard` AFTER `registerUser` resolves (which now means after finalization)
- If it throws, show the error text on the page (don't silently loop)

On the Prompt Wars lobby Create Match:
- Show "Creating match…" while waiting
- Only navigate to `/prompt-wars/<id>` after `createPromptWarsMatch` resolves with a confirmed real ID

On the match page:
- Keep the existing 3-second polling so state transitions (join, submit, judge) show up as they finalize

## Constraints

- Don't touch contracts, useActiveWallet, or the three client workarounds (keep all three).
- Don't upgrade package versions.
- Delete the temporary `scripts/diag_write.py` after diagnosis is complete (or keep it but note it's a dev-only diagnostic).
- The Privy analytics CORS/422 and Lit dev-mode console messages are EXPECTED and harmless — do not try to fix them.

## Verify

1. Restart clean: `taskkill /F /IM node.exe` then `cd app; npm run dev` (port 3000)
2. Hard refresh
3. **Guest signup**: incognito → guest → username `final_test_1` → Continue
   - Button shows "Registering on-chain…" briefly
   - Then lands on `/dashboard` showing `final_test_1`
   - Does NOT loop back to the username page
4. **Refresh dashboard** → username still shows (read-back works)
5. **Create match**: Prompt Wars → Create Match → "Creating match…" → lands on `/prompt-wars/<id>` with target text, NOT "Match not found"
6. **Full match** (two windows): create → copy link → other window joins → both submit → judge → both see results → both dashboards show updated counts

## Report

- Step 1 diagnostic output (the three timed reads)
- The genlayer-js finalization API used
- Verification results for all 6 checks
- Commit: `fix(genlayer): await transaction finalization before reads — resolves username loop and match-not-found`
