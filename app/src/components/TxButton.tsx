"use client";
import { useState, type ReactNode } from "react";

interface TxButtonProps {
  onClick: () => Promise<void>;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  pendingLabel?: string;
}

export default function TxButton({
  onClick,
  disabled = false,
  className = "",
  children,
  pendingLabel = "Awaiting validator consensus…",
}: TxButtonProps) {
  const [status, setStatus] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState("");

  async function handle() {
    if (status === "pending") return;
    setStatus("pending");
    setError("");
    try {
      await onClick();
      setStatus("done");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("idle");
    }
  }

  const isPending = status === "pending";
  const isDone = status === "done";

  return (
    <div>
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
            {pendingLabel}
          </span>
        ) : isDone ? (
          "✓ Done"
        ) : (
          children
        )}
      </button>
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}
