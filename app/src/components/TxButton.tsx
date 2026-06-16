"use client";
import { useState, useEffect, type ReactNode } from "react";
import { useSettling } from "@/lib/settling";
import { friendlyError, type FriendlyError } from "@/lib/errorMessages";

interface TxButtonProps {
  onClick: () => Promise<void>;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  pendingLabel?: string;
  pendingHint?: string;      // small sub-text shown below the button while pending
  description?: string;      // shown in the settling indicator tooltip
  onOptimistic?: () => void; // called immediately when clicked (before tx)
  onRevert?: () => void;     // called if the tx fails
}

export default function TxButton({
  onClick,
  disabled = false,
  className = "",
  children,
  pendingLabel = "Awaiting validator consensus…",
  pendingHint,
  description = "Transaction",
  onOptimistic,
  onRevert,
}: TxButtonProps) {
  const [status, setStatus] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<FriendlyError | null>(null);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [timedMsg, setTimedMsg] = useState("");
  const { addTx, removeTx } = useSettling();

  useEffect(() => {
    if (status === "pending") {
      setPendingStart(Date.now());
    } else {
      setPendingStart(null);
      setTimedMsg("");
    }
  }, [status]);

  useEffect(() => {
    if (status !== "pending" || !pendingStart) return;
    const update = () => {
      const s = (Date.now() - pendingStart) / 1000;
      if (s < 5) setTimedMsg(pendingLabel);
      else if (s < 30) setTimedMsg("GenLayer validators are processing…");
      else if (s < 90) setTimedMsg("Almost done — validators reaching consensus…");
      else setTimedMsg("Still working — Bradbury testnet is occasionally slow.");
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [status, pendingStart, pendingLabel]);

  async function handle() {
    if (status === "pending") return;
    const txId = `tx-${Date.now()}-${Math.random()}`;
    setStatus("pending");
    setError(null);
    onOptimistic?.();
    addTx(txId, description);
    try {
      await onClick();
      setStatus("done");
      removeTx(txId);
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
      setStatus("idle");
      onRevert?.();
      removeTx(txId);
    }
  }

  const isPending = status === "pending";
  const isDone = status === "done";

  return (
    <div className="w-full">
      <button
        onClick={handle}
        disabled={disabled || isPending}
        className={className}
      >
        {isPending ? (
          <span className="flex items-center gap-2">
            <svg
              className="h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            {timedMsg || pendingLabel}
          </span>
        ) : isDone ? (
          "✓ Done"
        ) : (
          children
        )}
      </button>
      {isPending && pendingHint && (
        <p className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
          {pendingHint}
        </p>
      )}
      {error && (
        <div className="mt-2">
          <p className="text-sm font-medium" style={{ color: "var(--danger, #f87171)" }}>
            {error.title}
          </p>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {error.message}
          </p>
          {error.cta && (
            <a
              href={error.cta.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-sm underline"
              style={{ color: "var(--accent-platform-hi)" }}
            >
              {error.cta.label} →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
