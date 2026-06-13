"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registerUser, getUserProfile } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";

async function pollForProfile(
  address: string,
  maxAttempts = 45,
  intervalMs = 2000
): Promise<{ username: string } | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const profile = await getUserProfile(address);
      if (profile && profile.username) return { username: String(profile.username) };
    } catch {
      // Profile not yet readable — keep polling
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  return null;
}

export default function UsernamePage() {
  const router = useRouter();
  const { wallet, ready } = useActiveWallet();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStatusMessage("");

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
      setStatusMessage("Finalizing on-chain…");
      const profile = await pollForProfile(wallet.address);
      if (profile) {
        router.push("/dashboard");
      } else {
        setError(
          "Your registration is on-chain but the profile read is still settling. " +
            "This is rare. Refresh the page in 30 seconds and you should be able to continue."
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("taken") ? "Username already taken." : `Registration failed: ${msg}`);
    } finally {
      setLoading(false);
      setStatusMessage("");
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
          disabled={loading}
          className="rounded-lg border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        {statusMessage && (
          <div className="flex flex-col items-center gap-2 py-1">
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              <p className="text-sm text-[var(--text-primary)]">{statusMessage}</p>
            </div>
            <p className="text-xs text-[var(--text-secondary)] text-center">
              This usually takes 30–60 seconds. We&apos;re waiting for GenLayer validators to reach consensus.
            </p>
          </div>
        )}
        <button
          type="submit"
          disabled={loading || username.length < 3 || !ready}
          className="rounded-lg bg-indigo-600 py-3 font-semibold hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading
            ? statusMessage
              ? "Waiting for profile…"
              : "Registering on-chain… this can take a few seconds"
            : "Continue"}
        </button>
      </form>
    </main>
  );
}
