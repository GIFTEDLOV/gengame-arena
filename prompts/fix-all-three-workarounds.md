# Definitive fix: apply ALL THREE viem↔GenLayer workarounds together in clientFromWallet

## Context — read carefully

Over the last several debugging rounds, we identified THREE separate incompatibilities between viem (which genlayer-js wraps) and the local GenLayer Studio. Each was diagnosed correctly. The problem has been that fixes were applied one at a time, and each new fix REMOVED the previous one — so we keep regressing to an earlier error.

This task applies all three fixes simultaneously and permanently. **Do not remove any of them. They are additive, not alternatives.**

The failing function is `clientFromWallet` (or equivalent client factory) in `app/src/lib/genlayer.ts`. Current symptom after the last change: `eth_fillTransaction` "Method not found" is back (because the `prepareTransactionRequest` override was deleted when the `estimateGas` override was added).

## The three fixes — ALL must be present in the final code

### Fix 1: await ConsensusMain initialization (currently present — keep it)
`createClient` fires `initializeConsensusSmartContract()` as fire-and-forget. Must await it so `client.chain.consensusMainContract` is set before any write:
```ts
await (client as any).initializeConsensusSmartContract();
```

### Fix 2: stub estimateGas (currently present — keep it)
GenLayer Studio rejects `eth_estimateGas` when viem appends a `"latest"` block tag as the second param. Override the action to skip the RPC call:
```ts
(client as any).estimateGas = async () => BigInt(30_000_000);
```

### Fix 3: override prepareTransactionRequest (was REMOVED — RESTORE it)
GenLayer Studio does not support `eth_fillTransaction`, which viem calls when chainId/nonce/gas/gasPrice are missing. Pre-fill them so viem never makes that call. This was working in an earlier version and must be brought back:
```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const origPrepare = (client as any).prepareTransactionRequest.bind(client);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(client as any).prepareTransactionRequest = async (args: any) => {
  const nonce =
    args.nonce !== undefined
      ? (typeof args.nonce === "string" ? parseInt(args.nonce, 16) : args.nonce)
      : args.nonce;
  return origPrepare({
    chainId: 61999,
    gas: BigInt(30_000_000),
    gasPrice: BigInt(0),
    ...args,
    nonce,
  });
};
```

## Required final shape of clientFromWallet

The function must be `async`, create the account + client, then apply ALL THREE overrides in this order, then return the client:

```ts
async function clientFromWallet(wallet: NonNullable<ActiveWallet>) {
  const account = toAccount({
    address: glAddr(wallet.address),
    async signMessage({ message }) {
      return wallet.signMessage(typeof message === "string" ? message : message.raw) as Promise<`0x${string}`>;
    },
    async signTransaction(tx) {
      return wallet.signTransaction(tx) as Promise<`0x${string}`>;
    },
    // include signTypedData passthrough if the existing code had it
  });

  const client = createClient({ endpoint: RPC_URL, account });

  // FIX 1 — await ConsensusMain init (race condition)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).initializeConsensusSmartContract();

  // FIX 3 — override prepareTransactionRequest (eth_fillTransaction unsupported)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origPrepare = (client as any).prepareTransactionRequest.bind(client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).prepareTransactionRequest = async (args: any) => {
    const nonce =
      args.nonce !== undefined
        ? (typeof args.nonce === "string" ? parseInt(args.nonce, 16) : args.nonce)
        : args.nonce;
    return origPrepare({
      chainId: 61999,
      gas: BigInt(30_000_000),
      gasPrice: BigInt(0),
      ...args,
      nonce,
    });
  };

  // FIX 2 — stub estimateGas (eth_estimateGas with block tag unsupported)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).estimateGas = async () => BigInt(30_000_000);

  return client;
}
```

Match the exact account-building code that already exists in the file (signMessage / signTransaction / signTypedData shape) — don't change how the account is built, only ensure all three overrides are applied after createClient.

## Critical constraints

- **Do NOT remove any of the three overrides.** If you think one is redundant, you are wrong — we have empirical evidence each one is needed. Keep all three.
- All five write helpers (`registerUser`, `createPromptWarsMatch`, `joinPromptWarsMatch`, `submitPrompt`, `judgeMatch`) must `await clientFromWallet(wallet)`.
- Do NOT change contracts, useActiveWallet, pages, or components.
- Do NOT upgrade package versions.

## Verify

1. TypeScript check: `cd app; npx tsc --noEmit` — zero errors
2. Restart clean:
   ```
   taskkill /F /IM node.exe
   cd app; npm run dev
   ```
   Confirm port 3000.
3. Hard refresh browser.
4. **Guest signup**: incognito → Continue as Guest → username `triple_fix_guest` → Continue
   - MUST land on dashboard with that username
   - DevTools Console: NO `eth_fillTransaction`, NO `eth_estimateGas`, NO `Method not found`, NO `Consensus main contract not initialized`
   - DevTools Network: the POST to localhost:4000/api returns 200, not 400
5. **Create match**: Prompt Wars → Create Match → routes to /prompt-wars/<real_id> with target text visible
6. **Full match** (two windows): create → join → both submit → judge → both see results with winner

## If a NEW error appears (different from the three above)

If after applying all three fixes a genuinely NEW error appears (not eth_fillTransaction, not estimateGas, not ConsensusMain), then:
- STOP
- Capture the exact error text + the Network tab Payload showing the failing RPC `method` name
- Report it — we'll add a fourth targeted workaround the same way

But if it's one of the three known errors, that means an override didn't get applied correctly — re-check that all three are present in clientFromWallet and that the file was saved.

## Commit

After all verification passes:
`fix(genlayer): apply all three viem-Studio workarounds together (fillTransaction + estimateGas + consensus init)`
