"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getOrCreateGuestWallet } from "@/lib/guest";

export default function SignInPage() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) {
      router.push("/dashboard");
    }
  }, [ready, authenticated, router]);

  function handleGuest() {
    getOrCreateGuestWallet();
    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold">Sign In</h1>
      <p className="text-gray-400">Choose how you want to play</p>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          onClick={login}
          disabled={!ready}
          className="rounded-lg bg-indigo-600 py-3 font-semibold hover:bg-indigo-500 disabled:opacity-50"
        >
          GitHub / Email / Wallet (Privy)
        </button>

        <div className="flex items-center gap-3">
          <hr className="flex-1 border-gray-700" />
          <span className="text-sm text-gray-500">or</span>
          <hr className="flex-1 border-gray-700" />
        </div>

        <button
          onClick={handleGuest}
          className="rounded-lg border border-gray-600 py-3 font-semibold hover:border-gray-400"
        >
          Continue as Guest
        </button>
      </div>

      <p className="text-xs text-gray-600">
        Guest mode stores a temporary wallet in your browser.
      </p>
    </main>
  );
}
