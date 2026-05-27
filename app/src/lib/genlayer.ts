import { createClient } from "genlayer-js";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const USER_REGISTRY_ADDRESS =
  (process.env.NEXT_PUBLIC_USER_REGISTRY_ADDRESS as Address) ??
  "0x698321Bb07b4536Cdc1DB7e7095eaB554feaE42b";

export const PROMPT_WARS_ADDRESS =
  (process.env.NEXT_PUBLIC_PROMPT_WARS_ADDRESS as Address) ?? ("" as Address);

const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC ?? "http://localhost:4000/api";

export function getGenlayerClient(privateKey?: `0x${string}`) {
  if (privateKey) {
    const account = privateKeyToAccount(privateKey);
    return createClient({ endpoint: RPC_URL, account });
  }
  return createClient({ endpoint: RPC_URL });
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
      address: USER_REGISTRY_ADDRESS,
      functionName: "get_profile",
      args: [address],
    });
    return result as UserProfile | null;
  } catch {
    return null;
  }
}

export async function registerUser(username: string, privateKey: `0x${string}`): Promise<TxHash> {
  const client = getGenlayerClient(privateKey);
  const hash = await client.writeContract({
    address: USER_REGISTRY_ADDRESS,
    functionName: "register_user",
    args: [username],
    value: BigInt(0),
  });
  await client.waitForTransactionReceipt({ hash });
  return hash as TxHash;
}

// ── Prompt Wars helpers ────────────────────────────────────────────────────

export async function createPromptWarsMatch(
  privateKey: `0x${string}`
): Promise<{ matchId: number; txHash: TxHash }> {
  const client = getGenlayerClient(privateKey);
  const hash = await client.writeContract({
    address: PROMPT_WARS_ADDRESS,
    functionName: "create_match",
    args: [],
    value: BigInt(0),
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  // Extract match ID from leader receipt return value
  const matchId = Number(
    (receipt as { consensus_data?: { leader_receipt?: { return_value?: unknown } } })
      ?.consensus_data?.leader_receipt?.return_value ?? 0
  );
  return { matchId, txHash: hash as TxHash };
}

export async function joinPromptWarsMatch(
  matchId: number,
  privateKey: `0x${string}`
): Promise<TxHash> {
  const client = getGenlayerClient(privateKey);
  const hash = await client.writeContract({
    address: PROMPT_WARS_ADDRESS,
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
  privateKey: `0x${string}`
): Promise<TxHash> {
  const client = getGenlayerClient(privateKey);
  const hash = await client.writeContract({
    address: PROMPT_WARS_ADDRESS,
    functionName: "submit_prompt",
    args: [matchId, prompt],
    value: BigInt(0),
  });
  await client.waitForTransactionReceipt({ hash });
  return hash as TxHash;
}

export async function judgeMatch(
  matchId: number,
  privateKey: `0x${string}`
): Promise<TxHash> {
  const client = getGenlayerClient(privateKey);
  const hash = await client.writeContract({
    address: PROMPT_WARS_ADDRESS,
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
      address: PROMPT_WARS_ADDRESS,
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
      address: PROMPT_WARS_ADDRESS,
      functionName: "get_recent_matches",
      args: [limit],
    });
    return (result as Match[]) ?? [];
  } catch {
    return [];
  }
}
