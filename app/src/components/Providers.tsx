"use client";

import { useEffect } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { SettlingProvider } from "@/lib/settling";

function ConsoleEasterEgg() {
  useEffect(() => {
    if (typeof window !== "undefined" && process.env.NODE_ENV === "production") {
      console.log(
        "%cGengame Arena 🎮",
        "color: #7c3aed; font-size: 32px; font-weight: bold; padding: 8px 0;"
      );
      console.log(
        "%cThe chain is the truth — the browser is just the view.",
        "color: #a78bfa; font-size: 14px; font-style: italic;"
      );
      console.log(
        "%cAll game logic runs as intelligent contracts on GenLayer. AI judges every match via on-chain validator consensus. Cheating the browser doesn't cheat the chain.",
        "color: #9ca3af; font-size: 12px; line-height: 1.5;"
      );
      console.log(
        "%cBuilt by @GIFTEDLOV · Learn more about GenLayer: https://genlayer.com",
        "color: #6b7280; font-size: 11px;"
      );
    }
  }, []);
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  const inner = (
    <SettlingProvider>
      <ConsoleEasterEgg />
      {children}
    </SettlingProvider>
  );

  if (!appId || appId === "your_privy_app_id_here") {
    return inner;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["github", "email", "wallet"],
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
        },
        appearance: {
          theme: "dark",
        },
      }}
    >
      {inner}
    </PrivyProvider>
  );
}
