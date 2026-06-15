"use client";

import AuthGuard from "@/components/AuthGuard";
import AppShell from "@/components/shell/AppShell";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  getUserProfile,
  getOpenMarkets,
  getOpenTriviaMatches,
  getOpenTitleMatches,
  getRecentMatches,
  STATE_WAITING,
} from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";
import { useRegistration } from "@/lib/RegistrationContext";
// Daily content is triggered by GitHub Actions cron (currently deferred) or manually via
// npx tsx scripts/cron-generate-daily.ts. Browser-side trigger removed because users
// don't have permission/funds to call it.
// import { getLastDailyGeneration, triggerAllDailyContent } from "@/lib/dailyContentTrigger";
import WalletStatusBar from "@/components/shell/WalletStatusBar";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const hasPrivy = !!privyAppId && privyAppId !== "your_privy_app_id_here";

/* ── Rank helper ─────────────────────────────────────────── */
function rankLabel(wins: number): string {
  if (wins >= 50) return "Legend";
  if (wins >= 20) return "Champion";
  if (wins >= 5)  return "Contender";
  return "Apprentice";
}

/* ── SVG background motifs ───────────────────────────────── */
function PromptWarsBg() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
      style={{ opacity: 0.08 }}
    >
      <defs>
        <pattern id="pw-tiles" width="56" height="56" patternUnits="userSpaceOnUse">
          <rect x="4" y="4" width="22" height="22" rx="3" fill="none" stroke="#fbbf24" strokeWidth="1.2" />
          <text x="15" y="21" fontFamily="Georgia,serif" fontSize="13" fontWeight="bold" textAnchor="middle" fill="#fbbf24">Q</text>
          <rect x="30" y="4" width="22" height="22" rx="3" fill="none" stroke="#fbbf24" strokeWidth="1.2" />
          <text x="41" y="21" fontFamily="Georgia,serif" fontSize="13" fontWeight="bold" textAnchor="middle" fill="#fbbf24">Z</text>
          <rect x="4" y="30" width="22" height="22" rx="3" fill="none" stroke="#fbbf24" strokeWidth="1.2" />
          <text x="15" y="47" fontFamily="Georgia,serif" fontSize="13" fontWeight="bold" textAnchor="middle" fill="#fbbf24">J</text>
          <rect x="30" y="30" width="22" height="22" rx="3" fill="none" stroke="#fbbf24" strokeWidth="1.2" />
          <text x="41" y="47" fontFamily="Georgia,serif" fontSize="13" fontWeight="bold" textAnchor="middle" fill="#fbbf24">X</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#pw-tiles)" />
    </svg>
  );
}

function PredictionsBg() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
      style={{ opacity: 0.1 }}
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 300 200"
    >
      {/* Vertical gridlines */}
      {[0, 60, 120, 180, 240, 300].map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2="200" stroke="#2dd4bf" strokeWidth="0.5" opacity="0.4" />
      ))}
      {/* Sparkline */}
      <polyline
        points="0,160 40,130 80,145 120,90 160,110 200,65 240,85 280,40 300,55"
        fill="none"
        stroke="#2dd4bf"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Data points */}
      {[[40,130],[120,90],[200,65],[280,40]].map(([x,y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="#2dd4bf" />
      ))}
    </svg>
  );
}

function TriviaBg() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
      preserveAspectRatio="xMaxYMax meet"
      viewBox="0 0 300 220"
    >
      {[20, 55, 90, 125, 160].map((r, i) => (
        <circle
          key={i}
          cx="300"
          cy="220"
          r={r}
          fill="none"
          stroke="#ec4899"
          strokeWidth="1"
          opacity={0.12 - i * 0.02}
        />
      ))}
    </svg>
  );
}

function TitleWarsBg() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
      style={{ opacity: 0.08 }}
    >
      <defs>
        <pattern id="tw-lines" width="300" height="24" patternUnits="userSpaceOnUse">
          <line x1="0" y1="23" x2="300" y2="23" stroke="#fef3c7" strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#tw-lines)" />
      {/* vertical margin rule */}
      <line x1="40" y1="0" x2="40" y2="100%" stroke="#fef3c7" strokeWidth="0.8" opacity="0.6" />
    </svg>
  );
}

/* ── Game card data ──────────────────────────────────────── */
interface GameDef {
  key: string;
  name: string;
  href: string;
  tagline: string;
  accent: string;
  Bg: () => React.ReactElement;
}

const GAMES: GameDef[] = [
  {
    key: "prompt-wars",
    name: "Prompt Wars",
    href: "/prompt-wars",
    tagline: "Write the best prompt for an AI-judged target text",
    accent: "var(--game-prompt-wars)",
    Bg: PromptWarsBg,
  },
  {
    key: "predictions",
    name: "Real-World Predictions",
    href: "/predictions",
    tagline: "Forecast outcomes — AI fetches web data and resolves",
    accent: "var(--game-predictions)",
    Bg: PredictionsBg,
  },
  {
    key: "trivia",
    name: "Trivia Royale",
    href: "/trivia-royale",
    tagline: "Battle-royale trivia with AI-generated questions",
    accent: "var(--game-trivia)",
    Bg: TriviaBg,
  },
  {
    key: "title-wars",
    name: "Title Wars",
    href: "/title-wars",
    tagline: "Submit the best title for a literary excerpt — AI judges",
    accent: "var(--game-title-wars)",
    Bg: TitleWarsBg,
  },
];

/* ── Game card component ─────────────────────────────────── */
function GameCard({
  game,
  count,
}: {
  game: GameDef;
  count: number | null;
}) {
  const { Bg } = game;
  const countStr =
    count === null
      ? "Loading…"
      : count === 0
      ? "No open matches — create one"
      : `${count} open match${count !== 1 ? "es" : ""}`;

  return (
    <Link href={game.href} className="block group" style={{ textDecoration: "none" }}>
      <div
        className="relative overflow-hidden h-full"
        style={{
          backgroundColor: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-card)",
          transition: `transform var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out), border-color var(--duration-normal)`,
          minHeight: 200,
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.transform = "translateY(-2px)";
          el.style.boxShadow = "var(--shadow-hover)";
          el.style.borderColor = "var(--border-strong)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.transform = "translateY(0)";
          el.style.boxShadow = "var(--shadow-card)";
          el.style.borderColor = "var(--border)";
        }}
      >
        {/* Thematic background motif */}
        <Bg />

        {/* Accent hairline at top */}
        <div
          className="absolute top-0 left-0 right-0 h-px transition-opacity duration-300"
          style={{ backgroundColor: game.accent, opacity: 0.6 }}
        />
        <div
          className="absolute top-0 left-0 right-0 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ backgroundColor: game.accent }}
        />

        {/* Glassmorphism overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundColor: "var(--bg-overlay)" }}
        />

        {/* Card content */}
        <div className="relative p-6 flex flex-col h-full">
          <div className="mb-auto">
            <p
              className="text-xs font-mono font-semibold mb-2 tracking-wider uppercase"
              style={{ color: game.accent }}
            >
              {game.name}
            </p>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {game.tagline}
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <p
              className="text-xs"
              style={{
                color: count === 0 ? "var(--text-disabled)" : "var(--text-tertiary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {countStr}
            </p>
            <span
              className="text-sm font-semibold group-hover:translate-x-1 transition-transform duration-200"
              style={{ color: game.accent }}
            >
              Play →
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ── Main dashboard ──────────────────────────────────────── */
type PrivySnapshot = {
  privyReady: boolean;
  authenticated: boolean;
  user: { github?: { username: string }; email?: { address: string } } | null;
};

function DashboardContentWithPrivy() {
  const { ready: privyReady, authenticated, user } = usePrivy() as {
    ready: boolean;
    authenticated: boolean;
    user: PrivySnapshot["user"];
  };
  return <DashboardContentBody privyReady={privyReady} authenticated={authenticated} user={user} />;
}

function DashboardContentBody({ privyReady, authenticated, user }: PrivySnapshot) {
  const { wallet } = useActiveWallet();
  const { username } = useRegistration();
  const [profile, setProfile] = useState<{ total_matches: number; total_wins: number } | null>(null);

  const [counts, setCounts] = useState<Record<string, number | null>>({
    "prompt-wars": null,
    predictions: null,
    trivia: null,
    "title-wars": null,
  });

  useEffect(() => {
    getOpenMarkets(100).then((ids) => setCounts((c) => ({ ...c, predictions: ids.length }))).catch(() => {});
    getOpenTriviaMatches(100).then((ids) => setCounts((c) => ({ ...c, trivia: ids.length }))).catch(() => {});
    getOpenTitleMatches(100).then((ids) => setCounts((c) => ({ ...c, "title-wars": ids.length }))).catch(() => {});
    getRecentMatches(50).then((ms) => {
      const open = ms.filter((m) => Number(m.state) === STATE_WAITING).length;
      setCounts((c) => ({ ...c, "prompt-wars": open }));
    }).catch(() => {});

  }, [wallet]);

  useEffect(() => {
    if (!wallet?.address) return;
    getUserProfile(wallet.address)
      .then((p) => {
        if (p) setProfile({ total_matches: Number(p.total_matches), total_wins: Number(p.total_wins) });
      })
      .catch(() => {});
  }, [wallet?.address]);

  const displayName = authenticated
    ? user?.github?.username
      ? `@${user.github.username}`
      : (username ?? "player")
    : username ?? null;

  if (!privyReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div style={{ color: "var(--text-tertiary)" }}>Loading…</div>
      </div>
    );
  }

  const wins = profile?.total_wins ?? 0;
  const matches = profile?.total_matches ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
      <WalletStatusBar />
      {/* Welcome header */}
      <div className="mb-10">
        <h1
          className="font-bold mb-2"
          style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}
        >
          {displayName ? `Welcome back, ${displayName}` : "Welcome to the Arena"}
        </h1>
        {matches > 0 && (
          <p style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
            {matches} match{matches !== 1 ? "es" : ""} · {wins} win{wins !== 1 ? "s" : ""} · Rank:{" "}
            <span style={{ color: "var(--accent-platform-hi)" }}>{rankLabel(wins)}</span>
          </p>
        )}
        {!profile && displayName && (
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
            No matches yet — pick a game below.
          </p>
        )}
      </div>

      {/* 2×2 game grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 mb-12">
        {GAMES.map((game) => (
          <GameCard key={game.key} game={game} count={counts[game.key] ?? null} />
        ))}
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--border)", marginBottom: "2rem" }} />

      {/* How judging works — brief explainer */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            icon: "🎮",
            label: "You play",
            text: "Write prompts, predict outcomes, answer trivia, or title literary excerpts",
          },
          {
            icon: "🤖",
            label: "AI validators judge",
            text: "Multiple AI validators reach consensus on-chain — no single point of bias",
          },
          {
            icon: "⛓️",
            label: "Truth is permanent",
            text: "Results are recorded immutably. Your on-chain stats update after every match.",
          },
        ].map(({ icon, label, text }) => (
          <div
            key={label}
            className="rounded-md p-5"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <div className="text-2xl mb-2">{icon}</div>
            <p
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
            >
              {label}
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
              {text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardContent() {
  if (!hasPrivy) return <DashboardContentBody privyReady={true} authenticated={false} user={null} />;
  return <DashboardContentWithPrivy />;
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <AppShell>
        <DashboardContent />
      </AppShell>
    </AuthGuard>
  );
}
