"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useActiveWallet } from "@/lib/useActiveWallet";
import { useRegistration } from "@/lib/RegistrationContext";
import EditUsernameModal from "@/components/EditUsernameModal";
import Card from "@/components/shell/Card";

const RPC_URL = process.env.NEXT_PUBLIC_GENLAYER_RPC ?? "https://rpc-bradbury.genlayer.com";
const FAUCET_URL = "https://testnet-faucet.genlayer.foundation";
const EXPLORER_BASE = "https://explorer-bradbury.genlayer.com/address/";
const CACHE_TTL = 30_000;

async function fetchBalance(address: string): Promise<bigint> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return BigInt(data.result);
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatGen(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(1);
}

export default function WalletStatusBar() {
  const { wallet, ready } = useActiveWallet();
  const { isRegistered, username, openRegistrationModal, refreshUsername } = useRegistration();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [fetching, setFetching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [faucetTip, setFaucetTip] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const lastFetch = useRef<number>(0);
  const address = wallet?.address;

  const refreshBalance = useCallback(
    async (force = false) => {
      if (!address) return;
      const now = Date.now();
      if (!force && now - lastFetch.current < CACHE_TTL) return;
      setFetching(true);
      try {
        const bal = await fetchBalance(address);
        setBalance(bal);
        lastFetch.current = Date.now();
      } catch {
        // silent — keep showing last known balance
      } finally {
        setFetching(false);
      }
    },
    [address]
  );

  useEffect(() => {
    refreshBalance(true);
    const interval = setInterval(() => refreshBalance(false), CACHE_TTL);
    return () => clearInterval(interval);
  }, [refreshBalance]);

  useEffect(() => {
    function onFocus() {
      refreshBalance(false);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshBalance]);

  if (!ready || !address) return null;

  const hasBalance = balance !== null && balance > BigInt(0);
  const balanceDisplay = balance === null ? (fetching ? "…" : "—") : `${formatGen(balance)} GEN`;

  function copyAddress() {
    navigator.clipboard.writeText(address!).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openFaucet() {
    navigator.clipboard.writeText(address!).catch(() => {});
    setFaucetTip(true);
    window.open(FAUCET_URL, "_blank", "noopener,noreferrer");
  }

  function handleSetUsername() {
    openRegistrationModal();
  }

  async function handleEditSuccess() {
    setShowEditModal(false);
    await refreshUsername();
  }

  return (
    <>
      <Card className="mb-8 p-4 sm:p-5">
        <p
          className="text-xs font-semibold uppercase tracking-widest mb-3"
          style={{ color: "var(--text-tertiary)" }}
        >
          Your wallet
        </p>

        {/* Address + balance row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Address + Copy + Explorer */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-mono text-sm"
              style={{ color: "var(--text-primary)" }}
            >
              {truncateAddress(address)}
            </span>
            <button
              onClick={copyAddress}
              className="text-xs px-2 py-0.5 rounded transition-colors"
              style={{
                color: "var(--text-tertiary)",
                border: "1px solid var(--border)",
                backgroundColor: "transparent",
                cursor: "pointer",
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <a
              href={`${EXPLORER_BASE}${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs"
              style={{ color: "var(--text-tertiary)" }}
            >
              View ↗
            </a>
          </div>

          {/* Balance + ready indicator */}
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-mono"
              style={{
                color: hasBalance ? "var(--accent-platform-hi)" : "var(--text-tertiary)",
              }}
            >
              {balanceDisplay}
            </span>
            {hasBalance && (
              <span className="text-xs" style={{ color: "#4ade80" }}>
                ✓ Ready to play
              </span>
            )}
          </div>
        </div>

        {/* Username row */}
        {isRegistered !== null && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              Username:
            </span>
            {isRegistered && username ? (
              <>
                <span
                  className="text-sm font-mono"
                  style={{ color: "var(--accent-platform-hi, #a78bfa)" }}
                >
                  @{username}
                </span>
                <button
                  onClick={() => setShowEditModal(true)}
                  className="text-xs hover:underline"
                  style={{
                    color: "var(--text-tertiary)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Edit
                </button>
              </>
            ) : (
              <button
                onClick={handleSetUsername}
                className="text-xs hover:underline"
                style={{
                  color: "var(--accent-platform-hi, #a78bfa)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                not set — Set one (optional)
              </button>
            )}
          </div>
        )}

        {/* Zero-balance messaging — soft for unregistered, urgent for registered */}
        {balance !== null && !hasBalance && (
          isRegistered === false ? (
            <p className="mt-3 text-sm" style={{ color: "var(--text-tertiary)" }}>
              Browse freely — funding is only needed when you create or join a match.
            </p>
          ) : (
            <div
              className="mt-3 rounded-md p-3"
              style={{
                backgroundColor: "rgba(251,191,36,0.08)",
                border: "1px solid rgba(251,191,36,0.25)",
              }}
            >
              <p className="text-sm mb-2" style={{ color: "#fbbf24" }}>
                ⚠ Your wallet needs testnet GEN to play.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={openFaucet}
                  className="text-sm font-semibold px-4 py-2 rounded transition-all"
                  style={{
                    backgroundColor: "var(--accent-platform)",
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                    borderRadius: "var(--radius)",
                  }}
                >
                  Get free testnet GEN →
                </button>
                <button
                  onClick={() => refreshBalance(true)}
                  className="text-sm px-3 py-2 rounded transition-all"
                  style={{
                    color: "var(--text-tertiary)",
                    border: "1px solid var(--border)",
                    backgroundColor: "transparent",
                    cursor: "pointer",
                    borderRadius: "var(--radius)",
                  }}
                >
                  I funded my wallet
                </button>
              </div>
              {faucetTip && (
                <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
                  Your address was copied. Paste it into the faucet form. Tokens typically arrive in 30–90 seconds.
                </p>
              )}
            </div>
          )
        )}
      </Card>

      {showEditModal && username && (
        <EditUsernameModal
          wallet={wallet}
          currentUsername={username}
          onSuccess={handleEditSuccess}
          onClose={() => setShowEditModal(false)}
        />
      )}
    </>
  );
}
