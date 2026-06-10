import { createClient } from "genlayer-js";

const RPC = "http://localhost:4000/api";
const REGISTRY = "0xF164Ce02730060F3e8b3b735eFe46abDeEC7308A";
const SUFFIX = "316719";
const LABELS = ["A", "B", "C", "D"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromMap(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (
    typeof value === "object" &&
    "bytes" in (value as object) &&
    (value as { bytes: unknown }).bytes instanceof Uint8Array &&
    (value as { bytes: Uint8Array }).bytes.length === 20
  ) {
    const bytes = (value as { bytes: Uint8Array }).bytes;
    return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    value.forEach((v, k) => { obj[String(k)] = fromMap(v); });
    return obj;
  }
  if (Array.isArray(value)) return value.map(fromMap);
  return value;
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createClient({ endpoint: RPC, account: { address: "0x0000000000000000000000000000000000000000" } as any });

  for (const label of LABELS) {
    const username = `tw${label}_${SUFFIX}`;
    const addrRaw = await client.readContract({
      address: REGISTRY as `0x${string}` & { length: 42 },
      functionName: "address_of",
      args: [username],
    });
    const addr = fromMap(addrRaw) as string | null;
    if (!addr) {
      console.log(`Wallet ${label} (${username}): address not found`);
      continue;
    }
    const profileRaw = await client.readContract({
      address: REGISTRY as `0x${string}` & { length: 42 },
      functionName: "get_profile",
      args: [addr],
    });
    const profile = fromMap(profileRaw) as Record<string, unknown> | null;
    if (!profile) {
      console.log(`Wallet ${label} (${username}): no profile at ${addr}`);
      continue;
    }
    console.log(`Wallet ${label} (${username})`);
    console.log(`  address:       ${addr}`);
    console.log(`  total_matches: ${profile.total_matches}`);
    console.log(`  total_wins:    ${profile.total_wins}`);
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
