import { type ReactNode } from "react";
import Header from "./Header";
import Footer from "./Footer";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-base)" }}>
      {/* Ambient violet glow — top-left */}
      <div
        className="pointer-events-none fixed z-0 overflow-hidden"
        style={{ inset: 0 }}
        aria-hidden
      >
        <div
          style={{
            position: "absolute",
            top: "-8rem",
            left: "-8rem",
            width: "36rem",
            height: "36rem",
            background: "var(--accent-platform-lo)",
            borderRadius: "9999px",
            opacity: 0.07,
            filter: "blur(80px)",
          }}
        />
      </div>

      <Header />

      <main
        className="relative z-10"
        style={{ minHeight: `calc(100vh - var(--header-height))` }}
      >
        {children}
      </main>

      <Footer />
    </div>
  );
}
