# Gengame Arena

A competitive gaming web app built on [GenLayer](https://genlayer.com) that hosts 4 AI-judged tournament games. Smart contracts run as Python Intelligent Contracts on GenVM; AI validators reach consensus on game outcomes on-chain.

---

## The 4 Games

| Game | Format | Description |
|---|---|---|
| **Prompt Wars** | Live scheduled tournaments | Players craft prompts; AI judges the best |
| **Real-World Predictions** | Async brackets (1–7 day windows) | Predict real-world outcomes; AI resolves disputes |
| **Trivia Royale** | Live battle royale | Multiplayer trivia; AI judges edge-case answers |
| **Title Wars** | Live scheduled | Submit titles for short poems/stories; AI picks the best fit |

> **Phase 0 only**: Foundation, auth, and user registry contract. Games are placeholders — coming in later phases.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 App Router + TypeScript + Tailwind CSS |
| Auth | Privy SDK (`@privy-io/react-auth`) — GitHub OAuth, email magic link, wallet connect, embedded wallets |
| Chain SDK | `genlayer-js` |
| Smart Contracts | Python Intelligent Contracts on GenLayer (localnet → testnet) |
| Tests | pytest + genlayer-test |
| State (future) | Zustand (client), Supabase (matchmaking — not yet wired) |

---

## Repository Structure

```
gengame-arena/
├── README.md
├── .env.example              # root-level env vars (Python/scripts)
├── requirements.txt          # Python deps for contracts + tests
├── contracts/
│   └── user_registry.py      # Phase 0 Intelligent Contract
├── scripts/
│   └── deploy_user_registry.py
├── test/
│   └── test_user_registry.py
└── app/                      # Next.js frontend
    ├── .env.example
    ├── package.json
    └── src/
        ├── app/              # App Router pages
        ├── components/       # Shared UI + providers
        ├── lib/              # Chain client + auth helpers
        └── types/
```

---

## Prerequisites

- Node.js 18+
- Python 3.11+
- Docker (for GenLayer Studio localnet)
- [GenLayer CLI](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-cli): `npm install -g genlayer`

---

## Setup

### 1. Clone & install Python deps

```bash
git clone <repo-url>
cd gengame-arena
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# fill in values — see comments inside .env.example
cd app
cp .env.example .env.local
# fill in NEXT_PUBLIC_PRIVY_APP_ID and NEXT_PUBLIC_USER_REGISTRY_ADDRESS
```

### 3. Start GenLayer Studio (localnet)

```bash
genlayer up
```

### 4. Deploy the user registry contract

```bash
genlayer deploy contracts/user_registry.py
# or use the helper script:
python scripts/deploy_user_registry.py
```

Copy the printed contract address into `app/.env.local` as `NEXT_PUBLIC_USER_REGISTRY_ADDRESS`.

### 5. Run contract tests

```bash
pytest test/
```

### 6. Run the frontend

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Auth Flows

1. **GitHub OAuth** — via Privy; embedded wallet created automatically for users without one
2. **Email magic link** — via Privy
3. **External wallet** — connect MetaMask or any EVM wallet; add Studio localnet as custom RPC
4. **Guest** — ephemeral viem wallet generated in-browser; private key stored in `localStorage`

After any sign-in method, new users are routed to `/sign-in/username` to pick a unique on-chain username. Returning users go straight to `/dashboard`.

---

## Environment Variables

### Root `.env`

```
# No secrets needed at root level yet — placeholder for future CLI scripts
GENLAYER_NETWORK=localnet
```

### `app/.env.local`

```
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id-here
NEXT_PUBLIC_GENLAYER_NETWORK=localnet
NEXT_PUBLIC_USER_REGISTRY_ADDRESS=0x...deployed-address...
```

---

## Open TODOs

- [ ] ACL on `record_match` — once game contracts are deployed, only they should call it
- [ ] Guest account upgrade flow (guest → email/GitHub)
- [ ] Supabase matchmaking integration (Phase 2+)
- [ ] Testnet deployment config
