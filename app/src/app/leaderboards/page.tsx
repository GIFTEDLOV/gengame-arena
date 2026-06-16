"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/shell/AppShell";
import { useActiveWallet } from "@/lib/useActiveWallet";
import {
  getOverallLeaderboard,
  getPromptWarsLeaderboard,
  getPredictionsLeaderboard,
  getTriviaRoyaleLeaderboard,
  getTitleWarsLeaderboard,
  type LeaderboardEntry,
} from "@/lib/leaderboards";

/* ── Tab config ──────────────────────────────────────────────────────────── */

type TabId = "overall" | "prompt-wars" | "predictions" | "trivia" | "title-wars";

interface TabConfig {
  id: TabId;
  label: string;
  accent: string;
  href: string;
  fetcher: (limit?: number) => Promise<LeaderboardEntry[]>;
}

const TABS: TabConfig[] = [
  {
    id: "overall",
    label: "Overall",
    accent: "var(--accent-platform-hi)",
    href: "/dashboard",
    fetcher: getOverallLeaderboard,
  },
  {
    id: "prompt-wars",
    label: "Prompt Wars",
    accent: "var(--game-prompt-wars)",
    href: "/prompt-wars",
    fetcher: getPromptWarsLeaderboard,
  },
  {
    id: "predictions",
    label: "Predictions",
    accent: "var(--game-predictions)",
    href: "/predictions",
    fetcher: getPredictionsLeaderboard,
  },
  {
    id: "trivia",
    label: "Trivia Royale",
    accent: "var(--game-trivia)",
    href: "/trivia-royale",
    fetcher: getTriviaRoyaleLeaderboard,
  },
  {
    id: "title-wars",
    label: "Title Wars",
    accent: "var(--game-title-wars)",
    href: "/title-wars",
    fetcher: getTitleWarsLeaderboard,
  },
];

/* ── Background ──────────────────────────────────────────────────────────── */

function LeaderboardsBg() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {/* Violet ambient glow top-left */}
      <div
        style={{
          position: "absolute",
          top: "-10%",
          left: "-10%",
          width: "55%",
          height: "55%",
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse, color-mix(in srgb, var(--accent-platform) 14%, transparent) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      {/* Dot-grid overlay */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 w-full h-full"
        style={{ opacity: 0.06 }}
      >
        <defs>
          <pattern id="lb-dots" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.5" fill="var(--accent-platform-hi)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lb-dots)" />
      </svg>
    </div>
  );
}

/* ── Medal rank ──────────────────────────────────────────────────────────── */

const MEDAL_COLORS = ["#F59E0B", "#9CA3AF", "#92400E"];
const MEDAL_SYMBOLS = ["①", "②", "③"];

function RankCell({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <span
        className="text-sm font-bold"
        style={{ color: MEDAL_COLORS[rank - 1], fontFamily: "var(--font-mono)" }}
        title={["Gold", "Silver", "Bronze"][rank - 1]}
      >
        {MEDAL_SYMBOLS[rank - 1]}
      </span>
    );
  }
  return (
    <span
      className="text-sm tabular-nums"
      style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
    >
      {rank}
    </span>
  );
}

/* ── Skeleton row ────────────────────────────────────────────────────────── */

function SkeletonRow({ index }: { index: number }) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-xl animate-pulse"
      style={{ background: "rgba(255,255,255,0.03)" }}
    >
      <div className="w-6 h-4 rounded" style={{ background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
      <div
        className="h-3 rounded"
        style={{
          background: "rgba(255,255,255,0.08)",
          width: `${55 + ((index * 17) % 30)}%`,
        }}
      />
      <div className="ml-auto flex gap-6 shrink-0">
        <div className="w-8 h-3 rounded" style={{ background: "rgba(255,255,255,0.08)" }} />
        <div className="w-10 h-3 rounded hidden sm:block" style={{ background: "rgba(255,255,255,0.08)" }} />
        <div className="w-12 h-3 rounded hidden md:block" style={{ background: "rgba(255,255,255,0.08)" }} />
      </div>
    </div>
  );
}

/* ── Desktop table row ───────────────────────────────────────────────────── */

function TableRow({
  entry,
  accent,
  isMe,
}: {
  entry: LeaderboardEntry;
  accent: string;
  isMe: boolean;
}) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-xl transition-colors"
      style={{
        background: isMe
          ? `color-mix(in srgb, ${accent} 10%, rgba(255,255,255,0.03))`
          : "rgba(255,255,255,0.03)",
        border: isMe ? `1px solid color-mix(in srgb, ${accent} 25%, transparent)` : "1px solid transparent",
      }}
    >
      {/* Rank */}
      <div className="w-8 text-center shrink-0">
        <RankCell rank={entry.rank} />
      </div>

      {/* Username / address */}
      <div className="flex-1 min-w-0">
        <span
          className="text-sm font-medium truncate block"
          style={{
            color: isMe ? accent : "var(--text-primary)",
            fontFamily: entry.username.startsWith("0x") ? "var(--font-mono)" : undefined,
          }}
        >
          {isMe ? "★ " : ""}
          {entry.username.startsWith("0x") ? entry.username : `@${entry.username}`}
        </span>
      </div>

      {/* Wins */}
      <div className="w-14 text-right shrink-0">
        <span
          className="text-sm font-semibold tabular-nums"
          style={{ color: accent, fontFamily: "var(--font-mono)" }}
        >
          {entry.wins}
        </span>
      </div>

      {/* Matches */}
      <div className="w-16 text-right shrink-0 hidden sm:block">
        <span className="text-sm tabular-nums" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
          {entry.matches}
        </span>
      </div>

      {/* Win Rate */}
      <div className="w-16 text-right shrink-0 hidden md:block">
        <span className="text-sm tabular-nums" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
          {(entry.winRate * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

/* ── Mobile card ─────────────────────────────────────────────────────────── */

function MobileCard({
  entry,
  accent,
  isMe,
}: {
  entry: LeaderboardEntry;
  accent: string;
  isMe: boolean;
}) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        background: isMe
          ? `color-mix(in srgb, ${accent} 10%, rgba(255,255,255,0.03))`
          : "rgba(255,255,255,0.03)",
        border: isMe ? `1px solid color-mix(in srgb, ${accent} 25%, transparent)` : "1px solid transparent",
      }}
    >
      <div className="flex items-center gap-3">
        <div className="w-8 text-center shrink-0">
          <RankCell rank={entry.rank} />
        </div>
        <span
          className="flex-1 text-sm font-medium truncate"
          style={{
            color: isMe ? accent : "var(--text-primary)",
            fontFamily: entry.username.startsWith("0x") ? "var(--font-mono)" : undefined,
          }}
        >
          {isMe ? "★ " : ""}
          {entry.username.startsWith("0x") ? entry.username : `@${entry.username}`}
        </span>
        <span
          className="text-sm font-semibold tabular-nums shrink-0"
          style={{ color: accent, fontFamily: "var(--font-mono)" }}
        >
          {entry.wins}W
        </span>
      </div>
      <div className="flex gap-4 mt-1 pl-11">
        <span className="text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {entry.matches} matches
        </span>
        <span className="text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {(entry.winRate * 100).toFixed(0)}% win rate
        </span>
      </div>
    </div>
  );
}

/* ── Leaderboard table header ────────────────────────────────────────────── */

function TableHeader() {
  return (
    <div className="flex items-center gap-4 px-4 py-2 mb-1">
      <div className="w-8 text-center shrink-0">
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>#</span>
      </div>
      <div className="flex-1">
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>Player</span>
      </div>
      <div className="w-14 text-right shrink-0">
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>Wins</span>
      </div>
      <div className="w-16 text-right shrink-0 hidden sm:block">
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>Matches</span>
      </div>
      <div className="w-16 text-right shrink-0 hidden md:block">
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>Win %</span>
      </div>
    </div>
  );
}

/* ── Main page component ─────────────────────────────────────────────────── */

function LeaderboardsPage() {
  const { wallet } = useActiveWallet();
  const myAddress = wallet?.address?.toLowerCase();

  const [activeTab, setActiveTab] = useState<TabId>("overall");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(false);

  const tab = TABS.find((t) => t.id === activeTab)!;

  const loadTab = useCallback(
    async (id: TabId) => {
      const t = TABS.find((x) => x.id === id)!;
      setLoading(true);
      setError(null);
      try {
        const data = await t.fetcher(20);
        setEntries(data);
        hasDataRef.current = true;
      } catch (e) {
        if (!hasDataRef.current) {
          setError(e instanceof Error ? e.message : "Failed to load leaderboard.");
          setEntries([]);
        }
        // If we already have data, preserve it — don't clear on transient failures
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadTab(activeTab);
  }, [activeTab, loadTab]);

  function handleTabClick(id: TabId) {
    if (id === activeTab) return;
    setActiveTab(id);
  }

  return (
    <div className="relative min-h-screen" style={{ background: "var(--bg-base)" }}>
      <LeaderboardsBg />

      <div className="relative z-10 mx-auto max-w-3xl px-4 pb-16 pt-10">
        {/* Page heading */}
        <div className="mb-8">
          <h1 className="font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>
            Leaderboards
          </h1>
          <p className="mt-1" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            Top players ranked by wins across the arena
          </p>
        </div>

        {/* Tab bar */}
        <div
          className="mb-8 flex gap-1 overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
          role="tablist"
          aria-label="Leaderboard tabs"
        >
          {TABS.map((t) => {
            const isActive = t.id === activeTab;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => handleTabClick(t.id)}
                className="relative shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  background: isActive
                    ? `color-mix(in srgb, ${t.accent} 15%, rgba(255,255,255,0.04))`
                    : "transparent",
                  color: isActive ? t.accent : "var(--text-secondary)",
                  border: isActive
                    ? `1px solid color-mix(in srgb, ${t.accent} 30%, transparent)`
                    : "1px solid transparent",
                }}
              >
                {t.label}
                {isActive && (
                  <span
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full"
                    style={{
                      width: "60%",
                      background: t.accent,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div role="tabpanel" aria-label={`${tab.label} leaderboard`}>
          {/* Loading skeleton */}
          {loading && (
            <div className="flex flex-col gap-2">
              <TableHeader />
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} index={i} />
              ))}
            </div>
          )}

          {/* Error state */}
          {!loading && error && (
            <div
              className="rounded-xl px-6 py-10 text-center"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
            >
              <p className="mb-4" style={{ color: "var(--text-secondary)" }}>
                Couldn&apos;t load this leaderboard.
              </p>
              <button
                onClick={() => loadTab(activeTab)}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
                style={{
                  background: `color-mix(in srgb, ${tab.accent} 15%, transparent)`,
                  color: tab.accent,
                  border: `1px solid color-mix(in srgb, ${tab.accent} 30%, transparent)`,
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && entries.length === 0 && (
            <div
              className="rounded-xl px-6 py-12 text-center"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
            >
              <div className="mb-2 text-3xl" aria-hidden>
                🏆
              </div>
              <p className="mb-1 font-medium" style={{ color: "var(--text-primary)" }}>
                No matches played yet
              </p>
              <p className="mb-6 text-sm" style={{ color: "var(--text-secondary)" }}>
                {activeTab === "overall"
                  ? "Start playing to claim your spot on the leaderboard."
                  : `Be the first to compete in ${tab.label}.`}
              </p>
              <a
                href={tab.href}
                className="inline-block rounded-lg px-5 py-2 text-sm font-semibold transition-opacity hover:opacity-80"
                style={{
                  background: tab.accent,
                  color: activeTab === "title-wars" ? "#0a0a0f" : "#0a0a0f",
                }}
              >
                Play {activeTab === "overall" ? "now" : tab.label} →
              </a>
            </div>
          )}

          {/* Leaderboard table — desktop (≥640px) */}
          {!loading && !error && entries.length > 0 && (
            <>
              {/* Desktop view */}
              <div className="hidden sm:flex flex-col gap-2">
                <TableHeader />
                {entries.map((entry) => (
                  <TableRow
                    key={entry.address}
                    entry={entry}
                    accent={tab.accent}
                    isMe={!!myAddress && entry.address.toLowerCase() === myAddress}
                  />
                ))}
              </div>

              {/* Mobile card view */}
              <div className="flex sm:hidden flex-col gap-2">
                {entries.map((entry) => (
                  <MobileCard
                    key={entry.address}
                    entry={entry}
                    accent={tab.accent}
                    isMe={!!myAddress && entry.address.toLowerCase() === myAddress}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer note */}
        {!loading && !error && entries.length > 0 && (
          <p className="mt-6 text-center" style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
            Showing top {entries.length} · Refreshes every 60 seconds
          </p>
        )}
      </div>
    </div>
  );
}

export default function LeaderboardsRoute() {
  return (
    <AuthGuard>
      <AppShell>
        <LeaderboardsPage />
      </AppShell>
    </AuthGuard>
  );
}
