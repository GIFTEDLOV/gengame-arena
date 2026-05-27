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

export function getGenlayerClient() {
  return createClient({ endpoint: RPC_URL });
}

function clientFromWallet(wallet: NonNullable<ActiveWallet>) {
  // Wrap the wallet's signing functions into a viem LocalAccount (type: "local")
  // so genlayer-js uses the sign-then-sendRaw path instead of eth_sendTransaction.
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
  return createClient({ endpoint: RPC_URL, account });
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
    return result as UserProfile | null;
  } catch {
    return null;
  }
}

export async function registerUser(username: string, wallet: ActiveWallet): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(USER_REGISTRY_ADDRESS),
    functionName: "register_user",
    args: [username],
    value: BigInt(0),
  });
  await client.waitForTransactionReceipt({ hash });
  return hash as TxHash;
}

// ── Prompt Wars helpers ────────────────────────────────────────────────────

export async function createPromptWarsMatch(
  wallet: ActiveWallet
): Promise<{ matchId: number; txHash: TxHash }> {
  if (!wallet) throw new Error("No wallet found");
  const client = clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PROMPT_WARS_ADDRESS),
    functionName: "create_match",
    args: [],
    value: BigInt(0),
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
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
  const client = clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PROMPT_WARS_ADDRESS),
    functionName: "join_match",
    args: [matchId],
    value: BigInt(0),
  });
  await client.waitForTransactionReceipt({ hash });
  return hash as TxHash;
}

export async function submitPrompt(
  matchId: number,
  prompt: string,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PROMPT_WARS_ADDRESS),
    functionName: "submit_prompt",
    args: [matchId, prompt],
    value: BigInt(0),
  });
  await client.waitForTransactionReceipt({ hash });
  return hash as TxHash;
}

export async function judgeMatch(
  matchId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PROMPT_WARS_ADDRESS),
    functionName: "judge_match",
    args: [matchId],
    value: BigInt(0),
  });
  await client.waitForTransactionReceipt({ hash });
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
    return result as Match | null;
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
    return (result as unknown as Match[]) ?? [];
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
