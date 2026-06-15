"use client";

interface Props {
  accent: string;
  backHref: string;
  backLabel: string;
}

export default function MatchSettlingState({ accent, backHref, backLabel }: Props) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 p-8 text-center">
      <div
        className="h-14 w-14 rounded-full border-t-2 animate-spin"
        style={{ borderColor: accent }}
      />
      <h2 className="text-xl font-bold" style={{ color: accent }}>
        Match is being created
      </h2>
      <p className="text-sm max-w-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        GenLayer validators are reaching consensus on your match.
        This takes 30–90 seconds on Bradbury testnet.
      </p>
      <a
        href={backHref}
        className="text-sm hover:underline mt-2"
        style={{ color: "var(--text-tertiary)" }}
      >
        {backLabel}
      </a>
    </main>
  );
}
