# Gengame Arena

**Four AI-judged competitive games on GenLayer testnet.**

🎮 **Live**: https://gengame-arena.vercel.app
📜 **Explorer**: https://explorer-bradbury.genlayer.com
🚰 **Faucet**: https://testnet-faucet.genlayer.foundation

---

## What it is

Gengame Arena is a gaming dapp built on **GenLayer Bradbury testnet**, where every match outcome is judged by AI validators reaching consensus across the network. There's no centralized backend judging player submissions — the chain itself runs LLMs across distributed validators to score creative prompts, predict real-world events, validate trivia answers, and rank literary titles.

Four games run in the same arena:

| Game | What you do | How AI judges it |
|---|---|---|
| **Prompt Wars** | Submit a prompt that best matches a target | Validators rank prompts by how well they elicit the target output |
| **Real-World Predictions** | Predict binary outcomes (Yes/No) or numeric values | Validators fetch real web data on resolution day and score accuracy |
| **Trivia Royale** | Answer AI-generated questions before time runs out | Validators verify answers against canonical sources |
| **Title Wars** | Submit a title for a generated poem or short story | Validators rank titles by literary fit, evocativeness, and craft |

Every game shows **5 new AI-generated matches per day** (creator wallet: `0x0000...DA17A1`, representing the validator network itself). Users compete against each other on the same daily content.

---

## How to play

1. Open https://gengame-arena.vercel.app
2. **Sign in** — choose Guest, Email, GitHub, or connect a wallet
3. Browse the dashboard, see daily matches, check leaderboards (no GEN needed for browsing)
4. When ready to play, **fund your wallet**:
   - Copy your wallet address from the wallet status bar
   - Visit the [Bradbury faucet](https://testnet-faucet.genlayer.foundation)
   - Paste your address, claim 100 free testnet GEN (rate-limited to once per 7 days)
5. **Set a username** via the wallet status bar (one-time on-chain registration)
6. **Join or create matches** in any of the 4 games

---

## Architecture

### Intelligent contracts (Python)

Five Python intelligent contracts deployed to Bradbury testnet:

| Contract | Address |
|---|---|
| `UserRegistry` | `0x42fCFf2df6FFE90dF487FF8Be1724135d465755F` |
| `PromptWars` | `0x2434A49958176eEdC5d2Fb634eCB500B3278eC57` |
| `Predictions` | `0x6682d4059b789145A4B1C40D51A0011867eB3d50` |
| `TriviaRoyale` | `0x92493FDA93ECF475ba5f9Ece1FBE8CE514Aca3DA` |
| `TitleWars` | `0xA25EF9797a273021756A93EE77F6456aa4a94Bb8` |

Each game contract uses **GenLayer's `eq_principle` pattern** to invoke validator LLMs for judging — ranking submissions, validating answers, fetching real-world data, scoring creativity. AI consensus replaces the role a centralized backend would otherwise play.

### Frontend (Next.js + TypeScript)

- **Next.js 15** App Router with TypeScript and Tailwind CSS
- **Privy SDK** for authentication — supports Guest, Email, GitHub, and external wallet sign-in. Embedded wallets are generated transparently for non-wallet sign-in methods.
- **genlayer-js v1.2.0** for chain interaction, with the `testnetBradbury` chain spec
- **Lazy registration** — users can browse the dapp without funding their wallet; registration is only required at the moment of taking a gas-paid action
- **Wallet status bar** — displays the user's address, balance, and faucet CTA on every page after sign-in
- **Friendly error toasts** — raw RPC errors are mapped to human-readable messages with relevant CTAs (e.g., "Wallet needs testnet GEN — claim from faucet")
- **Match settling states** — when a write transaction is pending consensus, the UI shows "validators reaching consensus (~30-90s)" rather than appearing broken

### Daily AI-generated content

A cron-signer wallet (`0x82a983325DE92AEDe126C18e9fE3b53da1ab3329`) triggers `generate_daily_content_if_due()` on all 4 contracts once per day. Each call instructs validator LLMs to generate the day's official matches:

- Prompt Wars: 5 fresh creative prompt-target pairs
- Predictions: 5 real-world prediction markets with resolution windows of 1-7 days
- Trivia Royale: 5 trivia topics with AI-generated question sets
- Title Wars: 5 short literary excerpts awaiting community titles

Daily content is gated on-chain by a UTC timestamp — re-calls within the same day revert with `[EXPECTED] Daily content already generated today`, so duplicate triggers are safe.

### Auto-resolving deadlines

Matches with time-based deadlines (e.g., Predictions resolution dates, Trivia Royale rounds) are auto-resolved by distributed frontend polling. When any user's browser detects an expired match, it submits a resolution call. The contract's `[EXPECTED]` revert handling means redundant calls are cheap and safe.

### Leaderboards

Per-game leaderboards rank players by wins. The `DAILY_SENTINEL` address (`0x0000...DA17A1`) — representing matches created by validators rather than players — is filtered out so real players are visible.

---

## Known limitations

This dapp is deployed to **Bradbury testnet**, which is an active public testnet currently in regular use. A few honest notes:

- **Bradbury consensus is intentionally slow.** Write transactions go through validator LLM consensus across the network. Expected time per write is 30-90 seconds. During testnet congestion this can extend.
- **Faucet rate limit.** The Bradbury faucet allows 100 GEN per address every 7 days. New users have to claim before playing.
- **Daily content cron is currently manual.** The GitHub Actions cron is configured but disabled pending npm lock file sync resolution. Daily content is triggered via local script run (`npx tsx app/scripts/cron-generate-daily.ts`). The on-chain timestamp gate prevents duplicate generation regardless of trigger source.
- **Each sign-in method creates a separate wallet.** Email, GitHub, Guest, and external wallets are treated as distinct identities. Cross-method identity linking is on the roadmap for future iterations.
- **Some frontend polish remains.** Rate-limit-induced flicker on read-heavy pages, the slow registration spinner, and per-game leaderboard tuning are post-submission iterations.

These are testnet realities, not architectural blockers. Mainnet performance will improve substantially when GenLayer's mainnet launches.

---

## Tech stack

| Layer | Tech |
|---|---|
| Smart contracts | Python intelligent contracts (GenLayer GenVM) |
| Chain | GenLayer Bradbury testnet (chain ID 4221) |
| Frontend | Next.js 15.3.2, TypeScript, Tailwind CSS |
| Authentication | Privy SDK (multi-method) |
| Wallet interaction | genlayer-js v1.2.0, viem |
| Testing | pytest with genlayer-test |
| Deployment | Vercel (frontend), GenLayer CLI 0.39.1 (contracts) |
| AI judging | Validator LLMs running per-tx consensus on Bradbury |

---

## Local development

### Prerequisites

- Node.js 18+ and npm
- Python 3.11+
- GenLayer CLI: `npm install -g genlayer`
- A funded GenLayer wallet (use the faucet for testnet)

### Frontend

```bash
cd app
npm install
cp .env.example .env.local
# Fill in NEXT_PUBLIC_GENLAYER_RPC, contract addresses, Privy app ID
npm run dev
# Open http://localhost:3000
```

### Contracts

```bash
# Deploy a contract
genlayer network set testnet-bradbury
genlayer account use <your-account>
genlayer deploy contracts/<file>.py
```

### Daily content (manual trigger)

```bash
cd app
$env:GENLAYER_RPC_URL = "https://rpc-bradbury.genlayer.com"
$env:CRON_SIGNER_PRIVATE_KEY = "0x..."
$env:PROMPT_WARS_ADDRESS = "0x2434..."
$env:PREDICTIONS_ADDRESS = "0x6682..."
$env:TRIVIA_ROYALE_ADDRESS = "0x9249..."
$env:TITLE_WARS_ADDRESS = "0xA25E..."
npx tsx scripts/cron-generate-daily.ts
```

---

## Project structure

```
gengame-arena/
├── app/                          # Next.js frontend
│   ├── src/
│   │   ├── app/                  # Routes (dashboard, 4 games, sign-in)
│   │   ├── components/           # UI components (WalletStatusBar, TxButton, etc.)
│   │   ├── lib/                  # genlayer.ts client, contexts, helpers
│   │   └── ...
│   ├── scripts/
│   │   └── cron-generate-daily.ts  # Daily content trigger
│   └── ...
├── contracts/                    # Python intelligent contracts
│   ├── user_registry.py
│   ├── prompt_wars.py
│   ├── predictions.py
│   ├── trivia_royale.py
│   └── title_wars.py
├── tests/                        # pytest integration tests
└── README.md
```

---

## Credits

Built for the GenLayer ecosystem hackathon by [@GIFTEDLOV](https://github.com/GIFTEDLOV).

Contracts judged by the open GenLayer validator network. Faucet provided by the GenLayer Foundation.

GenLayer documentation: https://docs.genlayer.com
GenLayer Discord: https://discord.gg/genlayer

---

## License

MIT (see `LICENSE` if included)
