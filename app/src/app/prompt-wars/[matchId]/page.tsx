"use client";

import AuthGuard from "@/components/AuthGuard";
import TxButton from "@/components/TxButton";
import JudgeReasoning from "@/components/shared/JudgeReasoning";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  getMatch,
  joinPromptWarsMatch,
  startMatch,
  submitPrompt,
  judgeMatch,
  cancelMatch,
  devForceJudge,
  getUserProfile,
  STATE_WAITING,
  STATE_FULL,
  STATE_JUDGED,
  STATE_CANCELLED,
} from "@/lib/genlayer";
import type { Match } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

const ZERO_ADDR = "0x" + "0".repeat(40);
const MAX_PROMPT = 500;
const DEADLINE_UNSET = BigInt(0);

function useCountdown(deadlineUnix: number | null): {
  display: string;
  expired: boolean;
  color: string;
} {
  const [secsLeft, setSecsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (deadlineUnix === null) return;
    const tick = () => setSecsLeft(Math.max(0, deadlineUnix - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlineUnix]);

  if (secsLeft === null) return { display: "", expired: false, color: "var(--text-primary)" };
  if (secsLeft === 0) return { display: "Time's up", expired: true, color: "var(--danger)" };

  const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0");
  const ss = String(secsLeft % 60).padStart(2, "0");
  const color =
    secsLeft < 10 ? "var(--danger)" : secsLeft < 60 ? "var(--warning)" : "var(--text-primary)";
  return { display: `${mm}:${ss} remaining`, expired: false, color };
}

function LetterTileBg() {
  const tiles = [
    { x: "4%",  y: "14%", letter: "A", size: 36 },
    { x: "22%", y: "52%", letter: "Z", size: 28 },
    { x: "65%", y: "18%", letter: "P", size: 32 },
    { x: "82%", y: "62%", letter: "Q", size: 24 },
    { x: "48%", y: "76%", letter: "X", size: 30 },
    { x: "12%", y: "86%", letter: "B", size: 26 },
    { x: "76%", y: "88%", letter: "W", size: 34 },
    { x: "92%", y: "34%", letter: "R", size: 22 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg width="100%" height="100%" className="absolute inset-0">
        {tiles.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={t.y}
            fontSize={t.size}
            fill="rgba(251,191,36,0.05)"
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

const RANK_STYLES = [
  { label: "1st", border: "rgba(251,191,36,0.5)", bg: "rgba(251,191,36,0.06)", color: "var(--game-prompt-wars)" },
  { label: "2nd", border: "rgba(200,200,200,0.25)", bg: "rgba(200,200,200,0.04)", color: "#c0c0c0" },
  { label: "3rd", border: "rgba(180,130,80,0.25)", bg: "rgba(180,130,80,0.04)", color: "#b47c50" },
];

export default function MatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const matchIdNum = Number(matchId);
  const { wallet } = useActiveWallet();
  const currentAddr = wallet?.address?.toLowerCase() ?? null;

  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [nullCount, setNullCount] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [playerUsernames, setPlayerUsernames] = useState<Record<string, string>>({});
  const [shimmer, setShimmer] = useState(false);
  const prevStateRef = useRef<number>(-1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMatch = useCallback(async () => {
    const m = await getMatch(matchIdNum);
    if (m) {
      const newState = Number(m.state);
      if (prevStateRef.current !== -1 && prevStateRef.current !== STATE_JUDGED && newState === STATE_JUDGED) {
        setShimmer(true);
        setTimeout(() => setShimmer(false), 900);
      }
      prevStateRef.current = newState;
      setMatch(m);
      setNullCount(0);
    } else {
      setNullCount((n) => n + 1);
    }
    setLoading(false);
    return m;
  }, [matchIdNum]);

  useEffect(() => {
    fetchMatch();
    intervalRef.current = setInterval(fetchMatch, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchMatch]);

  useEffect(() => {
    if (!match) return;
    match.players.forEach((addr) => {
      if (!playerUsernames[addr.toLowerCase()]) {
        getUserProfile(addr).then((p) => {
          if (p?.username) setPlayerUsernames((prev) => ({ ...prev, [addr.toLowerCase()]: String(p.username) }));
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.players_json]);

  const state = match ? Number(match.state) : -1;
  const deadlineSet = match ? match.submission_deadline !== DEADLINE_UNSET : false;
  const deadlineUnix = deadlineSet && state === STATE_FULL ? Number(match!.submission_deadline) : null;
  const countdown = useCountdown(deadlineUnix);
  const deadlinePassed = deadlineSet ? Date.now() / 1000 > Number(match!.submission_deadline) : false;
  const canCancel = match ? Date.now() / 1000 > Number(match.created_at) + 300 : false;

  const playerIdx = match ? match.players.findIndex((p) => p.toLowerCase() === currentAddr) : -1;
  const isPlayer = playerIdx >= 0;
  const isHost = match ? match.players[0]?.toLowerCase() === currentAddr : false;
  const myPrompt = isPlayer ? match!.prompts[playerIdx] : "";
  const iAlreadySubmitted = !!myPrompt;
  const submittedCount = match ? match.prompts.filter((p) => !!p).length : 0;
  const totalPlayers = match ? match.players.length : 0;
  const maxPlayers = match ? Number(match.max_players) : 50;
  const allSubmitted = totalPlayers > 0 && submittedCount === totalPlayers;

  function displayName(addr: string) {
    return playerUsernames[addr.toLowerCase()] ?? addr.slice(0, 10) + "…";
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading || (!match && nullCount < 3)) {
    return (
      <AuthGuard>
        <main className="flex min-h-screen items-center justify-center">
          <p style={{ color: "var(--text-tertiary)" }}>Loading match…</p>
        </main>
      </AuthGuard>
    );
  }

  if (!match) {
    return (
      <AuthGuard>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <p style={{ color: "var(--text-tertiary)" }}>Match not found.</p>
          <Link href="/prompt-wars" style={{ color: "var(--game-prompt-wars)" }} className="hover:underline">← Lobby</Link>
        </main>
      </AuthGuard>
    );
  }

  const winnerAddr = match.ranking[0]?.toLowerCase();
  const winnerUsername = winnerAddr ? displayName(match.ranking[0]) : null;

  return (
    <AuthGuard>
      <div className="relative min-h-screen overflow-hidden">
        <LetterTileBg />
        {shimmer && <div className="pw-shimmer-bar" />}

        <main className="relative p-4 sm:p-8 max-w-3xl mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Match #{matchId}</h1>
              <p className="text-xs mt-0.5 font-mono" style={{ color: "var(--text-tertiary)" }}>
                {totalPlayers} / {maxPlayers} players
              </p>
            </div>
            <Link href="/prompt-wars" className="hover:underline text-sm" style={{ color: "var(--game-prompt-wars)" }}>
              ← Lobby
            </Link>
          </div>

          {/* Target — literary brief card */}
          {state !== STATE_CANCELLED && (
            <div
              className="mb-6 rounded-xl p-5 relative overflow-hidden"
              style={{
                border: "1px solid rgba(251,191,36,0.25)",
                background: "rgba(251,191,36,0.04)",
              }}
            >
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{ background: "var(--game-prompt-wars)", opacity: 0.5 }}
              />
              <p
                className="mb-2 text-xs font-semibold uppercase tracking-widest"
                style={{ color: "var(--game-prompt-wars)" }}
              >
                Target
              </p>
              <p
                className="text-lg leading-relaxed"
                style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--text-primary)" }}
              >
                {match.target_text}
              </p>
              <div
                className="absolute bottom-0 left-0 right-0 h-px"
                style={{ background: "var(--game-prompt-wars)", opacity: 0.3 }}
              />
            </div>
          )}

          {/* Countdown */}
          {countdown.display && (
            <div className="mb-4 flex items-center gap-4">
              <span className="text-sm font-semibold font-mono" style={{ color: countdown.color }}>
                {countdown.display}
              </span>
              <span className="text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>
                {submittedCount} / {totalPlayers} submitted
              </span>
            </div>
          )}

          {/* DEV Skip */}
          {process.env.NODE_ENV === "development" && isPlayer && state === STATE_FULL && (
            <div className="mb-4">
              <TxButton
                onClick={() => devForceJudge(matchIdNum, wallet).then(() => { fetchMatch(); })}
                className="rounded border border-orange-700 bg-orange-950 px-2 py-0.5 text-xs text-orange-400 hover:bg-orange-900"
                pendingLabel="Skipping…"
              >
                DEV: Skip to judging
              </TxButton>
            </div>
          )}

          {/* ── STATE_WAITING ── */}
          {state === STATE_WAITING && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[var(--border)] p-5">
                <p className="mb-3 text-sm font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                  Players ({totalPlayers} / {maxPlayers})
                </p>
                <ul className="mb-4 space-y-1.5">
                  {match.players.map((addr, i) => (
                    <li key={addr} className="text-sm flex items-center gap-2">
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-mono"
                        style={{
                          background: addr.toLowerCase() === currentAddr ? "rgba(251,191,36,0.2)" : "var(--bg-elevated)",
                          color: addr.toLowerCase() === currentAddr ? "var(--game-prompt-wars)" : "var(--text-tertiary)",
                        }}
                      >
                        {i + 1}
                      </span>
                      <span style={{ color: addr.toLowerCase() === currentAddr ? "var(--game-prompt-wars)" : "var(--text-primary)" }}>
                        {displayName(addr)}
                      </span>
                      {addr.toLowerCase() === currentAddr && (
                        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>(you)</span>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="flex items-center gap-3 mb-4">
                  <input
                    readOnly
                    value={typeof window !== "undefined" ? window.location.href : ""}
                    className="flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-3 py-2 text-sm"
                    style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
                  />
                  <button
                    onClick={copyLink}
                    className="rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90"
                    style={{ background: "var(--game-prompt-wars)", color: "#0a0a0f" }}
                  >
                    {copied ? "Copied!" : "Copy link"}
                  </button>
                </div>

                <div className="flex flex-wrap gap-3">
                  {!isPlayer && (
                    <TxButton
                      onClick={() => joinPromptWarsMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
                      className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 text-[#0a0a0f] bg-[var(--game-prompt-wars)]"
                      description="Joining Prompt Wars match"
                    >
                      Join Match
                    </TxButton>
                  )}

                  {isHost && totalPlayers >= 2 && (
                    <TxButton
                      onClick={() => startMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
                      className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 text-[#0a0a0f] bg-[var(--game-prompt-wars)]"
                      pendingLabel="Starting…"
                      description="Starting Prompt Wars match"
                    >
                      Start Match
                    </TxButton>
                  )}

                  {isHost && totalPlayers < 2 && (
                    <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                      Waiting for a player to join before you can start.
                    </p>
                  )}

                  {isPlayer && !isHost && (
                    <p className="text-sm" style={{ color: "var(--game-prompt-wars)" }}>
                      Waiting for host to start the match…
                    </p>
                  )}
                </div>
              </div>

              {match.players[0]?.toLowerCase() === currentAddr && canCancel && (
                <TxButton
                  onClick={() => cancelMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
                  className="rounded-lg border border-red-700 px-4 py-1.5 text-sm text-red-400 hover:bg-red-900/20"
                  description="Cancelling match"
                >
                  Cancel match
                </TxButton>
              )}
            </div>
          )}

          {/* ── STATE_FULL ── */}
          {state === STATE_FULL && (
            <div className="space-y-5">
              {isPlayer ? (
                iAlreadySubmitted ? (
                  <div
                    className="rounded-xl border p-4"
                    style={{ borderColor: "rgba(52,211,153,0.4)", background: "rgba(52,211,153,0.06)" }}
                  >
                    <p className="text-green-400 font-semibold">✓ Your prompt is submitted.</p>
                    <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                      Waiting for {totalPlayers - submittedCount} more player{totalPlayers - submittedCount !== 1 ? "s" : ""}…
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="block text-sm" style={{ color: "var(--text-secondary)" }}>
                      Your prompt ({prompt.length}/{MAX_PROMPT})
                    </label>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      maxLength={MAX_PROMPT}
                      rows={5}
                      placeholder="Write your prompt here…"
                      className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-4 py-3 placeholder-gray-500 focus:outline-none"
                      style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
                    />
                    <TxButton
                      onClick={() => submitPrompt(matchIdNum, prompt, wallet).then(() => { fetchMatch(); })}
                      disabled={prompt.length === 0}
                      className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 disabled:opacity-50 text-[#0a0a0f] bg-[var(--game-prompt-wars)]"
                      description="Submitting prompt"
                    >
                      Submit Prompt
                    </TxButton>
                  </div>
                )
              ) : (
                <p style={{ color: "var(--text-secondary)" }}>You are not a player in this match.</p>
              )}

              {isPlayer && (allSubmitted || deadlinePassed) && (
                <TxButton
                  onClick={() => judgeMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
                  className="rounded-lg px-6 py-3 font-semibold hover:opacity-90 text-[#0a0a0f] bg-[var(--game-prompt-wars)]"
                  pendingLabel="Judging… (this may take a minute)"
                  description="Judging Prompt Wars match"
                >
                  {allSubmitted ? "Judge Now" : "Finalize & Judge"}
                </TxButton>
              )}
            </div>
          )}

          {/* ── STATE_JUDGED ── */}
          {state === STATE_JUDGED && (
            <div className="space-y-6">
              {match.ranking.length === 0 ? (
                <div
                  className="rounded-xl border p-5 text-center"
                  style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
                >
                  <p
                    className="text-sm font-semibold uppercase tracking-widest mb-2"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    No Contest
                  </p>
                  <p style={{ color: "var(--text-secondary)" }}>{match.judge_reasoning}</p>
                </div>
              ) : (
                <>
                  {/* Winner banner */}
                  <div
                    className="rounded-xl p-5 text-center relative overflow-hidden"
                    style={{
                      border: "1px solid rgba(251,191,36,0.4)",
                      background: "rgba(251,191,36,0.06)",
                    }}
                  >
                    <p
                      className="text-xs font-semibold uppercase tracking-widest mb-1"
                      style={{ color: "var(--game-prompt-wars)" }}
                    >
                      Winner
                    </p>
                    <p
                      className="text-2xl font-bold"
                      style={{ color: "var(--game-prompt-wars)", fontFamily: "var(--font-serif)" }}
                    >
                      {winnerUsername}
                    </p>
                    {winnerAddr === currentAddr && (
                      <p className="mt-1 text-green-400 text-sm">That&apos;s you! 🎉</p>
                    )}
                  </div>

                  {/* Ranking cards */}
                  <div className="space-y-3">
                    {match.ranking.map((addr, rank) => {
                      const addrLow = addr.toLowerCase();
                      const pIdx = match.players.findIndex((p) => p.toLowerCase() === addrLow);
                      const playerPrompt = pIdx >= 0 ? match.prompts[pIdx] : "";
                      const playerOutput = pIdx >= 0 ? match.outputs[pIdx] : "";
                      const rankStyle = RANK_STYLES[rank] ?? { label: `${rank + 1}th`, border: "var(--border)", bg: "transparent", color: "var(--text-tertiary)" };

                      return (
                        <div
                          key={addr}
                          className="rounded-xl border p-4 relative overflow-hidden"
                          style={{ borderColor: rankStyle.border, background: rankStyle.bg }}
                        >
                          <div
                            className="absolute top-0 left-0 right-0 h-px"
                            style={{ background: rankStyle.color, opacity: 0.4 }}
                          />
                          <div className="flex items-center gap-3 mb-3">
                            <span
                              className="text-sm font-bold w-8"
                              style={{ color: rankStyle.color }}
                            >
                              {rankStyle.label}
                            </span>
                            <span className="font-semibold text-sm">
                              {displayName(addr)}
                            </span>
                            {addrLow === currentAddr && (
                              <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>(you)</span>
                            )}
                          </div>
                          {playerPrompt && (
                            <p
                              className="text-sm mb-2 pl-3 border-l-2"
                              style={{
                                fontFamily: "var(--font-serif)",
                                fontStyle: "italic",
                                color: "var(--text-secondary)",
                                borderColor: `${rankStyle.color}40`,
                              }}
                            >
                              {playerPrompt}
                            </p>
                          )}
                          {playerOutput && (
                            <p
                              className="text-xs leading-relaxed"
                              style={{ fontFamily: "var(--font-serif)", color: "var(--text-tertiary)" }}
                            >
                              → {playerOutput}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* AI reasoning */}
                  {match.judge_reasoning && (
                    <JudgeReasoning
                      reasoning={match.judge_reasoning}
                      game="prompt-wars"
                    />
                  )}
                </>
              )}

              <Link
                href="/prompt-wars"
                className="inline-block rounded-lg px-6 py-2 font-semibold hover:opacity-90 text-[#0a0a0f] bg-[var(--game-prompt-wars)]"
              >
                Back to Lobby
              </Link>
            </div>
          )}

          {/* ── STATE_CANCELLED ── */}
          {state === STATE_CANCELLED && (
            <div className="space-y-4 text-center">
              <p style={{ color: "var(--text-secondary)" }}>This match was cancelled.</p>
              <Link
                href="/prompt-wars"
                className="inline-block rounded-lg px-6 py-2 font-semibold hover:opacity-90 text-[#0a0a0f] bg-[var(--game-prompt-wars)]"
              >
                Back to Lobby
              </Link>
            </div>
          )}
        </main>
      </div>
    </AuthGuard>
  );
}
