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

const MIN_RESOLUTION_HOURS = 24;
const MAX_RESOLUTION_HOURS = 168;
const MAX_QUESTION_CHARS = 300;

function defaultResolutionDatetime(): string {
  const d = new Date(Date.now() + 48 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 16); // "2025-01-15T12:00"
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

function MarketCard({ market, username }: { market: Market; username?: string }) {
  const state = Number(market.state);
  const resTs = Number(market.resolution_datetime);
  const isPastDeadline = Date.now() / 1000 > resTs;
  const typeBadge = Number(market.market_type) === MARKET_TYPE_BINARY ? "YES/NO" : "Numeric";

  return (
    <div className="rounded-xl border border-gray-700 p-4 hover:border-indigo-500 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium leading-snug flex-1">{market.question}</p>
        <span className="shrink-0 text-xs border border-gray-600 rounded px-1.5 py-0.5 text-gray-400">
          {typeBadge}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {state === PRED_STATE_OPEN && !isPastDeadline && (
            <>Resolves in {formatCountdown(resTs)}</>
          )}
          {state === PRED_STATE_OPEN && isPastDeadline && (
            <span className="text-amber-400">Awaiting resolution</span>
          )}
          {state === PRED_STATE_RESOLVED && (
            <span className="text-green-400">Resolved</span>
          )}
        </span>
        <span>{market.players.length} player{market.players.length !== 1 ? "s" : ""}</span>
      </div>
      {state === PRED_STATE_RESOLVED && market.ranking.length > 0 && (
        <p className="mt-1 text-xs text-gray-400">
          Winner: {username ?? market.ranking[0].slice(0, 10) + "…"}
        </p>
      )}
      <Link
        href={`/predictions/${Number(market.id)}`}
        className="mt-3 block text-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-500"
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

    // resolve winner usernames
    for (const m of resolved) {
      const winner = m.ranking[0];
      if (winner && !winnerNames[winner.toLowerCase()]) {
        getUserProfile(winner).then((p) => {
          if (p?.username) {
            setWinnerNames((prev) => ({ ...prev, [winner.toLowerCase()]: String(p.username) }));
          }
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

    // Check if the market was accepted or rejected
    const m = await getMarket(marketId);
    if (m && Number(m.state) === 2) {
      // REJECTED
      setLastCreatedState({ rejected: true, reason: m.rejection_reason, marketId });
    } else {
      setLastCreatedState({ rejected: false, reason: "", marketId });
      await fetchMarkets();
      router.push(`/predictions/${marketId}`);
    }
  }

  const minDatetime = new Date(Date.now() + MIN_RESOLUTION_HOURS * 3600 * 1000 + 60000)
    .toISOString().slice(0, 16);
  const maxDatetime = new Date(Date.now() + MAX_RESOLUTION_HOURS * 3600 * 1000)
    .toISOString().slice(0, 16);

  return (
    <AuthGuard>
      <AppShell>
      <main className="min-h-screen p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold">Predictions</h1>
          <Link href="/dashboard" className="text-indigo-400 hover:underline text-sm">← Arena</Link>
        </div>

        {/* Create Market */}
        <section className="mb-10 rounded-xl border border-gray-700 p-6">
          <h2 className="mb-4 text-lg font-semibold">Create New Market</h2>

          {lastCreatedState?.rejected && (
            <div className="mb-4 rounded-lg border border-red-700 bg-red-900/20 p-4">
              <p className="text-red-400 font-semibold mb-1">Market rejected by AI verifier</p>
              <p className="text-sm text-gray-300">{lastCreatedState.reason}</p>
              <button
                onClick={() => setLastCreatedState(null)}
                className="mt-2 text-xs text-indigo-400 hover:underline"
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
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              {marketType === MARKET_TYPE_NUMERIC &&
                /price|rate|currency|exchange|now|today|current|live|spot|index|value of/i.test(question) && (
                <div className="mt-2 rounded-lg border border-amber-600 bg-amber-900/20 p-3 text-sm">
                  <p className="font-semibold text-amber-400 mb-1">⚠️ Heads up — live data warning</p>
                  <p className="text-gray-300 mb-2">
                    Frequently-changing values (like spot prices or current rates) may fail to resolve on
                    local Studio because each simulated validator must independently fetch live data and
                    reach consensus. Network hiccups can cause a{" "}
                    <code className="text-amber-300">MAJORITY_DISAGREE</code> failure.
                  </p>
                  <p className="text-gray-400 font-medium mb-1">More reliable numeric questions reference stable values:</p>
                  <ul className="list-disc list-inside text-gray-400 space-y-0.5">
                    <li>Totals or supply caps (e.g. "What is the maximum supply of Bitcoin")</li>
                    <li>Historical facts (e.g. "What was the closing S&amp;P 500 on January 2, 2025")</li>
                    <li>Fixed protocol parameters</li>
                  </ul>
                  <p className="mt-2 text-gray-500 text-xs">
                    This limitation does not apply on GenLayer mainnet, where many distributed validators
                    reach consensus reliably.
                  </p>
                </div>
              )}
            </div>

            <div>
              <p className="text-sm text-gray-400 mb-2">Market type</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setMarketType(0)}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium ${marketType === 0 ? "border-indigo-500 bg-indigo-900/30 text-indigo-300" : "border-gray-600 text-gray-400 hover:border-gray-500"}`}
                >
                  Binary (YES / NO)
                </button>
                <button
                  onClick={() => setMarketType(1)}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium ${marketType === 1 ? "border-indigo-500 bg-indigo-900/30 text-indigo-300" : "border-gray-600 text-gray-400 hover:border-gray-500"}`}
                >
                  Numeric (specific value)
                </button>
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
                className="rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <TxButton
              onClick={handleCreate}
              disabled={question.trim().length < 10}
              className="rounded-lg bg-indigo-600 px-6 py-2 font-semibold hover:bg-indigo-500 disabled:opacity-50"
              pendingLabel="Creating market (AI verifying…)"
              description="Creating prediction market"
            >
              Create Market
            </TxButton>
          </div>
        </section>

        {/* Open Markets */}
        {openMarkets.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">Open Markets</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {openMarkets.map((m) => (
                <MarketCard key={Number(m.id)} market={m} />
              ))}
            </div>
          </section>
        )}

        {/* Resolving Soon */}
        {resolvingMarkets.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold text-amber-400">Ready to Resolve</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {resolvingMarkets.map((m) => (
                <MarketCard key={Number(m.id)} market={m} />
              ))}
            </div>
          </section>
        )}

        {/* Resolved */}
        {resolvedMarkets.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">Resolved</h2>
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
          <p className="text-gray-500 text-center py-8">No markets yet — create the first one!</p>
        )}

        {/* My Predictions */}
        {myMarkets.length > 0 && (
          <section className="mt-4 mb-8">
            <h2 className="mb-4 text-lg font-semibold">My Predictions</h2>
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
      </AppShell>
    </AuthGuard>
  );
}
