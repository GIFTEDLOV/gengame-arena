# Fix: eth_fillTransaction "Method not found" — use genlayer-js native writes

## What we now know (from browser console screenshots)

The actual RPC method failing is `eth_fillTransaction`. Stack trace:
```
Error fetching eth_fillTransaction from GenLayer RPC: Error: Method not found
  at Object.request (genlayer-js/dist/index.js:727:19)
  at async delay.count.count (viem/_esm/utils/buildRequest.js:42:24)
  at async attemptRetry (viem/_esm/utils/promise/withRetry.js:30:30)
```

GenLayer Studio does not implement `eth_fillTransaction` — that's a Geth-specific RPC method viem uses to auto-fill transaction fields. GenLayer uses its own RPC surface (`gen_call`, etc.).

Diagnosis: our frontend is using viem's `writeContract` (or `sendTransaction`) when writing to GenLayer contracts. Internally those viem methods call `eth_fillTransaction`, which 400s. We must replace them with genlayer-js's native write API everywhere.

This is the root cause of all of:
- Guest username registration silently failing
- Create Match silently failing → "Match not found" downstream
- All wallet-based sign-in methods unable to write to contracts

## Step 1 — Find the correct genlayer-js write API

Fetch and read:
1. https://docs.genlayer.com/api-references/genlayer-js — entire page
2. https://docs.genlayer.com/full-documentation.txt — grep for: `writeContract`, `sendTransaction`, `gen_call`, `createClient`, `simulateContract`, `transaction`
3. The GenLayer project boilerplate's frontend code (find link in docs root) — see how it performs writes in working code

Specifically determine:
- The function name(s) for writing to a deployed intelligent contract
- How the wallet/signer is passed (private key string? viem account? Privy wallet?)
- Whether genlayer-js exports its own client factory, or whether we should be wrapping viem differently
- Any required parameters that we might be missing (chain ID, contract ABI handling, etc.)

If the /genlayer-dev Claude Code plugin is loaded, query it for the canonical write pattern.

## Step 2 — Audit `app/src/lib/genlayer.ts`

Print to terminal:
1. The exact imports at the top
2. How the client is instantiated (read client and any write client)
3. The body of each write helper: `registerUser`, `createPromptWarsMatch`, `joinPromptWarsMatch`, `submitPrompt`, `judgeMatch`

Identify which helpers are using viem's `writeContract` / `sendTransaction` (the broken pattern) vs. genlayer-js's native write API.

## Step 3 — Refactor all write helpers

Replace every write helper's implementation to use the genlayer-js native pattern found in Step 1.

The wallet object from `useActiveWallet` provides signing. Pass it in whatever form genlayer-js's write API expects (raw private key for guest wallets in localStorage, or a Privy-provided signer for Privy users — handle both branches).

Read helpers (`getProfile`, `isUsernameTaken`, `getMatch`, `getRecentMatches`, `getMatchesForPlayer`) likely work already — they don't go through `eth_fillTransaction`. Verify, but don't change unless broken.

## Step 4 — Stabilize the dev server port

Symptoms in user's console: dev server is on `:3001` or `:3002`, causing Privy CORS failures because Privy allowlist is `localhost:3000`.

Fix:
1. Kill all running node processes:
   - Windows: `taskkill /F /IM node.exe`
   - Mac/Linux: `pkill -9 node`
2. Confirm port 3000 is free:
   - Windows: `netstat -ano | findstr :3000` should return nothing
3. Restart dev server: `cd app && npm run dev` — should grab port 3000
4. If something else is squatting on :3000, report what it is and don't proceed

## Constraints

- DO NOT upgrade genlayer-js or viem package versions unless docs explicitly require it. If a version bump is needed, STOP and report the proposed change.
- DO NOT change the `useActiveWallet` hook.
- DO NOT change pages or components — they consume helpers and should stay the same.
- DO NOT change contracts — they're verified working (51/51 tests).
- DO NOT touch unrelated open TODOs.

## Verification (must all pass)

After fix + clean restart on port 3000:

1. Open `http://localhost:3000` — hard refresh
2. **Guest signup**: incognito → Continue as guest → username `fix_test_guest` → Continue
   - Lands on dashboard showing `fix_test_guest`
   - DevTools Console: no `Method not found`, no `eth_fillTransaction` errors
3. **GitHub re-sign-in**: regular window → already signed in as @GIFTEDLOV → dashboard loads cleanly
4. **Create match**: Prompt Wars card → Create Match
   - Routes to `/prompt-wars/<real_id>` with the target text visible
   - Network tab: write request returns 200
5. **Full match end-to-end** (the real test):
   - Regular window @GIFTEDLOV creates match, copies link
   - Incognito guest joins via link
   - Both submit prompts before 5-min timer
   - Either clicks Judge
   - Both see results with declared winner
   - Both dashboards show updated total_matches / total_wins
6. **My Matches list** populates for both players in the lobby after the match

## If the docs are unclear or the fix doesn't work after 3 attempts

STOP. Don't keep trying random things. Produce a report:
- Snapshot of `src/lib/genlayer.ts` current code
- Relevant docs sections you found
- What pattern you tried and the resulting error
- Installed package versions

The user will escalate with this context.

## Commit

After verification all green:
`fix(genlayer): use native genlayer-js write API to replace viem writeContract — resolves Method not found`

## Out of scope

- Tournament infrastructure
- Adding MetaMask custom network configuration (the GenLayer localnet RPC URL setup in MetaMask is the user's responsibility; we can document it in README later)
- UI polish
- Phase 2 / other games
