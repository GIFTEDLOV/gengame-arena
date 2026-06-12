"use client";

import AuthGuard from "@/components/AuthGuard";
import TxButton from "@/components/TxButton";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  getTriviaMatch,
  joinTriviaMatch,
  startTriviaMatch,
  submitTriviaAnswer,
  resolveTriviaRound,
  cancelTriviaMatch,
  getUserProfile,
  TRIVIA_STATE_WAITING,
  TRIVIA_STATE_GENERATING,
  TRIVIA_STATE_IN_PROGRESS,
  TRIVIA_STATE_RESOLVING,
  TRIVIA_STATE_ENDED,
  TRIVIA_STATE_CANCELLED,
} from "@/lib/genlayer";
import type { TriviaMatch, TriviaQuestion } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

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

  if (secsLeft === null) return { display: "", expired: false, urgent: false, secsLeft: null };
  if (secsLeft === 0) return { display: "Time's up!", expired: true, urgent: true, secsLeft: 0 };

  const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0");
  const ss = String(secsLeft % 60).padStart(2, "0");
  return { display: `${mm}:${ss}`, expired: false, urgent: secsLeft < 15, secsLeft };
}

function optionLetter(opt: string): string {
  const m = opt.match(/^([A-D])[)\.]\s*/i);
  return m ? m[1].toUpperCase() : opt.slice(0, 1).toUpperCase();
}

function optionText(opt: string): string {
  return opt.replace(/^[A-D][)\.]\s*/i, "").trim();
}

function RingsBg({ fast }: { fast?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden flex items-center justify-center" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={`absolute rounded-full ${fast ? "animate-trivia-ring-fast" : "animate-trivia-ring"}`}
          style={{
            width: `${i * 30}vw`,
            height: `${i * 30}vw`,
            border: "1px solid rgba(236,72,153,0.12)",
            animationDelay: `${(i - 1) * 0.65}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function TriviaMatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const matchIdNum = Number(matchId);
  const { wallet } = useActiveWallet();
  const currentAddr = wallet?.address?.toLowerCase() ?? null;

  const [match, setMatch] = useState<TriviaMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [submittedThisRound, setSubmittedThisRound] = useState(false);
  const lastRoundRef = useRef<number>(-1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMatch = useCallback(async () => {
    const m = await getTriviaMatch(matchIdNum);
    if (m) {
      setMatch((prev) => {
        const newRound = Number(m.current_round);
        if (prev && Number(prev.current_round) !== newRound) {
          setSubmittedThisRound(false);
        }
        return m;
      });
    }
    setLoading(false);
    return m;
  }, [matchIdNum]);

  useEffect(() => { fetchMatch(); }, [fetchMatch]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const state = match ? Number(match.state) : -1;
    const ms =
      state === TRIVIA_STATE_IN_PROGRESS || state === TRIVIA_STATE_RESOLVING || state === TRIVIA_STATE_GENERATING
        ? 2000 : 5000;
    intervalRef.current = setInterval(fetchMatch, ms);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchMatch, match?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!match) return;
    const round = Number(match.current_round);
    if (round !== lastRoundRef.current) {
      lastRoundRef.current = round;
      setSubmittedThisRound(false);
    }
  }, [match?.current_round]); // eslint-disable-line react-hooks/exhaustive-deps

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
    return (
      <AuthGuard>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4">
          <p style={{ color: "var(--text-tertiary)" }}>Match not found.</p>
          <Link href="/trivia-royale" className="hover:underline" style={{ color: "var(--game-trivia)" }}>← Back to lobby</Link>
        </main>
      </AuthGuard>
    );
  }

  const state = Number(match.state);
  const isHost = currentAddr === match.host_str.toLowerCase();
  const isPlayer = match.players.some((p) => p.toLowerCase() === currentAddr);
  const isEliminated = match.eliminated.some((p) => p.toLowerCase() === currentAddr);
  const isSurvivor = isPlayer && !isEliminated;
  const playerCount = match.players.length;
  const maxPlayers = Number(match.max_players);
  const currentRound = Number(match.current_round);
  const question: TriviaQuestion | null =
    match.questions.length > 0 && currentRound < match.questions.length
      ? match.questions[currentRound]
      : null;
  const deadline = match.answer_deadline && Number(match.answer_deadline) > 0
    ? Number(match.answer_deadline) : null;
  const answeredCount = Object.keys(match.round_answers).length;
  const survivorCount = playerCount - match.eliminated.length;
  const accent = "var(--game-trivia)";

  // ── CANCELLED ──
  if (state === TRIVIA_STATE_CANCELLED) {
    return (
      <AuthGuard>
        <main className="min-h-screen p-8 max-w-2xl mx-auto">
          <Link href="/trivia-royale" className="hover:underline text-sm" style={{ color: accent }}>← Back to lobby</Link>
          <div className="mt-8 rounded-xl border border-red-700 bg-red-900/20 p-6">
            <h1 className="text-2xl font-bold mb-2">Match Cancelled</h1>
            {match.rejection_reason && <p className="text-gray-300 text-sm">{match.rejection_reason}</p>}
            <Link href="/trivia-royale" className="mt-4 inline-block rounded-lg px-5 py-2 text-sm font-semibold hover:opacity-90 text-white" style={{ background: accent }}>
              Create a new match
            </Link>
          </div>
        </main>
      </AuthGuard>
    );
  }

  // ── ENDED ──
  if (state === TRIVIA_STATE_ENDED) {
    const winner = match.winner_str;
    const iWon = winner.toLowerCase() === currentAddr;
    const elimOrder = [...match.eliminated].reverse();

    return (
      <AuthGuard>
        <div className="relative min-h-screen overflow-hidden">
          <RingsBg />
          <main className="relative min-h-screen p-8 max-w-2xl mx-auto">
            <Link href="/trivia-royale" className="hover:underline text-sm" style={{ color: accent }}>← Back to lobby</Link>

            <div
              className="mt-6 rounded-xl border p-6 text-center"
              style={{
                borderColor: "rgba(236,72,153,0.4)",
                background: "rgba(236,72,153,0.06)",
              }}
            >
              <p className="text-5xl mb-3">🏆</p>
              <h1
                className="text-3xl font-bold mb-1"
                style={{ color: iWon ? accent : "var(--text-primary)" }}
              >
                {iWon ? "You survived!" : `Survivor: ${displayName(winner)}`}
              </h1>
              {iWon && <p className="text-sm" style={{ color: accent }}>Last player standing — congratulations!</p>}
              <p className="text-gray-400 mt-2 text-sm">Topic: {match.topic}</p>
            </div>

            <div className="mt-6 rounded-xl border border-[var(--border)] p-4">
              <h2 className="text-lg font-semibold mb-3">Elimination Order</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]" style={{ color: "var(--text-tertiary)" }}>
                    <th className="pb-2 text-left text-xs uppercase tracking-widest">Rank</th>
                    <th className="pb-2 text-left text-xs uppercase tracking-widest">Player</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[var(--border)]">
                    <td className="py-2 font-semibold" style={{ color: accent }}>1st 🏆</td>
                    <td className="py-2">{displayName(winner)}{iWon ? " (you)" : ""}</td>
                  </tr>
                  {elimOrder.map((addr, i) => {
                    const rank = i + 2;
                    const isMe = addr.toLowerCase() === currentAddr;
                    const suffix = rank === 2 ? "nd" : rank === 3 ? "rd" : "th";
                    return (
                      <tr key={addr} className="border-b border-[var(--border)]">
                        <td className="py-2 text-gray-400">{rank}{suffix}</td>
                        <td className="py-2" style={{ color: isMe ? accent : "var(--text-primary)" }}>
                          {displayName(addr)}{isMe ? " (you)" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Link
              href="/trivia-royale"
              className="mt-6 inline-block rounded-lg px-5 py-2 text-sm font-semibold hover:opacity-90 text-white"
              style={{ background: accent }}
            >
              Back to lobby
            </Link>
          </main>
        </div>
      </AuthGuard>
    );
  }

  // ── GENERATING ──
  if (state === TRIVIA_STATE_GENERATING) {
    const isMidGame = match.questions.length > 0;
    return (
      <AuthGuard>
        <div className="relative min-h-screen overflow-hidden">
          <RingsBg />
          <main className="relative flex min-h-screen flex-col items-center justify-center gap-4 p-8">
            <div
              className="h-14 w-14 rounded-full border-t-2 animate-spin"
              style={{ borderColor: accent }}
            />
            <h2 className="text-xl font-bold" style={{ color: accent }}>
              {isMidGame ? "Generating more questions…" : "Generating trivia questions…"}
            </h2>
            <p className="text-sm text-center max-w-sm" style={{ color: "var(--text-secondary)" }}>
              {isMidGame
                ? `Fresh batch for "${match.topic}" — ${survivorCount} player${survivorCount !== 1 ? "s" : ""} still in.`
                : `Validators are agreeing on the question pool for "${match.topic}". This may take 30–60 seconds.`}
            </p>
          </main>
        </div>
      </AuthGuard>
    );
  }

  // ── RESOLVING ──
  if (state === TRIVIA_STATE_RESOLVING) {
    return (
      <AuthGuard>
        <div className="relative min-h-screen overflow-hidden">
          <RingsBg />
          <main className="relative flex min-h-screen flex-col items-center justify-center gap-4 p-8">
            <div className="h-14 w-14 rounded-full border-t-2 animate-spin" style={{ borderColor: "var(--warning)" }} />
            <h2 className="text-xl font-bold">Resolving round {currentRound + 1}…</h2>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Validators checking open-ended answers</p>
          </main>
        </div>
      </AuthGuard>
    );
  }

  // ── IN PROGRESS ──
  if (state === TRIVIA_STATE_IN_PROGRESS) {
    const isUrgent = !!(deadline && (deadline - Math.floor(Date.now() / 1000)) < 15);
    return (
      <AuthGuard>
        <div className="relative min-h-screen overflow-hidden">
          <RingsBg fast={isUrgent} />
          <main className="relative min-h-screen p-4 sm:p-6 max-w-2xl mx-auto">
            {/* Top bar */}
            <div className="flex items-center justify-between mb-4 py-2">
              <div>
                <span className="text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>
                  Round {currentRound + 1} / {match.questions.length}
                </span>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{match.topic}</p>
              </div>
              {/* Lives dots */}
              <div className="flex gap-1 flex-wrap justify-end max-w-xs items-center">
                {match.players.map((addr) => {
                  const isMe = addr.toLowerCase() === currentAddr;
                  const alive = !match.eliminated.some((e) => e.toLowerCase() === addr.toLowerCase());
                  return (
                    <div
                      key={addr}
                      className={`rounded-full ${isMe ? "ring-2 ring-offset-1 ring-[var(--game-trivia)]" : ""}`}
                      style={{
                        width: 10,
                        height: 10,
                        background: alive ? accent : "var(--text-disabled)",
                        outlineOffset: isMe ? "1px" : undefined,
                      } as React.CSSProperties}
                      title={displayName(addr)}
                    />
                  );
                })}
                <span className="text-xs ml-1 font-mono" style={{ color: "var(--text-tertiary)" }}>
                  {survivorCount} alive
                </span>
              </div>
            </div>

            {isEliminated && (
              <div
                className="mb-4 rounded-lg border p-3 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--text-tertiary)" }}
              >
                You were eliminated — watching as a spectator.
              </div>
            )}

            {question ? (
              <ActiveQuestion
                question={question}
                deadline={deadline}
                matchId={matchIdNum}
                wallet={wallet}
                isSurvivor={isSurvivor}
                submittedThisRound={submittedThisRound}
                onSubmit={() => setSubmittedThisRound(true)}
                answeredCount={answeredCount}
                survivorCount={survivorCount}
                roundAnswers={match.round_answers}
                currentAddr={currentAddr}
                accent={accent}
              />
            ) : (
              <p style={{ color: "var(--text-tertiary)" }}>Waiting for question…</p>
            )}

            {deadline && Date.now() / 1000 > deadline && (
              <div className="mt-6">
                <TxButton
                  onClick={async () => { await resolveTriviaRound(matchIdNum, wallet!); }}
                  className="rounded-lg px-5 py-2 text-sm font-semibold hover:opacity-90 bg-[var(--warning)] text-[#0a0a0f]"
                  pendingLabel="Resolving round…"
                  description="Resolving Trivia round"
                >
                  Resolve Round
                </TxButton>
              </div>
            )}

            {answeredCount >= survivorCount && survivorCount > 0 && !(deadline && Date.now() / 1000 > deadline) && (
              <div className="mt-4">
                <TxButton
                  onClick={async () => { await resolveTriviaRound(matchIdNum, wallet!); }}
                  className="rounded-lg px-5 py-2 text-sm font-semibold hover:opacity-90 text-white bg-[var(--success)]"
                  pendingLabel="Resolving round…"
                  description="Resolving Trivia round"
                >
                  All answered — Resolve Round
                </TxButton>
              </div>
            )}
          </main>
        </div>
      </AuthGuard>
    );
  }

  // ── WAITING (lobby) ──
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/trivia-royale/${matchIdNum}` : "";

  return (
    <AuthGuard>
      <div className="relative min-h-screen overflow-hidden">
        <RingsBg />
        <main className="relative min-h-screen p-8 max-w-2xl mx-auto">
          <div className="mb-6">
            <Link href="/trivia-royale" className="hover:underline text-sm" style={{ color: accent }}>← Lobby</Link>
          </div>

          <div
            className="rounded-xl border p-6 mb-6"
            style={{ borderColor: "rgba(236,72,153,0.25)", background: "rgba(236,72,153,0.04)" }}
          >
            <h1 className="text-2xl font-bold mb-1" style={{ color: accent }}>
              {match.topic}
            </h1>
            <p className="text-sm mb-4 font-mono" style={{ color: "var(--text-secondary)" }}>
              {playerCount} / {maxPlayers} players joined
            </p>

            <div className="mb-4">
              <p className="text-xs uppercase tracking-widest mb-2 font-mono" style={{ color: "var(--text-tertiary)" }}>
                Players
              </p>
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
                  onClick={async () => { await startTriviaMatch(matchIdNum, wallet!); }}
                  disabled={playerCount < 2}
                  className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 disabled:opacity-50 text-white bg-[var(--game-trivia)]"
                  pendingLabel="Starting match (AI generating questions…)"
                  description="Starting Trivia Royale match"
                >
                  Start Match
                </TxButton>
                {playerCount < 2 && (
                  <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Need at least 2 players to start</p>
                )}
                <div className="pt-2">
                  <TxButton
                    onClick={async () => { await cancelTriviaMatch(matchIdNum, wallet!); }}
                    className="rounded-lg border border-red-700 px-4 py-1.5 text-sm text-red-400 hover:bg-red-900/20"
                    pendingLabel="Cancelling…"
                    description="Cancelling Trivia match"
                  >
                    Cancel match
                  </TxButton>
                </div>
              </div>
            ) : isPlayer ? (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Waiting for host to start the match…</p>
            ) : playerCount < maxPlayers ? (
              <TxButton
                onClick={async () => { await joinTriviaMatch(matchIdNum, wallet!); }}
                className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 text-white bg-[var(--game-trivia)]"
                pendingLabel="Joining…"
                description="Joining Trivia Royale match"
              >
                Join Match
              </TxButton>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Match is full.</p>
            )}
          </div>

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

// ── ActiveQuestion sub-component ──

function ActiveQuestion({
  question,
  deadline,
  matchId,
  wallet,
  isSurvivor,
  submittedThisRound,
  onSubmit,
  answeredCount,
  survivorCount,
  roundAnswers,
  currentAddr,
  accent,
}: {
  question: TriviaQuestion;
  deadline: number | null;
  matchId: number;
  wallet: ReturnType<typeof useActiveWallet>["wallet"];
  isSurvivor: boolean;
  submittedThisRound: boolean;
  onSubmit: () => void;
  answeredCount: number;
  survivorCount: number;
  roundAnswers: Record<string, string>;
  currentAddr: string | null;
  accent: string;
}) {
  const { display, expired, urgent } = useCountdown(deadline);
  const [openAnswer, setOpenAnswer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (question.type === "open" && inputRef.current) inputRef.current.focus();
  }, [question]);

  const myAnswer = currentAddr ? roundAnswers[currentAddr.toLowerCase()] : undefined;
  const hasMyAnswer = !!myAnswer;

  async function submitMC(letter: string) {
    if (!wallet) throw new Error("No wallet");
    await submitTriviaAnswer(matchId, letter, wallet);
    onSubmit();
  }

  async function submitOpen() {
    if (!wallet || !openAnswer.trim()) throw new Error("No wallet or empty answer");
    await submitTriviaAnswer(matchId, openAnswer.trim(), wallet);
    onSubmit();
  }

  const timerColor = urgent ? "var(--danger)" : urgent === false && display.includes(":") && parseInt(display.split(":")[0]) === 0 && parseInt(display.split(":")[1]) < 30 ? "var(--warning)" : "var(--game-predictions)";

  return (
    <div>
      {/* Countdown — large and prominent */}
      {deadline && (
        <div
          className="text-6xl font-mono font-bold text-center mb-6 leading-none"
          style={{ color: timerColor }}
        >
          {display}
        </div>
      )}

      {/* Question card */}
      <div
        className="rounded-xl border p-6 mb-6 animate-trivia-question"
        style={{
          borderColor: `color-mix(in srgb, ${accent} 25%, var(--border))`,
          background: `color-mix(in srgb, ${accent} 4%, var(--bg-elevated))`,
        }}
      >
        <p
          className="text-xs uppercase tracking-widest mb-3 font-mono"
          style={{ color: accent }}
        >
          {question.type === "mc" ? "Multiple Choice" : "Open Ended"}
        </p>
        <p
          className="text-2xl font-bold leading-snug"
          style={{ color: "var(--text-primary)" }}
        >
          {question.text}
        </p>
      </div>

      {/* Answer area */}
      {isSurvivor && !expired ? (
        hasMyAnswer || submittedThisRound ? (
          <div
            className="rounded-lg border p-4 text-sm"
            style={{ borderColor: "rgba(52,211,153,0.4)", background: "rgba(52,211,153,0.06)" }}
          >
            <p className="text-green-400 font-semibold">✓ Answer locked in</p>
            <p className="mt-1 font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
              Waiting for others… ({answeredCount} / {survivorCount} answered)
            </p>
          </div>
        ) : question.type === "mc" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {question.options.map((opt) => {
              const letter = optionLetter(opt);
              const text = optionText(opt);
              return (
                <TxButton
                  key={letter}
                  onClick={() => submitMC(letter)}
                  className="rounded-xl border p-4 text-left transition-all hover:border-[var(--game-trivia)] hover:bg-[rgba(236,72,153,0.08)] w-full"
                  pendingLabel="Locking in…"
                  description="Submitting trivia answer"
                >
                  <span className="font-bold mr-2 text-sm" style={{ color: accent }}>{letter})</span>
                  <span className="text-sm">{text}</span>
                </TxButton>
              );
            })}
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={openAnswer}
              onChange={(e) => setOpenAnswer(e.target.value)}
              placeholder="Type your answer…"
              className="flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-4 py-3 text-white placeholder-gray-500 focus:outline-none"
              onKeyDown={(e) => { if (e.key === "Enter" && openAnswer.trim()) submitOpen(); }}
            />
            <TxButton
              onClick={submitOpen}
              disabled={!openAnswer.trim()}
              className="rounded-lg px-5 py-3 font-semibold hover:opacity-90 disabled:opacity-50 text-white bg-[var(--game-trivia)]"
              pendingLabel="Submitting…"
              description="Submitting trivia answer"
            >
              Submit
            </TxButton>
          </div>
        )
      ) : isSurvivor && expired ? (
        <div className="rounded-lg border border-red-700 bg-red-900/20 p-4 text-sm text-red-400">
          Time&apos;s up! Waiting for round resolution…
        </div>
      ) : (
        <div
          className="rounded-lg border p-4 text-sm font-mono"
          style={{ borderColor: "var(--border)", color: "var(--text-tertiary)" }}
        >
          {answeredCount} / {survivorCount} players answered
        </div>
      )}
    </div>
  );
}
