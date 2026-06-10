# Wrap up Phase 4.5 — diagnose Predictions test hang

Phase 4.5 is essentially done. 3 of 4 integration tests passed cleanly:
- Title Wars: 13/13 — batch settled in 5.9s (vs old 17-38s)
- Trivia Royale: 10/10
- Prompt Wars critical-path: 17/18 (1 known fix already in commit fc348dc)

Predictions test has been running 22+ minutes, past the normal 3-5 minute consensus window for web-resolution. We need to know whether to keep waiting or capture the failure cleanly.

## Action 1 — Bounded wait

Let the Predictions test run for AT MOST 5 more minutes from when you start this prompt. After that, kill the test process if it hasn't completed on its own.

Do not kill it before 5 more minutes. Web-resolution can occasionally take that long when validators are doing slow web fetches.

## Action 2 — Capture transaction queue state RIGHT NOW

While waiting (don't interrupt the running test), capture two snapshots of Postgres state — one now, and one after the test ends (whether by finishing naturally or being killed).

### Snapshot 1 (run now)

Query 1A — current status counts:
```
docker exec genlayer-postgres-1 psql -U postgres -d genlayer_state -c "SELECT status, COUNT(*) FROM transactions GROUP BY status;"
```

Query 1B — most recent 15 transactions:
```
docker exec genlayer-postgres-1 psql -U postgres -d genlayer_state -c "SELECT hash, status, created_at FROM transactions ORDER BY created_at DESC LIMIT 15;"
```

Label both as "Snapshot 1 — during hang."

### Snapshot 2 (after test ends)

Same two queries, after either:
- Predictions test completes on its own, OR
- 5 minutes elapse and you kill the test

Label as "Snapshot 2 — post test."

## Action 3 — Capture the test output file

Whatever output file the test writes to, capture its FINAL contents at the moment the test ends. Specifically, the last ~30 lines including:
- Whatever step it was on when it stopped
- Any error messages
- Whether resolve_market was called and what status it returned
- The expected vs actual answer (if the resolution completed but the assertion failed)

## Action 4 — Report

Present all three artifacts together:
1. Snapshot 1 (during hang) — both queries
2. Snapshot 2 (post test) — both queries
3. Test output file final contents

## Interpretation guide (so you know what we're looking for)

- **ACTIVATED count growing between snapshots** → resolver consensus is jammed, multiple retries piling up. This is the Studio's local-node limitation for live web-search questions, documented since Phase 2.

- **FINALIZED count growing but test still hanging** → resolution succeeded on chain but the test assertion is failing or the test polling is too tight.

- **Zero new transactions between snapshots** → emit() / resolution call never queued. Different bug, would need investigation.

## Constraints

- Do NOT modify any file
- Do NOT propose contract changes
- Do NOT redeploy anything
- Do NOT restart the test
- Do NOT touch the running test process before the 5-minute bound
- Do NOT clear any ACTIVATED transactions yet — we need to see them if they're there

## Context

The Predictions test resolution path is the known-fragile case on local Studio. Phase 2 shipped an inline amber advisory specifically because spot-price and "tomorrow"-style numeric questions sometimes fail consensus when validators interpret current time or web-fetch results inconsistently. This is a known constraint, not a regression. If the test fails this run, the architectural fix from Phase 4.5 is still verified by the other three games passing.

End of instructions. Begin.
