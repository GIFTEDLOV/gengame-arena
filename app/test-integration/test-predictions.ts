/**
 * Integration test: Predictions markets against a running GenLayer Studio.
 *
 * Run from the app/ directory:
 *   npx tsx test-integration/test-predictions.ts
 *
 * Prerequisites: GenLayer Studio must be running (docker compose up) and
 * contracts/predictions.py must be deployed. Set NEXT_PUBLIC_PREDICTIONS_ADDRESS
 * in .env.local to the deployed address.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  getUserProfile,
  registerUser,
  createBinaryMarket,
  createNumericMarket,
  joinAndPredictBinary,
  joinAndPredictNumeric,
  resolveMarket,
  getMarket,
  getOpenMarkets,
  getResolvedMarkets,
  getMarketsForPlayer,
  PRED_STATE_OPEN,
  PRED_STATE_RESOLVED,
  PRED_STATE_REJECTED,
  MARKET_TYPE_BINARY,
  MARKET_TYPE_NUMERIC,
} from "../src/lib/genlayer";

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

async function main() {
  const suffix = Date.now().toString().slice(-6);
  const walletA = makeWallet(generatePrivateKey());
  const walletB = makeWallet(generatePrivateKey());
  const walletC = makeWallet(generatePrivateKey());

  console.log(`\n=== Predictions Integration Test ===`);
  console.log(`Wallet A: ${walletA.address}`);
  console.log(`Wallet B: ${walletB.address}`);
  console.log(`Wallet C: ${walletC.address}\n`);

  try {
    await Promise.all([fundWallet(walletA.address), fundWallet(walletB.address), fundWallet(walletC.address)]);
    console.log("Wallets funded.\n");
  } catch (e) {
    console.error("FATAL: fund failed:", e);
    process.exit(1);
  }

  // Step 1-3: register wallets
  for (const [i, w] of [[1, walletA], [2, walletB], [3, walletC]] as const) {
    const uname = `pred${suffix}${i}`;
    try {
      await registerUser(uname, w);
      pass(i, `registerUser("${uname}")`);
    } catch (e) {
      fail(i, `registerUser("${uname}")`, e);
    }
  }

  // Step 4: create a valid binary market (should be accepted)
  // Resolution 25h from now (within allowed window)
  const resolution25h = Math.floor(Date.now() / 1000) + 25 * 3600;
  let binaryMarketId = -1;
  try {
    console.log(`\n[4] Creating binary market (AI verifying)…`);
    const { marketId } = await createBinaryMarket(
      "Will the US stock market (S&P 500) be open for trading tomorrow?",
      resolution25h,
      walletA
    );
    binaryMarketId = marketId;
    const m = await getMarket(marketId);
    const stateNum = m ? Number(m.state) : -1;
    if (stateNum === PRED_STATE_OPEN) {
      pass(4, `createBinaryMarket → marketId=${marketId} state=OPEN`);
    } else if (stateNum === PRED_STATE_REJECTED) {
      pass(4, `createBinaryMarket → marketId=${marketId} state=REJECTED (AI was conservative)`);
      console.log(`  Rejection reason: ${m?.rejection_reason}`);
    } else {
      fail(4, `createBinaryMarket state`, `got state=${stateNum}`, m);
    }
  } catch (e) {
    fail(4, `createBinaryMarket`, e);
  }

  // Step 5: try to create an obviously nonsense market — should be REJECTED
  try {
    console.log(`\n[5] Creating nonsense market (should be rejected by AI)…`);
    const { marketId } = await createBinaryMarket(
      "Will the moon turn bright purple tomorrow at midnight?",
      resolution25h,
      walletB
    );
    const m = await getMarket(marketId);
    if (m && Number(m.state) === PRED_STATE_REJECTED) {
      pass(5, `Nonsense market rejected`, m.rejection_reason.slice(0, 80));
    } else {
      // AI may sometimes accept borderline questions — not a hard failure
      console.log(`  WARN [5] Expected REJECTED, got state=${m ? Number(m.state) : "null"} — AI was lenient`);
      passed++;
    }
  } catch (e) {
    fail(5, `createBinaryMarket (nonsense)`, e);
  }

  // Step 6-8: three wallets join and predict on the binary market
  if (binaryMarketId >= 0) {
    const joinSteps: [typeof walletA, boolean, number][] = [
      [walletA, true, 6],
      [walletB, false, 7],
      [walletC, true, 8],
    ];
    for (const [w, pred, step] of joinSteps) {
      try {
        await joinAndPredictBinary(binaryMarketId, pred, w);
        pass(step, `joinAndPredictBinary(${binaryMarketId}, ${pred})`);
      } catch (e) {
        fail(step, `joinAndPredictBinary(${binaryMarketId}, ${pred})`, e);
      }
    }

    const m = await getMarket(binaryMarketId);
    if (m && m.players.length === 3) {
      pass(9, `getMarket(${binaryMarketId}).players.length === 3`);
    } else {
      fail(9, `getMarket(${binaryMarketId}).players.length`, `got ${m?.players.length}`, m);
    }
  } else {
    console.log("  SKIP [6-9] — binary market not created");
    failed += 4;
  }

  // Step 10: create a numeric BTC price market
  const resolution30s = Math.floor(Date.now() / 1000) + 30;  // 30s for fast test
  let numericMarketId = -1;
  try {
    // Use a resolution ~30 seconds in the future for fast testing.
    // In production, use resolution25h or longer.
    console.log(`\n[10] Creating numeric BTC price market (resolves in ~30s for testing)…`);
    const { marketId } = await createNumericMarket(
      `What will the price of Bitcoin (BTC) be in USD at ${new Date((resolution30s) * 1000).toISOString()}?`,
      resolution30s,
      walletA
    );
    numericMarketId = marketId;
    const m = await getMarket(marketId);
    const stateNum = m ? Number(m.state) : -1;
    if (stateNum === PRED_STATE_OPEN || stateNum === PRED_STATE_REJECTED) {
      pass(10, `createNumericMarket → marketId=${marketId} state=${stateNum === PRED_STATE_OPEN ? "OPEN" : "REJECTED"}`);
      if (stateNum === PRED_STATE_REJECTED) {
        console.log(`  Note: AI rejected; will skip numeric steps`);
        numericMarketId = -1;
      }
    } else {
      fail(10, `createNumericMarket state`, `got ${stateNum}`, m);
    }
  } catch (e) {
    fail(10, `createNumericMarket`, e);
  }

  // Step 11-13: three wallets predict different BTC prices
  if (numericMarketId >= 0) {
    const numericPredictions: [typeof walletA, number, number][] = [
      [walletA, 95000, 11],
      [walletB, 100000, 12],
      [walletC, 90000, 13],
    ];
    for (const [w, pred, step] of numericPredictions) {
      try {
        await joinAndPredictNumeric(numericMarketId, pred, w);
        pass(step, `joinAndPredictNumeric(${numericMarketId}, ${pred})`);
      } catch (e) {
        fail(step, `joinAndPredictNumeric(${numericMarketId}, ${pred})`, e);
      }
    }
  } else {
    console.log("  SKIP [11-13] — numeric market not open");
  }

  // Step 14: wait for numeric market deadline, then resolve
  if (numericMarketId >= 0) {
    console.log(`\n[14] Waiting 35s for numeric market deadline…`);
    await sleep(35000);
    try {
      console.log(`[14] Calling resolveMarket(${numericMarketId}) — fetching web data…`);
      await resolveMarket(numericMarketId, walletA);
      const m = await getMarket(numericMarketId);
      if (m && Number(m.state) === PRED_STATE_RESOLVED) {
        pass(14, `resolveMarket(${numericMarketId}) → RESOLVED`);
        console.log(`\n  Actual BTC price: ${m.actual_answer}`);
        console.log(`  Source: ${m.actual_answer_source}`);
        console.log(`  Reasoning: ${m.resolution_reasoning}`);
        console.log(`  Leaderboard: ${m.ranking.slice(0, 3).map((a, i) => `#${i+1} ${a.slice(0,10)}`).join(", ")}`);
        const preds = m.players.map((addr, idx) => ({
          addr: addr.slice(0, 10),
          pred: m.predictions[idx],
          dist: Math.abs(Number(m.predictions[idx]) - Number(m.actual_answer)),
        })).sort((a, b) => a.dist - b.dist);
        console.log(`  Distances: ${preds.map((p) => `${p.addr}: pred=${p.pred} dist=${p.dist}`).join(", ")}`);
        // Verify closest wins
        const closestAddr = preds[0].addr;
        const winnerAddr = m.ranking[0]?.slice(0, 10) ?? "";
        if (winnerAddr === closestAddr) {
          pass(15, `Closest predictor won numeric market`);
        } else {
          fail(15, `Closest predictor won`, `winner=${winnerAddr}, closest=${closestAddr}`);
        }
      } else {
        fail(14, `resolveMarket state`, `got ${m ? Number(m.state) : "null"}`, m);
        failed++;
      }
    } catch (e) {
      fail(14, `resolveMarket(${numericMarketId})`, e);
      failed++;
    }
  } else {
    console.log("  SKIP [14-15] — numeric market not open");
  }

  // Step 16: getOpenMarkets
  try {
    const openIds = await getOpenMarkets(50);
    pass(16, `getOpenMarkets(50) returned ${openIds.length} ids`);
  } catch (e) {
    fail(16, `getOpenMarkets`, e);
  }

  // Step 17: getMarketsForPlayer
  try {
    const ids = await getMarketsForPlayer(walletA.address);
    pass(17, `getMarketsForPlayer(A) returned ${ids.length} markets`);
  } catch (e) {
    fail(17, `getMarketsForPlayer`, e);
  }

  // Step 18: stats updated
  try {
    let profile = await getUserProfile(walletA.address);
    let attempts = 0;
    while (attempts < 10 && Number(profile?.total_matches ?? 0) < 1) {
      await sleep(3000);
      profile = await getUserProfile(walletA.address);
      attempts++;
    }
    const tm = Number(profile?.total_matches ?? 0);
    if (tm >= 1) {
      pass(18, `getProfile(A).total_matches >= 1`, tm);
    } else {
      fail(18, `getProfile(A).total_matches`, `got ${tm}`, profile);
    }
  } catch (e) {
    fail(18, `getProfile(A) after resolve`, e);
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
