"use client";

import AuthGuard from "@/components/AuthGuard";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  getMatch,
  joinPromptWarsMatch,
  submitPrompt,
  judgeMatch,
  getUserProfile,
} from "@/lib/genlayer";
import type { Match } from "@/lib/genlayer";
import { getOrCreateGuestWallet } from "@/lib/guest";
import { usePrivy } from "@privy-io/react-auth";

const ZERO_ADDR = "0x" + "0".repeat(40);
const MAX_PROMPT = 500;

function getPrivateKey(): `0x${string}` | undefined {
  if (typeof window === "undefined") return undefined;
  return (localStorage.getItem("gengame_guest_key") as `0x${string}`) ?? undefined;
}

function useCurrentAddress(): string | null {
  const { user } = usePrivy();
  const [addr, setAddr] = useState<string | null>(null);

  useEffect(() => {
    if (user?.wallet?.address) {
      setAddr(user.wallet.address);
      return;
    }
    const pk = getPrivateKey();
    if (pk) {
      import("viem/accounts").then(({ privateKeyToAccount }) => {
        setAddr(privateKeyToAccount(pk).address);
      });
    }
  }, [user]);

  return addr;
}

export default function MatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const matchIdNum = Number(matchId);
  const currentAddr = useCurrentAddress();

  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [txPending, setTxPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [winnerUsername, setWinnerUsername] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMatch = useCallback(async () => {
    const m = await getMatch(matchIdNum);
    setMatch(m);
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

  async function doJoin() {
    const pk = getPrivateKey();
    if (!pk) { setError("No wallet found."); return; }
    setTxPending(true); setError("");
    try {
      await joinPromptWarsMatch(matchIdNum, pk);
      await fetchMatch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTxPending(false);
    }
  }

  async function doSubmitPrompt() {
    const pk = getPrivateKey();
    if (!pk) { setError("No wallet found."); return; }
    if (prompt.length > MAX_PROMPT) { setError("Prompt too long."); return; }
    setTxPending(true); setError("");
    try {
      await submitPrompt(matchIdNum, prompt, pk);
      await fetchMatch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTxPending(false);
    }
  }

  async function doJudge() {
    const pk = getPrivateKey();
    if (!pk) { setError("No wallet found."); return; }
    setTxPending(true); setError("");
    try {
      await judgeMatch(matchIdNum, pk);
      await fetchMatch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTxPending(false);
    }
  }

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

  const state = Number(match.state);
  const isPlayer1 = currentAddr?.toLowerCase() === match.player1?.toLowerCase();
  const isPlayer2 = currentAddr?.toLowerCase() === match.player2?.toLowerCase();
  const isPlayer = isPlayer1 || isPlayer2;
  const iAlreadySubmitted =
    (isPlayer1 && match.player1_prompt !== "") ||
    (isPlayer2 && match.player2_prompt !== "");
  const opponentSubmitted =
    (isPlayer1 && match.player2_prompt !== "") ||
    (isPlayer2 && match.player1_prompt !== "");

  return (
    <AuthGuard>
      <main className="min-h-screen p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Match #{matchId}</h1>
          <Link href="/prompt-wars" className="text-indigo-400 hover:underline text-sm">← Lobby</Link>
        </div>

        <div className="mb-6 rounded-xl border border-gray-700 p-5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-500">Target</p>
          <p className="text-lg">{match.target_text}</p>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {/* STATE 0: WAITING_FOR_P2 */}
        {state === 0 && (
          <div className="space-y-4">
            <p className="text-gray-400">Waiting for a second player to join.</p>
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
              <button
                onClick={doJoin}
                disabled={txPending}
                className="rounded-lg bg-green-600 px-6 py-3 font-semibold hover:bg-green-500 disabled:opacity-50"
              >
                {txPending ? "Joining…" : "Join Match"}
              </button>
            )}
          </div>
        )}

        {/* STATES 1–2: submission phase */}
        {(state === 1 || state === 2) && (
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
                    <button
                      onClick={doSubmitPrompt}
                      disabled={txPending || prompt.length === 0}
                      className="rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {txPending ? "Submitting…" : "Submit Prompt"}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <p className="text-gray-400">You are not a player in this match.</p>
            )}
          </div>
        )}

        {/* STATE 3: BOTH_SUBMITTED */}
        {state === 3 && (
          <div className="space-y-4">
            <p className="text-gray-400">Both prompts submitted. Ready to judge!</p>
            <button
              onClick={doJudge}
              disabled={txPending}
              className="rounded-lg bg-yellow-600 px-6 py-3 font-semibold hover:bg-yellow-500 disabled:opacity-50"
            >
              {txPending ? "Judging… (this may take a minute)" : "Judge Now"}
            </button>
          </div>
        )}

        {/* STATE 4: JUDGED */}
        {state === 4 && (
          <div className="space-y-6">
            <div className="rounded-xl border border-yellow-700 bg-yellow-900/20 p-5 text-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-yellow-400">Winner</p>
              <p className="mt-1 text-xl font-bold">
                {winnerUsername ?? match.winner?.slice(0, 10) + "…"}
              </p>
              {match.winner?.toLowerCase() === currentAddr?.toLowerCase() && (
                <p className="mt-1 text-green-400">🎉 That's you!</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-700 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
                  Player 1 prompt
                </p>
                <p className="mb-3 text-sm text-gray-300">{match.player1_prompt}</p>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Output</p>
                <p className="mt-1 text-sm">{match.player1_output}</p>
              </div>
              <div className="rounded-xl border border-gray-700 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
                  Player 2 prompt
                </p>
                <p className="mb-3 text-sm text-gray-300">{match.player2_prompt}</p>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Output</p>
                <p className="mt-1 text-sm">{match.player2_output}</p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-700 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
                AI Reasoning
              </p>
              <p className="text-sm text-gray-300">{match.judge_reasoning}</p>
            </div>

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
