"use client";

import AuthGuard from "@/components/AuthGuard";
import TxButton from "@/components/TxButton";
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
  TITLE_STATE_WAITING,
  TITLE_STATE_REJECTED,
  TITLE_STATE_OPEN,
  TITLE_STATE_JUDGING,
  TITLE_STATE_JUDGED,
  TITLE_STATE_CANCELLED,
} from "@/lib/genlayer";
import type { TitleMatch } from "@/lib/genlayer";
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
    secsLeft < 30 ? "text-red-400" : secsLeft < 60 ? "text-amber-400" : "text-white";
  return { display: `${mm}:${ss}`, expired: false, color };
}

export default function TitleMatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const matchIdNum = Number(matchId);
  const { wallet } = useActiveWallet();
  const currentAddr = wallet?.address?.toLowerCase() ?? null;

  const [match, setMatch] = useState<TitleMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [submittedThisSession, setSubmittedThisSession] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          <Link href="/title-wars" className="text-indigo-400 hover:underline">← Back to lobby</Link>
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
    ? Number(match.submission_deadline)
    : null;
  const submittedCount = match.titles.filter((t) => t !== "").length;

  const myIndex = currentAddr
    ? match.players.findIndex((p) => p.toLowerCase() === currentAddr)
    : -1;
  const myTitle = myIndex >= 0 ? match.titles[myIndex] : "";
  const hasSubmitted = myTitle !== "";

  // ── CANCELLED ──────────────────────────────────────────────────────────────
  if (state === TITLE_STATE_CANCELLED) {
    return (
      <AuthGuard>
        <main className="min-h-screen p-8 max-w-2xl mx-auto">
          <Link href="/title-wars" className="text-indigo-400 hover:underline text-sm">← Back to lobby</Link>
          <div className="mt-8 rounded-xl border border-red-700 bg-red-900/20 p-6">
            <h1 className="text-2xl font-bold mb-2">Match Cancelled</h1>
            <p className="text-gray-300 text-sm">The host cancelled this match.</p>
            <Link
              href="/title-wars"
              className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold hover:bg-indigo-500"
            >
              Back to lobby
            </Link>
          </div>
        </main>
      </AuthGuard>
    );
  }

  // ── REJECTED ───────────────────────────────────────────────────────────────
  if (state === TITLE_STATE_REJECTED) {
    return (
      <AuthGuard>
        <main className="min-h-screen p-8 max-w-2xl mx-auto">
          <Link href="/title-wars" className="text-indigo-400 hover:underline text-sm">← Back to lobby</Link>
          <div className="mt-8 rounded-xl border border-red-700 bg-red-900/20 p-6">
            <h1 className="text-2xl font-bold mb-2">Excerpt Rejected</h1>
            <p className="text-gray-300 text-sm">{match.rejection_reason}</p>
            <Link
              href="/title-wars"
              className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold hover:bg-indigo-500"
            >
              Create a new match
            </Link>
          </div>
        </main>
      </AuthGuard>
    );
  }

  // ── JUDGING ────────────────────────────────────────────────────────────────
  if (state === TITLE_STATE_JUDGING) {
    return (
      <AuthGuard>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-indigo-500" />
          <h2 className="text-xl font-semibold">AI is ranking all titles…</h2>
          <p className="text-gray-400 text-sm text-center max-w-sm">
            Validators are agreeing on the ranking. This may take 30–60 seconds.
          </p>
        </main>
      </AuthGuard>
    );
  }

  // ── JUDGED ─────────────────────────────────────────────────────────────────
  if (state === TITLE_STATE_JUDGED) {
    const winner = match.ranking[0] ?? "";
    const iWon = winner.toLowerCase() === currentAddr;

    return (
      <AuthGuard>
        <main className="min-h-screen p-8 max-w-3xl mx-auto">
          <Link href="/title-wars" className="text-indigo-400 hover:underline text-sm">← Back to lobby</Link>

          {/* Excerpt */}
          <div className="mt-6 rounded-xl border border-gray-700 p-6 mb-6">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 font-mono">Excerpt</p>
            <p className="text-gray-200 italic whitespace-pre-line leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
              {match.excerpt}
            </p>
          </div>

          {/* Trophy */}
          <div className="rounded-xl border border-yellow-500 bg-yellow-900/20 p-6 text-center mb-6">
            <p className="text-4xl mb-2">🏆</p>
            <h1 className="text-3xl font-bold mb-1">
              {iWon ? "You won!" : `Winner: ${displayName(winner)}`}
            </h1>
            {iWon && <p className="text-yellow-300 text-sm">🎉 That&apos;s you — congratulations!</p>}
          </div>

          {/* Leaderboard */}
          <div className="rounded-xl border border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left border-b border-gray-700 bg-gray-900">
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Player</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3 hidden md:table-cell">AI Reasoning</th>
                </tr>
              </thead>
              <tbody>
                {match.ranking.map((addr, i) => {
                  const isMe = addr.toLowerCase() === currentAddr;
                  const playerIdx = match.players.findIndex(
                    (p) => p.toLowerCase() === addr.toLowerCase()
                  );
                  const submittedTitle = playerIdx >= 0 ? match.titles[playerIdx] : "";
                  const rankReason = match.judge_reasoning[i] ?? "";
                  const rankLabel =
                    i === 0 ? "1st 🏆" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}th`;

                  return (
                    <tr
                      key={addr}
                      className={`border-b border-gray-800 ${isMe ? "bg-indigo-900/20" : ""}`}
                    >
                      <td className={`px-4 py-3 font-semibold ${i === 0 ? "text-yellow-400" : "text-gray-400"}`}>
                        {rankLabel}
                      </td>
                      <td className={`px-4 py-3 ${isMe ? "text-indigo-300" : ""}`}>
                        {displayName(addr)}{isMe ? " (you)" : ""}
                      </td>
                      <td className="px-4 py-3 text-gray-200 italic">
                        {submittedTitle || <span className="text-gray-500 not-italic">[did not submit]</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">
                        {rankReason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Link
            href="/title-wars"
            className="mt-6 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold hover:bg-indigo-500"
          >
            Back to lobby
          </Link>
        </main>
      </AuthGuard>
    );
  }

  // ── OPEN_FOR_SUBMISSIONS ───────────────────────────────────────────────────
  if (state === TITLE_STATE_OPEN) {
    return (
      <AuthGuard>
        <main className="min-h-screen p-8 max-w-2xl mx-auto">
          <OpenSubmissions
            match={match}
            matchIdNum={matchIdNum}
            wallet={wallet}
            currentAddr={currentAddr}
            isPlayer={isPlayer}
            deadline={deadline}
            submittedCount={submittedCount}
            myTitle={myTitle}
            hasSubmitted={hasSubmitted}
            submittedThisSession={submittedThisSession}
            onSubmit={() => setSubmittedThisSession(true)}
            titleInput={titleInput}
            setTitleInput={setTitleInput}
          />
        </main>
      </AuthGuard>
    );
  }

  // ── WAITING (lobby) ────────────────────────────────────────────────────────
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/title-wars/${matchIdNum}`
      : "";

  return (
    <AuthGuard>
      <main className="min-h-screen p-8 max-w-2xl mx-auto">
        <div className="mb-6">
          <Link href="/title-wars" className="text-indigo-400 hover:underline text-sm">← Lobby</Link>
        </div>

        {/* Excerpt */}
        <div className="rounded-xl border border-gray-700 p-6 mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-3 font-mono">Literary Excerpt</p>
          <p
            className="text-gray-200 italic whitespace-pre-line leading-relaxed text-lg"
            style={{ fontFamily: "Georgia, serif" }}
          >
            {match.excerpt}
          </p>
        </div>

        {/* Lobby card */}
        <div className="rounded-xl border border-gray-700 p-6 mb-6">
          <p className="text-sm text-gray-400 mb-4">
            {playerCount} / {maxPlayers} players joined
          </p>

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
                      <span className="text-xs text-amber-400 border border-amber-700 rounded px-1">host</span>
                    )}
                    {isMe && !isH && <span className="text-xs text-gray-500">(you)</span>}
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
                className="rounded-lg bg-green-600 px-6 py-2 font-semibold hover:bg-green-500 disabled:opacity-50"
                pendingLabel="Starting match…"
              >
                Start Match
              </TxButton>
              {playerCount < 2 && (
                <p className="text-xs text-gray-500">Need at least 2 players to start</p>
              )}
              <div className="pt-2">
                <TxButton
                  onClick={async () => { await cancelTitleMatch(matchIdNum, wallet!); }}
                  className="rounded-lg border border-red-700 px-4 py-1.5 text-sm text-red-400 hover:bg-red-900/20"
                  pendingLabel="Cancelling…"
                >
                  Cancel match
                </TxButton>
              </div>
            </div>
          ) : isPlayer ? (
            <p className="text-gray-400 text-sm">Waiting for host to start the match…</p>
          ) : playerCount < maxPlayers ? (
            <TxButton
              onClick={async () => { await joinTitleWarsMatch(matchIdNum, wallet!); }}
              className="rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500"
              pendingLabel="Joining…"
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

// ── OpenSubmissions sub-component ─────────────────────────────────────────────

function OpenSubmissions({
  match,
  matchIdNum,
  wallet,
  currentAddr,
  isPlayer,
  deadline,
  submittedCount,
  myTitle,
  hasSubmitted,
  submittedThisSession,
  onSubmit,
  titleInput,
  setTitleInput,
}: {
  match: TitleMatch;
  matchIdNum: number;
  wallet: ReturnType<typeof useActiveWallet>["wallet"];
  currentAddr: string | null;
  isPlayer: boolean;
  deadline: number | null;
  submittedCount: number;
  myTitle: string;
  hasSubmitted: boolean;
  submittedThisSession: boolean;
  onSubmit: () => void;
  titleInput: string;
  setTitleInput: (v: string) => void;
}) {
  const MAX_TITLE = 100;
  const { display, expired, color } = useCountdown(deadline);
  const playerCount = match.players.length;

  const [excerptExpanded, setExcerptExpanded] = useState(false);
  const isLong = match.excerpt.length > 300;
  const excerptDisplay = isLong && !excerptExpanded
    ? match.excerpt.slice(0, 300) + "…"
    : match.excerpt;

  async function handleSubmit() {
    if (!wallet || !titleInput.trim()) throw new Error("No wallet or empty title");
    await submitTitle(matchIdNum, titleInput.trim(), wallet);
    onSubmit();
  }

  const deadlinePassed = deadline !== null && Date.now() / 1000 > deadline;
  const allSubmitted = submittedCount >= playerCount;

  return (
    <div>
      {/* Excerpt */}
      <div className="rounded-xl border border-gray-700 p-5 mb-6">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 font-mono">Excerpt</p>
        <p
          className="text-gray-200 italic whitespace-pre-line leading-relaxed"
          style={{ fontFamily: "Georgia, serif" }}
        >
          {excerptDisplay}
        </p>
        {isLong && (
          <button
            onClick={() => setExcerptExpanded((v) => !v)}
            className="mt-2 text-xs text-indigo-400 hover:underline"
          >
            {excerptExpanded ? "Collapse" : "Show full excerpt"}
          </button>
        )}
      </div>

      {/* Countdown */}
      {deadline && (
        <div className={`text-5xl font-mono font-bold text-center mb-6 ${color}`}>
          {display}
        </div>
      )}

      {/* Submission count */}
      <p className="text-xs text-gray-500 text-center mb-4">
        {submittedCount} / {playerCount} players have submitted
      </p>

      {/* Title input */}
      {isPlayer && !expired ? (
        hasSubmitted || submittedThisSession ? (
          <div className="rounded-lg border border-green-700 bg-green-900/20 p-4 text-sm mb-4">
            <p className="text-green-400 font-semibold">
              ✓ Title locked in (you can update until the deadline)
            </p>
            <p className="text-gray-400 mt-1 italic">&ldquo;{myTitle}&rdquo;</p>
          </div>
        ) : (
          <div className="mb-6">
            <label className="block text-sm text-gray-400 mb-1">
              Your title ({titleInput.length}/{MAX_TITLE})
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value.slice(0, MAX_TITLE))}
                placeholder="Enter your best title…"
                className="flex-1 rounded-lg border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                onKeyDown={(e) => { if (e.key === "Enter" && titleInput.trim()) handleSubmit(); }}
              />
              <TxButton
                onClick={handleSubmit}
                disabled={!titleInput.trim()}
                className="rounded-lg bg-indigo-600 px-5 py-3 font-semibold hover:bg-indigo-500 disabled:opacity-50"
                pendingLabel="Submitting…"
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

      {/* Judge button */}
      {(deadlinePassed || allSubmitted) && (
        <div className="mt-4">
          <TxButton
            onClick={async () => { await judgeTitleMatch(matchIdNum, wallet!); }}
            className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold hover:bg-amber-500"
            pendingLabel="AI ranking titles… (may take 1-2 min)"
          >
            {allSubmitted ? "All submitted — Judge Match" : "Judge Match"}
          </TxButton>
        </div>
      )}

      {/* DEV skip */}
      {process.env.NODE_ENV === "development" && !deadlinePassed && (
        <div className="mt-8 rounded-lg border border-dashed border-gray-600 p-3 text-xs text-gray-500">
          <p className="mb-2 font-mono">DEV: force-judge</p>
          <TxButton
            onClick={async () => { await judgeTitleMatch(matchIdNum, wallet!); }}
            className="rounded bg-gray-700 px-3 py-1 text-xs hover:bg-gray-600"
            pendingLabel="Force judging…"
          >
            Skip deadline → Judge
          </TxButton>
        </div>
      )}
    </div>
  );
}
