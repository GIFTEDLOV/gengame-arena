"use client";

import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/shell/AppShell";
import TxButton from "@/components/TxButton";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getOpenTriviaMatches,
  getTriviaMatchesForPlayer,
  getTriviaMatch,
  createTriviaMatch,
  TRIVIA_STATE_WAITING,
  TRIVIA_STATE_IN_PROGRESS,
  TRIVIA_STATE_ENDED,
  TRIVIA_STATE_CANCELLED,
  getUserProfile,
} from "@/lib/genlayer";
import type { TriviaMatch } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

const MAX_TOPIC_CHARS = 80;
const DEFAULT_MAX_PLAYERS = 10;

function TriviaBg() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {[120, 220, 320].map((r, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            bottom: -r * 0.6,
            left: -r * 0.4,
            width: r * 2,
            height: r * 2,
            border: "1px solid rgba(236,72,153,0.08)",
          }}
        />
      ))}
    </div>
  );
}

function SectionHeader({ title, count, accent }: { title: string; count: number; accent: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <span
        className="rounded-full px-2 py-0.5 text-xs font-mono"
        style={{ background: `color-mix(in srgb, ${accent} 15%, transparent)`, color: accent }}
      >
        {count}
      </span>
    </div>
  );
}

function MatchCard({ match, hostName, isLive }: { match: TriviaMatch; hostName?: string; isLive?: boolean }) {
  const playerCount = match.players.length;
  const maxPlayers = Number(match.max_players);
  const isFull = playerCount >= maxPlayers;
  const accent = "var(--game-trivia)";

  return (
    <div
      className={`rounded-xl border p-4 transition-all hover:border-[var(--border-strong)] hover:-translate-y-0.5 ${isLive ? "animate-trivia-glow" : ""}`}
      style={{ borderColor: isLive ? "rgba(236,72,153,0.3)" : "var(--border)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p
          className="font-semibold text-sm truncate flex-1"
          style={{ color: isLive ? accent : "var(--text-primary)" }}
        >
          {match.topic}
        </p>
        {isLive && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: "rgba(236,72,153,0.2)", color: accent }}
          >
            Live
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>
          {playerCount} / {maxPlayers} players
          {isFull && <span className="ml-1 text-amber-400">(full)</span>}
        </span>
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {hostName ?? match.host_str.slice(0, 10) + "…"}
        </span>
      </div>

      <Link
        href={`/trivia-royale/${Number(match.id)}`}
        className="block text-center rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90 transition-opacity text-white"
        style={{ background: accent }}
      >
        {isFull ? "View lobby" : "Join match"}
      </Link>
    </div>
  );
}

export default function TriviaRoyalePage() {
  const { wallet } = useActiveWallet();
  const router = useRouter();

  const [topic, setTopic] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(DEFAULT_MAX_PLAYERS);
  const [lastCreated, setLastCreated] = useState<null | { rejected: boolean; reason: string; matchId: number }>(null);
  const [openMatches, setOpenMatches] = useState<TriviaMatch[]>([]);
  const [myMatches, setMyMatches] = useState<TriviaMatch[]>([]);
  const [hostNames, setHostNames] = useState<Record<string, string>>({});

  const fetchMatches = useCallback(async () => {
    const openIds = await getOpenTriviaMatches(20);
    const fetched = (await Promise.all(openIds.map((id) => getTriviaMatch(id)))).filter(Boolean) as TriviaMatch[];
    setOpenMatches(fetched);

    for (const m of fetched) {
      const key = m.host_str.toLowerCase();
      if (!hostNames[key]) {
        getUserProfile(m.host_str).then((p) => {
          if (p?.username) setHostNames((prev) => ({ ...prev, [key]: String(p.username) }));
        });
      }
    }

    if (wallet) {
      const myIds = await getTriviaMatchesForPlayer(wallet.address);
      const myFetched = (await Promise.all(myIds.map((id) => getTriviaMatch(id)))).filter(Boolean) as TriviaMatch[];
      setMyMatches(myFetched.sort((a, b) => Number(b.id) - Number(a.id)));
    }
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchMatches();
    const id = setInterval(fetchMatches, 5000);
    return () => clearInterval(id);
  }, [fetchMatches]);

  async function handleCreate() {
    if (!wallet) throw new Error("No wallet");
    const { matchId } = await createTriviaMatch(topic.trim(), maxPlayers, wallet);
    const m = await getTriviaMatch(matchId);
    if (m && Number(m.state) === TRIVIA_STATE_CANCELLED) {
      setLastCreated({ rejected: true, reason: m.rejection_reason, matchId });
    } else {
      setLastCreated(null);
      await fetchMatches();
      router.push(`/trivia-royale/${matchId}`);
    }
  }

  const liveMatches = openMatches.filter((m) => Number(m.state) === TRIVIA_STATE_IN_PROGRESS);
  const lobbyMatches = openMatches.filter((m) => Number(m.state) === TRIVIA_STATE_WAITING);

  const myActive = myMatches.filter((m) => {
    const s = Number(m.state);
    return s !== TRIVIA_STATE_ENDED && s !== TRIVIA_STATE_CANCELLED;
  });
  const myCompleted = myMatches.filter((m) => {
    const s = Number(m.state);
    return s === TRIVIA_STATE_ENDED || s === TRIVIA_STATE_CANCELLED;
  });

  const accent = "var(--game-trivia)";

  return (
    <AuthGuard>
      <AppShell>
        <div className="relative min-h-screen overflow-hidden">
          <TriviaBg />
          <main className="relative p-4 sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold">Trivia Royale</h1>
                <p className="mt-0.5 text-sm font-semibold" style={{ color: accent }}>
                  Last player standing wins
                </p>
              </div>
              <Link href="/dashboard" className="text-[var(--accent-platform-hi)] hover:underline text-sm">← Arena</Link>
            </div>

            <section className="mb-10 rounded-xl border p-6" style={{ borderColor: "color-mix(in srgb, var(--game-trivia) 20%, var(--border))" }}>
              <h2 className="mb-4 text-lg font-semibold">Create New Match</h2>

              {lastCreated?.rejected && (
                <div className="mb-4 rounded-lg border border-red-700 bg-red-900/20 p-4">
                  <p className="text-red-400 font-semibold mb-1">Topic rejected by AI verifier</p>
                  <p className="text-sm text-gray-300">{lastCreated.reason}</p>
                  <button
                    onClick={() => setLastCreated(null)}
                    className="mt-2 text-xs hover:underline"
                    style={{ color: accent }}
                  >
                    Try a different topic
                  </button>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Topic ({topic.length}/{MAX_TOPIC_CHARS})
                  </label>
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value.slice(0, MAX_TOPIC_CHARS))}
                    placeholder="Football transfers, Crypto history, 1980s sci-fi movies…"
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-4 py-3 text-white placeholder-gray-500 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Pick a topic with 15+ publicly verifiable facts.
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Max players: <span className="font-mono">{maxPlayers}</span>
                  </label>
                  <input
                    type="range"
                    min={2}
                    max={50}
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(Number(e.target.value))}
                    className="w-full"
                    style={{ accentColor: "var(--game-trivia)" }}
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-0.5 font-mono">
                    <span>2</span><span>50</span>
                  </div>
                </div>

                <TxButton
                  onClick={handleCreate}
                  disabled={topic.trim().length < 3}
                  className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 disabled:opacity-50 text-white bg-[var(--game-trivia)]"
                  pendingLabel="Creating match (AI verifying topic…)"
                  description="Creating Trivia Royale match"
                >
                  Create Match
                </TxButton>
              </div>
            </section>

            {liveMatches.length > 0 && (
              <section className="mb-8">
                <SectionHeader title="Live Now" count={liveMatches.length} accent={accent} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {liveMatches.map((m) => (
                    <MatchCard key={Number(m.id)} match={m} hostName={hostNames[m.host_str.toLowerCase()]} isLive />
                  ))}
                </div>
              </section>
            )}

            {lobbyMatches.length > 0 && (
              <section className="mb-8">
                <SectionHeader title="Open Lobbies" count={lobbyMatches.length} accent={accent} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {lobbyMatches.map((m) => (
                    <MatchCard key={Number(m.id)} match={m} hostName={hostNames[m.host_str.toLowerCase()]} />
                  ))}
                </div>
              </section>
            )}

            {liveMatches.length === 0 && lobbyMatches.length === 0 && (
              <p className="text-center py-8" style={{ color: "var(--text-tertiary)" }}>
                No open matches — create the first one!
              </p>
            )}

            {myActive.length > 0 && (
              <section className="mt-4 mb-8">
                <SectionHeader title="My Active Matches" count={myActive.length} accent={accent} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {myActive.map((m) => {
                    const state = Number(m.state);
                    const isLive = state === TRIVIA_STATE_IN_PROGRESS;
                    return (
                      <Link
                        key={Number(m.id)}
                        href={`/trivia-royale/${Number(m.id)}`}
                        className="rounded-xl border p-4 hover:border-[var(--border-strong)] transition-colors block"
                        style={{ borderColor: isLive ? "rgba(236,72,153,0.3)" : "var(--border)" }}
                      >
                        <p className="font-semibold text-sm mb-1 truncate">{m.topic}</p>
                        <div className="flex items-center justify-between text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>
                          <span>{m.players.length} / {Number(m.max_players)} players</span>
                          <span style={{ color: isLive ? accent : "var(--text-secondary)" }}>
                            {isLive ? "Live" : "Lobby"}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {myCompleted.length > 0 && (
              <section className="mb-8 opacity-65">
                <SectionHeader title="Completed" count={myCompleted.length} accent="var(--text-tertiary)" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {myCompleted.map((m) => {
                    const state = Number(m.state);
                    return (
                      <Link
                        key={Number(m.id)}
                        href={`/trivia-royale/${Number(m.id)}`}
                        className="rounded-xl border border-[var(--border)] p-4 hover:border-[var(--border-strong)] transition-colors block"
                      >
                        <p className="font-semibold text-sm mb-1 truncate">{m.topic}</p>
                        <div className="flex items-center justify-between text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>
                          <span>{m.players.length} players</span>
                          <span className={state === TRIVIA_STATE_CANCELLED ? "text-red-400" : "text-gray-400"}>
                            {state === TRIVIA_STATE_CANCELLED ? "Cancelled" : "Ended"}
                          </span>
                        </div>
                        {state === TRIVIA_STATE_ENDED && m.winner_str && (
                          <p className="mt-1 text-xs" style={{ color: "var(--game-prompt-wars)" }}>
                            Winner: {
                              m.winner_str.toLowerCase() === wallet?.address?.toLowerCase()
                                ? "You!"
                                : m.winner_str.slice(0, 10) + "…"
                            }
                          </p>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}
          </main>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
