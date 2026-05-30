import { createClient } from "genlayer-js";
import { toAccount } from "viem/accounts";
import type { ActiveWallet } from "./useActiveWallet";

// genlayer-js defines Address as `0x${string}` & { length: 42 }.
// viem's Address is just `0x${string}`.  Cast through this helper to bridge the gap.
type GLAddress = `0x${string}` & { length: 42 };
function glAddr(a: string): GLAddress {
  return a as GLAddress;
}

export const USER_REGISTRY_ADDRESS =
  process.env.NEXT_PUBLIC_USER_REGISTRY_ADDRESS ??
  "0xF164Ce02730060F3e8b3b735eFe46abDeEC7308A";

export const PROMPT_WARS_ADDRESS =
  process.env.NEXT_PUBLIC_PROMPT_WARS_ADDRESS ??
  "0x4a21371182988efc2DC07ab7687e3eD079Fc31D4";

const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC ?? "http://localhost:4000/api";

// Pass a dummy account object so isAddress=false and eth_call routes to
// GenLayer RPC instead of window.ethereum (which may be undefined).
export function getGenlayerClient() {
  return createClient({
    endpoint: RPC_URL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    account: { address: glAddr("0x0000000000000000000000000000000000000000") } as any,
  });
}

// genlayer-js calldata decoder type mapping:
//   Python class instances  → JavaScript Map (keys = field names, values = decoded)
//   Address types           → CalldataAddress instance (.bytes: Uint8Array length 20)
//   Integers (u8/u32/u64)  → bigint
//   str                     → string
//   None                    → null
//
// fromMap converts all of these to plain JS so property access works everywhere.
function fromMap(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  // CalldataAddress: a class with .bytes = 20-byte Uint8Array for EVM addresses.
  // Check before Map so this branch runs even though CalldataAddress is not a Map.
  if (
    typeof value === "object" &&
    "bytes" in (value as object) &&
    (value as { bytes: unknown }).bytes instanceof Uint8Array &&
    (value as { bytes: Uint8Array }).bytes.length === 20
  ) {
    const bytes = (value as { bytes: Uint8Array }).bytes;
    return ("0x" +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")) as `0x${string}`;
  }
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    value.forEach((v, k) => {
      obj[String(k)] = fromMap(v);
    });
    return obj;
  }
  if (Array.isArray(value)) return value.map(fromMap);
  return value;
}

async function clientFromWallet(wallet: NonNullable<ActiveWallet>) {
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
  const client = createClient({ endpoint: RPC_URL, account });

  // FIX 1 — await ConsensusMain init (race condition: createClient fires this async)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).initializeConsensusSmartContract();

  // FIX 3 — pre-fill tx params so viem never calls eth_fillTransaction (unsupported by Studio)
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

  // FIX 2 — stub estimateGas so viem never calls eth_estimateGas with a block-tag 2nd param
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).estimateGas = async () => BigInt(30_000_000);

  return client;
}

export interface UserProfile {
  username: string;
  joined_at: bigint;
  total_matches: bigint; // u32 from contract decodes as bigint
  total_wins: bigint;    // u32 from contract decodes as bigint
}

export interface Match {
  id: bigint;
  target_text: string;
  player1: string;   // Address → hex string after fromMap
  player2: string;   // Address → hex string after fromMap
  player1_prompt: string;
  player2_prompt: string;
  player1_output: string;
  player2_output: string;
  state: bigint;     // u8 from contract decodes as bigint; use Number(match.state) in code
  winner: string;    // Address → hex string after fromMap
  judge_reasoning: string;
  created_at: bigint;
  submission_deadline: bigint;
}

export type TxHash = `0x${string}`;

// ── User Registry helpers ──────────────────────────────────────────────────

export async function getUserProfile(address: string): Promise<UserProfile | null> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(USER_REGISTRY_ADDRESS),
      functionName: "get_profile",
      args: [address],
    });
    if (result === null || result === undefined) return null;
    return fromMap(result) as UserProfile;
  } catch {
    return null;
  }
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(USER_REGISTRY_ADDRESS),
      functionName: "is_username_taken",
      args: [username],
    });
    return !!result;
  } catch {
    return false;
  }
}

export async function registerUser(username: string, wallet: ActiveWallet): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(USER_REGISTRY_ADDRESS),
    functionName: "register_user",
    args: [username],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  return hash as TxHash;
}

// ── Prompt Wars helpers ────────────────────────────────────────────────────

export async function createPromptWarsMatch(
  wallet: ActiveWallet
): Promise<{ matchId: number; txHash: TxHash }> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PROMPT_WARS_ADDRESS),
    functionName: "create_match",
    args: [],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  // Read back player's matches post-acceptance to get the real match ID.
  // The receipt's execution_result is hex-encoded calldata with no public decoder,
  // so we rely on the contract's view function instead.
  const matchIds = await getMatchesForPlayer(wallet.address);
  const matchId = matchIds.length > 0 ? Math.max(...matchIds) : 0;
  return { matchId, txHash: hash as TxHash };
}

export async function joinPromptWarsMatch(
  matchId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PROMPT_WARS_ADDRESS),
    functionName: "join_match",
    args: [matchId],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  return hash as TxHash;
}

export async function submitPrompt(
  matchId: number,
  prompt: string,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PROMPT_WARS_ADDRESS),
    functionName: "submit_prompt",
    args: [matchId, prompt],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  return hash as TxHash;
}

export async function judgeMatch(
  matchId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PROMPT_WARS_ADDRESS),
    functionName: "judge_match",
    args: [matchId],
    value: BigInt(0),
  });
  // judge_match uses AI consensus which takes 1-3 min; use 100 retries (5 min budget).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 100 });
  // Poll until match reaches JUDGED state (state=4) — the ACCEPTED receipt only confirms
  // the tx was processed; consensus on the AI output may still be resolving.
  const STATE_JUDGED = 4;
  for (let i = 0; i < 60; i++) {
    const match = await getMatch(matchId);
    if (match && Number(match.state) === STATE_JUDGED) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return hash as TxHash;
}

export async function getMatch(matchId: number): Promise<Match | null> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(PROMPT_WARS_ADDRESS),
      functionName: "get_match",
      args: [matchId],
    });
    if (result === null || result === undefined) return null;
    return fromMap(result) as Match;
  } catch {
    return null;
  }
}

export async function getRecentMatches(limit: number): Promise<Match[]> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(PROMPT_WARS_ADDRESS),
      functionName: "get_recent_matches",
      args: [limit],
    });
    const arr = (result as unknown as unknown[]) ?? [];
    return fromMap(arr) as Match[];
  } catch {
    return [];
  }
}

export async function getMatchesForPlayer(playerAddress: string): Promise<number[]> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(PROMPT_WARS_ADDRESS),
      functionName: "get_matches_for_player",
      args: [playerAddress],
    });
    return ((result as bigint[]) ?? []).map(Number);
  } catch {
    return [];
  }
}

export async function cancelMatch(
  matchId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PROMPT_WARS_ADDRESS),
    functionName: "cancel_match",
    args: [matchId],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  return hash as TxHash;
}

// Dev-only: forcibly advance a match to judging by submitting placeholder prompts
// for any player who hasn't submitted, then calling judge_match.
// Only intended for local development — never call this in production.
export async function devForceJudge(
  matchId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const match = await getMatch(matchId);
  if (!match) throw new Error("Match not found");

  const state = Number(match.state);
  const addr = wallet.address.toLowerCase();
  const isP1 = match.player1.toLowerCase() === addr;
  const isP2 = match.player2.toLowerCase() === addr;

  // Submit placeholder for whichever player(s) haven't submitted yet
  const DEV_PLACEHOLDER = "[DEV skip — no prompt submitted]";

  if (state === 1) {
    // BOTH_JOINED — neither submitted; submit for the connected player then
    // the other won't be able to, so we can only do one side from one wallet.
    // For dev convenience: submit for the current wallet if they're a player.
    if (isP1 || isP2) {
      await submitPrompt(matchId, DEV_PLACEHOLDER, wallet);
    }
    // After one submission state is ONE_SUBMITTED — fall through to next block
    // is handled by the judgeMatch forfeit path once deadline passes.
  }

  if (state === 2) {
    // ONE_SUBMITTED — one missing. If the missing player is the current wallet, submit.
    if (isP1 && !match.player1_prompt) {
      await submitPrompt(matchId, DEV_PLACEHOLDER, wallet);
    }
    if (isP2 && !match.player2_prompt) {
      await submitPrompt(matchId, DEV_PLACEHOLDER, wallet);
    }
  }

  // Re-read to check if now BOTH_SUBMITTED
  const updated = await getMatch(matchId);
  if (updated && Number(updated.state) === 3) {
    return judgeMatch(matchId, wallet);
  }
  // Otherwise let judgeMatch handle forfeit/no-contest via its deadline paths
  return judgeMatch(matchId, wallet);
}
