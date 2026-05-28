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
  "0x698321Bb07b4536Cdc1DB7e7095eaB554feaE42b";

export const PROMPT_WARS_ADDRESS =
  process.env.NEXT_PUBLIC_PROMPT_WARS_ADDRESS ?? "";

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

// genlayer-js decodes Python class instances as JavaScript Map objects.
// Convert recursively to plain objects so property access (result.username) works.
function fromMap(value: unknown): unknown {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    value.forEach((v, k) => { obj[String(k)] = fromMap(v); });
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
  total_matches: number;
  total_wins: number;
}

export interface Match {
  id: bigint;
  target_text: string;
  player1: string;
  player2: string;
  player1_prompt: string;
  player2_prompt: string;
  player1_output: string;
  player2_output: string;
  state: number;
  winner: string;
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
    if (!result) return null;
    return fromMap(result) as UserProfile;
  } catch {
    return null;
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
  await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
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
  const receipt = await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
  const matchId = Number(
    (receipt as { consensus_data?: { leader_receipt?: { return_value?: unknown } } })
      ?.consensus_data?.leader_receipt?.return_value ?? 0
  );
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
  await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
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
  await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
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
    if (!result) return null;
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
    return (fromMap(arr) as Match[]);
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
