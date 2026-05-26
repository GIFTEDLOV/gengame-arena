"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";

export default function LandingPage() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  function handlePlay() {
    if (authenticated) {
      router.push("/dashboard");
    } else {
      router.push("/sign-in");
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-5xl font-bold tracking-tight">Gengame Arena</h1>
      <p className="max-w-md text-center text-gray-400">
        Competitive mini-games adjudicated by AI consensus on GenLayer.
        No cheating. No disputes. Just on-chain results.
      </p>
      <div className="flex gap-4">
        <button
          onClick={handlePlay}
          disabled={!ready}
          className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold hover:bg-indigo-500 disabled:opacity-50"
        >
          Play Now
        </button>
        <button
          onClick={() => router.push("/sign-in")}
          className="rounded-lg border border-gray-600 px-6 py-3 font-semibold hover:border-gray-400"
        >
          Sign In
        </button>
      </div>
    </main>
  );
}
