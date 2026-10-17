# Tests

```
test/
  unit/          node:test suites, no infra needed   →  npm test
  integration/   need Mongo + Redis + Docker          →  npm run test:integration
  legacy/        pre-v4 ad-hoc scripts, kept for reference only
```

## `npm test` (unit)

Pure-logic suites — checkers, validation, the Java tokenizer, language command
shapes, `isInfraFailure`, middleware (with injected fake Redis), and `config`
validation (run in child processes). Fast, deterministic, no services.

## `npm run test:integration`

Needs the full stack up:

```bash
docker compose up -d          # mongo, redis, builds codeforge/fat-judge
```

Populated per phase:

- **Phase 2** — execution engine: AC / WA / TLE / MLE / CE / RE, per-test-case
  timing, deterministic MLE via cgroup, sandbox-killed-mid-run → INFRA_ERROR.
- **Phase 3** — contest flow: private test cases never appear in any HTTP/SSE
  response; leaderboard vs hand-computed ICPC penalty; no double-count under a
  re-submit race.

## `test/legacy/`

The `test_step*.js` / `test_phase7_*.js` scripts from the v3 build. They target
internals that v4 replaces (`containerPool`, the single-batch runner) and their
relative `require` paths are now broken by the move. Kept only so the original
intent is visible while each area is re-tested properly. Delete once the
equivalent unit/integration coverage lands.
