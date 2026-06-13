/**
 * Daily content trigger helpers.
 *
 * Reads last_daily_generation from each contract and fires generate_daily_content_if_due()
 * opportunistically when the cron hasn't run yet for the current UTC day.
 *
 * Contract enforces idempotency: a second call same day reverts with [EXPECTED], which we swallow.
 */

import { createClient } from "genlayer-js";
import { toAccount } from "viem/accounts";
import {
  getGenlayerClient,
  PROMPT_WARS_ADDRESS,
  PREDICTIONS_ADDRESS,
  TRIVIA_ROYALE_ADDRESS,
  TITLE_WARS_ADDRESS,
} from "./genlayer";
import type { ActiveWallet } from "./useActiveWallet";

// glAddr helper (mirrors the one in genlayer.ts — avoids touching that file)
type GLAddress = `0x${string}` & { length: 42 };
function glAddr(a: string): GLAddress {
  return a as GLAddress;
}

type ContractKey = "prompt-wars" | "predictions" | "trivia-royale" | "title-wars";

function contractAddress(key: ContractKey): string {
  switch (key) {
    case "prompt-wars":    return PROMPT_WARS_ADDRESS;
    case "predictions":    return PREDICTIONS_ADDRESS;
    case "trivia-royale":  return TRIVIA_ROYALE_ADDRESS;
    case "title-wars":     return TITLE_WARS_ADDRESS;
  }
}

/* ── Read helpers ──────────────────────────────────────────────────────────── */

export async function getLastDailyGeneration(key: ContractKey): Promise<number> {
  try {
    const client = getGenlayerClient();
    const result = await client.readContract({
      address: glAddr(contractAddress(key)),
      functionName: "get_last_daily_generation",
      args: [],
    });
    return Number(result ?? 0);
  } catch {
    return 0;
  }
}

export async function getDailyMatchIds(key: ContractKey): Promise<bigint[]> {
  try {
    const client = getGenlayerClient();
    const result = await client.readContract({
      address: glAddr(contractAddress(key)),
      functionName: "get_daily_match_ids",
      args: [],
    });
    return (result as bigint[]) ?? [];
  } catch {
    return [];
  }
}

/* ── Write client (3 fixes duplicated from genlayer.ts clientFromWallet) ──── */

async function buildWriteClient(wallet: NonNullable<ActiveWallet>) {
  const account = toAccount({
    address: glAddr(wallet.address),
    async signMessage({ message }) {
      const raw = typeof message === "string" ? message : message.raw;
      return wallet.signMessage(typeof raw === "string" ? raw : Buffer.from(raw).toString("hex"));
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signTransaction(tx: any) {
      return wallet.signTransaction(tx);
    },
    async signTypedData() {
      throw new Error("signTypedData not needed for GenLayer");
    },
  });

  const rpcUrl =
    process.env.NEXT_PUBLIC_GENLAYER_RPC ?? "http://localhost:4000/api";
  const client = createClient({ endpoint: rpcUrl, account });

  // FIX 1 — await ConsensusMain init
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).initializeConsensusSmartContract();

  // FIX 3 — pre-fill tx params so viem never calls eth_fillTransaction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origPrepare = (client as any).prepareTransactionRequest.bind(client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).prepareTransactionRequest = async (args: any) => {
    const nonce =
      args.nonce !== undefined
        ? (typeof args.nonce === "string" ? parseInt(args.nonce, 16) : args.nonce)
        : args.nonce;
    return origPrepare({
      chainId: 61999,
      gas: BigInt(30_000_000),
      gasPrice: BigInt(0),
      ...args,
      nonce,
    });
  };

  // FIX 2 — stub estimateGas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).estimateGas = async () => BigInt(30_000_000);

  return client;
}

/* ── Opportunistic trigger ─────────────────────────────────────────────────── */

/**
 * Fires generate_daily_content_if_due() if:
 *  - Current time is past today's 1pm UTC
 *  - lastGenTimestamp is before today's 1pm UTC (i.e. not yet generated today)
 *  - A wallet is available to sign the transaction
 *
 * [EXPECTED] reverts are silently swallowed — another caller (cron or another user) already triggered.
 */
export async function triggerDailyContentIfNeeded(
  key: ContractKey,
  wallet: ActiveWallet,
  lastGenTimestamp: number
): Promise<void> {
  if (!wallet) return;

  const now = Math.floor(Date.now() / 1000);
  const todayUtc = Math.floor(now / 86400) * 86400;
  const todayOnePm = todayUtc + 13 * 3600;

  if (now < todayOnePm) return;
  if (lastGenTimestamp >= todayOnePm) return;

  try {
    const client = await buildWriteClient(wallet);
    await client.writeContract({
      address: glAddr(contractAddress(key)),
      functionName: "generate_daily_content_if_due",
      value: BigInt(0),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("[EXPECTED]")) return;
    console.warn(`Daily generation trigger failed for ${key}:`, err);
  }
}

/**
 * Run the opportunistic trigger for all 4 contracts in parallel.
 * Call this from the dashboard useEffect after reading last_daily_generation for each.
 */
export async function triggerAllDailyContent(
  wallet: ActiveWallet,
  lastGenTimestamps: Record<ContractKey, number>
): Promise<void> {
  await Promise.allSettled([
    triggerDailyContentIfNeeded("prompt-wars",   wallet, lastGenTimestamps["prompt-wars"]),
    triggerDailyContentIfNeeded("predictions",   wallet, lastGenTimestamps["predictions"]),
    triggerDailyContentIfNeeded("trivia-royale", wallet, lastGenTimestamps["trivia-royale"]),
    triggerDailyContentIfNeeded("title-wars",    wallet, lastGenTimestamps["title-wars"]),
  ]);
}
