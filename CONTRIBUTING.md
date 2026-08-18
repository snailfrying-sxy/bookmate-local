# Contributing

BookMate is a local-first monorepo. Keep the Web UI, API, Agent Kit, and
product documents independently releasable; do not introduce cross-directory
imports that bypass the API or documented contracts.

## License Terms For Contributions

By submitting a contribution, you confirm that you have the right to submit it
and license that contribution under the repository's PolyForm Noncommercial
License 1.0.0. Do not contribute copyrighted book text, private reading data,
secrets, or code whose license conflicts with this repository's terms.

## Local Checks

```powershell
cd services/api
..\..\.venv\Scripts\python.exe -m pytest -q

cd ..\..\apps\web
npm run build
npm audit --omit=dev
```

Run the API and Web checks for every change that affects a user-facing flow.
Provider adapters and model calls must use mocks in automated tests; live API
calls are opt-in manual verification only.

## Change Boundaries

- `apps/web`: browser experience and API clients only.
- `services/api`: domain logic, persistence, model gateway, and HTTP API.
- `packages/agent-kit`: portable Skills and provider contracts; no dependency
  on the local Web application.
- `docs`: product decisions, architecture, and operational specifications.
- `data`: runtime-only local data. Never commit a user's books, conversations,
  API keys, model outputs, or derived indexes.

Use additive SQLite migrations for local schema changes. Preserve existing user
data and write a regression test for each migration-backed behavior.
