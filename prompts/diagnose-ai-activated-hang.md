# Diagnose ACTIVATED hang on AI-invoking transactions

## Settled context

Solo Predictions integration test run today:
- registerUser transactions FINALIZED in ~20 seconds each (no AI invocation)
- createBinaryMarket and createNumericMarket transactions stuck ACTIVATED indefinitely (these invoke AI verifiability check)
- 3 stuck ACTIVATED transactions left in queue after the test was killed

Yesterday's "concurrent load saturation" diagnosis does NOT explain this. We need new evidence.

Hypothesis: the AI validator path is broken on the current Studio. Possibly the Anthropic API key isn't reaching validators, possibly the API call is failing, possibly something else.

## What to do — investigate, REPORT ONLY, do NOT clear the stuck transactions yet

### Check 1 — Anthropic API key reachability inside the Studio

The Studio runs the validator inside the genlayer-jsonrpc-1 container. Check whether the ANTHROPIC_API_KEY env variable is present in that container:

```
docker exec genlayer-jsonrpc-1 sh -c "env | grep -i anthropic"
```

Report what you see (mask the actual key — just show the variable name and "key present, X chars" or "MISSING"). If MISSING, that's likely the entire problem.

Also check whether the LLM provider is configured to use Anthropic:

```
docker exec genlayer-jsonrpc-1 sh -c "env | grep -iE 'llm|provider|validator'"
```

Report what shows.

### Check 2 — Inspect the genlayer-jsonrpc-1 logs for AI-related errors

The 3 stuck ACTIVATED transactions are still in the queue. Their hashes are:
- 0x3f756bcf… (createBinaryMarket at 08:05:01)
- 0xed7d7b4b… (createBinaryMarket nonsense at 08:10:06)
- 0x6899dab2… (createNumericMarket at 08:15:12)

Look at the Studio's jsonrpc container logs from the timeframe 08:05 to 08:30 today, filtered for errors and AI-related events:

```
docker logs genlayer-jsonrpc-1 --since 2h 2>&1 | grep -iE "error|anthropic|claude|llm|exception|failed|timeout" | tail -80
```

Report the last 80 matching lines. We want to see: did the validators try to call Anthropic and fail? Did they get rate-limited? Did they time out? Was there an auth error?

### Check 3 — Test the AI provider directly from inside the container

If Check 1 shows the API key IS set, verify the validator can actually reach Anthropic by making a small test call from inside the container:

```
docker exec genlayer-jsonrpc-1 sh -c "curl -sS -X POST https://api.anthropic.com/v1/messages -H 'x-api-key: \$ANTHROPIC_API_KEY' -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' -d '{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":10,\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}' | head -c 500"
```

Report what comes back. We're looking for:
- A successful response (JSON with "content") → API key is fine, Anthropic is reachable, problem is elsewhere
- A 401 error → API key bad or expired
- A 429 error → rate limited
- A network error → container can't reach Anthropic at all
- An "ANTHROPIC_API_KEY: parameter not set" error → key not in env

Mask any key fragments in your output.

## Constraints

- Do NOT clear the stuck ACTIVATED transactions yet — they may be useful as we trace the issue
- Do NOT restart any containers yet
- Do NOT modify any file
- Do NOT propose fixes yet
- Do NOT redeploy anything
- Report all three checks, then stop and wait

End of instructions. Begin.
