"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const hasPrivy = !!privyAppId && privyAppId !== "your_privy_app_id_here";

function AuthGuardWithPrivy({ children }: { children: React.ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { usePrivy } = require("@privy-io/react-auth");
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authenticated) {
      router.push("/sign-in");
    }
  }, [ready, authenticated, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (!authenticated) return null;
  return <>{children}</>;
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  if (!hasPrivy) {
    // No Privy configured — allow access (guest mode)
    return <>{children}</>;
  }
  return <AuthGuardWithPrivy>{children}</AuthGuardWithPrivy>;
}
