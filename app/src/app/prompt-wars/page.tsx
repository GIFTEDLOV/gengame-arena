"use client";

import AuthGuard from "@/components/AuthGuard";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createPromptWarsMatch, getRecentMatches } from "@/lib/genlayer";
import type { Match } from "@/lib/genlayer";
import { getOrCreateGuestWallet } from "@/lib/guest";
import { usePrivy } from "@privy-io/react-auth";

const STATE_LABELS: Record<number, string> = {
  0: "Waiting for player 2",
  1: "In progress",
  2: "In progress",
  3: "Judging",
  4: "Judged",
};

const ZERO_ADDR = "0x" + "0".repeat(40);

function getPrivateKey(): `0x${string}` | undefined {
  if (typeof window === "undefined") return undefined;
  return (localStorage.getItem("gengame_guest_key") as `0x${string}`) ?? undefined;
}

export default function PromptWarsPage() {
  const router = useRouter();
  const { user } = usePrivy();
  const [creating, setCreating] = useState(false);
  const [joinId, setJoinId] = useState("");
  const [recentMatches, setRecentMatches] = useState<Match[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);

  useEffect(() => {
    getRecentMatches(10)
      .then(setRecentMatches)
      .finally(() => setLoadingMatches(false));
  }, []);

  async function handleCreate() {
    const pk =
      getPrivateKey() ??
      (user as unknown as { wallet?: { privateKey?: `0x${string}` } })?.wallet?.privateKey;
    if (!pk) {
      alert("No wallet found. Please sign in first.");
      return;
    }
    setCreating(true);
    try {
      const { matchId } = await createPromptWarsMatch(pk);
      router.push(`/prompt-wars/${matchId}`);
    } catch (err) {
      alert(`Failed to create match: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreating(false);
    }
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const id = joinId.trim().replace(/.*\/prompt-wars\//, "");
    if (!id) return;
    router.push(`/prompt-wars/${id}`);
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
            <button
              onClick={handleCreate}
              disabled={creating}
              className="w-full rounded-lg bg-indigo-600 py-3 font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Match"}
            </button>
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

        <section>
          <h2 className="mb-4 text-xl font-semibold">Recent Matches</h2>
          {loadingMatches ? (
            <p className="text-gray-500">Loading...</p>
          ) : recentMatches.length === 0 ? (
            <p className="text-gray-500">No matches yet. Create the first one!</p>
          ) : (
            <div className="space-y-3">
              {recentMatches.map((m) => {
                const state = Number(m.state);
                return (
                  <Link
                    key={String(m.id)}
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
              })}
            </div>
          )}
        </section>
      </main>
    </AuthGuard>
  );
}
