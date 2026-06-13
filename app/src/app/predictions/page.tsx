"use client";

import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/shell/AppShell";
import TxButton from "@/components/TxButton";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getOpenMarkets,
  getResolvedMarkets,
  getMarketsForPlayer,
  getMarket,
  createBinaryMarket,
  createNumericMarket,
  MARKET_TYPE_BINARY,
  MARKET_TYPE_NUMERIC,
  PRED_STATE_OPEN,
  PRED_STATE_RESOLVED,
  getUserProfile,
} from "@/lib/genlayer";
import type { Market } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";
import { getDailyMatchIds } from "@/lib/dailyContentTrigger";

const MIN_RESOLUTION_HOURS = 24;
const MAX_RESOLUTION_HOURS = 168;
const MAX_QUESTION_CHARS = 300;

function defaultResolutionDatetime(): string {
  const d = new Date(Date.now() + 48 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 16);
}

function formatCountdown(resolutionTs: number): string {
  const diffMs = resolutionTs * 1000 - Date.now();
  if (diffMs <= 0) return "Ready to resolve";
  const h = Math.floor(diffMs / 3600000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  const m = Math.floor((diffMs % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function PredBg() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(45,212,191,0.035) 0px, rgba(45,212,191,0.035) 1px, transparent 1px, transparent 20%)",
        }}
      />
      <svg
        className="absolute top-0 left-0 w-full opacity-60"
        height="64"
        viewBox="0 0 800 64"
        preserveAspectRatio="none"
      >
        <polyline
          points="0,52 80,38 160,44 240,28 320,40 400,22 480,34 560,18 640,30 720,14 800,26"
          fill="none"
          stroke="rgba(45,212,191,0.15)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function SectionHeader({ title, count, accent }: { title: string; count: number; accent: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <span
        className="rounded-full px-2 py-0.5 text-xs font-mono"
        style={{ background: `color-mix(in srgb, ${accent} 15%, transparent)`, color: accent }}
      >
        {count}
      </span>
    </div>
  );
}

function MarketCard({ market, username }: { market: Market; username?: string }) {
  const state = Number(market.state);
  const resTs = Number(market.resolution_datetime);
  const isPastDeadline = Date.now() / 1000 > resTs;
  const isBinary = Number(market.market_type) === MARKET_TYPE_BINARY;
  const accent = "var(--game-predictions)";

  const resDate = new Date(resTs * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      className="rounded-xl border p-4 hover:border-[var(--border-strong)] transition-all hover:-translate-y-0.5"
      style={{ borderColor: state === PRED_STATE_RESOLVED ? "rgba(45,212,191,0.15)" : "var(--border)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium leading-snug flex-1">{market.question}</p>
        <span
          className="shrink-0 text-xs rounded px-1.5 py-0.5 border"
          style={{
            borderColor: `color-mix(in srgb, ${accent} 30%, transparent)`,
            color: accent,
            fontFamily: "var(--font-mono)",
          }}
        >
          {isBinary ? "⚡ YES/NO" : "# Numeric"}
        </span>
      </div>

      <div className="flex items-center justify-between mb-3" style={{ fontFamily: "var(--font-mono)" }}>
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {state === PRED_STATE_OPEN && !isPastDeadline && (
            <span style={{ color: accent }}>→ {formatCountdown(resTs)}</span>
          )}
          {state === PRED_STATE_OPEN && isPastDeadline && (
            <span className="text-amber-400">Awaiting resolution</span>
          )}
          {state === PRED_STATE_RESOLVED && (
            <span className="text-green-400">Resolved</span>
          )}
        </span>
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {resDate} · {market.players.length}p
        </span>
      </div>

      {state === PRED_STATE_RESOLVED && market.ranking.length > 0 && (
        <p className="mb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          Winner: {username ?? market.ranking[0].slice(0, 10) + "…"}
        </p>
      )}

      <Link
        href={`/predictions/${Number(market.id)}`}
        className="block text-center rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90 transition-opacity text-[#0a0a0f]"
        style={{ background: accent }}
      >
        {state === PRED_STATE_OPEN && !isPastDeadline ? "Join & predict" :
         state === PRED_STATE_OPEN && isPastDeadline ? "Resolve now" :
         "View results"}
      </Link>
    </div>
  );
}

export default function PredictionsPage() {
  const { wallet } = useActiveWallet();
  const router = useRouter();

  const [question, setQuestion] = useState("");
  const [marketType, setMarketType] = useState<0 | 1>(0);
  const [resolutionInput, setResolutionInput] = useState(defaultResolutionDatetime());
  const [openMarkets, setOpenMarkets] = useState<Market[]>([]);
  const [resolvingMarkets, setResolvingMarkets] = useState<Market[]>([]);
  const [resolvedMarkets, setResolvedMarkets] = useState<Market[]>([]);
  const [myMarkets, setMyMarkets] = useState<Market[]>([]);
  const [winnerNames, setWinnerNames] = useState<Record<string, string>>({});
  const [lastCreatedState, setLastCreatedState] = useState<null | { rejected: boolean; reason: string; marketId: number }>(null);
  const [dailyMarkets, setDailyMarkets] = useState<Market[] | null>(null);

  const fetchMarkets = useCallback(async () => {
    const [openIds, resolvedIds] = await Promise.all([
      getOpenMarkets(20),
      getResolvedMarkets(10),
    ]);

    const allIds = [...new Set([...openIds, ...resolvedIds])];
    const markets = (await Promise.all(allIds.map(getMarket))).filter(Boolean) as Market[];
    const byId = Object.fromEntries(markets.map((m) => [Number(m.id), m]));

    const open = openIds.map((id) => byId[id]).filter(Boolean).filter(
      (m) => Number(m.state) === PRED_STATE_OPEN && Date.now() / 1000 <= Number(m.resolution_datetime)
    );
    const resolving = openIds.map((id) => byId[id]).filter(Boolean).filter(
      (m) => Number(m.state) === PRED_STATE_OPEN && Date.now() / 1000 > Number(m.resolution_datetime)
    );
    const resolved = resolvedIds.map((id) => byId[id]).filter(Boolean);

    setOpenMarkets(open.sort((a, b) => Number(a.resolution_datetime) - Number(b.resolution_datetime)));
    setResolvingMarkets(resolving);
    setResolvedMarkets(resolved);

    for (const m of resolved) {
      const winner = m.ranking[0];
      if (winner && !winnerNames[winner.toLowerCase()]) {
        getUserProfile(winner).then((p) => {
          if (p?.username) setWinnerNames((prev) => ({ ...prev, [winner.toLowerCase()]: String(p.username) }));
        });
      }
    }

    if (wallet) {
      const myIds = await getMarketsForPlayer(wallet.address);
      const myM = (await Promise.all(myIds.map(getMarket))).filter(Boolean) as Market[];
      setMyMarkets(myM.sort((a, b) => Number(b.id) - Number(a.id)));
    }
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchMarkets();
    const id = setInterval(fetchMarkets, 5000);
    getDailyMatchIds("predictions").then(async (ids) => {
      if (ids.length === 0) { setDailyMarkets([]); return; }
      const results = await Promise.all(ids.map((id) => getMarket(Number(id))));
      setDailyMarkets(results.filter((m): m is Market => m !== null));
    }).catch(() => setDailyMarkets([]));
    return () => clearInterval(id);
  }, [fetchMarkets]);

  async function handleCreate() {
    if (!wallet) throw new Error("No wallet");
    const resolutionTs = Math.floor(new Date(resolutionInput).getTime() / 1000);
    const nowTs = Math.floor(Date.now() / 1000);
    if (resolutionTs < nowTs + MIN_RESOLUTION_HOURS * 3600) {
      throw new Error("Resolution must be at least 24 hours from now");
    }
    if (resolutionTs > nowTs + MAX_RESOLUTION_HOURS * 3600) {
      throw new Error("Resolution must be at most 7 days from now");
    }
    const fn = marketType === MARKET_TYPE_BINARY ? createBinaryMarket : createNumericMarket;
    const { marketId } = await fn(question, resolutionTs, wallet);
    const m = await getMarket(marketId);
    if (m && Number(m.state) === 2) {
      setLastCreatedState({ rejected: true, reason: m.rejection_reason, marketId });
    } else {
      setLastCreatedState({ rejected: false, reason: "", marketId });
      await fetchMarkets();
      router.push(`/predictions/${marketId}`);
    }
  }

  const minDatetime = new Date(Date.now() + MIN_RESOLUTION_HOURS * 3600 * 1000 + 60000).toISOString().slice(0, 16);
  const maxDatetime = new Date(Date.now() + MAX_RESOLUTION_HOURS * 3600 * 1000).toISOString().slice(0, 16);
  const accent = "var(--game-predictions)";

  return (
    <AuthGuard>
      <AppShell>
        <div className="relative min-h-screen overflow-hidden">
          <PredBg />
          <main className="relative p-4 sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold">Predictions</h1>
                <p className="mt-0.5 text-sm" style={{ color: accent, fontFamily: "var(--font-mono)" }}>
                  Real-world outcomes · AI-resolved
                </p>
              </div>
              <Link href="/dashboard" className="text-[var(--accent-platform-hi)] hover:underline text-sm">← Arena</Link>
            </div>

            <section className="mb-10 rounded-xl border p-6" style={{ borderColor: "color-mix(in srgb, var(--game-predictions) 20%, var(--border))" }}>
              <h2 className="mb-4 text-lg font-semibold">Create New Market</h2>

              {lastCreatedState?.rejected && (
                <div className="mb-4 rounded-lg border border-red-700 bg-red-900/20 p-4">
                  <p className="text-red-400 font-semibold mb-1">Market rejected by AI verifier</p>
                  <p className="text-sm text-gray-300">{lastCreatedState.reason}</p>
                  <button
                    onClick={() => setLastCreatedState(null)}
                    className="mt-2 text-xs hover:underline"
                    style={{ color: accent }}
                  >
                    Refine and try again
                  </button>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Question ({question.length}/{MAX_QUESTION_CHARS})
                  </label>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION_CHARS))}
                    rows={3}
                    placeholder="Will Bitcoin exceed $100,000 USD by the resolution time?"
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-4 py-3 text-white placeholder-gray-500 focus:outline-none"
                  />
                  {marketType === MARKET_TYPE_NUMERIC &&
                    /price|rate|currency|exchange|now|today|current|live|spot|index|value of/i.test(question) && (
                    <div className="mt-2 rounded-lg border border-amber-600 bg-amber-900/20 p-3 text-sm">
                      <p className="font-semibold text-amber-400 mb-1">⚠️ Heads up — live data warning</p>
                      <p className="text-gray-300 mb-2">
                        Frequently-changing values may cause{" "}
                        <code className="text-amber-300 font-mono">MAJORITY_DISAGREE</code> on local Studio.
                        Stable historical values work more reliably.
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-sm text-gray-400 mb-2">Market type</p>
                  <div className="flex gap-3">
                    {([0, 1] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setMarketType(t)}
                        className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${marketType === t ? "border-[var(--game-predictions)]" : "border-[var(--border-strong)] text-gray-400 hover:border-gray-500"}`}
                        style={marketType === t ? { background: "rgba(45,212,191,0.1)", color: accent } : {}}
                      >
                        {t === MARKET_TYPE_BINARY ? "⚡ Binary (YES / NO)" : "# Numeric (value)"}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Resolution datetime (24h – 7 days from now)
                  </label>
                  <input
                    type="datetime-local"
                    value={resolutionInput}
                    min={minDatetime}
                    max={maxDatetime}
                    onChange={(e) => setResolutionInput(e.target.value)}
                    className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-3 py-2 text-white focus:outline-none"
                    style={{ fontFamily: "var(--font-mono)" }}
                  />
                </div>

                <TxButton
                  onClick={handleCreate}
                  disabled={question.trim().length < 10}
                  className="rounded-lg px-6 py-2 font-semibold hover:opacity-90 disabled:opacity-50 text-[#0a0a0f] bg-[var(--game-predictions)]"
                  pendingLabel="Creating market (AI verifying…)"
                  description="Creating prediction market"
                >
                  Create Market
                </TxButton>
              </div>
            </section>

            {/* Today's Official Markets */}
            {dailyMarkets === null ? (
              <section className="mb-10">
                <div className="mb-4 flex items-center gap-2">
                  <span style={{ color: accent, fontSize: "1rem" }}>&#9733;</span>
                  <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Today&apos;s Official Markets</h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-24 rounded-xl animate-pulse" style={{ background: "var(--bg-elevated)" }} />
                  ))}
                </div>
              </section>
            ) : dailyMarkets.length > 0 ? (
              <section className="mb-10">
                <div className="mb-1 flex items-center gap-2">
                  <span style={{ color: accent, fontSize: "1rem" }}>&#9733;</span>
                  <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Today&apos;s Official Markets</h2>
                  <span className="rounded-full px-2 py-0.5 text-xs font-mono" style={{ background: `color-mix(in srgb, ${accent} 15%, transparent)`, color: accent }}>{dailyMarkets.length}/5</span>
                </div>
                <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                  Generated daily by GenLayer validators · Refreshes 1pm UTC
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {dailyMarkets.map((m) => (
                    <div key={Number(m.id)} className="relative">
                      <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl z-10" style={{ backgroundColor: accent }} />
                      <div className="absolute top-1.5 right-2 z-10">
                        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${accent} 20%, transparent)`, color: accent, fontFamily: "var(--font-mono)" }}>Daily</span>
                      </div>
                      <MarketCard market={m} />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {openMarkets.length > 0 && (
              <section className="mb-8">
                <SectionHeader title="Active · Open" count={openMarkets.length} accent={accent} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {openMarkets.map((m) => <MarketCard key={Number(m.id)} market={m} />)}
                </div>
              </section>
            )}

            {resolvingMarkets.length > 0 && (
              <section className="mb-8">
                <SectionHeader title="Pending Resolution" count={resolvingMarkets.length} accent="var(--warning)" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {resolvingMarkets.map((m) => <MarketCard key={Number(m.id)} market={m} />)}
                </div>
              </section>
            )}

            {resolvedMarkets.length > 0 && (
              <section className="mb-8 opacity-75">
                <SectionHeader title="Resolved" count={resolvedMarkets.length} accent="var(--text-tertiary)" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {resolvedMarkets.map((m) => (
                    <MarketCard
                      key={Number(m.id)}
                      market={m}
                      username={m.ranking[0] ? winnerNames[m.ranking[0].toLowerCase()] : undefined}
                    />
                  ))}
                </div>
              </section>
            )}

            {openMarkets.length === 0 && resolvingMarkets.length === 0 && resolvedMarkets.length === 0 && (
              <p className="text-center py-8" style={{ color: "var(--text-tertiary)" }}>
                No markets yet — create the first one!
              </p>
            )}

            {myMarkets.length > 0 && (
              <section className="mt-4 mb-8">
                <SectionHeader title="My Predictions" count={myMarkets.length} accent={accent} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {myMarkets.map((m) => (
                    <MarketCard
                      key={Number(m.id)}
                      market={m}
                      username={m.ranking[0] ? winnerNames[m.ranking[0].toLowerCase()] : undefined}
                    />
                  ))}
                </div>
              </section>
            )}
          </main>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
