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
  "0x900cCC8eAcD9E777683877eb9E11FB23c3b5d24e";

export const PROMPT_WARS_ADDRESS =
  process.env.NEXT_PUBLIC_PROMPT_WARS_ADDRESS ??
  "0x712fc5c69DB0DB9F5cb0031B8203b859Bacf4989";

export const PREDICTIONS_ADDRESS =
  process.env.NEXT_PUBLIC_PREDICTIONS_ADDRESS ??
  "0x8d6d0AcEEA4273469d944aCbeAe53E236FF1ac5b";

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
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 60 });
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

// ── Predictions ────────────────────────────────────────────────────────────

export const MARKET_TYPE_BINARY  = 0;
export const MARKET_TYPE_NUMERIC = 1;

export const PRED_STATE_OPEN      = 0;
export const PRED_STATE_RESOLVED  = 1;
export const PRED_STATE_REJECTED  = 2;
export const PRED_STATE_CANCELLED = 3;

export interface MarketRaw {
  id: bigint;
  creator: string;
  question: string;
  market_type: bigint;
  resolution_datetime: bigint;
  created_at: bigint;
  state: bigint;
  rejection_reason: string;
  players_json: string;
  predictions_json: string;
  submission_times_json: string;
  actual_answer: string;
  actual_answer_source: string;
  ranking_json: string;
  resolution_reasoning: string;
}

export interface Market extends MarketRaw {
  players: string[];
  predictions: (boolean | number)[];
  submission_times: number[];
  ranking: string[];
}

function parseMarket(raw: MarketRaw): Market {
  const safeJson = (s: string | undefined, fallback: unknown[]) => {
    if (!s || s === "[]") return fallback;
    try { return JSON.parse(s); } catch { return fallback; }
  };
  return {
    ...raw,
    players: safeJson(raw.players_json, []) as string[],
    predictions: safeJson(raw.predictions_json, []) as (boolean | number)[],
    submission_times: safeJson(raw.submission_times_json, []) as number[],
    ranking: safeJson(raw.ranking_json, []) as string[],
  };
}

export async function getMarket(marketId: number): Promise<Market | null> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(PREDICTIONS_ADDRESS),
      functionName: "get_market",
      args: [marketId],
    });
    if (result === null || result === undefined) return null;
    return parseMarket(fromMap(result) as MarketRaw);
  } catch {
    return null;
  }
}

export async function getOpenMarkets(limit: number): Promise<number[]> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(PREDICTIONS_ADDRESS),
      functionName: "get_open_markets",
      args: [limit],
    });
    return ((result as bigint[]) ?? []).map(Number);
  } catch {
    return [];
  }
}

export async function getResolvedMarkets(limit: number): Promise<number[]> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(PREDICTIONS_ADDRESS),
      functionName: "get_resolved_markets",
      args: [limit],
    });
    return ((result as bigint[]) ?? []).map(Number);
  } catch {
    return [];
  }
}

export async function getMarketsForPlayer(address: string): Promise<number[]> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(PREDICTIONS_ADDRESS),
      functionName: "get_markets_for_player",
      args: [address],
    });
    return ((result as bigint[]) ?? []).map(Number);
  } catch {
    return [];
  }
}

async function getNextMarketId(): Promise<number> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(PREDICTIONS_ADDRESS),
      functionName: "get_next_market_id",
      args: [],
    });
    return Number(result as bigint);
  } catch {
    return 0;
  }
}

export async function createBinaryMarket(
  question: string,
  resolutionDatetime: number,
  wallet: ActiveWallet
): Promise<{ marketId: number; txHash: TxHash }> {
  if (!wallet) throw new Error("No wallet found");
  const marketId = await getNextMarketId();
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PREDICTIONS_ADDRESS),
    functionName: "create_market",
    args: [question, MARKET_TYPE_BINARY, resolutionDatetime],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 100 });
  return { marketId, txHash: hash as TxHash };
}

export async function createNumericMarket(
  question: string,
  resolutionDatetime: number,
  wallet: ActiveWallet
): Promise<{ marketId: number; txHash: TxHash }> {
  if (!wallet) throw new Error("No wallet found");
  const marketId = await getNextMarketId();
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PREDICTIONS_ADDRESS),
    functionName: "create_market",
    args: [question, MARKET_TYPE_NUMERIC, resolutionDatetime],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 100 });
  return { marketId, txHash: hash as TxHash };
}

export async function joinAndPredictBinary(
  marketId: number,
  prediction: boolean,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PREDICTIONS_ADDRESS),
    functionName: "join_and_predict_binary",
    args: [marketId, prediction],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  return hash as TxHash;
}

export async function joinAndPredictNumeric(
  marketId: number,
  prediction: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PREDICTIONS_ADDRESS),
    functionName: "join_and_predict_numeric",
    args: [marketId, String(prediction)],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  return hash as TxHash;
}

export async function resolveMarket(
  marketId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PREDICTIONS_ADDRESS),
    functionName: "resolve_market",
    args: [marketId],
    value: BigInt(0),
  });
  // AI web-fetch resolution takes 1-5 min per market; use 200 retries (10 min budget).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 200 });
  for (let i = 0; i < 60; i++) {
    const m = await getMarket(marketId);
    if (m && Number(m.state) === PRED_STATE_RESOLVED) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return hash as TxHash;
}

export async function cancelMarketPredictions(
  marketId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(PREDICTIONS_ADDRESS),
    functionName: "cancel_market",
    args: [marketId],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  return hash as TxHash;
}

// ── Trivia Royale ──────────────────────────────────────────────────────────

export const TRIVIA_ROYALE_ADDRESS =
  process.env.NEXT_PUBLIC_TRIVIA_ROYALE_ADDRESS ??
  "0x6C500774ecaD4d495c64F7E2ac631F2f767a0bf3";

export const TRIVIA_STATE_WAITING     = 0;
export const TRIVIA_STATE_GENERATING  = 1;
export const TRIVIA_STATE_IN_PROGRESS = 2;
export const TRIVIA_STATE_RESOLVING   = 3;
export const TRIVIA_STATE_ENDED       = 4;
export const TRIVIA_STATE_CANCELLED   = 5;

export interface TriviaQuestion {
  type: "mc" | "open";
  text: string;
  options: string[];
  correct_answer: string;
  alternates: string[];
}

export interface TriviaMatchRaw {
  id: bigint;
  host_str: string;
  topic: string;
  max_players: bigint;
  players_json: string;
  eliminated_json: string;
  state: bigint;
  rejection_reason: string;
  questions_json: string;
  current_round: bigint;
  round_answers_json: string;
  answer_deadline: bigint;
  winner_str: string;
  created_at: bigint;
}

export interface TriviaMatch extends TriviaMatchRaw {
  players: string[];
  eliminated: string[];
  questions: TriviaQuestion[];
  round_answers: Record<string, string>;
}

function parseTriviaMatch(raw: TriviaMatchRaw): TriviaMatch {
  const safeJson = <T>(s: string | undefined, fallback: T): T => {
    if (!s || s === "[]" || s === "{}") return fallback;
    try { return JSON.parse(s) as T; } catch { return fallback; }
  };
  return {
    ...raw,
    players: safeJson<string[]>(raw.players_json, []),
    eliminated: safeJson<string[]>(raw.eliminated_json, []),
    questions: safeJson<TriviaQuestion[]>(raw.questions_json, []),
    round_answers: safeJson<Record<string, string>>(raw.round_answers_json, {}),
  };
}

export async function getTriviaMatch(matchId: number): Promise<TriviaMatch | null> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(TRIVIA_ROYALE_ADDRESS),
      functionName: "get_match",
      args: [matchId],
    });
    if (result === null || result === undefined) return null;
    return parseTriviaMatch(fromMap(result) as TriviaMatchRaw);
  } catch {
    return null;
  }
}

export async function getOpenTriviaMatches(limit: number): Promise<number[]> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(TRIVIA_ROYALE_ADDRESS),
      functionName: "get_open_matches",
      args: [limit],
    });
    return ((result as bigint[]) ?? []).map(Number);
  } catch {
    return [];
  }
}

export async function getActiveTriviaMatches(limit: number): Promise<number[]> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(TRIVIA_ROYALE_ADDRESS),
      functionName: "get_active_matches",
      args: [limit],
    });
    return ((result as bigint[]) ?? []).map(Number);
  } catch {
    return [];
  }
}

export async function getTriviaMatchesForPlayer(playerAddress: string): Promise<number[]> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(TRIVIA_ROYALE_ADDRESS),
      functionName: "get_matches_for_player",
      args: [playerAddress],
    });
    return ((result as bigint[]) ?? []).map(Number);
  } catch {
    return [];
  }
}

export async function createTriviaMatch(
  topic: string,
  maxPlayers: number,
  wallet: ActiveWallet
): Promise<{ matchId: number; txHash: TxHash }> {
  if (!wallet) throw new Error("No wallet found");
  const prevIds = await getTriviaMatchesForPlayer(wallet.address);
  const prevMax = prevIds.length > 0 ? Math.max(...prevIds) : -1;
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(TRIVIA_ROYALE_ADDRESS),
    functionName: "create_match",
    args: [topic, maxPlayers],
    value: BigInt(0),
  });
  // AI topic verification can take 5-10 min in local Studio.
  // Try receipt first (3 min window), then fall back to state polling for up to 20 min.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 60 });
  } catch {
    // Receipt poll timed out — poll until the match appears (proves AI call finished)
    let found = false;
    for (let i = 0; i < 400; i++) {
      const ids = await getTriviaMatchesForPlayer(wallet.address);
      if (ids.length > 0 && Math.max(...ids) > prevMax) { found = true; break; }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!found) throw new Error("createTriviaMatch: timed out waiting for match to appear on-chain");
  }
  const matchIds = await getTriviaMatchesForPlayer(wallet.address);
  const newMax = matchIds.length > 0 ? Math.max(...matchIds) : -1;
  if (newMax <= prevMax) throw new Error("createTriviaMatch: no new match found after tx");
  return { matchId: newMax, txHash: hash as TxHash };
}

export async function joinTriviaMatch(
  matchId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(TRIVIA_ROYALE_ADDRESS),
    functionName: "join_match",
    args: [matchId],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 60 });
  return hash as TxHash;
}

export async function startTriviaMatch(
  matchId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(TRIVIA_ROYALE_ADDRESS),
    functionName: "start_match",
    args: [matchId],
    value: BigInt(0),
  });
  // AI question generation can take 2-5 minutes — try receipt first, fall back to state poll
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 60 });
  } catch {
    // Receipt poll timed out — poll match state until it leaves WAITING
    for (let i = 0; i < 120; i++) {
      const m = await getTriviaMatch(matchId);
      if (m && Number(m.state) !== TRIVIA_STATE_WAITING) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return hash as TxHash;
}

export async function submitTriviaAnswer(
  matchId: number,
  answer: string,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(TRIVIA_ROYALE_ADDRESS),
    functionName: "submit_answer",
    args: [matchId, answer],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  return hash as TxHash;
}

export async function resolveTriviaRound(
  matchId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const prevMatch = await getTriviaMatch(matchId);
  const prevRound = prevMatch ? Number(prevMatch.current_round) : -1;
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(TRIVIA_ROYALE_ADDRESS),
    functionName: "resolve_round",
    args: [matchId],
    value: BigInt(0),
  });
  // AI open-ended verification can take 1-3 minutes — try receipt, fall back to state poll
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 60 });
  } catch {
    // Poll until round advances or match ends
    for (let i = 0; i < 60; i++) {
      const m = await getTriviaMatch(matchId);
      if (!m) break;
      const roundChanged = Number(m.current_round) !== prevRound;
      const ended = Number(m.state) === TRIVIA_STATE_ENDED || Number(m.state) === TRIVIA_STATE_CANCELLED;
      if (roundChanged || ended) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return hash as TxHash;
}

export async function cancelTriviaMatch(
  matchId: number,
  wallet: ActiveWallet
): Promise<TxHash> {
  if (!wallet) throw new Error("No wallet found");
  const client = await clientFromWallet(wallet);
  const hash = await client.writeContract({
    address: glAddr(TRIVIA_ROYALE_ADDRESS),
    functionName: "cancel_match",
    args: [matchId],
    value: BigInt(0),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as any, retries: 30 });
  return hash as TxHash;
}
