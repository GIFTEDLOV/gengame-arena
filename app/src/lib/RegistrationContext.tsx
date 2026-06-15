"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { getUserProfile } from "@/lib/genlayer";
import { useActiveWallet } from "@/lib/useActiveWallet";
import RegisterModal from "@/components/RegisterModal";

interface RegistrationContextValue {
  isRegistered: boolean | null; // null = loading
  username: string | null;
  requireRegistration: () => Promise<boolean>;
  refreshUsername: () => Promise<void>;
}

const defaultValue: RegistrationContextValue = {
  isRegistered: null,
  username: null,
  requireRegistration: async () => true,
  refreshUsername: async () => {},
};

const RegistrationContext = createContext<RegistrationContextValue>(defaultValue);

export function useRegistration() {
  return useContext(RegistrationContext);
}

export function RegistrationProvider({ children }: { children: ReactNode }) {
  const { wallet, ready } = useActiveWallet();
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const pendingResolveRef = useRef<((value: boolean) => void) | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!wallet?.address) {
      setIsRegistered(null);
      setUsername(null);
      return;
    }
    setIsRegistered(null);
    getUserProfile(wallet.address)
      .then((profile) => {
        if (profile && profile.username) {
          setIsRegistered(true);
          setUsername(String(profile.username));
        } else {
          setIsRegistered(false);
          setUsername(null);
        }
      })
      .catch(() => {
        setIsRegistered(false);
        setUsername(null);
      });
  }, [wallet?.address, ready]);

  const refreshUsername = useCallback(async (): Promise<void> => {
    if (!wallet?.address) return;
    try {
      const profile = await getUserProfile(wallet.address);
      if (profile && profile.username) {
        setIsRegistered(true);
        setUsername(String(profile.username));
      }
    } catch {
      // silent
    }
  }, [wallet?.address]);

  const requireRegistration = useCallback((): Promise<boolean> => {
    if (isRegistered === true) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      pendingResolveRef.current = resolve;
      setShowModal(true);
    });
  }, [isRegistered]);

  function handleSuccess(newUsername: string) {
    setIsRegistered(true);
    setUsername(newUsername);
    setShowModal(false);
    pendingResolveRef.current?.(true);
    pendingResolveRef.current = null;
  }

  function handleClose() {
    setShowModal(false);
    pendingResolveRef.current?.(false);
    pendingResolveRef.current = null;
  }

  return (
    <RegistrationContext.Provider value={{ isRegistered, username, requireRegistration, refreshUsername }}>
      {children}
      {showModal && (
        <RegisterModal wallet={wallet} onSuccess={handleSuccess} onClose={handleClose} />
      )}
    </RegistrationContext.Provider>
  );
}
