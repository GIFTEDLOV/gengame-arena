"use client";

import AuthGuard from "@/components/AuthGuard";
import TxButton from "@/components/TxButton";
import MatchSettlingState from "@/components/MatchSettlingState";
import JudgeReasoning from "@/components/shared/JudgeReasoning";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  getTitleMatch,
  joinTitleWarsMatch,
  startTitleWarsMatch,
  submitTitle,
  judgeTitleMatch,
  cancelTitleMatch,
  getUserProfile,
  TITLE_STATE_REJECTED,
  TITLE_STATE_OPEN,
  TITLE_STATE_JUDGING,
  TITLE_STATE_JUDGED,
  TITLE_STATE_CANCELLED,
} from "@/lib/genlayer";
import type { TitleMatch } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";
import { useRegistration } from "@/lib/RegistrationContext";
import { useAutoResolve } from "@/lib/useAutoResolve";

const accent = "var(--game-title-wars)";

function useCountdown(deadlineUnix: number | null) {
  const [secsLeft, setSecsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (deadlineUnix === null) return;
    const tick = () =>
      setSecsLeft(Math.max(0, deadlineUnix - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlineUnix]);

  if (secsLeft === null) return { display: "", expired: false, timerColor: "var(--text-primary)" };
  if (secsLeft === 0) return { display: "Time's up!", expired: true, timerColor: "var(--danger)" };

  const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0");
  const ss = String(secsLeft % 60).padStart(2, "0");
  const timerColor =
    secsLeft < 30 ? "var(--danger)" : secsLeft < 60 ? "var(--warning)" : "var(--game-title-wars)";
  return { display: `${mm}:${ss}`, expired: false, timerColor };
}


function ExcerptCard({ excerpt }: { excerpt: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = excerpt.length > 300;
  const display = isLong && !expanded ? excerpt.slice(0, 300) + "…" : excerpt;

  return (
    <div
      className="rounded-xl border p-6 mb-6"
      style={{
        borderColor: `color-mix(in srgb, ${accent} 20%, var(--border))`,
        background: `color-mix(in srgb, ${accent} 3%, var(--bg-elevated))`,
      }}
    >
      <p
        className="text-xs uppercase tracking-widest mb-3 font-mono"
        style={{ color: accent }}
      >
        Literary Excerpt
      </p>
      <p
        className="leading-relaxed whitespace-pre-line"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          color: "var(--text-primary)",
          fontSize: "1.05rem",
        }}
      >
        {/* Drop cap on first letter */}
        <span
          className="float-left mr-2 leading-none animate-tw-drop-cap"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "normal",
            fontSize: "4rem",
            lineHeight: "3.2rem",
            color: accent,
          }}
        >
          {display[0]}
        </span>
        {display.slice(1)}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs hover:underline"
          style={{ color: accent }}
        >
          {expanded ? "Collapse" : "Show full excerpt"}
        </button>
      )}
    </div>
  );
}

const RANK_STYLES = [
  { label: "1st 🏆", border: "rgba(251,191,36,0.5)", bg: "rgba(251,191,36,0.07)", color: "#fbbf24" },
  { label: "2nd",    border: "rgba(192,192,192,0.4)", bg: "rgba(192,192,192,0.04)", color: "#c0c0c0" },
  { label: "3rd",    border: "rgba(205,127,50,0.4)",  bg: "rgba(205,127,50,0.04)",  color: "#cd7f32" },
];

export default function TitleMatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const matchIdNum = Number(matchId);
  const { wallet } = useActiveWallet();
  const { requireRegistration } = useRegistration();
  const currentAddr = wallet?.address?.toLowerCase() ?? null;

  const [match, setMatch] = useState<TitleMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [submittedThisSession, setSubmittedThisSession] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedAt = useRef<number>(Date.now());

  const fetchMatch = useCallback(async () => {
    const m = await getTitleMatch(matchIdNum);
    if (m) setMatch(m);
    setLoading(false);
    return m;
  }, [matchIdNum]);

  useEffect(() => { fetchMatch(); }, [fetchMatch]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const state = match ? Number(match.state) : -1;
    const ms = state === TITLE_STATE_OPEN || state === TITLE_STATE_JUDGING ? 2000 : 5000;
    intervalRef.current = setInterval(fetchMatch, ms);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchMatch, match?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!match) return;
    [...match.players].forEach((addr) => {
      const key = addr.toLowerCase();
      if (!playerNames[key]) {
        getUserProfile(addr).then((p) => {
          if (p?.username) setPlayerNames((prev) => ({ ...prev, [key]: String(p.username) }));
        });
      }
    });
  }, [match?.players]); // eslint-disable-line react-hooks/exhaustive-deps

  function displayName(addr: string) {
    return playerNames[addr.toLowerCase()] ?? addr.slice(0, 10) + "…";
  }

  // Must be called unconditionally before any early return
  const { resolving: autoResolving } = useAutoResolve({
    deadlineUnix: match && match.submission_deadline && Number(match.submission_deadline) > 0
      ? Number(match.submission_deadline) : 0,
    isActive: match ? Number(match.state) === TITLE_STATE_OPEN : false,
    resolveFn: async () => { await judgeTitleMatch(matchIdNum, wallet!); },
  });

  if (loading) {
    return (
      <AuthGuard>
        <main className="flex min-h-screen items-center justify-center">
          <p style={{ color: "var(--text-tertiary)" }}>Loading match…</p>
        </main>
      </AuthGuard>
    );
  }

  if (!match) {
    if ((Date.now() - mountedAt.current) / 1000 < 120) {
      return (
        <AuthGuard>
          <MatchSettlingState accent={accent} backHref="/title-wars" backLabel="← Back to lobby" />
        </AuthGuard>
      );
    }
    return (
      <AuthGuard>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4">
          <p style={{ color: "var(--text-tertiary)" }}>Match not found.</p>
          <Link href="/title-wars" className="hover:underline" style={{ color: accent }}>← Back to lobby</Link>
        </main>
      </AuthGuard>
    );
  }

  const state = Number(match.state);
  const isHost = currentAddr === match.host_str.toLowerCase();
  const isPlayer = match.players.some((p) => p.toLowerCase() === currentAddr);
  const playerCount = match.players.length;
  const maxPlayers = Number(match.max_players);
  const deadline = match.submission_deadline && Number(match.submission_deadline) > 0
    ? Number(match.submission_deadline) : null;
  const submittedCount = match.titles.filter((t) => t !== "").length;
  const myIndex = currentAddr
    ? match.players.findIndex((p) => p.toLowerCase() === currentAddr)
    : -1;
  const myTitle = myIndex >= 0 ? match.titles[myIndex] : "";
  const hasSubmitted = myTitle !== "";

  // ── CANCELLED ──
  if (state === TITLE_STATE_CANCELLED) {
    return (
      <AuthGuard>
        <div className="relative min-h-screen overflow-hidden">

          <main className="relative min-h-screen p-8 max-w-2xl mx-auto">
            <Link href="/title-wars" className="hover:underline text-sm" style={{ color: accent }}>← Back to lobby</Link>
            <div className="mt-8 rounded-xl border border-red-700 bg-red-900/20 p-6">
              <h1 className="text-2xl font-bold mb-2">Match Cancelled</h1>
              <p className="text-gray-300 text-sm">The host cancelled this match.</p>
              <Link href="/title-wars" className="mt-4 inline-block rounded-lg px-5 py-2 text-sm font-semibold hover:opacity-90 text-[#0a0a0f]" style={{ background: accent }}>
                Back to lobby
              </Link>
            </div>
          </main>
        </div>
      </AuthGuard>
    );
  }

  // ── REJECTED ──
  if (state === TITLE_STATE_REJECTED) {
    return (
      <AuthGuard>
        <div className="relative min-h-screen overflow-hidden">

          <main className="relative min-h-screen p-8 max-w-2xl mx-auto">
            <Link href="/title-wars" className="hover:underline text-sm" style={{ color: accent }}>← Back to lobby</Link>
            <div className="mt-8 rounded-xl border border-red-700 bg-red-900/20 p-6">
              <h1 className="text-2xl font-bold mb-2">Excerpt Rejected</h1>
              <p className="text-gray-300 text-sm">{match.rejection_reason}</p>
              <Link href="/title-wars" className="mt-4 inline-block rounded-lg px-5 py-2 text-sm font-semibold hover:opacity-90 text-[#0a0a0f]" style={{ background: accent }}>
                Create a new match
              </Link>
            </div>
          </main>
        </div>
      </AuthGuard>
    );
  }

  // ── JUDGING ──
  if (state === TITLE_STATE_JUDGING) {
    return (
      <AuthGuard>
        <div className="relative min-h-screen overflow-hidden">

          <main className="relative flex min-h-screen flex-col items-center justify-center gap-4 p-8">
            <div
              className="h-14 w-14 rounded-full border-t-2 animate-spin"
              style={{ borderColor: accent }}
            />
            <h2
              className="text-xl font-bold"
              style={{ fontFamily: "var(--font-serif)", color: accent }}
            >
              AI is ranking all titles…
            </h2>
            <p className="text-sm text-center max-w-sm" style={{ color: "var(--text-secondary)" }}>
              Validators are agreeing on the ranking. This may take 30–60 seconds.
            </p>
          </main>
        </div>
      </AuthGuard>
    );
  }

  // ── JUDGED ──
  if (state === TITLE_STATE_JUDGED) {
    const winner = match.ranking[0] ?? "";
    const iWon = winner.toLowerCase() === currentAddr;
    const winnerTitleIdx = match.players.findIndex((p) => p.toLowerCase() === winner.toLowerCase());
    const winnerTitle = winnerTitleIdx >= 0 ? match.titles[winnerTitleIdx] : "";
    const fullReasoning = match.judge_reasoning.join("\n\n");

    return (
      <AuthGuard>
        <div className="relative min-h-screen overflow-hidden">

          <main className="relative min-h-screen p-8 max-w-3xl mx-auto">
            <Link href="/title-wars" className="hover:underline text-sm" style={{ color: accent }}>← Back to lobby</Link>

            <ExcerptCard excerpt={match.excerpt} />

            {/* Winner banner */}
            <div
              className="rounded-xl border p-6 text-center mb-6"
              style={{
                borderColor: "rgba(251,191,36,0.5)",
                background: "rgba(251,191,36,0.06)",
              }}
            >
              <p className="text-4xl mb-2">🏆</p>
              <h1
                className="text-3xl font-bold mb-1"
                style={{ fontFamily: "var(--font-serif)", color: "#fbbf24" }}
              >
                {iWon ? "You won!" : `Winner: ${displayName(winner)}`}
              </h1>
              {winnerTitle && (
                <p
                  className="mt-2 text-xl italic"
                  style={{ fontFamily: "var(--font-serif)", color: "var(--text-secondary)" }}
                >
                  &ldquo;{winnerTitle}&rdquo;
                </p>
              )}
              {iWon && (
                <p className="text-sm mt-1" style={{ color: "#fbbf24" }}>
                  🎉 That&apos;s you — congratulations!
                </p>
              )}
            </div>

            {/* Gallery-style ranking cards */}
            <div className="space-y-3 mb-6">
              {match.ranking.map((addr, i) => {
                const isMe = addr.toLowerCase() === currentAddr;
                const playerIdx = match.players.findIndex(
                  (p) => p.toLowerCase() === addr.toLowerCase()
                );
                const submittedTitle = playerIdx >= 0 ? match.titles[playerIdx] : "";
                const rankReason = match.judge_reasoning[i] ?? "";
                const rs = RANK_STYLES[i] ?? { label: `${i + 1}th`, border: "var(--border)", bg: "var(--bg-elevated)", color: "var(--text-tertiary)" };

                return (
                  <div
                    key={addr}
                    className="rounded-xl border p-5"
                    style={{
                      borderColor: rs.border,
                      background: isMe
                        ? `color-mix(in srgb, ${accent} 6%, ${rs.bg})`
                        : rs.bg,
                      borderTopWidth: i === 0 ? "3px" : "1px",
                    }}
                  >
                    <div className="flex items-baseline gap-3 mb-2">
                      <span className="font-bold text-sm" style={{ color: rs.color }}>{rs.label}</span>
                      <span className="font-semibold" style={{ color: isMe ? accent : "var(--text-primary)" }}>
                        {displayName(addr)}{isMe ? " (you)" : ""}
                      </span>
                    </div>
                    {submittedTitle ? (
                      <p
                        className="text-lg mb-2 animate-tw-title-reveal"
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          color: "var(--text-primary)",
                          borderLeft: `3px solid ${rs.color}`,
                          paddingLeft: "0.75rem",
                        }}
                      >
                        &ldquo;{submittedTitle}&rdquo;
                      </p>
                    ) : (
                      <p className="text-sm italic mb-2" style={{ color: "var(--text-tertiary)" }}>[did not submit]</p>
                    )}
                    {rankReason && (
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-serif)" }}>
                        {rankReason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* JudgeReasoning — full consensus reasoning */}
            {fullReasoning && (
              <JudgeReasoning
                reasoning={fullReasoning}
                game="title-wars"
                verdict={winnerTitle ? `"${winnerTitle}"` : undefined}
              />
            )}

            <Link
              href="/title-wars"
              className="mt-6 inline-block rounded-lg px-5 py-2 text-sm font-semibold hover:opacity-90 text-[#0a0a0f]"
              style={{ background: accent }}
            >
              Back to lobby
            </Link>
          </main>
        </div>
      </AuthGuard>
    );
  }

  // ── OPEN for submissions ──
  if (state === TITLE_STATE_OPEN) {
    return (
      <AuthGuard>
        <div className="relative min-h-screen overflow-hidden">

          <main className="relative min-h-screen p-8 max-w-2xl mx-auto">
            <OpenSubmissions
              match={match}
              matchIdNum={matchIdNum}
              wallet={wallet}
              isPlayer={isPlayer}
              deadline={deadline}
              submittedCount={submittedCount}
              myTitle={myTitle}
              hasSubmitted={hasSubmitted}
              submittedThisSession={submittedThisSession}
              onSubmit={() => setSubmittedThisSession(true)}
              titleInput={titleInput}
              setTitleInput={setTitleInput}
              autoResolving={autoResolving}
            />
          </main>
        </div>
      </AuthGuard>
    );
  }

  // ── WAITING (lobby) ──
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/title-wars/${matchIdNum}` : "";

  return (
    <AuthGuard>
      <div className="relative min-h-screen overflow-hidden">
        <main className="relative min-h-screen p-8 max-w-2xl mx-auto">
          <div className="mb-6">
            <Link href="/title-wars" className="hover:underline text-sm" style={{ color: accent }}>← Lobby</Link>
          </div>

          <ExcerptCard excerpt={match.excerpt} />

          {/* Lobby card */}
          <div
            className="rounded-xl border p-6 mb-6"
            style={{
              borderColor: `color-mix(in srgb, ${accent} 20%, var(--border))`,
              background: `color-mix(in srgb, ${accent} 3%, var(--bg-elevated))`,
            }}
          >
            <p className="text-sm mb-4 font-mono" style={{ color: "var(--text-secondary)" }}>
              {playerCount} / {maxPlayers} players joined
            </p>

            <div className="mb-4">
              <p className="text-xs uppercase tracking-widest mb-2 font-mono" style={{ color: "var(--text-tertiary)" }}>Players</p>
              <ul className="space-y-1.5">
                {match.players.map((addr) => {
                  const isMe = addr.toLowerCase() === currentAddr;
                  const isH = addr.toLowerCase() === match.host_str.toLowerCase();
                  return (
                    <li key={addr} className="flex items-center gap-2 text-sm">
                      <span style={{ color: isMe ? accent : "var(--text-primary)" }}>
                        {displayName(addr)}
                      </span>
                      {isH && (
                        <span
                          className="text-xs border rounded px-1"
                          style={{ color: accent, borderColor: `color-mix(in srgb, ${accent} 30%, transparent)` }}
                        >
                          host
                        </span>
                      )}
                      {isMe && !isH && <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>(you)</span>}
                    </li>
                  );
                })}
              </ul>
            </div>

            {isHost ? (
              <div className="space-y-2">
                <TxButton
                  onClick={async () => { await startTitleWarsMatch(matchIdNum, wallet!); }}
                  disabled={playerCount < 2}
                  className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 disabled:opacity-50 text-[#0a0a0f] bg-[var(--game-title-wars)]"
                  pendingLabel="Starting match…"
                  description="Starting Title Wars match"
                >
                  Start Match
                </TxButton>
                {playerCount < 2 && (
                  <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Need at least 2 players to start</p>
                )}
                <div className="pt-2">
                  <TxButton
                    onClick={async () => { await cancelTitleMatch(matchIdNum, wallet!); }}
                    className="rounded-lg border border-red-700 px-4 py-1.5 text-sm text-red-400 hover:bg-red-900/20"
                    pendingLabel="Cancelling…"
                    description="Cancelling Title Wars match"
                  >
                    Cancel match
                  </TxButton>
                </div>
              </div>
            ) : isPlayer ? (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Waiting for host to start the match…</p>
            ) : playerCount < maxPlayers ? (
              <TxButton
                onClick={async () => { if (!await requireRegistration()) return; await joinTitleWarsMatch(matchIdNum, wallet!); }}
                className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 text-[#0a0a0f] bg-[var(--game-title-wars)]"
                pendingLabel="Joining…"
                description="Joining Title Wars match"
              >
                Join Match
              </TxButton>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Match is full.</p>
            )}
          </div>

          {/* Share link */}
          <div className="rounded-xl border border-[var(--border)] p-4">
            <p className="text-xs mb-2 font-mono" style={{ color: "var(--text-tertiary)" }}>Share this match</p>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 text-xs rounded px-3 py-2 truncate font-mono"
                style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
              >
                {shareUrl}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="text-xs hover:underline shrink-0"
                style={{ color: accent }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}

// ── OpenSubmissions sub-component ──

function OpenSubmissions({
  match,
  matchIdNum,
  wallet,
  isPlayer,
  deadline,
  submittedCount,
  myTitle,
  hasSubmitted,
  submittedThisSession,
  onSubmit,
  titleInput,
  setTitleInput,
  autoResolving,
}: {
  match: TitleMatch;
  matchIdNum: number;
  wallet: ReturnType<typeof useActiveWallet>["wallet"];
  isPlayer: boolean;
  deadline: number | null;
  submittedCount: number;
  myTitle: string;
  hasSubmitted: boolean;
  submittedThisSession: boolean;
  onSubmit: () => void;
  titleInput: string;
  setTitleInput: (v: string) => void;
  autoResolving: boolean;
}) {
  const MAX_TITLE = 100;
  const { display, expired, timerColor } = useCountdown(deadline);
  const playerCount = match.players.length;

  async function handleSubmit() {
    if (!wallet || !titleInput.trim()) throw new Error("No wallet or empty title");
    await submitTitle(matchIdNum, titleInput.trim(), wallet);
    onSubmit();
  }

  const deadlinePassed = deadline !== null && Date.now() / 1000 > deadline;
  const allSubmitted = submittedCount >= playerCount;

  return (
    <div>
      <ExcerptCard excerpt={match.excerpt} />

      {/* Countdown — 3 states: active, expired-awaiting, resolving */}
      {deadline && (
        <div className="text-5xl font-mono font-bold text-center mb-6 leading-none">
          {autoResolving ? (
            <span
              className="text-2xl animate-resolve-pulse"
              style={{ color: "var(--game-title-wars)" }}
            >
              Resolving…
            </span>
          ) : expired ? (
            <span className="text-xl" style={{ color: "var(--text-tertiary)" }}>
              Awaiting judgement
            </span>
          ) : (
            <span style={{ color: timerColor }}>{display}</span>
          )}
        </div>
      )}

      <p className="text-xs text-center mb-4 font-mono" style={{ color: "var(--text-tertiary)" }}>
        {submittedCount} / {playerCount} players submitted
      </p>

      {/* Title input */}
      {isPlayer && !expired ? (
        hasSubmitted || submittedThisSession ? (
          <div
            className="rounded-lg border p-4 text-sm mb-4"
            style={{ borderColor: "rgba(52,211,153,0.4)", background: "rgba(52,211,153,0.06)" }}
          >
            <p className="text-green-400 font-semibold">✓ Title locked in</p>
            <p
              className="mt-1 text-lg italic"
              style={{ fontFamily: "var(--font-serif)", color: "var(--text-secondary)" }}
            >
              &ldquo;{myTitle}&rdquo;
            </p>
          </div>
        ) : (
          <div className="mb-6">
            <label className="block text-sm mb-1" style={{ color: "var(--text-secondary)" }}>
              Your title ({titleInput.length}/{MAX_TITLE})
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value.slice(0, MAX_TITLE))}
                placeholder="Enter your best title…"
                className="flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-4 py-3 placeholder-gray-500 focus:outline-none"
                style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--text-primary)" }}
                onKeyDown={(e) => { if (e.key === "Enter" && titleInput.trim()) handleSubmit(); }}
              />
              <TxButton
                onClick={handleSubmit}
                disabled={!titleInput.trim()}
                className="rounded-lg px-5 py-3 font-semibold hover:opacity-90 disabled:opacity-50 text-[#0a0a0f] bg-[var(--game-title-wars)]"
                pendingLabel="Submitting…"
                description="Submitting title"
              >
                Submit
              </TxButton>
            </div>
          </div>
        )
      ) : isPlayer && expired ? (
        <div className="rounded-lg border border-red-700 bg-red-900/20 p-4 text-sm mb-4 text-red-400">
          Time&apos;s up — waiting for judging.
        </div>
      ) : null}

      {/* Judge button — hidden while auto-resolving */}
      {(deadlinePassed || allSubmitted) && !autoResolving && (
        <div className="mt-4">
          <TxButton
            onClick={async () => { await judgeTitleMatch(matchIdNum, wallet!); }}
            className="rounded-lg px-5 py-2 text-sm font-semibold hover:opacity-90 text-[#0a0a0f] bg-[var(--game-title-wars)]"
            pendingLabel="AI ranking titles… (may take 1-2 min)"
            description="Judging Title Wars match"
          >
            {allSubmitted ? "All submitted — Judge Match" : "Judge Match"}
          </TxButton>
        </div>
      )}

      {process.env.NODE_ENV === "development" && !deadlinePassed && (
        <div className="mt-8 rounded-lg border border-dashed border-[var(--border)] p-3 text-xs" style={{ color: "var(--text-tertiary)" }}>
          <p className="mb-2 font-mono">DEV: force-judge</p>
          <TxButton
            onClick={async () => { await judgeTitleMatch(matchIdNum, wallet!); }}
            className="rounded px-3 py-1 text-xs hover:opacity-80 bg-[var(--bg-elevated)]"
            pendingLabel="Force judging…"
          >
            Skip deadline → Judge
          </TxButton>
        </div>
      )}
    </div>
  );
}
