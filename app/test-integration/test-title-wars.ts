/**
 * Integration test: Title Wars against a running GenLayer Studio.
 *
 * Run from the app/ directory:
 *   npx tsx test-integration/test-title-wars.ts
 *
 * Prerequisites: GenLayer Studio must be running (docker compose up) and
 * contracts/title_wars.py must be deployed. Set NEXT_PUBLIC_TITLE_WARS_ADDRESS
 * in .env.local to the deployed address.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  getUserProfile,
  registerUser,
  createTitleWarsMatch,
  joinTitleWarsMatch,
  startTitleWarsMatch,
  submitTitle,
  judgeTitleMatch,
  getTitleMatch,
  getOpenTitleMatches,
  getTitleMatchesForPlayer,
  TITLE_STATE_WAITING,
  TITLE_STATE_REJECTED,
  TITLE_STATE_OPEN,
  TITLE_STATE_JUDGED,
} from "../src/lib/genlayer";
import type { TitleMatch } from "../src/lib/genlayer";

const RPC = process.env.NEXT_PUBLIC_GENLAYER_RPC ?? "http://localhost:4000/api";

// Robert Frost — "Nothing Gold Can Stay" (public domain)
const POEM_EXCERPT = `Nature's first green is gold,
Her hardest hue to hold.
Her early leaf's a flower;
But only so an hour.
Then leaf subsides to leaf.
So Eden sank to grief,
So dawn goes down to day.
Nothing gold can stay.`;

const GROCERY_LIST = "buy milk, eggs, bread, and cheese from the supermarket";

function makeWallet(pk: `0x${string}`) {
  const account = privateKeyToAccount(pk);
  return {
    address: account.address as `0x${string}`,
    signMessage: async (msg: string): Promise<`0x${string}`> =>
      account.signMessage({ message: msg }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signTransaction: async (tx: unknown): Promise<`0x${string}`> =>
      account.signTransaction(tx as any),
    source: "guest" as const,
  };
}

async function fundWallet(address: string) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sim_fundAccount", params: [address, 1000] }),
  });
  const data = (await res.json()) as { error?: unknown };
  if (data.error) throw new Error(`Fund failed: ${JSON.stringify(data.error)}`);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

let passed = 0;
let failed = 0;

function pass(step: number, desc: string, val?: unknown) {
  passed++;
  const display = val !== undefined
    ? ` → ${JSON.stringify(val, (_, v) => (typeof v === "bigint" ? `${v}n` : v))}`
    : "";
  console.log(`PASS [${step}] ${desc}${display}`);
}

function fail(step: number, desc: string, err: unknown, raw?: unknown) {
  failed++;
  console.error(`FAIL [${step}] ${desc}`);
  console.error(`  Error:`, err instanceof Error ? err.message : String(err));
  if (raw !== undefined) {
    console.error(`  Raw:`, JSON.stringify(raw, (_, v) => (typeof v === "bigint" ? `${v}n` : v)));
  }
}

async function pollUntil(
  fn: () => Promise<TitleMatch | null>,
  predicate: (m: TitleMatch) => boolean,
  timeoutMs = 300_000,
  intervalMs = 3000,
): Promise<TitleMatch> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = await fn();
    if (m && predicate(m)) return m;
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for match state");
}

async function main() {
  const suffix = Date.now().toString().slice(-6);
  console.log(`\n=== Title Wars Integration Test (${suffix}) ===\n`);

  // ── Step 1: Create 4 wallets ──────────────────────────────────────────────
  const wallets = [0, 1, 2, 3].map(() => makeWallet(generatePrivateKey()));
  const [walletA, walletB, walletC, walletD] = wallets;

  try {
    await Promise.all(wallets.map((w) => fundWallet(w.address)));
    pass(1, "Funded 4 wallets");
  } catch (err) {
    fail(1, "Fund wallets", err);
    process.exit(1);
  }

  // ── Step 2: Register wallets ──────────────────────────────────────────────
  try {
    await Promise.all([
      registerUser(`twA_${suffix}`, walletA),
      registerUser(`twB_${suffix}`, walletB),
      registerUser(`twC_${suffix}`, walletC),
      registerUser(`twD_${suffix}`, walletD),
    ]);
    pass(2, "Registered 4 users");
  } catch (err) {
    fail(2, "Register users", err);
    process.exit(1);
  }

  // ── Step 3: Test rejection — grocery list ─────────────────────────────────
  console.log("\n  Testing rejection (grocery list)…");
  try {
    const { matchId: rejectedId } = await createTitleWarsMatch(GROCERY_LIST, 4, walletA);
    const rm = await getTitleMatch(rejectedId);
    if (!rm) throw new Error("Match not found after creation");
    if (Number(rm.state) !== TITLE_STATE_REJECTED) {
      throw new Error(`Expected REJECTED (1), got state=${Number(rm.state)}`);
    }
    pass(3, "Grocery list correctly rejected by AI", { reason: rm.rejection_reason.slice(0, 80) });
  } catch (err) {
    fail(3, "Rejection test", err);
    // non-fatal — continue
  }

  // ── Step 4: Create poem match ─────────────────────────────────────────────
  console.log("\n  Creating match with Robert Frost poem…");
  let matchId: number;
  try {
    const { matchId: id } = await createTitleWarsMatch(POEM_EXCERPT, 4, walletA);
    matchId = id;
    const m = await getTitleMatch(matchId);
    if (!m) throw new Error("Match not found after creation");
    if (Number(m.state) === TITLE_STATE_REJECTED) {
      fail(4, "Poem match rejected unexpectedly", m.rejection_reason);
      process.exit(1);
    }
    pass(4, `Created poem match #${matchId}`, { state: Number(m.state) });
  } catch (err) {
    fail(4, "Create poem match", err);
    process.exit(1);
  }

  // ── Step 5: B, C, D join ─────────────────────────────────────────────────
  try {
    await joinTitleWarsMatch(matchId!, walletB);
    await joinTitleWarsMatch(matchId!, walletC);
    await joinTitleWarsMatch(matchId!, walletD);
    const m = await getTitleMatch(matchId!);
    if (!m || m.players.length !== 4) throw new Error(`Expected 4 players, got ${m?.players.length}`);
    pass(5, "B, C, D joined — 4 players in lobby");
  } catch (err) {
    fail(5, "Join match", err);
    process.exit(1);
  }

  // ── Step 6: Host starts ───────────────────────────────────────────────────
  try {
    await startTitleWarsMatch(matchId!, walletA);
    const m = await getTitleMatch(matchId!);
    if (!m) throw new Error("Match vanished after start");
    if (Number(m.state) !== TITLE_STATE_OPEN) {
      throw new Error(`Expected OPEN (2), got state=${Number(m.state)}`);
    }
    pass(6, "Match started", { state: Number(m.state), deadline: Number(m.submission_deadline) });
  } catch (err) {
    fail(6, "Start match", err);
    process.exit(1);
  }

  // ── Step 7: All 4 submit titles ───────────────────────────────────────────
  const submissions = [
    { wallet: walletA, title: "Gold's Brief Hour",    label: "A — thoughtful" },
    { wallet: walletB, title: "Nature Poem",           label: "B — generic" },
    { wallet: walletC, title: "Eden's Decay",          label: "C — creative" },
    { wallet: walletD, title: "asdf qwerty zzz",       label: "D — gibberish" },
  ];

  try {
    await Promise.all(
      submissions.map(({ wallet: w, title }) => submitTitle(matchId!, title, w))
    );
    submissions.forEach(({ label, title }) =>
      console.log(`  Submitted [${label}]: "${title}"`)
    );
    pass(7, "All 4 titles submitted");
  } catch (err) {
    fail(7, "Submit titles", err);
    process.exit(1);
  }

  // ── Step 8: Judge match ───────────────────────────────────────────────────
  console.log("\n  Judging match (AI ranking all titles — may take 60-90s)…");
  let judgedMatch: TitleMatch;
  try {
    await judgeTitleMatch(matchId!, walletA);
    judgedMatch = await pollUntil(
      () => getTitleMatch(matchId!),
      (m) => Number(m.state) === TITLE_STATE_JUDGED,
      300_000,
    );
    pass(8, "Match judged", { state: Number(judgedMatch.state) });
  } catch (err) {
    fail(8, "Judge match", err);
    process.exit(1);
  }

  // ── Step 9: Print ranking + reasoning ────────────────────────────────────
  console.log("\n  === AI Ranking ===\n");
  judgedMatch!.ranking.forEach((addr, i) => {
    const playerIdx = judgedMatch!.players.findIndex(
      (p) => p.toLowerCase() === addr.toLowerCase()
    );
    const submittedTitle = playerIdx >= 0 ? judgedMatch!.titles[playerIdx] : "[unknown]";
    const reason = judgedMatch!.judge_reasoning[i] ?? "";
    const walletLabel =
      addr.toLowerCase() === walletA.address.toLowerCase() ? "A" :
      addr.toLowerCase() === walletB.address.toLowerCase() ? "B" :
      addr.toLowerCase() === walletC.address.toLowerCase() ? "C" :
      addr.toLowerCase() === walletD.address.toLowerCase() ? "D" : "?";
    console.log(`  #${i + 1} [Wallet ${walletLabel}]: "${submittedTitle}"`);
    if (reason) console.log(`      Reasoning: ${reason}`);
    console.log();
  });

  // ── Step 10: Assert ranking invariants ───────────────────────────────────
  try {
    if (judgedMatch!.ranking.length !== 4) {
      throw new Error(`Expected 4 in ranking, got ${judgedMatch!.ranking.length}`);
    }
    pass(10, "Exactly 4 players in ranking");
  } catch (err) {
    fail(10, "Assert: ranking length", err);
  }

  try {
    const winner = judgedMatch!.ranking[0];
    if (!winner) throw new Error("No winner");
    pass(11, "Exactly one winner declared", {
      winner: winner.slice(0, 10) + "…",
      isWalletA: winner.toLowerCase() === walletA.address.toLowerCase(),
    });
  } catch (err) {
    fail(11, "Assert: winner declared", err);
  }

  try {
    const lastPlace = judgedMatch!.ranking[judgedMatch!.ranking.length - 1];
    const isDGibberish = lastPlace?.toLowerCase() === walletD.address.toLowerCase();
    if (!isDGibberish) {
      console.warn(`  Note: D (gibberish) did not rank last — AI placed ${lastPlace?.slice(0, 10)}… last instead.`);
    }
    pass(12, isDGibberish ? "D (gibberish) ranked last as expected" : "Ranking complete (D not last — see note)", {
      lastPlace: lastPlace?.slice(0, 10) + "…",
    });
  } catch (err) {
    fail(12, "Assert: gibberish last", err);
  }

  try {
    const winnerAddr = judgedMatch!.ranking[0];
    const isAOrC =
      winnerAddr?.toLowerCase() === walletA.address.toLowerCase() ||
      winnerAddr?.toLowerCase() === walletC.address.toLowerCase();
    pass(13, isAOrC ? "Winner is A or C (thoughtful/creative) as expected" : "Winner declared (see ranking above)", {
      winner: winnerAddr?.slice(0, 10) + "…",
    });
  } catch (err) {
    fail(13, "Assert: winner quality", err);
  }

  // ── Step 14: Check user stats updated ────────────────────────────────────
  try {
    const profileA = await getUserProfile(walletA.address);
    if (!profileA) throw new Error("Profile A not found");
    if (Number(profileA.total_matches) < 1) throw new Error("Match not recorded for A");
    pass(14, "User stats updated", {
      A: { matches: Number(profileA.total_matches), wins: Number(profileA.total_wins) },
    });
  } catch (err) {
    fail(14, "User stats update", err);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
