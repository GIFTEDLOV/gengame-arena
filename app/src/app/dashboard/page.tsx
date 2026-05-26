"use client";

import AuthGuard from "@/components/AuthGuard";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

const GAMES = [
  { name: "Trivia Royale", href: "/trivia-royale", description: "AI-verified trivia battles" },
  { name: "Prompt Wars", href: "/prompt-wars", description: "Compete with AI prompt engineering" },
  { name: "Predictions", href: "/predictions", description: "Bet on AI-adjudicated outcomes" },
  { name: "Title Wars", href: "/title-wars", description: "Best headline wins" },
];

export default function DashboardPage() {
  const { user } = usePrivy();

  return (
    <AuthGuard>
      <main className="min-h-screen p-8">
        <h1 className="mb-2 text-3xl font-bold">Arena</h1>
        <p className="mb-8 text-gray-400">
          {user?.github?.username
            ? `Welcome, @${user.github.username}`
            : "Welcome, player"}
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
