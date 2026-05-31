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
  "0xD5d16B25b811AD222Df2Ff0E1aE359B101F298A5";

export const PROMPT_WARS_ADDRESS =
  process.env.NEXT_PUBLIC_PROMPT_WARS_ADDRESS ??
  "0x48e610a2dB8ba246fdfBbaa50eaa91DCd5D45131";

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

// Raw contract struct — fields are scalar types; arrays are JSON strings.
export interface MatchRaw {
  id: bigint;
  target_text: string;
  max_players: bigint;
  players_json: string;
  prompts_json: string;
  outputs_json: string;
  ranking_json: string;
  state: bigint;
  judge_reasoning: string;
  created_at: bigint;
  submission_deadline: bigint;
}

// Decoded match with parsed arrays for easy use in the frontend.
export interface Match extends MatchRaw {
  players: string[];   // hex addresses, ordered by join time
  prompts: string[];   // prompts[i] belongs to players[i]; "" = not submitted
  outputs: string[];   // simulated LLM outputs after judging
  ranking: string[];   // ranking[0] = winner; empty until JUDGED
}

// STATE constants (u8 from contract)
export const STATE_WAITING   = 0;  // accepting joins, no timer
export const STATE_FULL      = 1;  // clock running, accepting submissions
export const STATE_JUDGED    = 2;
export const STATE_CANCELLED = 3;

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
  wallet: ActiveWallet,
  maxPlayers: number = 50
): Promise<{ matchId: number; txHash: TxHash }> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PROMPT_WARS_ADDRESS),
    functionName: "create_match",
    args: [maxPlayers],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  const matchIds = await getMatchesForPlayer(wallet.address);
  const matchId = matchIds.length > 0 ? Math.max(...matchIds) : 0;
  return { matchId, txHash: hash as TxHash };
}

export async function startMatch(
  matchId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PROMPT_WARS_ADDRESS),
    functionName: "start_match",
    args: [matchId],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  return hash as TxHash;
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
  // Poll until match reaches JUDGED state — the ACCEPTED receipt only confirms
  // the tx was processed; consensus on the AI output may still be resolving.
  for (let i = 0; i < 60; i++) {
    const match = await getMatch(matchId);
    if (match && Number(match.state) === STATE_JUDGED) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return hash as TxHash;
}

function parseMatch(raw: MatchRaw): Match {
  const safeJson = (s: string | undefined, fallback: unknown[]) => {
    if (!s || s === "[]") return fallback;
    try { return JSON.parse(s); } catch { return fallback; }
  };
  return {
    ...raw,
    players: safeJson(raw.players_json, []) as string[],
    prompts: safeJson(raw.prompts_json, []) as string[],
    outputs: safeJson(raw.outputs_json, []) as string[],
    ranking: safeJson(raw.ranking_json, []) as string[],
  };
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
    return parseMatch(fromMap(result) as MatchRaw);
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
    return (fromMap(arr) as MatchRaw[]).map(parseMatch);
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

// Dev-only: fast-forward a match to judging. Only intended for local development.
export async function devForceJudge(
  matchId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const match = await getMatch(matchId);
  if (!match) throw new Error("Match not found");

  const state = Number(match.state);
  const addr = wallet.address.toLowerCase();

  // Find this player's index and whether they've submitted.
  const playerIdx = match.players.findIndex((p) => p.toLowerCase() === addr);
  const alreadySubmitted = playerIdx >= 0 && !!match.prompts[playerIdx];
  const allSubmitted = match.prompts.every((p) => !!p);

  // Fast path: all prompts in, call judgeMatch directly.
  if (allSubmitted) {
    return judgeMatch(matchId, wallet);
  }

  // Submit a placeholder for this player if they're in the match and haven't submitted.
  if (state === STATE_FULL && playerIdx >= 0 && !alreadySubmitted) {
    await submitPrompt(matchId, "[DEV skip — no prompt submitted]", wallet);
  }

  // Re-read and judge if everyone has now submitted.
  const updated = await getMatch(matchId);
  if (updated && updated.prompts.every((p) => !!p)) {
    return judgeMatch(matchId, wallet);
  }

  // Not everyone has submitted yet — return fast instead of hanging.
  throw new Error(
    "Placeholder submitted. Have the other player(s) also click DEV Skip to trigger judging."
  );
}
