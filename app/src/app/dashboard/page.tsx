"use client";

import AuthGuard from "@/components/AuthGuard";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getUserProfile } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

const GAMES = [
  { name: "Trivia Royale", href: "/trivia-royale", description: "AI-verified trivia battles" },
  { name: "Prompt Wars", href: "/prompt-wars", description: "Compete with AI prompt engineering" },
  { name: "Predictions", href: "/predictions", description: "Predict AI-judged real-world outcomes" },
  { name: "Title Wars", href: "/title-wars", description: "Best headline wins" },
];

export default function DashboardPage() {
  const { ready: privyReady, authenticated, user } = usePrivy();
  const { wallet, ready: walletReady } = useActiveWallet();
  const router = useRouter();
  const [guestUsername, setGuestUsername] = useState<string | null>(null);
  const [loadingGuest, setLoadingGuest] = useState(false);

  useEffect(() => {
    // Privy users: we show their GitHub handle; no on-chain lookup needed.
    if (!walletReady || authenticated) return;

    // Guest users: look up their on-chain username by session key address.
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

  return (
    <AuthGuard>
      <main className="min-h-screen p-8">
        <h1 className="mb-2 text-3xl font-bold">Arena</h1>
        <p className="mb-8 text-gray-400">
          {displayName ? `Welcome, ${displayName}` : "Welcome, player"}
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GAMES.map((game) => (
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
