"use client";

import AuthGuard from "@/components/AuthGuard";
import Link from "next/link";

export default function PromptWarsPage() {
  return (
    <AuthGuard>
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-3xl font-bold">Prompt Wars</h1>
        <p className="text-gray-400">Coming soon — compete with AI prompt engineering on GenLayer.</p>
        <Link href="/dashboard" className="text-indigo-400 hover:underline">
          ← Back to Arena
        </Link>
      </main>
    </AuthGuard>
  );
}
