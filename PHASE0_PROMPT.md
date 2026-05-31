# Gengame Arena — Phase 0 Build Brief

We're building **Gengame Arena** — a competitive gaming web app on GenLayer that will host 4 AI-judged tournament games. This document is **PHASE 0 only**: foundation, auth system, and user registry contract. No games yet — they come in later phases.

Read this entire file before starting. Execute the steps in order. Commit to git after each major step.

---

## Context: what GenLayer is

GenLayer is an AI-adjudication blockchain. Intelligent Contracts are Python files that run on GenVM and are validated by AI consensus — validators run LLMs to judge results. Frontend talks to chain via the GenLayerJS SDK.

- Docs root: https://docs.genlayer.com
- Bulk docs reference (fetch this if you need to look up specific APIs): https://docs.genlayer.com/full-documentation.txt
- Official Claude Code plugin we should use: `genlayerlabs/skills`

---

## Final tech stack (do not deviate)

- **Frontend**: Next.js 14 App Router + TypeScript + Tailwind CSS
- **Auth**: Privy SDK (`@privy-io/react-auth`) — handles GitHub OAuth, email magic link, external wallet connect, and embedded-wallet creation
- **Chain SDK**: `genlayer-js`
- **Smart contracts**: Python intelligent contracts deployed to GenLayer Studio (localnet for dev, testnet later)
- **Tests**: pytest + genlayer-test
- **Future (do NOT add now, just leave hooks)**: Supabase for matchmaking

---

## Games we will build in later phases — DO NOT BUILD NOW, just create placeholder pages

1. Prompt Wars (live scheduled tournaments)
2. Real-World Predictions (async brackets, 1-7 day event windows)
3. Trivia Royale (live battle royale tournaments)
4. Title Wars (live scheduled — players submit titles for short poems or stories, AI judges best fit)

---

## Step 1: Install the GenLayer Claude Code plugin

Run inside this Claude Code session:
```
/plugin marketplace add genlayerlabs/skills
/genlayer-dev
```

Then continue with the rest of this document.

---

## Step 2: Initialize repo

- The current working directory is already `gengame-arena` — work inside it, don't create another wrapper folder
- `git init` and commit at the end of each major step so we have checkpoints
- Create a README covering: project overview, the 4 games, tech stack, setup instructions, how to run locally

---

## Step 3: Directory structure to scaffold

```
gengame-arena/
├── README.md
├── .env.example
├── requirements.txt
├── contracts/
│   └── user_registry.py
├── scripts/
│   └── deploy_user_registry.py
├── test/
│   └── test_user_registry.py
└── app/                              # Next.js frontend
    ├── .env.example
    ├── package.json
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── page.tsx              # landing
        │   ├── sign-in/
        │   │   ├── page.tsx          # 4 sign-in options
        │   │   └── username/page.tsx # one-time username pick
        │   ├── dashboard/page.tsx    # post-auth home, shows 4 game cards
        │   ├── prompt-wars/page.tsx  # placeholder "Coming soon"
        │   ├── predictions/page.tsx  # placeholder
        │   ├── trivia-royale/page.tsx # placeholder
        │   └── title-wars/page.tsx   # placeholder
        ├── components/
        │   ├── Providers.tsx         # wraps PrivyProvider
        │   ├── Navbar.tsx
        │   └── AuthGuard.tsx
        ├── lib/
        │   ├── genlayer.ts           # GenLayerJS client singleton
        │   ├── user.ts               # registerUser / getProfile helpers
        │   └── guest.ts              # guest wallet generation + storage
        └── types/
            └── user.ts
```

---

## Step 4: Build `contracts/user_registry.py`

Follow GenLayer's intelligent contract patterns. Reference docs while writing:
- https://docs.genlayer.com/developers/intelligent-contracts/first-contract
- https://docs.genlayer.com/developers/intelligent-contracts/examples/user-storage
- https://docs.genlayer.com/developers/intelligent-contracts/storage
- https://docs.genlayer.com/developers/intelligent-contracts/types/dataclasses

**Spec:**

- Dataclass `UserProfile`:
  - `username: str`
  - `joined_at: u64` (block timestamp)
  - `total_matches: u32`
  - `total_wins: u32`

- Storage:
  - `profiles: TreeMap[Address, UserProfile]`
  - `username_to_address: TreeMap[str, Address]` — key is `username.lower()` for case-insensitive uniqueness

- Public write methods:
  - `register_user(username: str)` — registers `msg.sender`; reverts if caller already registered, username taken, or username invalid
  - `update_username(new_username: str)` — caller renames; reverts if not registered or new name taken
  - `record_match(player: Address, won: bool)` — increments stats. For now anyone can call — leave a TODO comment for ACL once game contracts exist

- Public read methods:
  - `get_profile(addr: Address) -> Optional[UserProfile]`
  - `address_of(username: str) -> Optional[Address]`
  - `is_username_taken(username: str) -> bool`

- Username validation:
  - length 3 to 20
  - allowed chars: `a-z`, `A-Z`, `0-9`, underscore
  - uniqueness is case-insensitive but original casing is preserved for display

This is fully deterministic — no LLM calls in this contract.

---

## Step 5: Tests at `test/test_user_registry.py`

Use genlayer-test (https://docs.genlayer.com/api-references/genlayer-test). Cover:
- Successful registration + profile readback
- Duplicate address rejected
- Duplicate username rejected (case-insensitive: "Alice" then "alice" must fail)
- Invalid usernames rejected (too short, too long, has space, has dash, has special char)
- `update_username` works and frees old name
- `record_match` correctly increments counters
- `get_profile` returns None for unregistered address

All tests must pass.

---

## Step 6: Deploy contract locally

Use the GenLayer CLI:
```
genlayer init
genlayer up                                  # start local Studio
genlayer deploy contracts/user_registry.py
```

Capture the deployed address — write a small helper script that prints it cleanly so we can copy it into the frontend env.

---

## Step 7: Scaffold Next.js app

```
cd app
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*"
npm install @privy-io/react-auth genlayer-js viem zustand
```

---

## Step 8: Privy setup (`src/components/Providers.tsx`)

Wrap the app in `PrivyProvider` with config:
```
loginMethods: ['github', 'email', 'wallet']
embeddedWallets: { createOnLogin: 'users-without-wallets' }
appearance: { theme: 'dark' }
```

Env var: `NEXT_PUBLIC_PRIVY_APP_ID` — placeholder `"your-privy-app-id-here"` in `.env.example`.

---

## Step 9: Guest mode (`src/lib/guest.ts`)

Guest doesn't use Privy. The "Continue as guest" button:
1. Generates an ephemeral wallet with viem's `generatePrivateKey` + `privateKeyToAccount`
2. Stores private key in localStorage under key `arena_guest_wallet`
3. Sets a guest flag in a small Zustand auth store
4. Routes to `/sign-in/username`

The guest wallet is a real EVM/GenLayer-compatible wallet. Warn the user in the UI that clearing browser data loses their guest identity, and offer to "upgrade to email/GitHub later" (note as TODO for now).

---

## Step 10: GenLayer client (`src/lib/genlayer.ts`)

Create a singleton GenLayerJS client. Use Studio localnet by default, with `NEXT_PUBLIC_GENLAYER_NETWORK` env var to switch to testnet later. Export typed helpers:
- `registerUser(username: string): Promise<TxHash>`
- `getProfile(address: Address): Promise<UserProfile | null>`
- `isUsernameTaken(username: string): Promise<boolean>`

Pull `NEXT_PUBLIC_USER_REGISTRY_ADDRESS` from env.

---

## Step 11: Sign-in routing logic

After auth (Privy success OR guest creation):
1. Read wallet address from Privy or guest store
2. Call `getProfile(address)`
3. If profile exists → `/dashboard`
4. If profile is null → `/sign-in/username`

On username form submit:
- Client-side validate (length, characters) BEFORE sending tx
- Call `isUsernameTaken` first for fast feedback
- Call `registerUser`, await receipt
- On success → `/dashboard`
- On revert → surface error message in UI

---

## Step 12: Minimal page layouts (no design polish yet — function over form)

- **`/` (landing)**: centered card. Title "Gengame Arena". Subtitle "AI-judged tournament games on GenLayer". CTA button "Sign in / Play" → `/sign-in`
- **`/sign-in`**: 4 stacked buttons: "Continue with GitHub", "Continue with email", "Connect wallet", "Continue as guest"
- **`/sign-in/username`**: input + submit. Live availability check on blur.
- **`/dashboard`**: Navbar shows username + total matches + total wins. Body has 4 cards in a grid, one per game, each linking to its placeholder page.
- **4 placeholder pages**: "Coming soon — [game name]" + back-to-dashboard link

Use `AuthGuard` component on `/dashboard`, `/sign-in/username`, and the 4 game pages — redirect to `/sign-in` if no auth.

---

## Step 13: Verify everything end-to-end

1. `pytest test/` — all green
2. `genlayer up` — Studio running, contract deployed
3. `cd app && npm run dev` — frontend running
4. Manual smoke test, with screenshots/logs printed:
   - Sign in via GitHub → pick username `alice_test` → dashboard shows `alice_test`
   - Sign out, sign in again with same GitHub account → dashboard shows `alice_test` immediately (proves on-chain persistence)
   - Sign in via email → different username flow → works
   - Sign in via wallet (MetaMask, with Studio localnet added as custom network) → works
   - Sign in as guest → works, gets a generated wallet
   - Try to register username `Alice_Test` (case variant of existing) → rejected with clear error

---

## Deliverables to print at the end

1. Deployed `user_registry` contract address
2. Pytest output showing all tests pass
3. Confirmation each of the 4 sign-in methods works
4. List of any open TODOs or unresolved questions
5. Git log showing checkpoint commits

**DO NOT build any of the 4 games. Stop after Phase 0 verification and wait for the next prompt.**
