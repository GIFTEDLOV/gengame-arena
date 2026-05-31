"use client";

import AuthGuard from "@/components/AuthGuard";
import TxButton from "@/components/TxButton";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createPromptWarsMatch,
  getRecentMatches,
  getMatchesForPlayer,
  getMatch,
} from "@/lib/genlayer";
import type { Match } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

const STATE_LABELS: Record<number, string> = {
  0: "Waiting for player 2",
  1: "In progress",
  2: "In progress",
  3: "Judging",
  4: "Judged",
};

const ZERO_ADDR = "0x" + "0".repeat(40);

export default function PromptWarsPage() {
  const router = useRouter();
  const { wallet, ready } = useActiveWallet();
  const [joinId, setJoinId] = useState("");
  const [recentMatches, setRecentMatches] = useState<Match[]>([]);
  const [myMatches, setMyMatches] = useState<Match[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);

  useEffect(() => {
    getRecentMatches(10)
      .then(setRecentMatches)
      .finally(() => setLoadingMatches(false));
  }, []);

  useEffect(() => {
    if (!wallet?.address) return;
    getMatchesForPlayer(wallet.address).then(async (ids) => {
      const results = await Promise.all(ids.map((id) => getMatch(id)));
      setMyMatches(results.filter((m): m is Match => m !== null));
    });
  }, [wallet?.address]);

  async function handleCreate() {
    if (!wallet) throw new Error("No wallet found. Please sign in first.");
    const { matchId } = await createPromptWarsMatch(wallet);
    router.push(`/prompt-wars/${matchId}`);
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const id = joinId.trim().replace(/.*\/prompt-wars\//, "");
    if (!id) return;
    router.push(`/prompt-wars/${id}`);
  }

  function MatchRow({ m }: { m: Match }) {
    const state = Number(m.state);
    return (
      <Link
        href={`/prompt-wars/${m.id}`}
        className="block rounded-xl border border-gray-700 p-4 hover:border-indigo-500 transition-colors"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-gray-300">{m.target_text}</p>
            <p className="mt-1 text-xs text-gray-500">
              {m.player1?.toLowerCase() !== ZERO_ADDR.toLowerCase()
                ? `${m.player1.slice(0, 8)}…`
                : "?"}
              {" vs "}
              {m.player2?.toLowerCase() !== ZERO_ADDR.toLowerCase()
                ? `${m.player2.slice(0, 8)}…`
                : "Waiting…"}
              {state === 4 && m.winner?.toLowerCase() !== ZERO_ADDR.toLowerCase() && (
                <span className="ml-2 text-yellow-400">
                  Winner: {m.winner.slice(0, 8)}…
                </span>
              )}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              state === 4
                ? "bg-green-900 text-green-300"
                : state === 0
                ? "bg-yellow-900 text-yellow-300"
                : "bg-blue-900 text-blue-300"
            }`}
          >
            {STATE_LABELS[state] ?? "Unknown"}
          </span>
        </div>
      </Link>
    );
  }

  return (
    <AuthGuard>
      <main className="min-h-screen p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Prompt Wars</h1>
            <p className="text-gray-400">Write the best prompt to match the AI target.</p>
          </div>
          <Link href="/dashboard" className="text-indigo-400 hover:underline">
            ← Arena
          </Link>
        </div>

        <div className="mb-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-700 p-6">
            <h2 className="mb-3 text-lg font-semibold">New Match</h2>
            <TxButton
              onClick={handleCreate}
              disabled={!ready}
              className="w-full rounded-lg bg-indigo-600 py-3 font-semibold hover:bg-indigo-500 disabled:opacity-50"
              pendingLabel="Creating match…"
            >
              Create Match
            </TxButton>
          </div>

          <div className="rounded-xl border border-gray-700 p-6">
            <h2 className="mb-3 text-lg font-semibold">Join Match</h2>
            <form onSubmit={handleJoin} className="flex gap-2">
              <input
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                placeholder="Paste match ID or link"
                className="flex-1 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500"
              >
                Go
              </button>
            </form>
          </div>
        </div>

        {myMatches.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">My Matches</h2>
            <div className="space-y-3">
              {myMatches.map((m) => (
                <MatchRow key={String(m.id)} m={m} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-4 text-xl font-semibold">Recent Matches</h2>
          {loadingMatches ? (
            <p className="text-gray-500">Loading...</p>
          ) : recentMatches.length === 0 ? (
            <p className="text-gray-500">No matches yet. Create the first one!</p>
          ) : (
            <div className="space-y-3">
              {recentMatches.map((m) => (
                <MatchRow key={String(m.id)} m={m} />
              ))}
            </div>
          )}
        </section>
      </main>
    </AuthGuard>
  );
}
