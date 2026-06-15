"use client";

import AuthGuard from "@/components/AuthGuard";
import TxButton from "@/components/TxButton";
import MatchSettlingState from "@/components/MatchSettlingState";
import JudgeReasoning from "@/components/shared/JudgeReasoning";
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
import { useAutoResolve } from "@/lib/useAutoResolve";

function useCountdown(resolutionTs: number | null): { display: string; expired: boolean; color: string } {
  const [secsLeft, setSecsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (resolutionTs === null) return;
    const tick = () => setSecsLeft(Math.max(0, resolutionTs - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resolutionTs]);

  if (secsLeft === null) return { display: "", expired: false, color: "var(--text-primary)" };
  if (secsLeft === 0) return { display: "Deadline reached", expired: true, color: "var(--danger)" };

  const d = Math.floor(secsLeft / 86400);
  const h = Math.floor((secsLeft % 86400) / 3600);
  const m = Math.floor((secsLeft % 3600) / 60);
  const s = secsLeft % 60;
  const display = d > 0
    ? `${d}d ${h}h ${m}m`
    : h > 0
    ? `${h}h ${m}m ${s}s`
    : `${m}:${String(s).padStart(2, "0")}`;
  const color = secsLeft < 300 ? "var(--danger)" : secsLeft < 3600 ? "var(--warning)" : "var(--game-predictions)";
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
  const mountedAt = useRef<number>(Date.now());

  const fetchMarket = useCallback(async () => {
    const m = await getMarket(marketIdNum);
    if (m) { setMarket(m); setNullCount(0); }
    else setNullCount((n) => n + 1);
    setLoading(false);
    return m;
  }, [marketIdNum]);

  useEffect(() => {
    fetchMarket();
    intervalRef.current = setInterval(fetchMarket, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchMarket]);

  useEffect(() => {
    if (!market) return;
    market.players.forEach((addr) => {
      if (!playerUsernames[addr.toLowerCase()]) {
        getUserProfile(addr).then((p) => {
          if (p?.username) setPlayerUsernames((prev) => ({ ...prev, [addr.toLowerCase()]: String(p.username) }));
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
  const accent = "var(--game-predictions)";

  const { resolving: autoResolving } = useAutoResolve({
    deadlineUnix: resolutionTs ?? 0,
    isActive: state === PRED_STATE_OPEN,
    resolveFn: async () => { await resolveMarket(marketIdNum, wallet!); },
  });

  const playerIdx = market ? market.players.findIndex((p) => p.toLowerCase() === currentAddr) : -1;
  const isPlayer = playerIdx >= 0;
  const myPrediction = isPlayer ? market!.predictions[playerIdx] : null;

  const winnerAddr = market?.ranking[0]?.toLowerCase();
  const winnerUsername = winnerAddr ? (playerUsernames[winnerAddr] ?? winnerAddr.slice(0, 10) + "…") : null;

  const yesCount = isBinary ? market?.predictions.filter((p) => p === true).length ?? 0 : 0;
  const noCount = isBinary ? market?.predictions.filter((p) => p === false).length ?? 0 : 0;
  const totalPlayers = market?.players.length ?? 0;

  const resolutionDate = resolutionTs
    ? new Date(resolutionTs * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";

  function displayName(addr: string) {
    return playerUsernames[addr.toLowerCase()] ?? addr.slice(0, 10) + "…";
  }

  if (loading || (!market && nullCount < 3)) {
    return (
      <AuthGuard>
        <main className="flex min-h-screen items-center justify-center">
          <p style={{ color: "var(--text-tertiary)" }}>Loading market…</p>
        </main>
      </AuthGuard>
    );
  }

  if (!market) {
    if ((Date.now() - mountedAt.current) / 1000 < 120) {
      return (
        <AuthGuard>
          <MatchSettlingState accent="var(--game-predictions)" backHref="/predictions" backLabel="← Lobby" />
        </AuthGuard>
      );
    }
    return (
      <AuthGuard>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <p style={{ color: "var(--text-tertiary)" }}>Market not found.</p>
          <Link href="/predictions" className="hover:underline" style={{ color: accent }}>← Predictions</Link>
        </main>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="relative min-h-screen overflow-hidden">

        <main className="relative p-4 sm:p-8 max-w-3xl mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs border rounded px-1.5 py-0.5 font-mono"
                  style={{ borderColor: `color-mix(in srgb, ${accent} 30%, transparent)`, color: accent }}
                >
                  {isBinary ? "⚡ YES / NO" : "# Numeric"}
                </span>
                <span className="text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>Market #{marketId}</span>
              </div>
              <h1 className="text-xl font-bold max-w-2xl">{market.question}</h1>
            </div>
            <Link href="/predictions" className="hover:underline text-sm shrink-0 ml-4" style={{ color: accent }}>
              ← Lobby
            </Link>
          </div>

          {/* Resolution info */}
          {state !== PRED_STATE_CANCELLED && (
            <div
              className="mb-6 rounded-xl border p-4"
              style={{ borderColor: `color-mix(in srgb, ${accent} 20%, var(--border))` }}
            >
              <p className="text-xs uppercase tracking-widest mb-1 font-mono" style={{ color: "var(--text-tertiary)" }}>
                Resolution
              </p>
              <p className="font-mono" style={{ color: "var(--text-primary)" }}>{resolutionDate}</p>
              {autoResolving ? (
                <p
                  className="text-sm mt-1 font-mono font-bold animate-resolve-pulse"
                  style={{ color: accent }}
                >
                  Resolving…
                </p>
              ) : !deadlinePassed && countdown.display ? (
                <p
                  key={Math.floor(Date.now() / 1000)}
                  className="text-sm mt-1 font-mono font-bold animate-pred-tick"
                  style={{ color: countdown.color }}
                >
                  {countdown.display}
                </p>
              ) : deadlinePassed && state === PRED_STATE_OPEN ? (
                <p className="text-sm mt-1 font-mono" style={{ color: "var(--text-tertiary)" }}>
                  Awaiting resolution
                </p>
              ) : null}
            </div>
          )}

          {/* ── REJECTED ── */}
          {state === PRED_STATE_REJECTED && (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-700 bg-red-900/10 p-5">
                <p className="text-sm font-semibold uppercase tracking-widest text-red-400 mb-2">Market Rejected</p>
                <p className="text-sm text-gray-300">{market.rejection_reason}</p>
              </div>
              <Link
                href="/predictions"
                className="inline-block rounded-lg px-6 py-2 font-semibold hover:opacity-90 text-[#0a0a0f]"
                style={{ background: accent }}
              >
                Create a new market
              </Link>
            </div>
          )}

          {/* ── CANCELLED ── */}
          {state === PRED_STATE_CANCELLED && (
            <div className="space-y-4 text-center">
              <p style={{ color: "var(--text-secondary)" }}>This market was cancelled.</p>
              <Link href="/predictions" className="inline-block rounded-lg px-6 py-2 font-semibold hover:opacity-90 text-[#0a0a0f]" style={{ background: accent }}>
                Back to Lobby
              </Link>
            </div>
          )}

          {/* ── OPEN ── */}
          {state === PRED_STATE_OPEN && (
            <div className="space-y-6">
              {/* Distribution */}
              {totalPlayers > 0 && isBinary && (
                <div
                  className="rounded-xl border p-4"
                  style={{ borderColor: `color-mix(in srgb, ${accent} 15%, var(--border))` }}
                >
                  <p
                    className="text-xs uppercase tracking-widest mb-3 font-mono"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {totalPlayers} prediction{totalPlayers !== 1 ? "s" : ""} submitted
                  </p>
                  <div className="flex gap-6 text-sm font-mono font-bold">
                    <span style={{ color: "var(--success)" }}>YES: {yesCount}</span>
                    <span style={{ color: "var(--danger)" }}>NO: {noCount}</span>
                  </div>
                  {totalPlayers > 0 && (
                    <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${(yesCount / totalPlayers) * 100}%`,
                          background: "var(--success)",
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              {totalPlayers > 0 && !isBinary && (
                <div className="rounded-xl border border-[var(--border)] p-4">
                  <p className="text-xs uppercase tracking-widest font-mono" style={{ color: "var(--text-tertiary)" }}>
                    {totalPlayers} player{totalPlayers !== 1 ? "s" : ""} have predicted
                  </p>
                </div>
              )}

              {/* My prediction */}
              {isPlayer && myPrediction !== null && (
                <div
                  className="rounded-xl border p-4"
                  style={{ borderColor: `color-mix(in srgb, ${accent} 30%, transparent)`, background: `color-mix(in srgb, ${accent} 5%, transparent)` }}
                >
                  <p className="text-sm font-mono" style={{ color: accent }}>
                    Your prediction:{" "}
                    <strong>
                      {isBinary ? (myPrediction === true ? "YES" : "NO") : String(myPrediction)}
                    </strong>
                    {!deadlinePassed && <span className="font-normal" style={{ color: "var(--text-tertiary)" }}> (editable until deadline)</span>}
                  </p>
                </div>
              )}

              {/* Predict form */}
              {!deadlinePassed && (
                <div
                  className="rounded-xl border p-5"
                  style={{ borderColor: `color-mix(in srgb, ${accent} 15%, var(--border))` }}
                >
                  <p
                    className="mb-3 text-sm font-semibold uppercase tracking-widest font-mono"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {isPlayer ? "Update prediction" : "Make your prediction"}
                  </p>

                  {isBinary ? (
                    <div className="flex gap-3 mb-4">
                      {([true, false] as const).map((val) => (
                        <button
                          key={String(val)}
                          onClick={() => setBinaryPick(val)}
                          className="rounded-lg border px-8 py-3 font-semibold font-mono text-lg transition-all"
                          style={
                            binaryPick === val
                              ? {
                                  borderColor: val ? "var(--success)" : "var(--danger)",
                                  background: val ? "rgba(52,211,153,0.12)" : "rgba(239,68,68,0.12)",
                                  color: val ? "var(--success)" : "var(--danger)",
                                }
                              : { borderColor: "var(--border-strong)", color: "var(--text-secondary)" }
                          }
                        >
                          {val ? "YES" : "NO"}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      type="number"
                      value={numericInput}
                      onChange={(e) => setNumericInput(e.target.value)}
                      placeholder="Enter your numeric prediction"
                      className="mb-4 w-full max-w-xs rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-4 py-3 placeholder-gray-500 focus:outline-none"
                      style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}
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
                    className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 disabled:opacity-50 text-[#0a0a0f] bg-[var(--game-predictions)]"
                    description="Submitting prediction"
                  >
                    {isPlayer ? "Update prediction" : "Submit prediction"}
                  </TxButton>
                </div>
              )}

              {/* Resolve */}
              {deadlinePassed && (
                <div
                  className="rounded-xl border p-5"
                  style={{ borderColor: "rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.04)" }}
                >
                  {autoResolving ? (
                    <p
                      className="text-sm font-mono font-semibold animate-resolve-pulse"
                      style={{ color: accent }}
                    >
                      Resolving…
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-amber-400 mb-3 font-mono">
                        Deadline passed — anyone can resolve this market now
                      </p>
                      <TxButton
                        onClick={async () => {
                          if (!wallet) throw new Error("No wallet");
                          await resolveMarket(marketIdNum, wallet);
                          fetchMarket();
                        }}
                        className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 text-[#0a0a0f] bg-[var(--game-predictions)]"
                        pendingLabel="Fetching real-world data via validators…"
                        description="Resolving prediction market"
                      >
                        Resolve Market
                      </TxButton>
                    </>
                  )}
                </div>
              )}

              {market.creator.toLowerCase() === currentAddr && totalPlayers === 0 && !deadlinePassed && (
                <TxButton
                  onClick={async () => {
                    if (!wallet) throw new Error("No wallet");
                    await cancelMarketPredictions(marketIdNum, wallet);
                    fetchMarket();
                  }}
                  className="rounded-lg border border-[var(--border-strong)] px-4 py-1.5 text-sm hover:border-red-700 hover:text-red-400 disabled:opacity-40 text-[var(--text-secondary)]"
                  description="Cancelling market"
                >
                  Cancel market
                </TxButton>
              )}
            </div>
          )}

          {/* ── RESOLVED ── */}
          {state === PRED_STATE_RESOLVED && (
            <div className="space-y-6">
              {/* Large answer display */}
              <div
                className="rounded-xl border p-6 text-center"
                style={{
                  borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
                  background: `color-mix(in srgb, ${accent} 5%, var(--bg-elevated))`,
                }}
              >
                <p
                  className="text-xs font-semibold uppercase tracking-widest mb-2 font-mono"
                  style={{ color: accent }}
                >
                  Actual Answer
                </p>
                <p
                  className="font-bold leading-none"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: isBinary ? "clamp(2rem, 6vw, 4rem)" : "clamp(2.5rem, 8vw, 5rem)",
                    color: isBinary
                      ? market.actual_answer === "true" ? "var(--success)" : "var(--danger)"
                      : accent,
                  }}
                >
                  {isBinary
                    ? market.actual_answer === "true" ? "YES" : "NO"
                    : market.actual_answer}
                </p>
              </div>

              {/* AI reasoning */}
              {market.resolution_reasoning && (
                <JudgeReasoning
                  reasoning={market.resolution_reasoning}
                  game="predictions"
                  verdict={isBinary ? (market.actual_answer === "true" ? "YES" : "NO") : market.actual_answer}
                  sourceUrl={market.actual_answer_source ?? undefined}
                />
              )}

              {/* Winner */}
              {market.ranking.length > 0 && (
                <div
                  className="rounded-xl border p-5 text-center"
                  style={{ borderColor: "rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.04)" }}
                >
                  <p className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-1">Winner</p>
                  <p className="text-xl font-bold">{winnerUsername}</p>
                  {winnerAddr === currentAddr && <p className="text-green-400 text-sm mt-1">That&apos;s you!</p>}
                </div>
              )}

              {/* Leaderboard */}
              {market.ranking.length > 0 && (
                <div className="rounded-xl border border-[var(--border)] p-4">
                  <p
                    className="mb-3 text-xs font-semibold uppercase tracking-widest font-mono"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Leaderboard
                  </p>
                  <div className="space-y-2">
                    {market.ranking.map((addr, rank) => {
                      const addrLow = addr.toLowerCase();
                      const pIdx = market.players.findIndex((p) => p.toLowerCase() === addrLow);
                      const pred = pIdx >= 0 ? market.predictions[pIdx] : null;
                      const predDisplay = pred === null ? "—"
                        : isBinary ? (pred === true ? "YES" : "NO")
                        : String(pred);
                      const isWinner = rank === 0;
                      const isMe = addrLow === currentAddr;
                      let distDisplay = "";
                      if (!isBinary && market.actual_answer && pred !== null) {
                        const dist = Math.abs(Number(pred) - Number(market.actual_answer));
                        distDisplay = `±${dist.toLocaleString()}`;
                      }

                      return (
                        <div
                          key={addr}
                          className="rounded-lg border p-3 flex items-center gap-3"
                          style={{
                            borderColor: isWinner ? "rgba(251,191,36,0.3)" : isMe ? `color-mix(in srgb, ${accent} 20%, transparent)` : "var(--border)",
                            background: isWinner ? "rgba(251,191,36,0.04)" : isMe ? `color-mix(in srgb, ${accent} 4%, transparent)` : "transparent",
                          }}
                        >
                          <span
                            className="text-sm font-bold w-6 text-center font-mono"
                            style={{ color: isWinner ? "var(--warning)" : "var(--text-tertiary)" }}
                          >
                            #{rank + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium">{displayName(addr)}</span>
                            {isMe && <span className="ml-1 text-xs" style={{ color: accent }}>(you)</span>}
                          </div>
                          <div className="text-right text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
                            <div>Predicted: <strong style={{ color: "var(--text-primary)" }}>{predDisplay}</strong></div>
                            {distDisplay && <div>{distDisplay}</div>}
                            {isBinary && pred !== null && (
                              <div style={{ color: pred === (market.actual_answer === "true") ? "var(--success)" : "var(--danger)" }}>
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
                className="inline-block rounded-lg px-6 py-2 font-semibold hover:opacity-90 text-[#0a0a0f]"
                style={{ background: accent }}
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
