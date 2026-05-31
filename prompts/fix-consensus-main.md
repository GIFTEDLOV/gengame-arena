# Fix: "Consensus main contract not initialized" — use genlayer-js native client end-to-end

## What's confirmed working

- GenLayer Studio is healthy: `docker ps` shows 4 containers up 28-30 hours
  - `genlayer-jsonrpc` on :4000 (JSON-RPC)
  - `genlayer-hardhat` on :8545
  - `genlayer-postgres` on :5432
  - `genlayer-webdriver` on :4444
- Contracts deployed and contract-side tests all pass (51/51)
- `useActiveWallet` hook resolves wallets for all sign-in methods
- The previous `eth_fillTransaction` patch removed the wrong RPC method call

## What's broken

Browser error during write tx (guest username registration in this case):
> "Registration failed: Consensus main contract not initialized. Please ensure client is properly initialized."

## Diagnosis

GenLayer routes ALL writes to intelligent contracts through a system contract called **ConsensusMain**, which orchestrates AI validator consensus. The Studio deploys ConsensusMain at startup; our genlayer-js client doesn't know its address. The previous fix patched viem's transaction shape (chainId / nonce / gas) but did not give the client the protocol-level routing it needs.

Root cause: `app/src/lib/genlayer.ts` is using viem primitives (`createWalletClient`, `writeContract`, manual `prepareTransactionRequest`) as the primary API. This is the wrong layer. We need to use genlayer-js's own client/account factory, which handles ConsensusMain wiring internally.

## Step 1 — Read the docs end-to-end, no skimming

Fetch and read **completely**:

1. https://docs.genlayer.com/api-references/genlayer-js
2. https://docs.genlayer.com/full-documentation.txt — grep specifically for: `createClient`, `createAccount`, `simulateContract`, `writeContract`, `ConsensusMain`, `localnet`, `chain`, `account`, `transport`

Then check actual working code:

3. List files in `node_modules/genlayer-js/dist` (or `lib`, depending on packaging) to see what's exported
4. Open `node_modules/genlayer-js/package.json` — note the `main`, `module`, `exports`, and `types` fields. Read the file at the `types` path for the public API surface.
5. If genlayer-js README exists at `node_modules/genlayer-js/README.md`, read it.

Find the canonical "instantiate a client and call a write method on an intelligent contract from a browser frontend" pattern. The pattern likely involves:
- A genlayer-js chain config object (with localnet/testnet variants)
- An account object built from a private key OR from a Privy embedded wallet signer
- A genlayer-js-specific client created with both
- A `simulateContract` → `writeContract` flow OR a single `writeContract` call — whichever the docs prescribe

If the docs at the first two URLs reference example apps (boilerplate or sample dapps on GitHub), fetch those READMEs and `src/lib/` equivalents. Working example code beats abstract API reference every time.

## Step 2 — Print a diagnosis BEFORE changing code

Output to terminal:

A. What genlayer-js exports (top-level functions/classes from the package)
B. The canonical client/account/write pattern from the docs (a code snippet)
C. The current implementation in `app/src/lib/genlayer.ts` — paste it
D. The specific delta between (B) and (C) — what needs to change

Stop after this output. Do not refactor yet. If anything in steps (A)-(D) is ambiguous or contradictory, ask before proceeding.

## Step 3 — Refactor `app/src/lib/genlayer.ts`

Once the diagnosis is clear and posted, replace the entire client setup with the genlayer-js native pattern.

Required shape:
- Single client factory function (or module-level singleton) that takes an `ActiveWallet` and returns a fully-configured genlayer-js client
- That client's write methods route through ConsensusMain automatically (the SDK handles this — we don't manually specify it)
- Read methods continue to work; verify they still do
- Helpers: `registerUser`, `updateUsername`, `createPromptWarsMatch`, `joinPromptWarsMatch`, `submitPrompt`, `judgeMatch`, `getProfile`, `isUsernameTaken`, `getMatch`, `getRecentMatches`, `getMatchesForPlayer` — all use the new client
- Helper signatures (the function names and arguments) stay the same so calling pages don't need changes

For wallet integration:
- Privy embedded wallets: get the signer/private key access via Privy's `useWallets` hook (consult Privy docs if needed). genlayer-js typically wants a private key string or a viem-compatible account.
- Guest wallets: already a viem-style account in localStorage — pass through to genlayer-js
- External wallets (MetaMask): connect through Privy's external wallet flow; genlayer-js should accept the resulting signer
- Document any sign-in method that doesn't work with the new client as a known limitation in the deliverables — don't break working methods to support edge cases.

## Step 4 — Hard constraints

- **DO NOT** patch viem further. If the docs say to use genlayer-js's `createClient`, use it. No `prepareTransactionRequest` workarounds, no manual chainId injection.
- **DO NOT** upgrade genlayer-js or viem versions unless docs explicitly require it. If they do, STOP and report which version + why.
- **DO NOT** touch contracts, `useActiveWallet`, pages, or components.
- **DO NOT** stub or mock anything. If a write helper can't be implemented with the installed SDK version, report it.

## Step 5 — Verify

Restart cleanly:
```
taskkill /F /IM node.exe
cd app && npm run dev
```

Confirm port 3000 (not 3001/3002). Hard refresh browser.

Manual checks:
1. **Guest signup**: incognito → Continue as Guest → username `final_fix_guest` → Continue → dashboard shows that name, zero console errors
2. **GitHub signin**: regular window → already authenticated as @GIFTEDLOV → dashboard loads cleanly
3. **Create match**: Prompt Wars → Create Match → routes to /prompt-wars/<id> with target text
4. **Full match end-to-end** (two windows, regular + incognito):
   - @GIFTEDLOV creates match, copies link
   - Guest joins via link
   - Both submit prompts
   - Either clicks Judge
   - Both see results screen
   - Both dashboards show updated total_matches / total_wins
5. **My Matches** lobby section shows the completed match for both players

All 5 must pass.

## Step 6 — If stuck after one real attempt

Do NOT try multiple patches. Produce this dump and stop:
- Step 2's diagnosis output (A-D)
- The refactored `app/src/lib/genlayer.ts` (final version you tried)
- Browser console + network errors after the refactor
- `package.json` versions for genlayer-js and viem
- Any docs page that contradicts what you implemented

Better to surface the contradiction than to thrash.

## Commit

After verification:
`fix(genlayer): use genlayer-js native client end-to-end — resolves ConsensusMain routing`

## Out of scope

Tournament features, UI polish, MetaMask GenLayer custom network setup (we'll document later), Phase 2.
