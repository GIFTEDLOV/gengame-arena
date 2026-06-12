"use client";

import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/shell/AppShell";
import TxButton from "@/components/TxButton";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createPromptWarsMatch,
  getRecentMatches,
  getMatchesForPlayer,
  getMatch,
  STATE_JUDGED,
  STATE_WAITING,
  STATE_FULL,
  STATE_CANCELLED,
} from "@/lib/genlayer";
import type { Match } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

const ZERO_ADDR = "0x" + "0".repeat(40);

function LetterTileBg() {
  const tiles = [
    { x: "4%",  y: "14%", letter: "A", size: 36 },
    { x: "22%", y: "50%", letter: "Z", size: 28 },
    { x: "65%", y: "18%", letter: "P", size: 32 },
    { x: "82%", y: "60%", letter: "Q", size: 24 },
    { x: "48%", y: "74%", letter: "X", size: 30 },
    { x: "12%", y: "84%", letter: "B", size: 26 },
    { x: "76%", y: "88%", letter: "W", size: 34 },
    { x: "92%", y: "32%", letter: "R", size: 22 },
    { x: "36%", y: "32%", letter: "T", size: 20 },
    { x: "56%", y: "56%", letter: "N", size: 28 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden animate-pw-drift" aria-hidden="true">
      <svg width="100%" height="100%" className="absolute inset-0">
        {tiles.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={t.y}
            fontSize={t.size}
            fill="rgba(251,191,36,0.055)"
            fontFamily="Georgia, serif"
            fontStyle="italic"
          >
            {t.letter}
          </text>
        ))}
      </svg>
    </div>
  );
}

function StatePill({ state }: { state: number }) {
  if (state === STATE_WAITING) {
    return (
      <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
        style={{ background: "rgba(251,191,36,0.15)", color: "var(--game-prompt-wars)" }}>
        Open
      </span>
    );
  }
  if (state === STATE_FULL) {
    return (
      <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-900/40 text-blue-300">
        In progress
      </span>
    );
  }
  if (state === STATE_JUDGED) {
    return (
      <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium bg-gray-800 text-gray-400">
        Judged
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium bg-red-900/30 text-red-400">
      Cancelled
    </span>
  );
}

function MatchRow({ m }: { m: Match }) {
  const state = Number(m.state);
  const playerCount = m.players.length;
  const maxP = Number(m.max_players);
  const isCompleted = state === STATE_JUDGED || state === STATE_CANCELLED;

  return (
    <Link
      href={`/prompt-wars/${m.id}`}
      className={`block rounded-xl border p-4 transition-all hover:border-[var(--border-strong)] hover:-translate-y-0.5 ${isCompleted ? "opacity-60" : ""}`}
      style={{ borderColor: state === STATE_JUDGED ? "rgba(251,191,36,0.1)" : "var(--border)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm leading-snug"
            style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--text-primary)" }}
          >
            {m.target_text}
          </p>
          <p className="mt-1 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
            {playerCount} / {maxP} players
            {state === STATE_JUDGED && m.ranking[0] && m.ranking[0].toLowerCase() !== ZERO_ADDR.toLowerCase() && (
              <span className="ml-2" style={{ color: "var(--game-prompt-wars)" }}>
                Winner: {m.ranking[0].slice(0, 8)}…
              </span>
            )}
          </p>
        </div>
        <StatePill state={state} />
      </div>
    </Link>
  );
}

function SectionHeader({ title, count, accent }: { title: string; count: number; accent: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
      <span
        className="rounded-full px-2 py-0.5 text-xs font-mono"
        style={{ background: `color-mix(in srgb, ${accent} 15%, transparent)`, color: accent }}
      >
        {count}
      </span>
    </div>
  );
}

export default function PromptWarsPage() {
  const router = useRouter();
  const { wallet, ready } = useActiveWallet();
  const [showModal, setShowModal] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(50);
  const [joinId, setJoinId] = useState("");
  const [recentMatches, setRecentMatches] = useState<Match[]>([]);
  const [myMatches, setMyMatches] = useState<Match[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);

  useEffect(() => {
    getRecentMatches(20)
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
    const cap = Math.min(50, Math.max(2, maxPlayers));
    const { matchId } = await createPromptWarsMatch(wallet, cap);
    setShowModal(false);
    router.push(`/prompt-wars/${matchId}`);
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const id = joinId.trim().replace(/.*\/prompt-wars\//, "");
    if (!id) return;
    router.push(`/prompt-wars/${id}`);
  }

  const openMatches = recentMatches.filter((m) => Number(m.state) === STATE_WAITING);
  const activeMatches = recentMatches.filter((m) => Number(m.state) === STATE_FULL);
  const completedMatches = recentMatches.filter(
    (m) => Number(m.state) === STATE_JUDGED || Number(m.state) === STATE_CANCELLED
  );

  const accent = "var(--game-prompt-wars)";

  return (
    <AuthGuard>
      <AppShell>
        <div className="relative min-h-screen overflow-hidden">
          <LetterTileBg />
          <main className="relative p-4 sm:p-8">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                  Prompt Wars
                </h1>
                <p className="mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "var(--text-sm)" }}>
                  Write the best prompt to match the AI target.
                </p>
              </div>
              <Link href="/dashboard" className="text-[var(--accent-platform-hi)] hover:underline text-sm">
                ← Arena
              </Link>
            </div>

            <div className="mb-10 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border p-6" style={{ borderColor: "color-mix(in srgb, var(--game-prompt-wars) 20%, var(--border))" }}>
                <h2 className="mb-3 text-lg font-semibold">New Match</h2>
                {showModal ? (
                  <div className="space-y-3">
                    <label className="block text-sm text-gray-400">Max players (2–50)</label>
                    <input
                      type="number"
                      min={2}
                      max={50}
                      value={maxPlayers}
                      onChange={(e) => setMaxPlayers(Number(e.target.value))}
                      className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-3 py-2 text-white focus:outline-none"
                      style={{ focusBorderColor: accent } as React.CSSProperties}
                    />
                    <div className="flex gap-2">
                      <TxButton
                        onClick={handleCreate}
                        disabled={!ready}
                        className="flex-1 rounded-lg px-4 py-2 font-semibold hover:opacity-90 disabled:opacity-50 text-[#0a0a0f] bg-[var(--game-prompt-wars)]"
                        pendingLabel="Creating…"
                        description="Creating Prompt Wars match"
                      >
                        Create
                      </TxButton>
                      <button
                        onClick={() => setShowModal(false)}
                        className="flex-1 rounded-lg border border-[var(--border-strong)] py-2 text-sm text-gray-400 hover:bg-gray-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowModal(true)}
                    disabled={!ready}
                    className="w-full rounded-lg py-3 font-semibold hover:opacity-90 disabled:opacity-50 text-[#0a0a0f] bg-[var(--game-prompt-wars)]"
                  >
                    Create Match
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-[var(--border)] p-6">
                <h2 className="mb-3 text-lg font-semibold">Join Match</h2>
                <form onSubmit={handleJoin} className="flex gap-2">
                  <input
                    value={joinId}
                    onChange={(e) => setJoinId(e.target.value)}
                    placeholder="Paste match ID or link"
                    className="flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 text-[#0a0a0f] bg-[var(--game-prompt-wars)]"
                  >
                    Go
                  </button>
                </form>
              </div>
            </div>

            {myMatches.length > 0 && (
              <section className="mb-10">
                <SectionHeader title="My Matches" count={myMatches.length} accent={accent} />
                <div className="space-y-2">
                  {myMatches.map((m) => <MatchRow key={String(m.id)} m={m} />)}
                </div>
              </section>
            )}

            {loadingMatches ? (
              <p className="text-center py-8" style={{ color: "var(--text-tertiary)" }}>Loading matches…</p>
            ) : (
              <>
                {openMatches.length > 0 && (
                  <section className="mb-8">
                    <SectionHeader title="Open" count={openMatches.length} accent={accent} />
                    <div className="space-y-2">
                      {openMatches.map((m) => <MatchRow key={String(m.id)} m={m} />)}
                    </div>
                  </section>
                )}

                {activeMatches.length > 0 && (
                  <section className="mb-8">
                    <SectionHeader title="In Progress" count={activeMatches.length} accent={accent} />
                    <div className="space-y-2">
                      {activeMatches.map((m) => <MatchRow key={String(m.id)} m={m} />)}
                    </div>
                  </section>
                )}

                {completedMatches.length > 0 && (
                  <section className="mb-8">
                    <SectionHeader title="Completed" count={completedMatches.length} accent={accent} />
                    <div className="space-y-2">
                      {completedMatches.map((m) => <MatchRow key={String(m.id)} m={m} />)}
                    </div>
                  </section>
                )}

                {openMatches.length === 0 && activeMatches.length === 0 && completedMatches.length === 0 && (
                  <p className="text-center py-8" style={{ color: "var(--text-tertiary)" }}>
                    No matches yet. Create the first one!
                  </p>
                )}
              </>
            )}
          </main>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
