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

  if (secsLeft === null) return { display: "", expired: false, color: "text-white" };
  if (secsLeft === 0) return { display: "Time's up!", expired: true, color: "text-red-400" };

  const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0");
  const ss = String(secsLeft % 60).padStart(2, "0");
  const color =
    secsLeft < 10 ? "text-red-400" : secsLeft < 30 ? "text-amber-400" : "text-white";
  return { display: `${mm}:${ss}`, expired: false, color };
}

function optionLetter(opt: string): string {
  const m = opt.match(/^([A-D])[)\.]\s*/i);
  return m ? m[1].toUpperCase() : opt.slice(0, 1).toUpperCase();
}

function optionText(opt: string): string {
  return opt.replace(/^[A-D][)\.]\s*/i, "").trim();
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
  const [openAnswer, setOpenAnswer] = useState("");
  const [submittedThisRound, setSubmittedThisRound] = useState(false);
  const lastRoundRef = useRef<number>(-1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMatch = useCallback(async () => {
    const m = await getTriviaMatch(matchIdNum);
    if (m) {
      setMatch((prev) => {
        // Reset submission tracking when round advances
        const newRound = Number(m.current_round);
        if (prev && Number(prev.current_round) !== newRound) {
          setSubmittedThisRound(false);
          setOpenAnswer("");
        }
        return m;
      });
    }
    setLoading(false);
    return m;
  }, [matchIdNum]);

  useEffect(() => {
    fetchMatch();
  }, [fetchMatch]);

  // Adaptive polling: 2s during active play, 5s in lobby
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const state = match ? Number(match.state) : -1;
    const ms =
      state === TRIVIA_STATE_IN_PROGRESS || state === TRIVIA_STATE_RESOLVING || state === TRIVIA_STATE_GENERATING
        ? 2000
        : 5000;
    intervalRef.current = setInterval(fetchMatch, ms);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMatch, match?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track round changes to reset submission state
  useEffect(() => {
    if (!match) return;
    const round = Number(match.current_round);
    if (round !== lastRoundRef.current) {
      lastRoundRef.current = round;
      setSubmittedThisRound(false);
      setOpenAnswer("");
    }
  }, [match?.current_round]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve player usernames
  useEffect(() => {
    if (!match) return;
    [...match.players].forEach((addr) => {
      const key = addr.toLowerCase();
      if (!playerNames[key]) {
        getUserProfile(addr).then((p) => {
          if (p?.username) {
            setPlayerNames((prev) => ({ ...prev, [key]: String(p.username) }));
          }
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
          <p className="text-gray-400">Loading match…</p>
        </main>
      </AuthGuard>
    );
  }

  if (!match) {
    return (
      <AuthGuard>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4">
          <p className="text-gray-400">Match not found.</p>
          <Link href="/trivia-royale" className="text-indigo-400 hover:underline">← Back to lobby</Link>
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
    ? Number(match.answer_deadline)
    : null;
  const answeredCount = Object.keys(match.round_answers).length;
  const survivorCount = playerCount - match.eliminated.length;

  // ── CANCELLED ──────────────────────────────────────────────────────────────
  if (state === TRIVIA_STATE_CANCELLED) {
    return (
      <AuthGuard>
        <main className="min-h-screen p-8 max-w-2xl mx-auto">
          <Link href="/trivia-royale" className="text-indigo-400 hover:underline text-sm">← Back to lobby</Link>
          <div className="mt-8 rounded-xl border border-red-700 bg-red-900/20 p-6">
            <h1 className="text-2xl font-bold mb-2">Match Cancelled</h1>
            {match.rejection_reason && (
              <p className="text-gray-300 text-sm">{match.rejection_reason}</p>
            )}
            <Link
              href="/trivia-royale"
              className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold hover:bg-indigo-500"
            >
              Create a new match
            </Link>
          </div>
        </main>
      </AuthGuard>
    );
  }

  // ── ENDED ──────────────────────────────────────────────────────────────────
  if (state === TRIVIA_STATE_ENDED) {
    const winner = match.winner_str;
    const iWon = winner.toLowerCase() === currentAddr;
    const elimOrder = [...match.eliminated].reverse();

    return (
      <AuthGuard>
        <main className="min-h-screen p-8 max-w-2xl mx-auto">
          <Link href="/trivia-royale" className="text-indigo-400 hover:underline text-sm">← Back to lobby</Link>

          <div className="mt-6 rounded-xl border border-yellow-500 bg-yellow-900/20 p-6 text-center">
            <p className="text-4xl mb-2">🏆</p>
            <h1 className="text-3xl font-bold mb-1">
              {iWon ? "You won!" : `Winner: ${displayName(winner)}`}
            </h1>
            {iWon && (
              <p className="text-yellow-300 text-sm">That's you — congratulations!</p>
            )}
            <p className="text-gray-400 mt-2 text-sm">Topic: {match.topic}</p>
          </div>

          <div className="mt-6 rounded-xl border border-gray-700 p-4">
            <h2 className="text-lg font-semibold mb-3">Elimination Order</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left border-b border-gray-700">
                  <th className="pb-2">Rank</th>
                  <th className="pb-2">Player</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-800">
                  <td className="py-2 text-yellow-400 font-semibold">1st 🏆</td>
                  <td className="py-2">{displayName(winner)}{iWon ? " (you)" : ""}</td>
                </tr>
                {elimOrder.map((addr, i) => {
                  const rank = i + 2;
                  const isMe = addr.toLowerCase() === currentAddr;
                  return (
                    <tr key={addr} className="border-b border-gray-800">
                      <td className="py-2 text-gray-400">{rank}{rank === 2 ? "nd" : rank === 3 ? "rd" : "th"}</td>
                      <td className={`py-2 ${isMe ? "text-indigo-300" : ""}`}>
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
            className="mt-6 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold hover:bg-indigo-500"
          >
            Back to lobby
          </Link>
        </main>
      </AuthGuard>
    );
  }

  // ── GENERATING ─────────────────────────────────────────────────────────────
  if (state === TRIVIA_STATE_GENERATING) {
    const isMidGame = match.questions.length > 0;
    const activeSurvivors = survivorCount;
    return (
      <AuthGuard>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-indigo-500" />
          <h2 className="text-xl font-semibold">
            {isMidGame
              ? `Generating more questions… (${activeSurvivors} player${activeSurvivors !== 1 ? "s" : ""} still standing)`
              : "Generating trivia questions…"}
          </h2>
          <p className="text-gray-400 text-sm text-center max-w-sm">
            {isMidGame
              ? `The question pool is exhausted. Generating a fresh batch for "${match.topic}".`
              : `Validators are agreeing on the question pool for "${match.topic}". This may take 30–60 seconds.`}
          </p>
        </main>
      </AuthGuard>
    );
  }

  // ── RESOLVING ──────────────────────────────────────────────────────────────
  if (state === TRIVIA_STATE_RESOLVING) {
    return (
      <AuthGuard>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-amber-500" />
          <h2 className="text-xl font-semibold">Resolving round {currentRound + 1}…</h2>
          <p className="text-gray-400 text-sm">Validators checking open-ended answers</p>
        </main>
      </AuthGuard>
    );
  }

  // ── IN PROGRESS ────────────────────────────────────────────────────────────
  if (state === TRIVIA_STATE_IN_PROGRESS) {
    return (
      <AuthGuard>
        <main className="min-h-screen p-8 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-xs text-gray-400 uppercase tracking-wide">
                Round {currentRound + 1} / {match.questions.length}
              </span>
              <p className="text-sm text-gray-400 mt-0.5">Topic: {match.topic}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-400">
                {survivorCount} player{survivorCount !== 1 ? "s" : ""} remaining
              </span>
            </div>
          </div>

          {isEliminated && (
            <div className="mb-4 rounded-lg border border-gray-600 bg-gray-800/50 p-3 text-sm text-gray-400">
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
            />
          ) : (
            <p className="text-gray-400">Waiting for question…</p>
          )}

          {/* Anyone can trigger resolve (deadline-based) */}
          {(deadline && Date.now() / 1000 > deadline) && (
            <div className="mt-6">
              <TxButton
                onClick={async () => { await resolveTriviaRound(matchIdNum, wallet!); }}
                className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold hover:bg-amber-500"
                pendingLabel="Resolving round…"
                description="Resolving Trivia round"
              >
                Resolve Round
              </TxButton>
            </div>
          )}

          {answeredCount >= survivorCount && survivorCount > 0 && (
            <div className="mt-4">
              <TxButton
                onClick={async () => { await resolveTriviaRound(matchIdNum, wallet!); }}
                className="rounded-lg bg-green-700 px-5 py-2 text-sm font-semibold hover:bg-green-600"
                pendingLabel="Resolving round…"
                description="Resolving Trivia round"
              >
                All answered — Resolve Round
              </TxButton>
            </div>
          )}
        </main>
      </AuthGuard>
    );
  }

  // ── WAITING (lobby) ────────────────────────────────────────────────────────
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/trivia-royale/${matchIdNum}`
      : "";

  return (
    <AuthGuard>
      <main className="min-h-screen p-8 max-w-2xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/trivia-royale" className="text-indigo-400 hover:underline text-sm">← Lobby</Link>
        </div>

        <div className="rounded-xl border border-gray-700 p-6 mb-6">
          <h1 className="text-2xl font-bold mb-1">{match.topic}</h1>
          <p className="text-sm text-gray-400 mb-4">
            {playerCount} / {maxPlayers} players joined
          </p>

          {/* Players list */}
          <div className="mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Players</p>
            <ul className="space-y-1">
              {match.players.map((addr) => {
                const isMe = addr.toLowerCase() === currentAddr;
                const isH = addr.toLowerCase() === match.host_str.toLowerCase();
                return (
                  <li key={addr} className="flex items-center gap-2 text-sm">
                    <span className={isMe ? "text-indigo-300" : "text-gray-300"}>
                      {displayName(addr)}
                    </span>
                    {isH && (
                      <span className="text-xs text-amber-400 border border-amber-700 rounded px-1">
                        host
                      </span>
                    )}
                    {isMe && !isH && (
                      <span className="text-xs text-gray-500">(you)</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Actions */}
          {isHost ? (
            <div className="space-y-2">
              <TxButton
                onClick={async () => { await startTriviaMatch(matchIdNum, wallet!); }}
                disabled={playerCount < 2}
                className="rounded-lg bg-green-600 px-6 py-2 font-semibold hover:bg-green-500 disabled:opacity-50"
                pendingLabel="Starting match (AI generating questions…)"
                description="Starting Trivia Royale match"
              >
                Start Match
              </TxButton>
              {playerCount < 2 && (
                <p className="text-xs text-gray-500">Need at least 2 players to start</p>
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
            <p className="text-gray-400 text-sm">Waiting for host to start the match…</p>
          ) : playerCount < maxPlayers ? (
            <TxButton
              onClick={async () => { await joinTriviaMatch(matchIdNum, wallet!); }}
              className="rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500"
              pendingLabel="Joining…"
              description="Joining Trivia Royale match"
            >
              Join Match
            </TxButton>
          ) : (
            <p className="text-gray-400 text-sm">Match is full.</p>
          )}
        </div>

        {/* Share link */}
        <div className="rounded-xl border border-gray-700 p-4">
          <p className="text-xs text-gray-500 mb-2">Share this match</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-gray-900 rounded px-3 py-2 text-gray-300 truncate">
              {shareUrl}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(shareUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="text-xs text-indigo-400 hover:underline shrink-0"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </main>
    </AuthGuard>
  );
}

// ── ActiveQuestion sub-component ───────────────────────────────────────────

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
}) {
  const { display, expired, color } = useCountdown(deadline);
  const [openAnswer, setOpenAnswer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (question.type === "open" && inputRef.current) {
      inputRef.current.focus();
    }
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

  return (
    <div>
      {/* Countdown */}
      {deadline && (
        <div className={`text-5xl font-mono font-bold text-center mb-6 ${color}`}>
          {display}
        </div>
      )}

      {/* Question */}
      <div className="rounded-xl border border-gray-600 p-6 mb-6">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          {question.type === "mc" ? "Multiple Choice" : "Open Ended"}
        </p>
        <p className="text-xl font-semibold leading-snug">{question.text}</p>
      </div>

      {/* Answer area */}
      {isSurvivor && !expired ? (
        hasMyAnswer || submittedThisRound ? (
          <div className="rounded-lg border border-green-700 bg-green-900/20 p-4 text-sm">
            <p className="text-green-400 font-semibold">Answer locked in</p>
            <p className="text-gray-400 mt-1">
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
                  className="rounded-xl border border-gray-600 p-4 text-left hover:border-indigo-500 hover:bg-indigo-900/20 transition-colors"
                  pendingLabel="Locking in…"
                  description="Submitting trivia answer"
                >
                  <span className="font-bold text-indigo-400 mr-2">{letter})</span>
                  {text}
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
              className="flex-1 rounded-lg border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && openAnswer.trim()) {
                  submitOpen();
                }
              }}
            />
            <TxButton
              onClick={submitOpen}
              disabled={!openAnswer.trim()}
              className="rounded-lg bg-indigo-600 px-5 py-3 font-semibold hover:bg-indigo-500 disabled:opacity-50"
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
        <div className="rounded-lg border border-gray-700 p-4 text-sm text-gray-400">
          {answeredCount} / {survivorCount} players answered
        </div>
      )}
    </div>
  );
}
