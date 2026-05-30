/**
 * Smoke test: proves end-to-end AI judging via Anthropic Haiku validators.
 *
 * Runs Path B — creates a fresh match, has both players submit real prompts,
 * calls judge_match, and prints the full AI reasoning block.
 *
 * Run from the app/ directory:
 *   npx tsx test-integration/judge-real-match.ts
 *
 * Prerequisites: GenLayer Studio running, Anthropic validators configured.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  getUserProfile,
  registerUser,
  createPromptWarsMatch,
  joinPromptWarsMatch,
  submitPrompt,
  judgeMatch,
  getMatch,
} from "../src/lib/genlayer";

const RPC = process.env.NEXT_PUBLIC_GENLAYER_RPC ?? "http://localhost:4000/api";

function makeWallet(pk: `0x${string}`) {
  const account = privateKeyToAccount(pk);
  return {
    address: account.address as `0x${string}`,
    signMessage: async (msg: string): Promise<`0x${string}`> =>
      account.signMessage({ message: msg }),
    signTransaction: async (tx: unknown): Promise<`0x${string}`> =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      account.signTransaction(tx as any),
    source: "guest" as const,
  };
}

async function fundWallet(address: string) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sim_fundAccount",
      params: [address, 1000],
    }),
  });
  const data = (await res.json()) as { error?: unknown };
  if (data.error) throw new Error(`Fund failed: ${JSON.stringify(data.error)}`);
}

async function main() {
  console.log("\n=== Judge Real Match — AI Judging Smoke Test ===\n");

  // ── Fresh wallets ──────────────────────────────────────────────────────────
  const pkA = generatePrivateKey();
  const pkB = generatePrivateKey();
  const walletA = makeWallet(pkA);
  const walletB = makeWallet(pkB);

  console.log(`Wallet A: ${walletA.address}`);
  console.log(`Wallet B: ${walletB.address}\n`);

  // ── Fund ──────────────────────────────────────────────────────────────────
  await fundWallet(walletA.address);
  await fundWallet(walletB.address);
  console.log("Funded both wallets.\n");

  // ── Register ──────────────────────────────────────────────────────────────
  const suffix = Date.now().toString().slice(-6);
  const nameA = `jra${suffix}`;
  const nameB = `jrb${suffix}`;

  console.log(`Registering ${nameA} and ${nameB}...`);
  await registerUser(nameA, walletA);
  await registerUser(nameB, walletB);
  console.log("Registered.\n");

  // ── Create + join ─────────────────────────────────────────────────────────
  console.log("Creating match...");
  const { matchId } = await createPromptWarsMatch(walletA);
  console.log(`Match ID: ${matchId}`);

  const matchAfterCreate = await getMatch(matchId);
  if (!matchAfterCreate) throw new Error("Match not found after create");
  const target = matchAfterCreate.target_text;
  console.log(`Target: "${target}"\n`);

  console.log("Joining as walletB...");
  await joinPromptWarsMatch(matchId, walletB);
  console.log("Joined.\n");

  // ── Submit prompts — craft real attempts at the target ────────────────────
  const promptA = `Write the following and nothing else: ${target.replace(/^A prompt that produces /, "")}`;
  const promptB = `Produce a response that directly addresses this: ${target.replace(/^A prompt that produces /, "")}. Be concise and precise.`;

  console.log(`Submitting prompt A: "${promptA.slice(0, 80)}..."`);
  await submitPrompt(matchId, promptA, walletA);
  console.log("Submitted A.\n");

  console.log(`Submitting prompt B: "${promptB.slice(0, 80)}..."`);
  await submitPrompt(matchId, promptB, walletB);
  console.log("Submitted B.\n");

  // ── Judge — the AI consensus step ─────────────────────────────────────────
  console.log("Calling judgeMatch — Anthropic Haiku validators running...");
  console.log("(This may take 1-2 minutes for AI consensus.)\n");
  await judgeMatch(matchId, walletA);
  console.log("judgeMatch returned.\n");

  // ── Read results ──────────────────────────────────────────────────────────
  const result = await getMatch(matchId);
  if (!result) throw new Error("Match disappeared after judging");

  const state = Number(result.state);
  if (state !== 4) {
    console.error(`FAIL: expected state=JUDGED(4), got ${state}`);
    console.error("Raw match:", result);
    process.exit(1);
  }

  const ZERO = "0x" + "0".repeat(40);
  const winnerIs =
    result.winner.toLowerCase() === walletA.address.toLowerCase()
      ? "Player A"
      : result.winner.toLowerCase() === walletB.address.toLowerCase()
      ? "Player B"
      : result.winner.toLowerCase() === ZERO
      ? "ZERO (no winner?)"
      : "Unknown";

  // Look up winner's username
  const winnerProfile = await getUserProfile(result.winner);

  console.log("=".repeat(60));
  console.log("MATCH RESULTS");
  console.log("=".repeat(60));
  console.log(`Target:   ${target}`);
  console.log(`\nPlayer A (${walletA.address.slice(0, 10)}…)`);
  console.log(`  Prompt:  ${result.player1_prompt}`);
  console.log(`  Output:  ${result.player1_output}`);
  console.log(`\nPlayer B (${walletB.address.slice(0, 10)}…)`);
  console.log(`  Prompt:  ${result.player2_prompt}`);
  console.log(`  Output:  ${result.player2_output}`);
  console.log(`\nWinner:   ${winnerIs} (${result.winner.slice(0, 10)}… / ${winnerProfile?.username ?? "unknown"})`);
  console.log("\n" + "=".repeat(60));
  console.log("=== AI REASONING ===");
  console.log("=".repeat(60));
  console.log(result.judge_reasoning);
  console.log("=".repeat(60));
  console.log("=== END ===");
  console.log("=".repeat(60));

  console.log("\nSMOKE TEST PASSED — AI judging is working end-to-end.\n");
}

main().catch((e: unknown) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
