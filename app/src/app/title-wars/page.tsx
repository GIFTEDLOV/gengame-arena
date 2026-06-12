"use client";

import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/shell/AppShell";
import TxButton from "@/components/TxButton";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getOpenTitleMatches,
  getTitleMatchesForPlayer,
  getTitleMatch,
  createTitleWarsMatch,
  TITLE_STATE_WAITING,
  TITLE_STATE_REJECTED,
  TITLE_STATE_JUDGED,
  TITLE_STATE_JUDGING,
  TITLE_STATE_OPEN,
  TITLE_STATE_CANCELLED,
  getUserProfile,
} from "@/lib/genlayer";
import type { TitleMatch } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

const MAX_EXCERPT_CHARS = 1500;
const DEFAULT_MAX_PLAYERS = 10;

function RuledLineBg() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
      style={{
        backgroundImage:
          "repeating-linear-gradient(180deg, transparent 0px, transparent 27px, rgba(254,243,199,0.05) 27px, rgba(254,243,199,0.05) 28px)",
      }}
    />
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

function MatchCard({ match, hostName }: { match: TitleMatch; hostName?: string }) {
  const excerptPreview = match.excerpt.length > 160 ? match.excerpt.slice(0, 160) + "…" : match.excerpt;
  const firstLine = match.excerpt.split("\n")[0];
  const previewText = firstLine.length > 100 ? firstLine.slice(0, 100) + "…" : firstLine;
  const playerCount = match.players.length;
  const maxPlayers = Number(match.max_players);
  const isFull = playerCount >= maxPlayers;
  const accent = "var(--game-title-wars)";

  return (
    <div
      className="rounded-xl border p-4 hover:border-[var(--border-strong)] transition-all hover:-translate-y-0.5"
      style={{ borderColor: "color-mix(in srgb, var(--game-title-wars) 15%, var(--border))" }}
    >
      <p
        className="text-sm mb-3 line-clamp-3 leading-relaxed"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          color: "var(--text-secondary)",
          whiteSpace: "pre-line",
        }}
        title={excerptPreview}
      >
        {previewText}
      </p>
      <div className="flex items-center justify-between text-xs mb-3 font-mono" style={{ color: "var(--text-tertiary)" }}>
        <span>
          {playerCount} / {maxPlayers} players
          {isFull && <span className="ml-1 text-amber-400">(full)</span>}
        </span>
        <span>by {hostName ?? match.host_str.slice(0, 10) + "…"}</span>
      </div>
      <Link
        href={`/title-wars/${Number(match.id)}`}
        className="block text-center rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90 transition-opacity text-[#0a0a0f]"
        style={{ background: accent }}
      >
        {isFull ? "View lobby" : "Join match"}
      </Link>
    </div>
  );
}

export default function TitleWarsPage() {
  const { wallet } = useActiveWallet();
  const router = useRouter();

  const [excerpt, setExcerpt] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(DEFAULT_MAX_PLAYERS);
  const [lastCreated, setLastCreated] = useState<null | { rejected: boolean; reason: string; matchId: number }>(null);
  const [openMatches, setOpenMatches] = useState<TitleMatch[]>([]);
  const [myMatches, setMyMatches] = useState<TitleMatch[]>([]);
  const [hostNames, setHostNames] = useState<Record<string, string>>({});

  const fetchMatches = useCallback(async () => {
    const openIds = await getOpenTitleMatches(20);
    const fetched = (await Promise.all(openIds.map((id) => getTitleMatch(id)))).filter(Boolean) as TitleMatch[];
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
      const myIds = await getTitleMatchesForPlayer(wallet.address);
      const myFetched = (await Promise.all(myIds.map((id) => getTitleMatch(id)))).filter(Boolean) as TitleMatch[];
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
    const { matchId } = await createTitleWarsMatch(excerpt.trim(), maxPlayers, wallet);
    const m = await getTitleMatch(matchId);
    if (m && Number(m.state) === TITLE_STATE_REJECTED) {
      setLastCreated({ rejected: true, reason: m.rejection_reason, matchId });
    } else {
      setLastCreated(null);
      await fetchMatches();
      router.push(`/title-wars/${matchId}`);
    }
  }

  const openForJoining = openMatches.filter((m) => Number(m.state) === TITLE_STATE_WAITING);
  const inProgress = openMatches.filter((m) => {
    const s = Number(m.state);
    return s === TITLE_STATE_OPEN || s === TITLE_STATE_JUDGING;
  });

  const myActive = myMatches.filter((m) => {
    const s = Number(m.state);
    return s !== TITLE_STATE_JUDGED && s !== TITLE_STATE_CANCELLED && s !== TITLE_STATE_REJECTED;
  });
  const myCompleted = myMatches.filter((m) => {
    const s = Number(m.state);
    return s === TITLE_STATE_JUDGED || s === TITLE_STATE_CANCELLED || s === TITLE_STATE_REJECTED;
  });

  const accent = "var(--game-title-wars)";

  return (
    <AuthGuard>
      <AppShell>
        <div className="relative min-h-screen overflow-hidden">
          <RuledLineBg />
          <main className="relative p-4 sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1
                  className="text-3xl font-bold"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  Title Wars
                </h1>
                <p
                  className="mt-0.5 text-sm italic"
                  style={{ fontFamily: "var(--font-serif)", color: accent }}
                >
                  Give the excerpt its perfect title.
                </p>
              </div>
              <Link href="/dashboard" className="text-[var(--accent-platform-hi)] hover:underline text-sm">← Arena</Link>
            </div>

            <section className="mb-10 rounded-xl border p-6" style={{ borderColor: "color-mix(in srgb, var(--game-title-wars) 20%, var(--border))" }}>
              <h2 className="mb-4 text-lg font-semibold">Create New Match</h2>

              {lastCreated?.rejected && (
                <div className="mb-4 rounded-lg border border-red-700 bg-red-900/20 p-4">
                  <p className="text-red-400 font-semibold mb-1">Excerpt rejected by AI verifier</p>
                  <p className="text-sm text-gray-300">{lastCreated.reason}</p>
                  <button
                    onClick={() => setLastCreated(null)}
                    className="mt-2 text-xs hover:underline"
                    style={{ color: accent }}
                  >
                    Try a different excerpt
                  </button>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Literary excerpt ({excerpt.length}/{MAX_EXCERPT_CHARS})
                  </label>
                  <textarea
                    value={excerpt}
                    onChange={(e) => setExcerpt(e.target.value.slice(0, MAX_EXCERPT_CHARS))}
                    placeholder="Paste a poem, short prose, or scene…"
                    rows={6}
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-4 py-3 placeholder-gray-500 focus:outline-none resize-y"
                    style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--text-primary)" }}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    The AI checks the text is suitable, then players race to submit the best title.
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
                    style={{ accentColor: "var(--game-title-wars)" }}
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-0.5 font-mono">
                    <span>2</span><span>50</span>
                  </div>
                </div>

                <TxButton
                  onClick={handleCreate}
                  disabled={excerpt.trim().length < 10}
                  className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 disabled:opacity-50 text-[#0a0a0f] bg-[var(--game-title-wars)]"
                  pendingLabel="Creating match (AI verifying excerpt…)"
                  description="Creating Title Wars match"
                >
                  Create Match
                </TxButton>
              </div>
            </section>

            {(openForJoining.length > 0 || inProgress.length > 0) && (
              <section className="mb-8">
                <SectionHeader
                  title="Open Matches"
                  count={openForJoining.length + inProgress.length}
                  accent={accent}
                />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[...openForJoining, ...inProgress].map((m) => (
                    <MatchCard key={Number(m.id)} match={m} hostName={hostNames[m.host_str.toLowerCase()]} />
                  ))}
                </div>
              </section>
            )}

            {openForJoining.length === 0 && inProgress.length === 0 && (
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
                    const stateLabel =
                      state === TITLE_STATE_WAITING ? "Waiting" :
                      state === TITLE_STATE_OPEN ? "Open for submissions" :
                      "Judging…";
                    return (
                      <Link
                        key={Number(m.id)}
                        href={`/title-wars/${Number(m.id)}`}
                        className="rounded-xl border p-4 hover:border-[var(--border-strong)] transition-colors block"
                        style={{ borderColor: "color-mix(in srgb, var(--game-title-wars) 15%, var(--border))" }}
                      >
                        <p
                          className="text-sm mb-1 truncate leading-snug"
                          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--text-secondary)" }}
                        >
                          {m.excerpt.slice(0, 80)}{m.excerpt.length > 80 ? "…" : ""}
                        </p>
                        <div className="flex items-center justify-between text-xs font-mono mt-1" style={{ color: "var(--text-tertiary)" }}>
                          <span>{m.players.length} / {Number(m.max_players)} players</span>
                          <span style={{ color: accent }}>{stateLabel}</span>
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
                        href={`/title-wars/${Number(m.id)}`}
                        className="rounded-xl border border-[var(--border)] p-4 hover:border-[var(--border-strong)] transition-colors block"
                      >
                        <p
                          className="text-sm mb-1 italic truncate"
                          style={{ fontFamily: "var(--font-serif)", color: "var(--text-tertiary)" }}
                        >
                          {m.excerpt.slice(0, 80)}{m.excerpt.length > 80 ? "…" : ""}
                        </p>
                        <div className="flex items-center justify-between text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>
                          <span>{m.players.length} players</span>
                          <span className={state === TITLE_STATE_CANCELLED || state === TITLE_STATE_REJECTED ? "text-red-400" : "text-gray-400"}>
                            {state === TITLE_STATE_CANCELLED ? "Cancelled" :
                             state === TITLE_STATE_REJECTED ? "Rejected" : "Judged"}
                          </span>
                        </div>
                        {state === TITLE_STATE_JUDGED && m.ranking.length > 0 && (
                          <p className="mt-1 text-xs" style={{ color: accent }}>
                            Winner: {
                              m.ranking[0].toLowerCase() === wallet?.address?.toLowerCase()
                                ? "You!"
                                : m.ranking[0].slice(0, 10) + "…"
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
