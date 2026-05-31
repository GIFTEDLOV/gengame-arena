# Fix: genlayer-js "Method not found" blocking all contract writes

## Symptom

Two screenshots from the user confirm:

1. On `/sign-in/username` after clicking Continue (guest mode, wallet present in store): Console Error **"Method not found"** originating from `node_modules/genlayer-js/dist/index.js:713` via `viem/utils/buildRequest.js:30` and `viem/utils/promise/withRetry.js:24`.

2. On `/prompt-wars` after clicking Create Match: same underlying transaction failure, manifesting as a redirect to `/prompt-wars/<id>` for an ID that doesn't exist on-chain (page renders "Match not found").

The wallet IS being retrieved correctly (good — the `useActiveWallet` hook from the cleanup is working). The issue is downstream: the transaction request itself hits a JSON-RPC method the local Studio doesn't recognize.

## Likely root causes (in order of probability)

1. **genlayer-js client misconfigured.** The genlayer-js client in `src/lib/genlayer.ts` may be using a default viem transport that sends raw `eth_*` RPC methods to the Studio. GenLayer Studio uses its own `gen_*` methods (or similar). Need to use genlayer-js's own client factory, not a viem `createPublicClient`/`createWalletClient` directly.

2. **Wrong client method for writes.** Writing to a GenLayer intelligent contract uses a different code path than reading. If we're calling `client.writeContract(...)` (a viem method), the SDK may not be intercepting it. Genlayer-js typically exposes its own `writeContract` or `simulateAndWrite` or similar — find the current one in the docs.

3. **Version mismatch.** Installed `genlayer-js` version may be ahead of or behind the local Studio version. Check `package.json` for the installed version and check the GenLayer docs/changelog for the matching Studio version.

## Diagnostic steps (run these first, report findings before changing code)

### Step 1: Inspect the current client

Open `app/src/lib/genlayer.ts` and report (paste into terminal output, not into the user's view):
- The full import statements at the top
- How the client is instantiated
- The function signatures of the helpers that perform writes: `registerUser`, `createPromptWarsMatch`, `joinPromptWarsMatch`, `submitPrompt`, `judgeMatch`

### Step 2: Check the installed SDK

Run `cat app/package.json` and report:
- The exact installed version of `genlayer-js`
- The exact installed version of `viem`

### Step 3: Check the latest genlayer-js docs

Fetch https://docs.genlayer.com/api-references/genlayer-js — read it fully. Note specifically:
- How to instantiate the client for localnet
- The correct method names for write operations against intelligent contracts
- Whether `simulateContract` / `writeContract` / `eq_call` / something else is the current pattern
- Any breaking changes between versions

If the docs at that URL are sparse, also fetch https://docs.genlayer.com/full-documentation.txt and grep for "writeContract", "simulateContract", "eq_principle", and "write".

### Step 4: Check the GenLayer Skills plugin

If the `genlayerlabs/skills` plugin is loaded in this Claude Code session, ask it (via `/genlayer-dev` or whatever subcommand) for the canonical pattern to call a write method on a deployed intelligent contract from a Next.js frontend. The plugin is the authoritative source.

### Step 5: Report findings before fixing

After steps 1-4, output a short diagnosis to the terminal:
- What the current code does
- What the docs/plugin say it should do
- The specific change you propose to make

Wait for any clarification needed before making sweeping changes.

## Fix

After the diagnosis, fix `app/src/lib/genlayer.ts` so every write helper uses the correct genlayer-js pattern. The contract DOES work — proved by 51/51 passing pytest tests using `genlayer-test`. The bug is exclusively in the frontend client setup.

Constraints on the fix:
- Do not change `package.json` dependency versions unless the docs explicitly say the installed version is incompatible. If a version bump IS needed, note it clearly so I can confirm before you proceed.
- Do not change the contract code. It works.
- Do not change `useActiveWallet`. It works.
- Touch only `src/lib/genlayer.ts` and the helpers it exports. Pages should not need changes — they consume the helpers.

## Verification

After the fix:

1. Restart dev server (kill all old node processes first with `taskkill /F /IM node.exe` on Windows or `pkill node` on Mac/Linux, then `cd app && npm run dev`)
2. Hard refresh browser
3. Sign in as guest → pick username "test_guest_fix" → Continue → **must land on dashboard with that username shown**
4. Click Prompt Wars card → click Create Match → **must route to /prompt-wars/<real_id> with the target text visible**
5. Open DevTools Network tab during steps 3-4 — no "Method not found" errors, all RPC requests return 200

## Commit

After verification: `fix(genlayer): use correct genlayer-js write API to resolve Method not found`

## If the fix involves upgrading genlayer-js

Stop and report the proposed version change. Do not upgrade without confirmation — version bumps can cascade into other issues.

## Out of scope

Don't touch any other open TODOs in this session. The deadline countdown and My Matches list (from the previous cleanup) should already be in place; if they aren't, leave them — we'll come back. Focus only on the Method not found bug.
