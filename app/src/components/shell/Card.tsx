"use client";
import { type ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  accent?: string; // CSS color value for top hairline
  hover?: boolean;
  style?: React.CSSProperties;
}

export default function Card({
  children,
  className = "",
  accent,
  hover = true,
  style,
}: CardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-md ${className}`}
      style={{
        backgroundColor: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-card)",
        borderRadius: "var(--radius-md)",
        transition: `box-shadow var(--duration-normal) var(--ease-out), transform var(--duration-normal) var(--ease-out), border-color var(--duration-normal)`,
        ...style,
      }}
      onMouseEnter={
        hover
          ? (e) => {
              const el = e.currentTarget as HTMLDivElement;
              el.style.boxShadow = "var(--shadow-hover)";
              el.style.transform = "translateY(-2px)";
              el.style.borderColor = "var(--border-strong)";
            }
          : undefined
      }
      onMouseLeave={
        hover
          ? (e) => {
              const el = e.currentTarget as HTMLDivElement;
              el.style.boxShadow = "var(--shadow-card)";
              el.style.transform = "translateY(0)";
              el.style.borderColor = "var(--border)";
            }
          : undefined
      }
    >
      {accent && (
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ backgroundColor: accent, opacity: 0.7 }}
        />
      )}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundColor: "var(--bg-overlay)" }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
