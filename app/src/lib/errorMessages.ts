export interface FriendlyError {
  title: string;
  message: string;
  cta?: { label: string; href: string };
}

export function friendlyError(error: unknown): FriendlyError {
  const raw = error instanceof Error ? error.message : String(error);

  if (raw.includes("sender does not have enough funds") || raw.includes("insufficient funds")) {
    return {
      title: "Wallet needs testnet GEN",
      message: "Your wallet doesn't have enough GEN to cover transaction fees. Claim free testnet tokens from the faucet to play.",
      cta: { label: "Get testnet GEN", href: "https://testnet-faucet.genlayer.foundation" },
    };
  }

  if (raw.includes("rate limit exceeded")) {
    return {
      title: "Network busy",
      message: "Bradbury RPC is briefly rate-limited. Try again in 30–60 seconds.",
    };
  }

  if (raw.includes("[EXPECTED]")) {
    const message = raw.split("[EXPECTED]")[1]?.split("\n")[0]?.trim() ?? "Action couldn't be completed.";
    return { title: "Action declined", message };
  }

  if (raw.includes("[EXTERNAL]")) {
    return {
      title: "External error",
      message: "Something outside our control failed. This usually resolves itself — try again in a moment.",
    };
  }

  if (raw.includes("chain ID does not match")) {
    return {
      title: "Wrong network",
      message: "Your wallet is connected to a different network. Switch to Bradbury testnet (Chain ID 4221) to continue.",
    };
  }

  return {
    title: "Something went wrong",
    message: "We hit an unexpected error. Try again or refresh the page.",
  };
}
