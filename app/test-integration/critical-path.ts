/**
 * Integration test: full critical path against a running GenLayer Studio.
 *
 * Run from the app/ directory:
 *   npx tsx test-integration/critical-path.ts
 *
 * Prerequisites: GenLayer Studio must be running (docker compose up).
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  getUserProfile,
  registerUser,
  isUsernameTaken,
  createPromptWarsMatch,
  joinPromptWarsMatch,
  submitPrompt,
  judgeMatch,
  getMatch,
  getRecentMatches,
  getMatchesForPlayer,
} from "../src/lib/genlayer";

const RPC = process.env.NEXT_PUBLIC_GENLAYER_RPC ?? "http://localhost:4000/api";

// ── wallet factory ────────────────────────────────────────────────────────────

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function pass(step: number, desc: string, val?: unknown) {
  passed++;
  const display =
    val !== undefined
      ? ` → ${JSON.stringify(val, (_, v) => (typeof v === "bigint" ? `${v}n` : v))}`
      : "";
  console.log(`PASS [${step}] ${desc}${display}`);
}

function fail(step: number, desc: string, err: unknown, raw?: unknown) {
  failed++;
  console.error(`FAIL [${step}] ${desc}`);
  console.error(`  Error:`, err instanceof Error ? err.message : String(err));
  if (raw !== undefined) {
    console.error(
      `  Raw value:`,
      JSON.stringify(raw, (_, v) => (typeof v === "bigint" ? `${v}n` : v))
    );
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const suffix = Date.now().toString().slice(-6);
  const usernameA = `ita${suffix}`;
  const usernameB = `itb${suffix}`;

  const pkA = generatePrivateKey();
  const pkB = generatePrivateKey();
  const walletA = makeWallet(pkA);
  const walletB = makeWallet(pkB);

  console.log(`\n=== GenLayer Integration Test ===`);
  console.log(`Wallet A: ${walletA.address}`);
  console.log(`Wallet B: ${walletB.address}`);
  console.log(`Usernames: ${usernameA} / ${usernameB}\n`);

  // Fund both wallets
  try {
    await fundWallet(walletA.address);
    await fundWallet(walletB.address);
    console.log("Wallets funded.\n");
  } catch (e) {
    console.error("FATAL: failed to fund wallets:", e);
    process.exit(1);
  }

  let matchId = 0;

  // Step 1
  try {
    await registerUser(usernameA, walletA);
    pass(1, `registerUser("${usernameA}", walletA)`);
  } catch (e) {
    fail(1, `registerUser("${usernameA}", walletA)`, e);
  }

  // Step 2
  try {
    const profile = await getUserProfile(walletA.address);
    if (!profile || profile.username !== usernameA) {
      fail(2, `getProfile(A).username === "${usernameA}"`, `got: ${profile?.username}`, profile);
    } else {
      pass(2, `getProfile(A).username === "${usernameA}"`, profile.username);
    }
  } catch (e) {
    fail(2, `getProfile(A)`, e);
  }

  // Step 3
  try {
    await registerUser(usernameB, walletB);
    pass(3, `registerUser("${usernameB}", walletB)`);
  } catch (e) {
    fail(3, `registerUser("${usernameB}", walletB)`, e);
  }

  // Step 4
  try {
    const profile = await getUserProfile(walletB.address);
    if (!profile || profile.username !== usernameB) {
      fail(4, `getProfile(B).username === "${usernameB}"`, `got: ${profile?.username}`, profile);
    } else {
      pass(4, `getProfile(B).username === "${usernameB}"`, profile.username);
    }
  } catch (e) {
    fail(4, `getProfile(B)`, e);
  }

  // Step 5
  try {
    const taken = await isUsernameTaken(usernameA);
    if (!taken) {
      fail(5, `isUsernameTaken("${usernameA}") === true`, `got: ${taken}`);
    } else {
      pass(5, `isUsernameTaken("${usernameA}") === true`);
    }
  } catch (e) {
    fail(5, `isUsernameTaken("${usernameA}")`, e);
  }

  // Step 6
  try {
    const taken = await isUsernameTaken("totally_unused_xyz");
    if (taken) {
      fail(6, `isUsernameTaken("totally_unused_xyz") === false`, `got: ${taken}`);
    } else {
      pass(6, `isUsernameTaken("totally_unused_xyz") === false`);
    }
  } catch (e) {
    fail(6, `isUsernameTaken("totally_unused_xyz")`, e);
  }

  // Step 7
  try {
    const result = await createPromptWarsMatch(walletA, 2);  // 2-player match
    matchId = result.matchId;
    if (typeof matchId !== "number" || isNaN(matchId)) {
      fail(7, `createPromptWarsMatch returns numeric matchId`, `got: ${matchId}`);
    } else {
      pass(7, `createPromptWarsMatch(walletA) → matchId=${matchId}`);
    }
  } catch (e) {
    fail(7, `createPromptWarsMatch(walletA)`, e);
  }

  // Step 8
  try {
    const match = await getMatch(matchId);
    if (!match) {
      fail(8, `getMatch(${matchId}) exists`, "null");
    } else if (match.players[0]?.toLowerCase() !== walletA.address.toLowerCase()) {
      fail(8, `getMatch.players[0] === walletA.address`, `got: ${match.players[0]}`, match);
    } else if (!match.target_text) {
      fail(8, `getMatch.target_text non-empty`, `got: "${match.target_text}"`, match);
    } else {
      pass(
        8,
        `getMatch(${matchId}): players[0]=✓ target="${match.target_text.slice(0, 40)}…"`
      );
    }
  } catch (e) {
    fail(8, `getMatch(${matchId})`, e);
  }

  // Step 9
  try {
    await joinPromptWarsMatch(matchId, walletB);
    pass(9, `joinPromptWarsMatch(${matchId}, walletB)`);
  } catch (e) {
    fail(9, `joinPromptWarsMatch(${matchId}, walletB)`, e);
  }

  // Step 10
  try {
    const match = await getMatch(matchId);
    if (!match || match.players[1]?.toLowerCase() !== walletB.address.toLowerCase()) {
      fail(10, `getMatch.players[1] === walletB.address`, `got: ${match?.players[1]}`, match);
    } else {
      pass(10, `getMatch(${matchId}).players[1] === walletB.address`);
    }
  } catch (e) {
    fail(10, `getMatch(${matchId}) after join`, e);
  }

  // Step 11
  try {
    await submitPrompt(matchId, "Write a short creative response to the prompt.", walletA);
    pass(11, `submitPrompt(${matchId}, alicePrompt, walletA)`);
  } catch (e) {
    fail(11, `submitPrompt(alicePrompt, walletA)`, e);
  }

  // Step 12
  try {
    await submitPrompt(matchId, "Craft a concise and engaging answer for the given task.", walletB);
    pass(12, `submitPrompt(${matchId}, bobPrompt, walletB)`);
  } catch (e) {
    fail(12, `submitPrompt(bobPrompt, walletB)`, e);
  }

  // Step 13 — AI judging, may take 1-3 minutes
  console.log(`\n[13] judgeMatch(${matchId}) — AI consensus, may take ~2 min…`);
  try {
    await judgeMatch(matchId, walletA);
    pass(13, `judgeMatch(${matchId})`);
  } catch (e) {
    fail(13, `judgeMatch(${matchId})`, e);
  }

  // Step 14 — poll for JUDGED state (AI consensus may finalize slightly after ACCEPTED)
  try {
    let match = await getMatch(matchId);
    let attempts = 0;
    while (attempts < 20 && Number(match?.state ?? -1) !== 2) {
      await sleep(3000);
      match = await getMatch(matchId);
      attempts++;
    }
    const state = Number(match?.state ?? -1);
    const winnerAddr = match?.ranking[0] ?? "";
    if (state !== 2) {  // STATE_JUDGED = 2
      fail(14, `getMatch.state === JUDGED(2)`, `got: ${state}`, match);
    } else if (!winnerAddr) {
      fail(14, `getMatch.ranking[0] is a real player`, `got: empty ranking`, match);
    } else if (!match!.judge_reasoning) {
      fail(14, `getMatch.judge_reasoning non-empty`, `got: "${match?.judge_reasoning}"`, match);
    } else {
      pass(
        14,
        `getMatch: state=JUDGED winner=${winnerAddr.slice(0, 10)}… reasoning="${match!.judge_reasoning.slice(0, 40)}…"`
      );
    }
  } catch (e) {
    fail(14, `getMatch(${matchId}) after judge`, e);
  }

  // Step 15 — cross-contract record_match may need a few extra seconds
  try {
    let profile = await getUserProfile(walletA.address);
    let attempts = 0;
    while (attempts < 10 && Number(profile?.total_matches ?? 0) < 1) {
      await sleep(3000);
      profile = await getUserProfile(walletA.address);
      attempts++;
    }
    const totalMatches = Number(profile?.total_matches ?? 0);
    if (totalMatches < 1) {
      fail(15, `getProfile(A).total_matches >= 1`, `got: ${totalMatches}`, profile);
    } else {
      pass(15, `getProfile(A).total_matches === ${totalMatches}`);
    }
  } catch (e) {
    fail(15, `getProfile(A) after match`, e);
  }

  // Step 16
  try {
    const matches = await getRecentMatches(10);
    const found = matches.some((m) => Number(m.id) === matchId);
    if (!found) {
      fail(
        16,
        `getRecentMatches includes matchId=${matchId}`,
        `got IDs: ${matches.map((m) => Number(m.id)).join(",")}`
      );
    } else {
      pass(16, `getRecentMatches(10) contains matchId=${matchId}`);
    }
  } catch (e) {
    fail(16, `getRecentMatches(10)`, e);
  }

  // Step 17
  try {
    const ids = await getMatchesForPlayer(walletA.address);
    if (!ids.includes(matchId)) {
      fail(
        17,
        `getMatchesForPlayer(A) includes matchId=${matchId}`,
        `got: [${ids.join(",")}]`
      );
    } else {
      pass(17, `getMatchesForPlayer(A) includes matchId=${matchId}`);
    }
  } catch (e) {
    fail(17, `getMatchesForPlayer(A)`, e);
  }

  // ── summary ─────────────────────────────────────────────────────────────────
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
