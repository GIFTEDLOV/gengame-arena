"use client";

import AuthGuard from "@/components/AuthGuard";
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
  TRIVIA_STATE_CANCELLED,
  getUserProfile,
} from "@/lib/genlayer";
import type { TriviaMatch } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

const MAX_TOPIC_CHARS = 80;
const DEFAULT_MAX_PLAYERS = 10;

function MatchCard({ match, hostName }: { match: TriviaMatch; hostName?: string }) {
  const playerCount = match.players.length;
  const maxPlayers = Number(match.max_players);
  const isFull = playerCount >= maxPlayers;

  return (
    <div className="rounded-xl border border-gray-700 p-4 hover:border-indigo-500 transition-colors">
      <p className="font-semibold text-sm mb-1 truncate">{match.topic}</p>
      <div className="flex items-center justify-between text-xs text-gray-400 mb-3">
        <span>
          {playerCount} / {maxPlayers} players
          {isFull && <span className="ml-1 text-amber-400">(full)</span>}
        </span>
        <span>Host: {hostName ?? match.host_str.slice(0, 10) + "…"}</span>
      </div>
      <Link
        href={`/trivia-royale/${Number(match.id)}`}
        className="block text-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-500"
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
  const [lastCreated, setLastCreated] = useState<null | {
    rejected: boolean;
    reason: string;
    matchId: number;
  }>(null);

  const [openMatches, setOpenMatches] = useState<TriviaMatch[]>([]);
  const [myMatches, setMyMatches] = useState<TriviaMatch[]>([]);
  const [hostNames, setHostNames] = useState<Record<string, string>>({});

  const fetchMatches = useCallback(async () => {
    const openIds = await getOpenTriviaMatches(20);
    const fetched = (
      await Promise.all(openIds.map((id) => getTriviaMatch(id)))
    ).filter(Boolean) as TriviaMatch[];
    setOpenMatches(fetched);

    // resolve host usernames
    for (const m of fetched) {
      const key = m.host_str.toLowerCase();
      if (!hostNames[key]) {
        getUserProfile(m.host_str).then((p) => {
          if (p?.username) {
            setHostNames((prev) => ({ ...prev, [key]: String(p.username) }));
          }
        });
      }
    }

    if (wallet) {
      const myIds = await getTriviaMatchesForPlayer(wallet.address);
      const myFetched = (
        await Promise.all(myIds.map((id) => getTriviaMatch(id)))
      ).filter(Boolean) as TriviaMatch[];
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

  return (
    <AuthGuard>
      <main className="min-h-screen p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold">Trivia Royale</h1>
          <Link href="/dashboard" className="text-indigo-400 hover:underline text-sm">← Arena</Link>
        </div>

        {/* Create match */}
        <section className="mb-10 rounded-xl border border-gray-700 p-6">
          <h2 className="mb-4 text-lg font-semibold">Create New Match</h2>

          {lastCreated?.rejected && (
            <div className="mb-4 rounded-lg border border-red-700 bg-red-900/20 p-4">
              <p className="text-red-400 font-semibold mb-1">Topic rejected by AI verifier</p>
              <p className="text-sm text-gray-300">{lastCreated.reason}</p>
              <button
                onClick={() => setLastCreated(null)}
                className="mt-2 text-xs text-indigo-400 hover:underline"
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
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                Pick a topic with 15+ publicly verifiable facts. The AI will generate questions and verify answers.
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Max players: {maxPlayers}
              </label>
              <input
                type="range"
                min={2}
                max={50}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-0.5">
                <span>2</span>
                <span>50</span>
              </div>
            </div>

            <TxButton
              onClick={handleCreate}
              disabled={topic.trim().length < 3}
              className="rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500 disabled:opacity-50"
              pendingLabel="Creating match (AI verifying topic…)"
            >
              Create Match
            </TxButton>
          </div>
        </section>

        {/* Open matches */}
        {openMatches.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">Open Matches</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {openMatches.map((m) => (
                <MatchCard
                  key={Number(m.id)}
                  match={m}
                  hostName={hostNames[m.host_str.toLowerCase()]}
                />
              ))}
            </div>
          </section>
        )}

        {openMatches.length === 0 && (
          <p className="text-gray-500 text-center py-8">
            No open matches — create the first one!
          </p>
        )}

        {/* My matches */}
        {myMatches.length > 0 && (
          <section className="mt-4 mb-8">
            <h2 className="mb-4 text-lg font-semibold">My Matches</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myMatches.map((m) => {
                const state = Number(m.state);
                const stateLabel =
                  state === TRIVIA_STATE_WAITING ? "Waiting" :
                  state === 1 ? "Generating" :
                  state === 2 ? "In Progress" :
                  state === 3 ? "Resolving" :
                  state === 4 ? "Ended" :
                  "Cancelled";
                const stateColor =
                  state === 2 ? "text-green-400" :
                  state === 4 ? "text-gray-400" :
                  state === TRIVIA_STATE_CANCELLED ? "text-red-400" :
                  "text-amber-400";
                return (
                  <Link
                    key={Number(m.id)}
                    href={`/trivia-royale/${Number(m.id)}`}
                    className="rounded-xl border border-gray-700 p-4 hover:border-indigo-500 transition-colors block"
                  >
                    <p className="font-semibold text-sm mb-1 truncate">{m.topic}</p>
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>{m.players.length} / {Number(m.max_players)} players</span>
                      <span className={stateColor}>{stateLabel}</span>
                    </div>
                    {state === 4 && m.winner_str && (
                      <p className="mt-1 text-xs text-yellow-400">
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
    </AuthGuard>
  );
}
