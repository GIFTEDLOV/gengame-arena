import { createClient } from "genlayer-js";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const USER_REGISTRY_ADDRESS =
  (process.env.NEXT_PUBLIC_USER_REGISTRY_ADDRESS as Address) ??
  "0x698321Bb07b4536Cdc1DB7e7095eaB554feaE42b";

const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC ?? "http://localhost:4000/api";

export function getGenlayerClient(privateKey?: `0x${string}`) {
  if (privateKey) {
    const account = privateKeyToAccount(privateKey);
    return createClient({ endpoint: RPC_URL, account });
  }
  return createClient({ endpoint: RPC_URL });
}
