"use client";

import AuthGuard from "@/components/AuthGuard";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getUserProfile, getOpenMarkets, getOpenTriviaMatches, getOpenTitleMatches } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

const GAME_STATIC = [
  { name: "Prompt Wars", href: "/prompt-wars", description: "Compete with AI prompt engineering" },
];

export default function DashboardPage() {
  const { ready: privyReady, authenticated, user } = usePrivy();
  const { wallet, ready: walletReady } = useActiveWallet();
  const router = useRouter();
  const [guestUsername, setGuestUsername] = useState<string | null>(null);
  const [loadingGuest, setLoadingGuest] = useState(false);
  const [openMarketCount, setOpenMarketCount] = useState<number | null>(null);
  const [openTriviaCount, setOpenTriviaCount] = useState<number | null>(null);
  const [openTitleCount, setOpenTitleCount] = useState<number | null>(null);

  useEffect(() => {
    getOpenMarkets(100).then((ids) => setOpenMarketCount(ids.length)).catch(() => {});
    getOpenTriviaMatches(100).then((ids) => setOpenTriviaCount(ids.length)).catch(() => {});
    getOpenTitleMatches(100).then((ids) => setOpenTitleCount(ids.length)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!walletReady || authenticated) return;
    if (!wallet) return;
    setLoadingGuest(true);
    getUserProfile(wallet.address)
      .then((profile) => {
        if (!profile) {
          router.push("/sign-in/username");
        } else {
          setGuestUsername(profile.username as string);
        }
      })
      .catch(() => {
        router.push("/sign-in/username");
      })
      .finally(() => setLoadingGuest(false));
  }, [walletReady, authenticated, wallet, router]);

  const displayName = authenticated
    ? user?.github?.username
      ? `@${user.github.username}`
      : "player"
    : guestUsername ?? null;

  if (!privyReady || loadingGuest) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  const predictionsHint =
    openMarketCount === null
      ? "Predict AI-judged real-world outcomes"
      : openMarketCount === 0
      ? "No open markets yet — create one"
      : `${openMarketCount} open market${openMarketCount !== 1 ? "s" : ""}`;

  const triviaHint =
    openTriviaCount === null
      ? "AI-verified trivia battle royale"
      : openTriviaCount === 0
      ? "No open matches yet — create one"
      : `${openTriviaCount} open match${openTriviaCount !== 1 ? "es" : ""}`;

  const titleHint =
    openTitleCount === null
      ? "Submit the best title for AI-judged literary excerpts"
      : openTitleCount === 0
      ? "No open matches yet — create one"
      : `${openTitleCount} open match${openTitleCount !== 1 ? "es" : ""}`;

  return (
    <AuthGuard>
      <main className="min-h-screen p-8">
        <h1 className="mb-2 text-3xl font-bold">Arena</h1>
        <p className="mb-8 text-gray-400">
          {displayName ? `Welcome, ${displayName}` : "Welcome, player"}
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/predictions"
            className="rounded-xl border border-gray-700 p-6 hover:border-indigo-500 hover:bg-gray-900 transition-colors"
          >
            <h2 className="mb-1 text-lg font-semibold">Predictions</h2>
            <p className="text-sm text-gray-400">{predictionsHint}</p>
          </Link>

          <Link
            href="/trivia-royale"
            className="rounded-xl border border-gray-700 p-6 hover:border-indigo-500 hover:bg-gray-900 transition-colors"
          >
            <h2 className="mb-1 text-lg font-semibold">Trivia Royale</h2>
            <p className="text-sm text-gray-400">{triviaHint}</p>
          </Link>

          <Link
            href="/title-wars"
            className="rounded-xl border border-gray-700 p-6 hover:border-indigo-500 hover:bg-gray-900 transition-colors"
          >
            <h2 className="mb-1 text-lg font-semibold">Title Wars</h2>
            <p className="text-sm text-gray-400">{titleHint}</p>
          </Link>

          {GAME_STATIC.map((game) => (
            <Link
              key={game.href}
              href={game.href}
              className="rounded-xl border border-gray-700 p-6 hover:border-indigo-500 hover:bg-gray-900 transition-colors"
            >
              <h2 className="mb-1 text-lg font-semibold">{game.name}</h2>
              <p className="text-sm text-gray-400">{game.description}</p>
            </Link>
          ))}
        </div>
      </main>
    </AuthGuard>
  );
}
