import {
  getGenlayerClient,
  getUserProfile,
  getRecentMatches,
  getResolvedMarkets,
  getMarket,
  getTriviaMatch,
  getJudgedTitleMatches,
  getTitleMatch,
  TRIVIA_ROYALE_ADDRESS,
  STATE_JUDGED,
  PRED_STATE_RESOLVED,
  TRIVIA_STATE_ENDED,
  TITLE_STATE_JUDGED,
} from "./genlayer";

type GLAddress = `0x${string}` & { length: 42 };
const glAddr = (a: string) => a as GLAddress;

const DAILY_SENTINEL = "0x0000000000000000000000000000000000da17a1";
const ZERO_ADDR = "0x" + "0".repeat(40);

function isRealPlayer(addr: string): boolean {
  const lo = addr.toLowerCase();
  return lo !== DAILY_SENTINEL.toLowerCase() && lo !== ZERO_ADDR;
}

function fmtAddr(addr: string): string {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  username: string;
  wins: number;
  matches: number;
  winRate: number;
}

// Module-level cache keyed by tab name, 60s TTL
const cache = new Map<string, { data: LeaderboardEntry[]; fetchedAt: number }>();
const TTL_MS = 60_000;

function getCached(key: string): LeaderboardEntry[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TTL_MS) { cache.delete(key); return null; }
  return entry.data;
}

function setCached(key: string, data: LeaderboardEntry[]): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

async function resolveUsernames(addresses: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  await Promise.all(
    addresses.map(async (addr) => {
      const profile = await getUserProfile(addr).catch(() => null);
      if (profile?.username) result.set(addr.toLowerCase(), String(profile.username));
    })
  );
  return result;
}

function buildEntries(
  wins: Map<string, number>,
  matches: Map<string, number>,
  usernames: Map<string, string>,
  limit: number
): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];
  for (const [addr, w] of wins.entries()) {
    const m = matches.get(addr) ?? w;
    entries.push({
      rank: 0,
      address: addr,
      username: usernames.get(addr.toLowerCase()) ?? fmtAddr(addr),
      wins: w,
      matches: m,
      winRate: m > 0 ? w / m : 0,
    });
  }
  entries.sort((a, b) => b.wins - a.wins || b.matches - a.matches);
  return entries.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));
}

// Fetch trivia ended matches by scanning IDs 0..N-1 in parallel
async function getTriviaEndedMatches(maxId: number) {
  const ids = Array.from({ length: maxId }, (_, i) => i);
  const fetched = await Promise.all(ids.map((id) => getTriviaMatch(id)));
  return fetched.filter(
    (m): m is NonNullable<typeof m> => m !== null && Number(m.state) === TRIVIA_STATE_ENDED
  );
}

// Read the current next_match_id from TriviaRoyale so we know how far to scan
async function getTriviaNextMatchId(): Promise<number> {
  const client = getGenlayerClient();
  try {
    const result = await client.readContract({
      address: glAddr(TRIVIA_ROYALE_ADDRESS),
      functionName: "get_next_match_id",
      args: [],
    });
    return Number(result as bigint);
  } catch {
    return 50; // safe fallback: scan up to 50
  }
}

// ── Public leaderboard functions ──────────────────────────────────────────────

export async function getPromptWarsLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const cached = getCached("prompt-wars");
  if (cached) return cached;

  const data = await withTimeout(
    (async () => {
      const matches = await getRecentMatches(100);
      const judged = matches.filter((m) => Number(m.state) === STATE_JUDGED);

      const wins = new Map<string, number>();
      const participated = new Map<string, number>();

      for (const m of judged) {
        const winner = m.ranking[0];
        if (winner && isRealPlayer(winner)) {
          wins.set(winner, (wins.get(winner) ?? 0) + 1);
        }
        for (const p of m.players) {
          if (isRealPlayer(p)) {
            participated.set(p, (participated.get(p) ?? 0) + 1);
          }
        }
      }

      const allAddrs = [...new Set([...wins.keys(), ...participated.keys()])];
      const usernames = await resolveUsernames(allAddrs);
      return buildEntries(wins, participated, usernames, limit);
    })(),
    5000,
    [] as LeaderboardEntry[]
  );

  setCached("prompt-wars", data);
  return data;
}

export async function getPredictionsLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const cached = getCached("predictions");
  if (cached) return cached;

  const data = await withTimeout(
    (async () => {
      const marketIds = await getResolvedMarkets(100);
      const markets = (await Promise.all(marketIds.map((id) => getMarket(id)))).filter(
        (m): m is NonNullable<typeof m> => m !== null && Number(m.state) === PRED_STATE_RESOLVED
      );

      const wins = new Map<string, number>();
      const participated = new Map<string, number>();

      for (const m of markets) {
        const winner = m.ranking[0];
        if (winner && isRealPlayer(winner)) {
          wins.set(winner, (wins.get(winner) ?? 0) + 1);
        }
        for (const p of m.players) {
          if (isRealPlayer(p)) {
            participated.set(p, (participated.get(p) ?? 0) + 1);
          }
        }
      }

      const allAddrs = [...new Set([...wins.keys(), ...participated.keys()])];
      const usernames = await resolveUsernames(allAddrs);
      return buildEntries(wins, participated, usernames, limit);
    })(),
    5000,
    [] as LeaderboardEntry[]
  );

  setCached("predictions", data);
  return data;
}

export async function getTriviaRoyaleLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const cached = getCached("trivia");
  if (cached) return cached;

  const data = await withTimeout(
    (async () => {
      const nextId = await getTriviaNextMatchId();
      const scanLimit = Math.min(nextId, 60); // never scan more than 60
      const ended = await getTriviaEndedMatches(scanLimit);

      const wins = new Map<string, number>();
      const participated = new Map<string, number>();

      for (const m of ended) {
        if (m.winner_str && isRealPlayer(m.winner_str)) {
          wins.set(m.winner_str, (wins.get(m.winner_str) ?? 0) + 1);
        }
        for (const p of m.players) {
          if (isRealPlayer(p)) {
            participated.set(p, (participated.get(p) ?? 0) + 1);
          }
        }
      }

      const allAddrs = [...new Set([...wins.keys(), ...participated.keys()])];
      const usernames = await resolveUsernames(allAddrs);
      return buildEntries(wins, participated, usernames, limit);
    })(),
    5000,
    [] as LeaderboardEntry[]
  );

  setCached("trivia", data);
  return data;
}

export async function getTitleWarsLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const cached = getCached("title-wars");
  if (cached) return cached;

  const data = await withTimeout(
    (async () => {
      const matchIds = await getJudgedTitleMatches(100);
      const matches = (await Promise.all(matchIds.map((id) => getTitleMatch(id)))).filter(
        (m): m is NonNullable<typeof m> => m !== null && Number(m.state) === TITLE_STATE_JUDGED
      );

      const wins = new Map<string, number>();
      const participated = new Map<string, number>();

      for (const m of matches) {
        const winner = m.ranking[0];
        if (winner && isRealPlayer(winner)) {
          wins.set(winner, (wins.get(winner) ?? 0) + 1);
        }
        for (const p of m.players) {
          if (isRealPlayer(p)) {
            participated.set(p, (participated.get(p) ?? 0) + 1);
          }
        }
      }

      const allAddrs = [...new Set([...wins.keys(), ...participated.keys()])];
      const usernames = await resolveUsernames(allAddrs);
      return buildEntries(wins, participated, usernames, limit);
    })(),
    5000,
    [] as LeaderboardEntry[]
  );

  setCached("title-wars", data);
  return data;
}

export async function getOverallLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const cached = getCached("overall");
  if (cached) return cached;

  const data = await withTimeout(
    (async () => {
      // Collect addresses from all 4 game contracts
      const [pwMatches, predIds, triviaScanId, titleIds] = await Promise.all([
        getRecentMatches(100).catch(() => []),
        getResolvedMarkets(100).catch(() => []),
        getTriviaNextMatchId().catch(() => 0),
        getJudgedTitleMatches(100).catch(() => []),
      ]);

      const addressSet = new Set<string>();

      // Prompt Wars players
      for (const m of pwMatches) {
        for (const p of m.players) { if (isRealPlayer(p)) addressSet.add(p.toLowerCase()); }
      }

      // Predictions players
      const predMarkets = (await Promise.all(predIds.map((id) => getMarket(id).catch(() => null)))).filter(Boolean);
      for (const m of predMarkets) {
        if (!m) continue;
        for (const p of m.players) { if (isRealPlayer(p)) addressSet.add(p.toLowerCase()); }
      }

      // Trivia players
      const triviaMatches = await getTriviaEndedMatches(Math.min(triviaScanId, 60)).catch(() => []);
      for (const m of triviaMatches) {
        for (const p of m.players) { if (isRealPlayer(p)) addressSet.add(p.toLowerCase()); }
      }

      // Title Wars players
      const titleMatches = (await Promise.all(titleIds.map((id) => getTitleMatch(id).catch(() => null)))).filter(Boolean);
      for (const m of titleMatches) {
        if (!m) continue;
        for (const p of m.players) { if (isRealPlayer(p)) addressSet.add(p.toLowerCase()); }
      }

      // Fetch profiles and sort by total_wins
      const addresses = [...addressSet];
      const profileResults = await Promise.all(addresses.map((addr) => getUserProfile(addr).catch(() => null)));

      const entries: LeaderboardEntry[] = [];
      for (let i = 0; i < addresses.length; i++) {
        const profile = profileResults[i];
        if (!profile) continue;
        const wins = Number(profile.total_wins);
        const matches = Number(profile.total_matches);
        entries.push({
          rank: 0,
          address: addresses[i],
          username: String(profile.username) || fmtAddr(addresses[i]),
          wins,
          matches,
          winRate: matches > 0 ? wins / matches : 0,
        });
      }

      entries.sort((a, b) => b.wins - a.wins || b.matches - a.matches);
      const ranked = entries.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));
      return ranked;
    })(),
    5000,
    [] as LeaderboardEntry[]
  );

  setCached("overall", data);
  return data;
}

export type { LeaderboardEntry as default };
