"use client";

import AuthGuard from "@/components/AuthGuard";
import TxButton from "@/components/TxButton";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  getMarket,
  joinAndPredictBinary,
  joinAndPredictNumeric,
  resolveMarket,
  cancelMarketPredictions,
  getUserProfile,
  MARKET_TYPE_BINARY,
  PRED_STATE_OPEN,
  PRED_STATE_RESOLVED,
  PRED_STATE_REJECTED,
  PRED_STATE_CANCELLED,
} from "@/lib/genlayer";
import type { Market } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

function useCountdown(resolutionTs: number | null): { display: string; expired: boolean; color: string } {
  const [secsLeft, setSecsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (resolutionTs === null) return;
    const tick = () => setSecsLeft(Math.max(0, resolutionTs - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resolutionTs]);

  if (secsLeft === null) return { display: "", expired: false, color: "text-white" };
  if (secsLeft === 0) return { display: "Deadline reached", expired: true, color: "text-red-400" };

  const d = Math.floor(secsLeft / 86400);
  const h = Math.floor((secsLeft % 86400) / 3600);
  const m = Math.floor((secsLeft % 3600) / 60);
  const s = secsLeft % 60;
  const display = d > 0
    ? `${d}d ${h}h ${m}m remaining`
    : h > 0
    ? `${h}h ${m}m ${s}s remaining`
    : `${m}:${String(s).padStart(2, "0")} remaining`;
  const color = secsLeft < 300 ? "text-red-400" : secsLeft < 3600 ? "text-amber-400" : "text-white";
  return { display, expired: false, color };
}

export default function MarketPage() {
  const { marketId } = useParams<{ marketId: string }>();
  const marketIdNum = Number(marketId);
  const { wallet } = useActiveWallet();
  const currentAddr = wallet?.address?.toLowerCase() ?? null;

  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [nullCount, setNullCount] = useState(0);
  const [binaryPick, setBinaryPick] = useState<boolean | null>(null);
  const [numericInput, setNumericInput] = useState("");
  const [playerUsernames, setPlayerUsernames] = useState<Record<string, string>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMarket = useCallback(async () => {
    const m = await getMarket(marketIdNum);
    if (m) {
      setMarket(m);
      setNullCount(0);
    } else {
      setNullCount((n) => n + 1);
    }
    setLoading(false);
    return m;
  }, [marketIdNum]);

  useEffect(() => {
    fetchMarket();
    intervalRef.current = setInterval(fetchMarket, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchMarket]);

  // Resolve usernames
  useEffect(() => {
    if (!market) return;
    market.players.forEach((addr) => {
      if (!playerUsernames[addr.toLowerCase()]) {
        getUserProfile(addr).then((p) => {
          if (p?.username) {
            setPlayerUsernames((prev) => ({ ...prev, [addr.toLowerCase()]: String(p.username) }));
          }
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.players_json]);

  const state = market ? Number(market.state) : -1;
  const isBinary = market ? Number(market.market_type) === MARKET_TYPE_BINARY : true;
  const resolutionTs = market ? Number(market.resolution_datetime) : null;
  const deadlinePassed = resolutionTs !== null && Date.now() / 1000 > resolutionTs;
  const countdown = useCountdown(resolutionTs && !deadlinePassed ? resolutionTs : null);

  const playerIdx = market ? market.players.findIndex((p) => p.toLowerCase() === currentAddr) : -1;
  const isPlayer = playerIdx >= 0;
  const myPrediction = isPlayer ? market!.predictions[playerIdx] : null;

  const winnerAddr = market?.ranking[0]?.toLowerCase();
  const winnerUsername = winnerAddr ? (playerUsernames[winnerAddr] ?? winnerAddr.slice(0, 10) + "…") : null;

  // Distribution preview (binary only)
  const yesCount = isBinary ? market?.predictions.filter((p) => p === true).length ?? 0 : 0;
  const noCount = isBinary ? market?.predictions.filter((p) => p === false).length ?? 0 : 0;
  const totalPlayers = market?.players.length ?? 0;

  const resolutionDate = resolutionTs
    ? new Date(resolutionTs * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";

  if (loading || (!market && nullCount < 3)) {
    return (
      <AuthGuard>
        <main className="flex min-h-screen items-center justify-center">
          <p className="text-gray-400">Loading market…</p>
        </main>
      </AuthGuard>
    );
  }

  if (!market) {
    return (
      <AuthGuard>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <p className="text-gray-400">Market not found.</p>
          <Link href="/predictions" className="text-indigo-400 hover:underline">← Predictions</Link>
        </main>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <main className="min-h-screen p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs border border-gray-600 rounded px-1.5 py-0.5 text-gray-400">
                {isBinary ? "YES / NO" : "Numeric"}
              </span>
              <span className="text-xs text-gray-500">Market #{marketId}</span>
            </div>
            <h1 className="text-xl font-bold max-w-2xl">{market.question}</h1>
          </div>
          <Link href="/predictions" className="text-indigo-400 hover:underline text-sm shrink-0 ml-4">← Lobby</Link>
        </div>

        {/* Resolution time */}
        {state !== PRED_STATE_CANCELLED && (
          <div className="mb-6 rounded-xl border border-gray-700 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Resolution</p>
            <p className="text-white">{resolutionDate}</p>
            {!deadlinePassed && countdown.display && (
              <p className={`text-sm mt-1 ${countdown.color}`}>{countdown.display}</p>
            )}
            {deadlinePassed && state === PRED_STATE_OPEN && (
              <p className="text-amber-400 text-sm mt-1">Past deadline — awaiting resolution</p>
            )}
          </div>
        )}

        {/* ── STATE_REJECTED ── */}
        {state === PRED_STATE_REJECTED && (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-700 bg-red-900/10 p-5">
              <p className="text-sm font-semibold uppercase tracking-widest text-red-400 mb-2">Market Rejected</p>
              <p className="text-sm text-gray-300">{market.rejection_reason}</p>
            </div>
            <Link
              href="/predictions"
              className="inline-block rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500"
            >
              Create a new market
            </Link>
          </div>
        )}

        {/* ── STATE_CANCELLED ── */}
        {state === PRED_STATE_CANCELLED && (
          <div className="space-y-4 text-center">
            <p className="text-gray-400">This market was cancelled.</p>
            <Link href="/predictions" className="inline-block rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500">
              Back to Lobby
            </Link>
          </div>
        )}

        {/* ── STATE_OPEN ── */}
        {state === PRED_STATE_OPEN && (
          <div className="space-y-6">
            {/* Distribution */}
            {totalPlayers > 0 && isBinary && (
              <div className="rounded-xl border border-gray-700 p-4">
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Current predictions ({totalPlayers} players)</p>
                <div className="flex gap-4 text-sm">
                  <span className="text-green-400">YES: {yesCount}</span>
                  <span className="text-red-400">NO: {noCount}</span>
                </div>
              </div>
            )}
            {totalPlayers > 0 && !isBinary && (
              <div className="rounded-xl border border-gray-700 p-4">
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">{totalPlayers} player{totalPlayers !== 1 ? "s" : ""} have predicted</p>
              </div>
            )}

            {/* My current prediction */}
            {isPlayer && myPrediction !== null && (
              <div className="rounded-xl border border-indigo-800 bg-indigo-900/20 p-4">
                <p className="text-sm text-indigo-300">
                  Your prediction:{" "}
                  <strong>
                    {isBinary ? (myPrediction === true ? "YES" : "NO") : String(myPrediction)}
                  </strong>
                  {!deadlinePassed && " (editable until deadline)"}
                </p>
              </div>
            )}

            {/* Predict form — only when deadline hasn't passed */}
            {!deadlinePassed && (
              <div className="rounded-xl border border-gray-700 p-5">
                <p className="mb-3 text-sm font-semibold text-gray-400 uppercase tracking-widest">
                  {isPlayer ? "Update prediction" : "Make your prediction"}
                </p>

                {isBinary ? (
                  <div className="flex gap-3 mb-4">
                    <button
                      onClick={() => setBinaryPick(true)}
                      className={`rounded-lg border px-6 py-3 font-semibold ${binaryPick === true ? "border-green-500 bg-green-900/30 text-green-300" : "border-gray-600 text-gray-300 hover:border-green-700"}`}
                    >
                      YES
                    </button>
                    <button
                      onClick={() => setBinaryPick(false)}
                      className={`rounded-lg border px-6 py-3 font-semibold ${binaryPick === false ? "border-red-500 bg-red-900/30 text-red-300" : "border-gray-600 text-gray-300 hover:border-red-700"}`}
                    >
                      NO
                    </button>
                  </div>
                ) : (
                  <input
                    type="number"
                    value={numericInput}
                    onChange={(e) => setNumericInput(e.target.value)}
                    placeholder="Enter your numeric prediction"
                    className="mb-4 w-full max-w-xs rounded-lg border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                  />
                )}

                <TxButton
                  onClick={async () => {
                    if (!wallet) throw new Error("No wallet");
                    if (isBinary) {
                      if (binaryPick === null) throw new Error("Select YES or NO");
                      await joinAndPredictBinary(marketIdNum, binaryPick, wallet);
                    } else {
                      const n = parseFloat(numericInput);
                      if (isNaN(n)) throw new Error("Enter a valid number");
                      await joinAndPredictNumeric(marketIdNum, n, wallet);
                    }
                    fetchMarket();
                  }}
                  disabled={isBinary ? binaryPick === null : numericInput.trim() === ""}
                  className="rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500 disabled:opacity-50"
                >
                  {isPlayer ? "Update prediction" : "Submit prediction"}
                </TxButton>
              </div>
            )}

            {/* Resolve button — after deadline */}
            {deadlinePassed && (
              <div className="rounded-xl border border-amber-800 bg-amber-900/10 p-5">
                <p className="text-sm text-amber-400 mb-3">
                  Deadline passed — anyone can resolve this market now
                </p>
                <TxButton
                  onClick={async () => {
                    if (!wallet) throw new Error("No wallet");
                    await resolveMarket(marketIdNum, wallet);
                    fetchMarket();
                  }}
                  className="rounded-lg bg-amber-600 px-6 py-2 font-semibold hover:bg-amber-500 disabled:opacity-50"
                  pendingLabel="Fetching real-world data via validators…"
                >
                  Resolve Market
                </TxButton>
              </div>
            )}

            {/* Creator cancel option */}
            {market.creator.toLowerCase() === currentAddr && totalPlayers === 0 && !deadlinePassed && (
              <TxButton
                onClick={async () => {
                  if (!wallet) throw new Error("No wallet");
                  await cancelMarketPredictions(marketIdNum, wallet);
                  fetchMarket();
                }}
                className="rounded-lg border border-gray-600 px-4 py-1.5 text-sm text-gray-400 hover:border-red-700 hover:text-red-400 disabled:opacity-40"
              >
                Cancel market
              </TxButton>
            )}
          </div>
        )}

        {/* ── STATE_RESOLVED ── */}
        {state === PRED_STATE_RESOLVED && (
          <div className="space-y-6">
            {/* Actual answer */}
            <div className="rounded-xl border border-green-700 bg-green-900/10 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-green-400 mb-2">Actual Answer</p>
              <p className="text-2xl font-bold">
                {isBinary
                  ? market.actual_answer === "true" ? "YES" : "NO"
                  : market.actual_answer}
              </p>
              {market.actual_answer_source && (
                <p className="mt-1 text-xs text-gray-500">Source: {market.actual_answer_source}</p>
              )}
            </div>

            {/* AI reasoning */}
            {market.resolution_reasoning && (
              <div className="rounded-xl border border-gray-700 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">AI Resolution Reasoning</p>
                <p className="text-sm text-gray-300">{market.resolution_reasoning}</p>
              </div>
            )}

            {/* Winner */}
            {market.ranking.length > 0 && (
              <div className="rounded-xl border border-yellow-700 bg-yellow-900/10 p-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-yellow-400 mb-1">Winner</p>
                <p className="text-xl font-bold">{winnerUsername}</p>
                {winnerAddr === currentAddr && <p className="text-green-400 text-sm mt-1">That&apos;s you!</p>}
              </div>
            )}

            {/* Leaderboard */}
            {market.ranking.length > 0 && (
              <div className="rounded-xl border border-gray-700 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Leaderboard</p>
                <div className="space-y-2">
                  {market.ranking.map((addr, rank) => {
                    const addrLow = addr.toLowerCase();
                    const username = playerUsernames[addrLow] ?? addrLow.slice(0, 10) + "…";
                    const pIdx = market.players.findIndex((p) => p.toLowerCase() === addrLow);
                    const pred = pIdx >= 0 ? market.predictions[pIdx] : null;
                    const predDisplay = pred === null ? "—"
                      : isBinary ? (pred === true ? "YES" : "NO")
                      : String(pred);
                    const isWinner = rank === 0;
                    const isMe = addrLow === currentAddr;

                    // distance for numeric
                    let distDisplay = "";
                    if (!isBinary && market.actual_answer && pred !== null) {
                      const dist = Math.abs(Number(pred) - Number(market.actual_answer));
                      distDisplay = `±${dist.toLocaleString()}`;
                    }

                    return (
                      <div
                        key={addr}
                        className={`rounded-lg border p-3 flex items-center gap-3 ${isWinner ? "border-yellow-700 bg-yellow-900/10" : isMe ? "border-indigo-800 bg-indigo-900/10" : "border-gray-700"}`}
                      >
                        <span className={`text-sm font-bold w-6 text-center ${isWinner ? "text-yellow-400" : "text-gray-400"}`}>
                          #{rank + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium">{username}</span>
                          {isMe && <span className="ml-1 text-xs text-indigo-400">(you)</span>}
                        </div>
                        <div className="text-right text-xs text-gray-400">
                          <div>Predicted: <strong className="text-white">{predDisplay}</strong></div>
                          {distDisplay && <div>{distDisplay}</div>}
                          {isBinary && pred !== null && (
                            <div className={pred === (market.actual_answer === "true") ? "text-green-400" : "text-red-400"}>
                              {pred === (market.actual_answer === "true") ? "Correct" : "Incorrect"}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <Link
              href="/predictions"
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
