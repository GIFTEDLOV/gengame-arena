import { createClient } from "genlayer-js";

const RPC = "http://localhost:4000/api";
const REGISTRY = "0x8704aBA88217a076292bd2Fd3945eb49E4Fc2448";
type GL = `0x${string}` & { length: 42 };

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createClient({ endpoint: RPC, account: { address: "0x0000000000000000000000000000000000000000" } as any });

  console.log("Calling is_username_taken('test') on UserRegistry...");
  try {
    const result = await client.readContract({
      address: REGISTRY as GL,
      functionName: "is_username_taken",
      args: ["test"],
    });
    console.log("SUCCESS — result:", result);
    console.log("UserRegistry at", REGISTRY, "is ALIVE.");
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : String(e));
    console.log("UserRegistry at", REGISTRY, "is DEAD.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
