"use client";

import AuthGuard from "@/components/AuthGuard";
import TxButton from "@/components/TxButton";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  getMatch,
  joinPromptWarsMatch,
  submitPrompt,
  judgeMatch,
  cancelMatch,
  devForceJudge,
  getUserProfile,
} from "@/lib/genlayer";
import type { Match } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

const ZERO_ADDR = "0x" + "0".repeat(40);
const MAX_PROMPT = 500;
// submission_deadline == BigInt(0) means the match isn't full yet — timer hasn't started.
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

  if (secsLeft === null) return { display: "", expired: false, color: "text-white" };
  if (secsLeft === 0) return { display: "Time's up", expired: true, color: "text-red-400" };

  const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0");
  const ss = String(secsLeft % 60).padStart(2, "0");
  const color =
    secsLeft < 10 ? "text-red-400" : secsLeft < 60 ? "text-amber-400" : "text-white";
  return { display: `${mm}:${ss} remaining`, expired: false, color };
}

export default function MatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const matchIdNum = Number(matchId);
  const { wallet } = useActiveWallet();
  const currentAddr = wallet?.address ?? null;

  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [nullCount, setNullCount] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [winnerUsername, setWinnerUsername] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMatch = useCallback(async () => {
    const m = await getMatch(matchIdNum);
    if (m) {
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
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMatch]);

  useEffect(() => {
    if (match && Number(match.state) === 4 && match.winner?.toLowerCase() !== ZERO_ADDR.toLowerCase()) {
      getUserProfile(match.winner).then((p) => {
        if (p?.username) setWinnerUsername(String(p.username));
      });
    }
  }, [match]);

  const state = match ? Number(match.state) : -1;

  // Only show countdown when the deadline has actually been set (match is full).
  const deadlineSet = match ? match.submission_deadline !== DEADLINE_UNSET : false;
  const deadlineUnix = deadlineSet && state <= 2 ? Number(match!.submission_deadline) : null;
  const countdown = useCountdown(deadlineUnix);
  const deadlinePassed = deadlineSet
    ? Date.now() / 1000 > Number(match!.submission_deadline)
    : false;
  // Cancel is available 5 minutes after creation (same window the deadline would have run).
  const canCancel = match ? Date.now() / 1000 > Number(match.created_at) + 300 : false;

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  if (!match && (loading || nullCount < 3)) {
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
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <p className="text-gray-400">Match not found.</p>
          <Link href="/prompt-wars" className="text-indigo-400 hover:underline">← Lobby</Link>
        </main>
      </AuthGuard>
    );
  }

  const isPlayer1 = currentAddr?.toLowerCase() === match.player1?.toLowerCase();
  const isPlayer2 = currentAddr?.toLowerCase() === match.player2?.toLowerCase();
  const isPlayer = isPlayer1 || isPlayer2;
  const iAlreadySubmitted =
    (isPlayer1 && !!match.player1_prompt) ||
    (isPlayer2 && !!match.player2_prompt);
  const opponentSubmitted =
    (isPlayer1 && !!match.player2_prompt) ||
    (isPlayer2 && !!match.player1_prompt);
  const iAmTheSubmitter =
    (isPlayer1 && !!match.player1_prompt) || (isPlayer2 && !!match.player2_prompt);

  return (
    <AuthGuard>
      <main className="min-h-screen p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Match #{matchId}</h1>
          <Link href="/prompt-wars" className="text-indigo-400 hover:underline text-sm">← Lobby</Link>
        </div>

        {/* Target — shown for all non-cancelled states */}
        {state !== 5 && (
          <div className="mb-6 rounded-xl border border-gray-700 p-5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-500">Target</p>
            <p className="text-lg">{match.target_text}</p>
          </div>
        )}

        {/* Countdown — only shown when the match is full and deadline is real */}
        {countdown.display && (
          <div className="mb-4 flex items-center gap-4">
            <span className={`text-sm font-semibold ${countdown.color}`}>{countdown.display}</span>
          </div>
        )}

        {/* DEV Skip — available once match is full (state ≥ 1) and not yet judged */}
        {process.env.NODE_ENV === "development" && isPlayer && state >= 1 && state < 4 && (
          <div className="mb-4">
            <TxButton
              onClick={() => devForceJudge(matchIdNum, wallet).then(() => { fetchMatch(); })}
              className="rounded border border-orange-700 bg-orange-950 px-2 py-0.5 text-xs text-orange-400 hover:bg-orange-900 disabled:opacity-40"
              pendingLabel="Skipping…"
            >
              DEV: Skip to judging
            </TxButton>
          </div>
        )}

        {/* STATE 0: WAITING_FOR_P2 */}
        {state === 0 && !canCancel && (
          <div className="space-y-4">
            <p className="text-gray-400">Waiting for opponent to join — timer starts when they do.</p>
            <div className="flex items-center gap-3">
              <input
                readOnly
                value={typeof window !== "undefined" ? window.location.href : ""}
                className="flex-1 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-300"
              />
              <button onClick={copyLink} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500">
                {copied ? "Copied!" : "Copy link"}
              </button>
            </div>
            {!isPlayer && (
              <TxButton
                onClick={() => joinPromptWarsMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
                className="rounded-lg bg-green-600 px-6 py-3 font-semibold hover:bg-green-500 disabled:opacity-50"
              >
                Join Match
              </TxButton>
            )}
          </div>
        )}

        {/* STATE 0 + canCancel: no opponent joined, 5 min passed */}
        {state === 0 && canCancel && (
          <div className="space-y-4">
            {isPlayer1 ? (
              <>
                <p className="text-gray-300">No opponent joined. You can cancel this match.</p>
                <TxButton
                  onClick={() => cancelMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
                  className="rounded-lg bg-red-700 px-6 py-3 font-semibold hover:bg-red-600 disabled:opacity-50"
                >
                  Cancel match
                </TxButton>
              </>
            ) : (
              <p className="text-gray-400">Match expired — no opponent joined in time.</p>
            )}
          </div>
        )}

        {/* STATES 1–2: submission phase, deadline NOT passed */}
        {(state === 1 || state === 2) && !deadlinePassed && (
          <div className="space-y-4">
            {isPlayer ? (
              iAlreadySubmitted ? (
                <div>
                  <p className="text-green-400">✓ You submitted your prompt.</p>
                  <p className="mt-2 text-gray-400">
                    {opponentSubmitted ? "Opponent submitted ✓ — both prompts in." : "Opponent: thinking…"}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="block text-sm text-gray-400">
                    Your prompt ({prompt.length}/{MAX_PROMPT})
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    maxLength={MAX_PROMPT}
                    rows={5}
                    placeholder="Write your prompt here…"
                    className="w-full rounded-lg border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500">
                      {opponentSubmitted ? "Opponent submitted ✓" : "Opponent: thinking…"}
                    </p>
                    <TxButton
                      onClick={() => submitPrompt(matchIdNum, prompt, wallet).then(() => { fetchMatch(); })}
                      disabled={prompt.length === 0}
                      className="rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500 disabled:opacity-50"
                    >
                      Submit Prompt
                    </TxButton>
                  </div>
                </div>
              )
            ) : (
              <p className="text-gray-400">You are not a player in this match.</p>
            )}
          </div>
        )}

        {/* STATE 2 + expired: ONE_SUBMITTED forfeit */}
        {state === 2 && deadlinePassed && (
          <div className="space-y-4">
            {isPlayer ? (
              iAmTheSubmitter ? (
                <>
                  <p className="text-amber-400">Opponent didn&apos;t submit before the deadline.</p>
                  <TxButton
                    onClick={() => judgeMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
                    className="rounded-lg bg-amber-600 px-6 py-3 font-semibold hover:bg-amber-500 disabled:opacity-50"
                    pendingLabel="Claiming win… (this may take a minute)"
                  >
                    Claim win by forfeit
                  </TxButton>
                </>
              ) : (
                <p className="text-gray-400">You missed the deadline. Your opponent can claim a forfeit win.</p>
              )
            ) : (
              <p className="text-gray-400">The submission deadline has passed.</p>
            )}
          </div>
        )}

        {/* STATE 1 + expired: BOTH_JOINED, neither submitted — no-contest */}
        {state === 1 && deadlinePassed && (
          <div className="space-y-4">
            <p className="text-gray-400">Match expired — neither player submitted before the deadline.</p>
            {isPlayer && (
              <TxButton
                onClick={() => judgeMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
                className="rounded-lg bg-gray-600 px-6 py-3 font-semibold hover:bg-gray-500 disabled:opacity-50"
                pendingLabel="Marking no-contest…"
              >
                Mark no-contest
              </TxButton>
            )}
          </div>
        )}

        {/* STATE 3: BOTH_SUBMITTED */}
        {state === 3 && (
          <div className="space-y-4">
            <p className="text-gray-400">Both prompts submitted. Ready to judge!</p>
            <TxButton
              onClick={() => judgeMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
              className="rounded-lg bg-yellow-600 px-6 py-3 font-semibold hover:bg-yellow-500 disabled:opacity-50"
              pendingLabel="Judging… (this may take a minute)"
            >
              Judge Now
            </TxButton>
          </div>
        )}

        {/* STATE 4: JUDGED */}
        {state === 4 && (
          <div className="space-y-6">
            {match.winner?.toLowerCase() === ZERO_ADDR.toLowerCase() ? (
              <div className="rounded-xl border border-gray-600 bg-gray-800/40 p-5 text-center">
                <p className="text-sm font-semibold uppercase tracking-widest text-gray-400">No Contest</p>
                <p className="mt-1 text-gray-300">{match.judge_reasoning}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-yellow-700 bg-yellow-900/20 p-5 text-center">
                <p className="text-sm font-semibold uppercase tracking-widest text-yellow-400">Winner</p>
                <p className="mt-1 text-xl font-bold">
                  {winnerUsername ?? (match.winner ? `${match.winner.slice(0, 10)}…` : "Unknown")}
                </p>
                {match.winner?.toLowerCase() === currentAddr?.toLowerCase() && (
                  <p className="mt-1 text-green-400">That&apos;s you!</p>
                )}
              </div>
            )}

            {(match.player1_prompt || match.player2_prompt) && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-700 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">Player 1 prompt</p>
                  <p className="mb-3 text-sm text-gray-300">{match.player1_prompt}</p>
                  {match.player1_output && (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Output</p>
                      <p className="mt-1 text-sm">{match.player1_output}</p>
                    </>
                  )}
                </div>
                <div className="rounded-xl border border-gray-700 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">Player 2 prompt</p>
                  <p className="mb-3 text-sm text-gray-300">{match.player2_prompt}</p>
                  {match.player2_output && (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Output</p>
                      <p className="mt-1 text-sm">{match.player2_output}</p>
                    </>
                  )}
                </div>
              </div>
            )}

            {match.judge_reasoning && match.winner?.toLowerCase() !== ZERO_ADDR.toLowerCase() && (
              <div className="rounded-xl border border-gray-700 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">AI Reasoning</p>
                <p className="text-sm text-gray-300">{match.judge_reasoning}</p>
              </div>
            )}

            <Link
              href="/prompt-wars"
              className="inline-block rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500"
            >
              Back to Lobby
            </Link>
          </div>
        )}

        {/* STATE 5: CANCELLED */}
        {state === 5 && (
          <div className="space-y-4 text-center">
            <p className="text-gray-400">This match was cancelled.</p>
            <Link
              href="/prompt-wars"
              className="inline-block rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500"
            >
              Back to Lobby
            </Link>
          </div>
        )}
      </main>
    </AuthGuard>
  );
}
