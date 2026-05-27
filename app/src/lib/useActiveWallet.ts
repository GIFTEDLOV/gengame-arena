"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const GUEST_KEY = "gengame_guest_key";

export type ActiveWallet = {
  address: `0x${string}`;
  signMessage: (msg: string) => Promise<`0x${string}`>;
  // tx is a viem TransactionRequest — the underlying account handles serialization
  signTransaction: (tx: unknown) => Promise<`0x${string}`>;
  source: "privy" | "guest";
} | null;

function sessionKey(userId: string): string {
  return `gengame_privy_session_${userId}`;
}

function buildWallet(pk: `0x${string}`, source: "privy" | "guest"): NonNullable<ActiveWallet> {
  const acct = privateKeyToAccount(pk);
  return {
    address: acct.address,
    signMessage: (msg) => acct.signMessage({ message: msg }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signTransaction: (tx) => acct.signTransaction(tx as any),
    source,
  };
}

export function useActiveWallet(): { wallet: ActiveWallet; ready: boolean } {
  const { ready: privyReady, authenticated, user } = usePrivy();
  const [wallet, setWallet] = useState<ActiveWallet>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!privyReady) return;

    if (authenticated && user?.id) {
      // Privy user — get or create a per-user session signing key
      const key = sessionKey(user.id);
      let pk = localStorage.getItem(key) as `0x${string}` | null;
      if (!pk) {
        pk = generatePrivateKey();
        localStorage.setItem(key, pk);
      }
      setWallet(buildWallet(pk, "privy"));
      setReady(true);
      return;
    }

    // Guest mode — use the shared guest key created at sign-in
    const guestPk = localStorage.getItem(GUEST_KEY) as `0x${string}` | null;
    setWallet(guestPk ? buildWallet(guestPk, "guest") : null);
    setReady(true);
  }, [privyReady, authenticated, user?.id]);

  return { wallet, ready };
}
