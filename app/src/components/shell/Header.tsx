"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import SettlingIndicator from "./SettlingIndicator";

const NAV_LINKS = [
  { href: "/dashboard",    label: "Dashboard" },
  { href: "/prompt-wars",  label: "Prompt Wars" },
  { href: "/predictions",  label: "Predictions" },
  { href: "/trivia-royale", label: "Trivia" },
  { href: "/title-wars",   label: "Titles" },
  { href: "/leaderboards", label: "Leaderboards" },
];

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const hasPrivy = !!privyAppId && privyAppId !== "your_privy_app_id_here";

/* ── inner header that can call usePrivy() safely ── */
function HeaderInner() {
  // ALL hooks unconditionally at the top — never inside conditionals or after early returns
  const { authenticated, user, logout } = usePrivy() as {
    authenticated: boolean;
    user: { github?: { username: string }; email?: { address: string } } | null;
    logout: () => Promise<void>;
  };
  const [guestName, setGuestName] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!authenticated && typeof window !== "undefined") {
      setGuestName(localStorage.getItem("gengame_guest_username"));
    }
  }, [authenticated]);

  const username = authenticated
    ? user?.github?.username ?? user?.email?.address?.split("@")[0] ?? "player"
    : guestName ?? "guest";

  const initial = username[0]?.toUpperCase() ?? "G";

  function handleSignOut() {
    if (authenticated) {
      logout().then(() => router.push("/sign-in"));
    } else {
      if (typeof window !== "undefined") {
        localStorage.removeItem("gengame_guest_key");
        localStorage.removeItem("gengame_guest_username");
      }
      router.push("/sign-in");
    }
    setDropOpen(false);
  }

  return (
    <HeaderShell
      menuOpen={menuOpen}
      setMenuOpen={setMenuOpen}
      dropOpen={dropOpen}
      setDropOpen={setDropOpen}
      pathname={pathname}
      username={username}
      initial={initial}
      onSignOut={handleSignOut}
    />
  );
}

/* ── guest-only header (no Privy) ── */
function HeaderGuest() {
  const [guestName, setGuestName] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined") {
      setGuestName(localStorage.getItem("gengame_guest_username"));
    }
  }, []);

  const username = guestName ?? "guest";
  const initial = username[0]?.toUpperCase() ?? "G";

  function handleSignOut() {
    if (typeof window !== "undefined") {
      localStorage.removeItem("gengame_guest_key");
      localStorage.removeItem("gengame_guest_username");
    }
    router.push("/sign-in");
    setDropOpen(false);
  }

  return (
    <HeaderShell
      menuOpen={menuOpen}
      setMenuOpen={setMenuOpen}
      dropOpen={dropOpen}
      setDropOpen={setDropOpen}
      pathname={pathname}
      username={username}
      initial={initial}
      onSignOut={handleSignOut}
    />
  );
}

/* ── shared shell markup ── */
interface ShellProps {
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  dropOpen: boolean;
  setDropOpen: (v: boolean) => void;
  pathname: string;
  username: string;
  initial: string;
  onSignOut: () => void;
}

function HeaderShell({
  menuOpen, setMenuOpen, dropOpen, setDropOpen,
  pathname, username, initial, onSignOut,
}: ShellProps) {
  return (
    <header
      className="sticky top-0 z-50 flex items-center justify-between gap-4 px-4 sm:px-6"
      style={{
        height: "var(--header-height)",
        backgroundColor: "rgba(10, 10, 15, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Brand */}
      <Link
        href="/dashboard"
        className="flex items-center gap-2 shrink-0"
        style={{ textDecoration: "none" }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <circle cx="10" cy="10" r="10" fill="var(--accent-platform)" />
          <circle cx="10" cy="10" r="5" fill="var(--accent-platform-hi)" opacity="0.6" />
          <circle cx="10" cy="10" r="2" fill="white" />
        </svg>
        <span
          className="hidden sm:block font-bold tracking-tight text-sm"
          style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
        >
          Gengame Arena
        </span>
      </Link>

      {/* Desktop Nav */}
      <nav className="hidden md:flex items-center gap-0.5 flex-1 justify-center">
        {NAV_LINKS.map(({ href, label }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                color: active ? "var(--accent-platform-hi)" : "var(--text-secondary)",
                backgroundColor: active ? "rgba(139,92,246,0.12)" : "transparent",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Right: Settling + Account + Hamburger */}
      <div className="flex items-center gap-2 shrink-0">
        <SettlingIndicator />

        {/* Account dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropOpen(!dropOpen)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(255,255,255,0.05)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shrink-0"
              style={{ backgroundColor: "var(--accent-platform-lo)", color: "white" }}
            >
              {initial}
            </span>
            <span className="hidden sm:block max-w-[100px] truncate">{username}</span>
            <svg className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {dropOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setDropOpen(false)} />
              <div
                className="absolute right-0 top-full mt-2 w-40 rounded-xl border py-1 z-50"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  borderColor: "var(--border)",
                  boxShadow: "var(--shadow-card)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <button
                  onClick={onSignOut}
                  className="w-full px-4 py-2 text-left text-xs transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                >
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden flex flex-col items-center justify-center gap-1.5 p-2 rounded-lg"
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          style={{ minWidth: 44, minHeight: 44 }}
        >
          <span
            className="block h-0.5 w-5 origin-center transition-transform duration-200"
            style={{
              backgroundColor: "var(--text-secondary)",
              transform: menuOpen ? "rotate(45deg) translateY(5px)" : "none",
            }}
          />
          <span
            className="block h-0.5 w-5 transition-opacity duration-200"
            style={{
              backgroundColor: "var(--text-secondary)",
              opacity: menuOpen ? 0 : 1,
            }}
          />
          <span
            className="block h-0.5 w-5 origin-center transition-transform duration-200"
            style={{
              backgroundColor: "var(--text-secondary)",
              transform: menuOpen ? "rotate(-45deg) translateY(-5px)" : "none",
            }}
          />
        </button>
      </div>

      {/* Mobile nav slide-down */}
      {menuOpen && (
        <div
          className="absolute top-full left-0 right-0 md:hidden"
          style={{
            backgroundColor: "rgba(10,10,15,0.97)",
            borderBottom: "1px solid var(--border)",
            backdropFilter: "blur(12px)",
          }}
        >
          {NAV_LINKS.map(({ href, label }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="flex items-center px-6 py-3.5 text-sm font-medium"
                style={{
                  color: active ? "var(--accent-platform-hi)" : "var(--text-secondary)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}

/* ── public export ── */
export default function Header() {
  if (!hasPrivy) return <HeaderGuest />;
  return <HeaderInner />;
}
