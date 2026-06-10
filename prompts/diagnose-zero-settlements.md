# Diagnose Title Wars test settlement failure — evidence-only

The integration test is currently running and has gone past 346 seconds with zero settlements on any of the 4 wallets. Yesterday's measurement showed settling at 17-38 seconds. Something is different today. We need evidence before any action.

## Action 1 — Let the test finish

Let the existing integration test process finish all 300 attempts. Don't kill it. When it completes (or times out), report:
- Total runtime
- Final attempt number for each of the 4 wallets
- Final `settledAt` value for each (likely all `null`)
- Any error messages or warnings printed near the end
- Whether the test process exited cleanly or hit a 10-minute timeout

## Action 2 — In parallel (separate commands, don't touch the test)

While the test is still running, run these two SQL queries against Postgres. These do NOT interfere with the running test.

### Query 1: Current transaction status counts

```
docker exec genlayer-postgres-1 psql -U postgres -d genlayer_state -c "SELECT status, COUNT(*) FROM transactions GROUP BY status;"
```

Report the full output. I want to see counts for FINALIZED, ACCEPTED, ACTIVATED, and any other status.

### Query 2: Most recent 20 transactions with status and timestamp

```
docker exec genlayer-postgres-1 psql -U postgres -d genlayer_state -c "SELECT hash, status, created_at FROM transactions ORDER BY created_at DESC LIMIT 20;"
```

Report the full output. I want to see the sequence of transactions submitted during this test run, specifically:
- Did `judge_match` finalize? (should appear in the list)
- Did `record_match` transactions get queued at all? (should appear 4 times, one per player)
- What state are they in (FINALIZED, ACCEPTED, ACTIVATED)?
- What are their timestamps relative to each other?

## Action 3 — Report the three artifacts together

When the test finishes and you have both query outputs, present all three artifacts in one report:
1. Final test summary (per-wallet settledAt status, total runtime, exit status)
2. Transaction count by status
3. The 20 most recent transactions

## Constraints

- Do NOT modify any file
- Do NOT propose contract changes
- Do NOT blame emit() or NonGenVMContract
- Do NOT propose options or fixes — just present evidence
- Do NOT clear ACTIVATED transactions on your own, even if you see them stuck — wait for my instruction
- Do NOT kill the test early

We are gathering forensic evidence to figure out which of three scenarios is happening:
- Scenario A: record_match transactions are stuck ACTIVATED (Hardhat queue issue)
- Scenario B: record_match transactions are never being queued (silent emit() failure)
- Scenario C: record_match transactions settle but getUserProfile can't read them back

The three artifacts will tell us which scenario this is. Then I will write the next prompt.

End of instructions. Begin.
