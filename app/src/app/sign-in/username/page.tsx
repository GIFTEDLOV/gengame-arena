"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registerUser, getUserProfile } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

export default function UsernamePage() {
  const router = useRouter();
  const { wallet, ready } = useActiveWallet();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (username.length < 3 || username.length > 20) {
      setError("Username must be between 3 and 20 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError("Username may only contain letters, numbers, and underscores.");
      return;
    }

    if (!wallet) {
      setError("No wallet found. Please sign in again.");
      return;
    }

    setLoading(true);
    try {
      await registerUser(username, wallet);
      // Confirm on-chain profile is visible before redirecting — prevents silent
      // loop back to this page if the read races the write.
      const profile = await getUserProfile(wallet.address);
      if (!profile) {
        setError("Registration succeeded but profile isn't readable yet. Please wait a moment and try again.");
        return;
      }
      router.push("/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("taken") ? "Username already taken." : `Registration failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold">Pick a username</h1>
      <p className="text-gray-400">This will be your on-chain identity.</p>

      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. prompt_wizard"
          maxLength={20}
          className="rounded-lg border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading || username.length < 3 || !ready}
          className="rounded-lg bg-indigo-600 py-3 font-semibold hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading ? "Registering on-chain… this can take a few seconds" : "Continue"}
        </button>
      </form>
    </main>
  );
}
