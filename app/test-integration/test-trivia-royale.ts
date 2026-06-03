/**
 * Integration test: Trivia Royale against a running GenLayer Studio.
 *
 * Run from the app/ directory:
 *   npx tsx test-integration/test-trivia-royale.ts
 *
 * Prerequisites: GenLayer Studio must be running (docker compose up) and
 * contracts/trivia_royale.py must be deployed. Set NEXT_PUBLIC_TRIVIA_ROYALE_ADDRESS
 * in .env.local to the deployed address.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  getUserProfile,
  registerUser,
  createTriviaMatch,
  joinTriviaMatch,
  startTriviaMatch,
  submitTriviaAnswer,
  resolveTriviaRound,
  getTriviaMatch,
  getOpenTriviaMatches,
  getTriviaMatchesForPlayer,
  TRIVIA_STATE_WAITING,
  TRIVIA_STATE_IN_PROGRESS,
  TRIVIA_STATE_ENDED,
  TRIVIA_STATE_CANCELLED,
} from "../src/lib/genlayer";
import type { TriviaMatch, TriviaQuestion } from "../src/lib/genlayer";

const RPC = process.env.NEXT_PUBLIC_GENLAYER_RPC ?? "http://localhost:4000/api";

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
  fn: () => Promise<TriviaMatch | null>,
  predicate: (m: TriviaMatch) => boolean,
  timeoutMs = 180_000,
  intervalMs = 3000,
): Promise<TriviaMatch> {
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
  console.log(`\n=== Trivia Royale Integration Test (${suffix}) ===\n`);

  // ── Step 1: Create 4 wallets ───────────────────────────────────────────────
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
      registerUser(`triviaA_${suffix}`, walletA),
      registerUser(`triviaB_${suffix}`, walletB),
      registerUser(`triviaC_${suffix}`, walletC),
      registerUser(`triviaD_${suffix}`, walletD),
    ]);
    pass(2, "Registered 4 users", [`triviaA_${suffix}`, `triviaB_${suffix}`, `triviaC_${suffix}`, `triviaD_${suffix}`]);
  } catch (err) {
    fail(2, "Register users", err);
    process.exit(1);
  }

  // ── Step 3: Create match ──────────────────────────────────────────────────
  let matchId: number;
  try {
    const { matchId: id } = await createTriviaMatch("Football transfers", 4, walletA);
    matchId = id;
    const m = await getTriviaMatch(matchId);
    if (!m) throw new Error("Match not found after creation");
    if (Number(m.state) === TRIVIA_STATE_CANCELLED) {
      console.warn(`  Topic was rejected: ${m.rejection_reason}`);
      fail(3, "Create match — topic rejected by AI", m.rejection_reason);
      process.exit(1);
    }
    pass(3, `Created match #${matchId}`, { topic: m.topic, state: Number(m.state) });
  } catch (err) {
    fail(3, "Create match", err);
    process.exit(1);
  }

  // ── Step 4: Wallets B, C, D join ─────────────────────────────────────────
  try {
    await joinTriviaMatch(matchId!, walletB);
    await joinTriviaMatch(matchId!, walletC);
    await joinTriviaMatch(matchId!, walletD);
    const m = await getTriviaMatch(matchId!);
    if (!m || m.players.length !== 4) throw new Error(`Expected 4 players, got ${m?.players.length}`);
    pass(4, "B, C, D joined — 4 players in lobby");
  } catch (err) {
    fail(4, "Join match", err);
    process.exit(1);
  }

  // ── Step 5: Host (A) starts ───────────────────────────────────────────────
  console.log("\n  Starting match (AI generating questions — may take 60-90s)…");
  try {
    await startTriviaMatch(matchId!, walletA);
    const m = await getTriviaMatch(matchId!);
    if (!m) throw new Error("Match vanished after start");
    const state = Number(m.state);
    if (state !== TRIVIA_STATE_IN_PROGRESS) throw new Error(`Unexpected state after start: ${state}`);
    pass(5, "Match started", { state, questionCount: m.questions.length });
  } catch (err) {
    fail(5, "Start match", err);
    process.exit(1);
  }

  // ── Step 6: Print generated questions ────────────────────────────────────
  let match = await getTriviaMatch(matchId!);
  if (match && match.questions.length > 0) {
    console.log(`\n  Generated ${match.questions.length} questions. First 3:\n`);
    match.questions.slice(0, 3).forEach((q: TriviaQuestion, i: number) => {
      console.log(`  Q${i + 1} [${q.type}]: ${q.text}`);
      if (q.type === "mc") {
        q.options.forEach((opt) => console.log(`    ${opt}`));
        console.log(`    Correct: ${q.correct_answer}`);
      } else {
        console.log(`    Canonical: ${q.correct_answer}`);
        if (q.alternates?.length) console.log(`    Alternates: ${q.alternates.join(", ")}`);
      }
      console.log();
    });
    if (match.questions.length > 3) {
      console.log(`  … and ${match.questions.length - 3} more questions.\n`);
    }
    pass(6, "Question pool generated and printed");
  } else {
    fail(6, "No questions generated", "questions array is empty");
  }

  // ── Steps 7-9: Play through rounds ────────────────────────────────────────
  let roundsPlayed = 0;
  let eliminationHappened = false;

  for (let round = 0; round < 15; round++) {
    match = await getTriviaMatch(matchId!);
    if (!match) break;

    const state = Number(match.state);
    if (state === TRIVIA_STATE_ENDED) break;
    if (state !== TRIVIA_STATE_IN_PROGRESS) {
      console.log(`  Round ${round + 1}: state=${state}, skipping`);
      await sleep(3000);
      continue;
    }

    const q = match.questions[Number(match.current_round)];
    if (!q) break;

    const survivors = match.players.filter(
      (p) => !match!.eliminated.some((e) => e.toLowerCase() === p.toLowerCase())
    );
    if (survivors.length <= 1) break;

    console.log(`\n  === Round ${round + 1} [${q.type}] ===`);
    console.log(`  Q: ${q.text}`);
    console.log(`  Survivors: ${survivors.length}`);

    // Determine answers per wallet
    const answers: Array<{ wallet: typeof walletA; answer: string; label: string }> = [];

    for (const w of [walletA, walletB, walletC, walletD]) {
      if (!survivors.some((s) => s.toLowerCase() === w.address.toLowerCase())) continue;

      let answer: string;
      let label: string;

      if (q.type === "mc") {
        if (w === walletA) {
          // A always correct
          answer = q.correct_answer;
          label = "correct";
        } else {
          // Others pick randomly (may or may not be correct)
          const letters = ["A", "B", "C", "D"];
          answer = letters[Math.floor(Math.random() * letters.length)];
          label = answer === q.correct_answer ? "correct (lucky)" : "wrong";
        }
      } else {
        // Open-ended
        if (w === walletA) {
          answer = q.correct_answer;
          label = "canonical answer";
        } else if (w === walletB) {
          // Slight typo of canonical
          answer = q.correct_answer.slice(0, -1) + (q.correct_answer.slice(-1) === "a" ? "e" : "a");
          label = "typo variant";
        } else if (w === walletC && q.alternates?.length > 0) {
          answer = q.alternates[0];
          label = "alternate phrasing";
        } else {
          answer = "xxxxxxxxx gibberish";
          label = "gibberish";
        }
      }

      answers.push({ wallet: w, answer, label });
    }

    // Submit all answers
    try {
      await Promise.all(
        answers.map(({ wallet: w, answer }) => submitTriviaAnswer(matchId!, answer, w))
      );
      answers.forEach(({ wallet: w, label }) => {
        const short = w.address.slice(0, 8);
        console.log(`  Submitted [${short}…]: ${label}`);
      });
    } catch (err) {
      console.log(`  Submit error (may be deadline-passed): ${err instanceof Error ? err.message : err}`);
    }

    // Resolve round
    console.log(`  Resolving round…`);
    try {
      await resolveTriviaRound(matchId!, walletA);
    } catch (err) {
      console.log(`  Resolve error: ${err instanceof Error ? err.message : err}`);
    }

    // Poll until state changes
    await sleep(3000);
    match = await getTriviaMatch(matchId!);
    if (!match) break;

    const newState = Number(match.state);
    const newSurvivors = match.players.filter(
      (p) => !match!.eliminated.some((e) => e.toLowerCase() === p.toLowerCase())
    );
    const eliminated = match.eliminated;

    console.log(`  After round: ${newSurvivors.length} survivors, ${eliminated.length} eliminated`);
    if (eliminated.length > 0) eliminationHappened = true;

    roundsPlayed++;

    if (newState === TRIVIA_STATE_ENDED) break;
  }

  // ── Step 10: Print final result ───────────────────────────────────────────
  match = await getTriviaMatch(matchId!);
  if (match && Number(match.state) === TRIVIA_STATE_ENDED) {
    console.log(`\n  === Match Ended ===`);
    console.log(`  Winner: ${match.winner_str}`);
    console.log(`  Elimination order (last→first out): ${match.eliminated.join(", ")}`);
    pass(10, "Match ended with a winner", { winner: match.winner_str, rounds: roundsPlayed });
  } else {
    fail(10, "Match did not end cleanly", `state=${match ? Number(match.state) : "null"}`);
  }

  // ── Step 11: Assertions ───────────────────────────────────────────────────
  try {
    if (roundsPlayed < 1) throw new Error("No rounds played");
    pass(11, "At least one round played", roundsPlayed);
  } catch (err) {
    fail(11, "Assert: at least one round played", err);
  }

  try {
    if (!eliminationHappened) throw new Error("No eliminations occurred");
    pass(12, "At least one elimination happened");
  } catch (err) {
    fail(12, "Assert: at least one elimination", err);
  }

  try {
    if (!match || !match.winner_str) throw new Error("No winner recorded");
    pass(13, "Exactly one winner recorded", match.winner_str);
  } catch (err) {
    fail(13, "Assert: winner recorded", err);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
