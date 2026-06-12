import { useRef, useEffect, useState } from "react";
import { useActiveWallet } from "./useActiveWallet";

interface AutoResolveParams {
  /** Unix timestamp of the deadline; 0 = no deadline configured yet */
  deadlineUnix: number;
  /** Whether the match is currently in a state that needs resolving */
  isActive: boolean;
  /** The contract write function to call when deadline expires */
  resolveFn: () => Promise<unknown>;
  /** How often to check (ms). Default 5000. */
  intervalMs?: number;
}

/**
 * Fires resolveFn once when the deadline has expired and the match is active.
 * First connected browser wins; others' calls no-op gracefully on the contract.
 * On error, backs off 30 s before retrying.
 * Returns { resolving } — true while the transaction is in flight.
 */
export function useAutoResolve({
  deadlineUnix,
  isActive,
  resolveFn,
  intervalMs = 5000,
}: AutoResolveParams): { resolving: boolean } {
  const { wallet } = useActiveWallet();
  const triggered = useRef(false);
  const [resolving, setResolving] = useState(false);

  // Keep resolveFn stable across renders without adding it to the dep array
  const resolveFnRef = useRef(resolveFn);
  resolveFnRef.current = resolveFn;

  useEffect(() => {
    if (!isActive || !wallet || deadlineUnix === 0) return;

    const checkAndResolve = async () => {
      if (triggered.current) return;
      const now = Math.floor(Date.now() / 1000);
      if (now < deadlineUnix) return;

      triggered.current = true;
      setResolving(true);
      try {
        await resolveFnRef.current();
      } catch (err) {
        // Expected when another player already resolved the match
        console.debug("auto-resolve:", err);
        setTimeout(() => {
          triggered.current = false;
          setResolving(false);
        }, 30_000);
        return;
      }
      setResolving(false);
    };

    checkAndResolve();
    const id = setInterval(checkAndResolve, intervalMs);
    return () => clearInterval(id);
  }, [isActive, wallet, deadlineUnix, intervalMs]);

  return { resolving };
}
