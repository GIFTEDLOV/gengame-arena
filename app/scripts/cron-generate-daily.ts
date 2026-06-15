/**
 * cron-generate-daily.ts
 *
 * Triggers generate_daily_content_if_due() on all 4 game contracts.
 * Runs via GitHub Actions daily at 1pm UTC (see .github/workflows/daily-content-generation.yml).
 *
 * Required environment variables (set as GitHub Actions secrets):
 *   GENLAYER_RPC_URL          — GenLayer RPC endpoint (e.g. https://studio.genlayer.com/api)
 *   CRON_SIGNER_PRIVATE_KEY   — Private key of dedicated cron wallet (funded with GEN for gas)
 *   PROMPT_WARS_ADDRESS       — Deployed PromptWars contract address
 *   PREDICTIONS_ADDRESS       — Deployed Predictions contract address
 *   TRIVIA_ROYALE_ADDRESS     — Deployed TriviaRoyale contract address
 *   TITLE_WARS_ADDRESS        — Deployed TitleWars contract address
 */

import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { privateKeyToAccount } from "viem/accounts";

const rpcUrl = process.env.GENLAYER_RPC_URL;
const signerKey = process.env.CRON_SIGNER_PRIVATE_KEY;
const contracts = {
  promptWars: process.env.PROMPT_WARS_ADDRESS,
  predictions: process.env.PREDICTIONS_ADDRESS,
  triviaRoyale: process.env.TRIVIA_ROYALE_ADDRESS,
  titleWars: process.env.TITLE_WARS_ADDRESS,
};

if (!rpcUrl || !signerKey) {
  console.error("Missing required env: GENLAYER_RPC_URL and CRON_SIGNER_PRIVATE_KEY");
  process.exit(1);
}

for (const [name, addr] of Object.entries(contracts)) {
  if (!addr) {
    console.error(`Missing required env for ${name} address`);
    process.exit(1);
  }
}

async function buildClient() {
  const account = privateKeyToAccount(signerKey as `0x${string}`);
  const client = createClient({ chain: testnetBradbury, endpoint: rpcUrl!, account });

  // Same 3 fixes as clientFromWallet in genlayer.ts
  // FIX 1 — await ConsensusMain init
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).initializeConsensusSmartContract();

  // FIX 3 — pre-fill tx params so viem never calls eth_fillTransaction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origPrepare = (client as any).prepareTransactionRequest.bind(client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).prepareTransactionRequest = async (args: any) => {
    const nonce =
      args.nonce !== undefined
        ? (typeof args.nonce === "string" ? parseInt(args.nonce, 16) : args.nonce)
        : args.nonce;
    return origPrepare({
      chainId: 4221,
      gas: BigInt(30_000_000),
      gasPrice: BigInt(0),
      ...args,
      nonce,
    });
  };

  // FIX 2 — stub estimateGas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).estimateGas = async () => BigInt(30_000_000);

  return client;
}

type GenerateResult = { name: string; status: "triggered" | "skipped" | "failed"; error?: string };

async function generateForContract(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  name: string,
  address: string
): Promise<GenerateResult> {
  try {
    const tx = await client.writeContract({
      address: address as `0x${string}`,
      functionName: "generate_daily_content_if_due",
      value: BigInt(0),
    });
    console.log(`${name}: triggered, tx ${tx}`);
    return { name, status: "triggered" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("[EXPECTED] Daily content already generated today")) {
      console.log(`${name}: already generated today (skipping)`);
      return { name, status: "skipped" };
    }
    console.error(`${name}: failed`, err);
    return { name, status: "failed", error: msg };
  }
}

async function main() {
  const client = await buildClient();

  const targets: Array<{ name: string; address: string }> = [
    { name: "PromptWars", address: contracts.promptWars! },
    { name: "Predictions", address: contracts.predictions! },
    { name: "TriviaRoyale", address: contracts.triviaRoyale! },
    { name: "TitleWars", address: contracts.titleWars! },
  ];

  const summary: GenerateResult[] = [];
  for (const target of targets) {
    const result = await generateForContract(client, target.name, target.address);
    summary.push(result);
    // Brief breath between contracts so nonce/state settles cleanly
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("Daily generation summary:", JSON.stringify(summary, null, 2));

  const failures = summary.filter((r) => r.status === "failed");
  if (failures.length > 0) {
    console.error(`${failures.length} contract(s) failed daily generation`);
    process.exit(1);
  }
}

main();
