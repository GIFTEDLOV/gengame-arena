# Find why emit().record_match isn't queueing transactions

Forensic evidence confirms Scenario B: zero `record_match` transactions appeared in the database after `judge_match` finalized at 11:24:57. The emit() chain isn't producing queued transactions.

We need to find out where in the chain it's failing. Three checks in order. Report results after each; do not modify any file.

## Check 1 — Source of judge_match in title_wars.py

Open `contracts/title_wars.py`. Find the `judge_match` method. Show me:
- The complete `judge_match` method body
- Specifically: where it loops over players and calls `record_match` (or `record_match_with_rank`) on the user_registry via `emit()`
- Confirm whether the emit() block is unconditional or guarded by an `if` that could skip it

I want to see the actual code that should be queueing the 4 record_match transactions.

## Check 2 — UserRegistry address that title_wars.py targets

The `judge_match` method needs the UserRegistry contract address to emit() against. Find:
- How does title_wars.py get the UserRegistry address? Is it a constructor argument? A constant? A class field set on deploy?
- What's the actual address value baked into the deployed TitleWars contract at `0xf0936D33B8d6f6dbf9cc7A3dD871F94350093bcF`?

To check the deployed value, you can call a getter on the contract if one exists, OR check the deploy script that deployed it — `scripts/deploy_title_wars.py` — to see what UserRegistry address it passed in. Compare that value to the canonical UserRegistry `0x66B41A5866F8AD6704F00bCd8c8A668D99564032`.

If the deploy script passed a different/stale UserRegistry address, emit() is firing into a dead address and silently no-oping. That alone could explain everything.

## Check 3 — Inspect the judge_match transaction execution trace

The judge_match transaction is `0x135a330...` (from the previous artifact, finalized at 11:24:57). Pull its full transaction details from the JSON-RPC:

```
curl -X POST http://localhost:4000/api -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionReceipt\",\"params\":[\"0x135a330...\"]}"
```

(replace `0x135a330...` with the full hash you have)

Also try:

```
curl -X POST http://localhost:4000/api -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"gen_getTransactionStatus\",\"params\":[\"0x135a330...\"]}"
```

Or whatever GenLayer-specific RPC method shows execution result / consensus output / logs. Show me:
- The full execution result, including any logs, events, or output
- Whether the receipt shows internal transactions / emits
- Any error or revert reason at the genvm level
- The contract state changes recorded (specifically: was the match ranking written? was anything attempted on UserRegistry?)

If the RPC method names I gave are wrong for GenLayer, use whatever the SDK provides. You can grep `node_modules/genlayer-js` for available methods if needed.

## Constraints

- Do not modify any file
- Do not propose fixes
- Do not redeploy anything
- Do not run the integration test again
- Report results from each check before moving to the next

End of instructions. Begin with Check 1.
