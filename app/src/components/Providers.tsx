"use client";

import { PrivyProvider } from "@privy-io/react-auth";

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // Without a real Privy app ID the SDK hard-errors. Skip the provider
  // so guest mode still works; auth features are simply unavailable.
  if (!appId || appId === "your_privy_app_id_here") {
    return <>{children}</>;
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
      {children}
    </PrivyProvider>
  );
}
