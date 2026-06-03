"use client";

import AuthGuard from "@/components/AuthGuard";
import TxButton from "@/components/TxButton";
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
  const currentAddr = wallet?.address?.toLowerCase() ?? null;

  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [nullCount, setNullCount] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [playerUsernames, setPlayerUsernames] = useState<Record<string, string>>({});
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

  // Resolve usernames for all joined players
  useEffect(() => {
    if (!match) return;
    match.players.forEach((addr) => {
      if (!playerUsernames[addr.toLowerCase()]) {
        getUserProfile(addr).then((p) => {
          if (p?.username) {
            setPlayerUsernames((prev) => ({ ...prev, [addr.toLowerCase()]: String(p.username) }));
          }
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.players_json]);

  const state = match ? Number(match.state) : -1;

  const deadlineSet = match ? match.submission_deadline !== DEADLINE_UNSET : false;
  const deadlineUnix = deadlineSet && state === STATE_FULL ? Number(match!.submission_deadline) : null;
  const countdown = useCountdown(deadlineUnix);
  const deadlinePassed = deadlineSet
    ? Date.now() / 1000 > Number(match!.submission_deadline)
    : false;
  // Cancel available 5 min after creation (same window deadline would have been)
  const canCancel = match ? Date.now() / 1000 > Number(match.created_at) + 300 : false;

  // Derived player info
  const playerIdx = match ? match.players.findIndex((p) => p.toLowerCase() === currentAddr) : -1;
  const isPlayer = playerIdx >= 0;
  const isHost = match ? match.players[0]?.toLowerCase() === currentAddr : false;
  const myPrompt = isPlayer ? match!.prompts[playerIdx] : "";
  const iAlreadySubmitted = !!myPrompt;
  const submittedCount = match ? match.prompts.filter((p) => !!p).length : 0;
  const totalPlayers = match ? match.players.length : 0;
  const maxPlayers = match ? Number(match.max_players) : 50;
  const allSubmitted = totalPlayers > 0 && submittedCount === totalPlayers;

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading || (!match && nullCount < 3)) {
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

  const winnerAddr = match.ranking[0]?.toLowerCase();
  const winnerUsername = winnerAddr ? (playerUsernames[winnerAddr] ?? `${winnerAddr.slice(0, 10)}…`) : null;

  return (
    <AuthGuard>
      <main className="min-h-screen p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Match #{matchId}</h1>
            <p className="text-sm text-gray-500">{totalPlayers} / {maxPlayers} players joined</p>
          </div>
          <Link href="/prompt-wars" className="text-indigo-400 hover:underline text-sm">← Lobby</Link>
        </div>

        {/* Target */}
        {state !== STATE_CANCELLED && (
          <div className="mb-6 rounded-xl border border-gray-700 p-5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-500">Target</p>
            <p className="text-lg">{match.target_text}</p>
          </div>
        )}

        {/* Countdown */}
        {countdown.display && (
          <div className="mb-4 flex items-center gap-4">
            <span className={`text-sm font-semibold ${countdown.color}`}>{countdown.display}</span>
            <span className="text-xs text-gray-500">Submitted: {submittedCount} / {totalPlayers}</span>
          </div>
        )}

        {/* DEV Skip — visible once match has started (STATE_FULL) */}
        {process.env.NODE_ENV === "development" && isPlayer && state === STATE_FULL && (
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

        {/* ── STATE_WAITING: Lobby ── */}
        {state === STATE_WAITING && (
          <div className="space-y-5">
            <div className="rounded-xl border border-gray-700 p-5">
              <p className="mb-3 text-sm font-semibold text-gray-400 uppercase tracking-widest">
                Players ({totalPlayers} / {maxPlayers})
              </p>
              <ul className="mb-4 space-y-1">
                {match.players.map((addr, i) => (
                  <li key={addr} className="text-sm text-gray-300">
                    {i + 1}. {playerUsernames[addr.toLowerCase()] ?? addr.slice(0, 10) + "…"}
                    {addr.toLowerCase() === currentAddr ? " (you)" : ""}
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3 mb-3">
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
                  className="rounded-lg bg-green-600 px-6 py-2 font-semibold hover:bg-green-500 disabled:opacity-50"
                >
                  Join Match
                </TxButton>
              )}

              {isHost && totalPlayers >= 2 && (
                <TxButton
                  onClick={() => startMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
                  className="rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500 disabled:opacity-50"
                  pendingLabel="Starting…"
                >
                  Start Match
                </TxButton>
              )}

              {isHost && totalPlayers < 2 && (
                <p className="text-sm text-gray-500">Waiting for a player to join before you can start.</p>
              )}

              {isPlayer && !isHost && (
                <p className="text-sm text-amber-400">Waiting for host to start the match…</p>
              )}
            </div>

            {/* Cancel: only creator, after 5 min */}
            {match.players[0]?.toLowerCase() === currentAddr && canCancel && (
              <TxButton
                onClick={() => cancelMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
                className="rounded-lg bg-red-700 px-6 py-2 font-semibold hover:bg-red-600 disabled:opacity-50"
              >
                Cancel match
              </TxButton>
            )}
          </div>
        )}

        {/* ── STATE_FULL: Submission ── */}
        {state === STATE_FULL && (
          <div className="space-y-5">
            {isPlayer ? (
              iAlreadySubmitted ? (
                <div className="rounded-xl border border-green-800 bg-green-900/20 p-4">
                  <p className="text-green-400 font-semibold">✓ Your prompt is submitted.</p>
                  <p className="mt-1 text-sm text-gray-400">
                    Waiting for {totalPlayers - submittedCount} more player{totalPlayers - submittedCount !== 1 ? "s" : ""}…
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
                  <TxButton
                    onClick={() => submitPrompt(matchIdNum, prompt, wallet).then(() => { fetchMatch(); })}
                    disabled={prompt.length === 0}
                    className="rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500 disabled:opacity-50"
                  >
                    Submit Prompt
                  </TxButton>
                </div>
              )
            ) : (
              <p className="text-gray-400">You are not a player in this match.</p>
            )}

            {/* Judge button when all submitted OR deadline passed */}
            {isPlayer && (allSubmitted || deadlinePassed) && (
              <TxButton
                onClick={() => judgeMatch(matchIdNum, wallet).then(() => { fetchMatch(); })}
                className="rounded-lg bg-yellow-600 px-6 py-3 font-semibold hover:bg-yellow-500 disabled:opacity-50"
                pendingLabel="Judging… (this may take a minute)"
              >
                {allSubmitted ? "Judge Now" : deadlinePassed ? "Finalize & Judge" : "Judge Now"}
              </TxButton>
            )}
          </div>
        )}

        {/* ── STATE_JUDGED: Results ── */}
        {state === STATE_JUDGED && (
          <div className="space-y-6">
            {match.ranking.length === 0 ? (
              <div className="rounded-xl border border-gray-600 bg-gray-800/40 p-5 text-center">
                <p className="text-sm font-semibold uppercase tracking-widest text-gray-400">No Contest</p>
                <p className="mt-1 text-gray-300">{match.judge_reasoning}</p>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-yellow-700 bg-yellow-900/20 p-5 text-center">
                  <p className="text-sm font-semibold uppercase tracking-widest text-yellow-400">Winner</p>
                  <p className="mt-1 text-xl font-bold">{winnerUsername}</p>
                  {winnerAddr === currentAddr && (
                    <p className="mt-1 text-green-400">That&apos;s you! 🎉</p>
                  )}
                </div>

                {match.judge_reasoning && (
                  <div className="rounded-xl border border-gray-700 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">AI Reasoning</p>
                    <p className="text-sm text-gray-300">{match.judge_reasoning}</p>
                  </div>
                )}

                <div className="rounded-xl border border-gray-700 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Leaderboard</p>
                  <div className="space-y-3">
                    {match.ranking.map((addr, rank) => {
                      const addrLow = addr.toLowerCase();
                      const username = playerUsernames[addrLow] ?? addr.slice(0, 10) + "…";
                      const pIdx = match.players.findIndex((p) => p.toLowerCase() === addrLow);
                      const playerPrompt = pIdx >= 0 ? match.prompts[pIdx] : "";
                      const playerOutput = pIdx >= 0 ? match.outputs[pIdx] : "";
                      return (
                        <div key={addr} className={`rounded-lg border p-3 ${rank === 0 ? "border-yellow-700 bg-yellow-900/10" : "border-gray-700"}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-sm font-bold ${rank === 0 ? "text-yellow-400" : "text-gray-400"}`}>
                              #{rank + 1}
                            </span>
                            <span className="text-sm font-semibold">{username}</span>
                            {addrLow === currentAddr && <span className="text-xs text-indigo-400">(you)</span>}
                          </div>
                          {playerPrompt && <p className="text-xs text-gray-400 mb-1">Prompt: {playerPrompt}</p>}
                          {playerOutput && <p className="text-xs text-gray-300">Output: {playerOutput}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <Link
              href="/prompt-wars"
              className="inline-block rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500"
            >
              Back to Lobby
            </Link>
          </div>
        )}

        {/* ── STATE_CANCELLED ── */}
        {state === STATE_CANCELLED && (
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
