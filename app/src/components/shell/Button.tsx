"use client";
import { type ReactNode, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

const variantStyles: Record<Variant, React.CSSProperties> = {
  primary: {
    backgroundColor: "var(--accent-platform)",
    color: "#fff",
    border: "1px solid transparent",
  },
  secondary: {
    backgroundColor: "var(--bg-overlay)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-strong)",
    backdropFilter: "blur(8px)",
  },
  ghost: {
    backgroundColor: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid transparent",
  },
};

const sizeStyles: Record<string, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

const hoverBg: Record<Variant, string> = {
  primary:   "var(--accent-platform-hi)",
  secondary: "rgba(255,255,255,0.06)",
  ghost:     "rgba(255,255,255,0.05)",
};

export default function Button({
  variant = "primary",
  children,
  loading,
  size = "md",
  className = "",
  style,
  disabled,
  onMouseEnter,
  onMouseLeave,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-2 font-semibold rounded transition-all min-h-[44px] ${sizeStyles[size]} ${className}`}
      style={{
        ...variantStyles[variant],
        borderRadius: "var(--radius)",
        transition: `background-color var(--duration-fast), opacity var(--duration-fast), transform var(--duration-fast)`,
        opacity: isDisabled ? 0.5 : 1,
        cursor: isDisabled ? "not-allowed" : "pointer",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!isDisabled) {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = hoverBg[variant];
        }
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (!isDisabled) {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            variantStyles[variant].backgroundColor as string;
        }
        onMouseLeave?.(e);
      }}
      {...props}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
