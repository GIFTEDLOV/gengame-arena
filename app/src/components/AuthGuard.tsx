'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const hasPrivy = !!privyAppId && privyAppId !== 'your_privy_app_id_here';

function AuthGuardWithPrivy({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authenticated) {
      const hasGuestSession =
        typeof window !== 'undefined' &&
        !!localStorage.getItem('gengame_guest_key');
      if (!hasGuestSession) {
        router.push('/sign-in');
      }
    }
  }, [ready, authenticated, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  const hasGuestSession =
    typeof window !== 'undefined' &&
    !!localStorage.getItem('gengame_guest_key');

  if (!authenticated && !hasGuestSession) return null;
  return <>{children}</>;
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  if (!hasPrivy) {
    return <>{children}</>;
  }
  return <AuthGuardWithPrivy>{children}</AuthGuardWithPrivy>;
}
