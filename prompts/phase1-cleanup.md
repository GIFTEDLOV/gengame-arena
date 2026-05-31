# Phase 1 Cleanup: Wallet hook + deadline countdown + My Matches

Three fixes/additions to complete Phase 1 verification. The first is blocking (we can't play a match without it). The other two were flagged as open TODOs in the Phase 1 deliverables and are small enough to do together.

---

## Fix 1 (BLOCKING) — "No wallet found" error on Prompt Wars page

### Symptom

User is signed in via GitHub (Privy embedded wallet). Dashboard correctly shows their username `@GIFTEDLOV` pulled from the on-chain user_registry. But clicking **Create Match** on `/prompt-wars` triggers an alert: **"No wallet found. Please sign in first."**

### Root cause

The Prompt Wars page is checking wallet availability from a different source than the dashboard. Likely candidates: it's only reading from the guest store in `src/lib/guest.ts` and ignoring Privy embedded wallets, or only reading `usePrivy()` and ignoring guest sessions. The dashboard works because it uses a different code path.

### Fix — centralize wallet retrieval into one hook

Create a new file `src/lib/useActiveWallet.ts` (or `.tsx` if needed) that exports a single React hook:

```tsx
'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useGuestStore } from './guest'; // or wherever the guest Zustand store lives
import { useEffect, useState } from 'react';

export type ActiveWallet = {
  address: `0x${string}`;
  signMessage: (msg: string) => Promise<string>;
  signTransaction: (tx: unknown) => Promise<string>;
  source: 'privy' | 'guest';
} | null;

export function useActiveWallet(): { wallet: ActiveWallet; ready: boolean } {
  // 1. Wait for Privy to be ready
  // 2. If Privy authenticated AND has at least one wallet (embedded or external), return it as { source: 'privy' }
  // 3. Else, check the guest store for a guest wallet; if present, return as { source: 'guest' }
  // 4. Else, return null
  // ready === false until Privy reports ready (prevents flash-of-no-wallet bugs)
}
```

Then refactor **every page and helper that needs a wallet** to use this hook instead of reading Privy or the guest store directly. Specifically:

- `app/src/app/prompt-wars/page.tsx` (the lobby — Create Match button)
- `app/src/app/prompt-wars/[matchId]/page.tsx` (match page — Join, Submit, Judge buttons)
- `app/src/app/dashboard/page.tsx` (replace whatever it's doing today with the new hook for consistency)
- `app/src/app/sign-in/username/page.tsx` (the username-pick page that calls register_user)
- Any other page that needs to sign a transaction or read the active wallet address

### Update genlayer.ts helpers

The helpers in `src/lib/genlayer.ts` (`createPromptWarsMatch`, `submitPrompt`, `judgeMatch`, `registerUser`, etc.) currently must be receiving a wallet somehow. Update their signatures so they accept the `ActiveWallet` returned from `useActiveWallet`, rather than fetching it themselves. This makes the data flow explicit:

```
useActiveWallet() → wallet
→ pass wallet to helper: createPromptWarsMatch(wallet)
→ helper signs tx with wallet, returns tx hash
```

### Verification of Fix 1

After the refactor:
1. Restart dev server (`Ctrl+C` then `npm run dev`)
2. Hard refresh browser
3. Sign in via GitHub → go to `/prompt-wars` → click **Create Match** → should NOT see "No wallet found." Should see a loading state, then route to `/prompt-wars/<id>` with the target shown.
4. Sign in via guest (incognito) → go to `/prompt-wars` → click **Create Match** → same behavior, no error.

---

## Fix 2 — Submission deadline countdown in match UI

The contract enforces a 5-minute submission window via `submission_deadline`, but the frontend doesn't show players a timer. Currently they have to guess how long they have.

### Spec

In `app/src/app/prompt-wars/[matchId]/page.tsx`, when the match state is `BOTH_JOINED` or `ONE_SUBMITTED` (i.e. submissions are open):

- Display a countdown in the format `MM:SS remaining` near the top of the match view
- Updates every second
- When time reaches `00:00`, show `"Time's up"` and disable the submit button
- The countdown is computed from `match.submission_deadline - currentBlockTimestamp` — fetch current block timestamp from GenLayerJS, or use client time with a small drift tolerance (max 5 seconds drift acceptable for an MVP)
- Color: white above 1:00, amber from 1:00 to 0:10, red below 0:10

Don't over-engineer this. A simple `useEffect` with a `setInterval` is fine.

---

## Fix 3 — "My Matches" view

`prompt_wars.py` already has `get_matches_for_player(player: Address) -> list[u64]`. Wire it up to a frontend view.

### Spec

On `/prompt-wars` (the lobby), add a new section **above** "Recent Matches" titled **"My Matches"**:

- Only shown when the user has at least one match
- Calls `get_matches_for_player(wallet.address)` on the prompt_wars contract
- For each match ID, also fetches the match details via `get_match(matchId)`
- Renders the same row format as Recent Matches: target snippet, both players, state badge, winner (if judged)
- Click row → routes to that match's page

### Why this matters

Players need a way to find their in-progress matches without bookmarking each match URL. Without this, if a player closes their browser mid-match, they lose track of the match.

---

## Verification (all three fixes together)

End-to-end manual test — this is the real validation Phase 1 is done:

1. Restart dev server, hard refresh
2. **Regular window** (signed in as @GIFTEDLOV via GitHub): go to `/prompt-wars`, click **Create Match**, copy the match URL
3. **Incognito window** (sign in as guest with username `guest_player`): paste the URL, click **Join match**
4. Both windows see the same target and a live countdown timer
5. Both windows type a prompt and submit before the timer hits zero
6. Either window clicks **Judge now**
7. Both windows see the same results screen with the same declared winner
8. Both go back to `/prompt-wars` — the completed match appears in **My Matches** for both players
9. Both go to `/dashboard` — `total_matches` is 1 for both, `total_wins` is 1 for the winner

If all 9 steps pass, Phase 1 is genuinely complete.

---

## Commits

After each fix, commit separately:
- `fix(wallet): centralize wallet retrieval into useActiveWallet hook`
- `feat(prompt-wars): submission deadline countdown in match UI`
- `feat(prompt-wars): My Matches section in lobby`

---

## Out of scope for this cleanup

- Tournament brackets, matchmaking queues (still deferred)
- Mobile UI polish
- Real-time updates via WebSocket (3-second polling still fine)
- Refactoring beyond what's listed above

Stop after the verification 9 steps pass and wait for the next prompt.
