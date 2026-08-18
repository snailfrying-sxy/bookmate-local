# Repository Structure

`D:\goose\bookmate-local` is the single project root for BookMate Local. It is organized
as a lightweight monorepo so that the personal application and reusable Agent
components remain clearly separated.

```text
bookmate-local/
├─ apps/web/                 # Next.js local management and book-friend UI
├─ services/api/             # FastAPI, SQLite domain services, model gateway
├─ packages/agent-kit/       # Portable Skills and provider-neutral contracts
├─ docs/                     # Product, architecture, data, and operating docs
├─ data/                     # Local runtime data; ignored except .gitkeep
├─ Dockerfile                # Single-container local distribution
├─ docker-compose.yml        # One-service local deployment
├─ AGENTS.md                  # Durable Codex/project guidance
├─ start-local.ps1           # Windows local launcher
└─ start-local.cmd           # Launcher shortcut
```

## Dependency Direction

```text
apps/web -> services/api HTTP contract -> SQLite/files/model providers
packages/agent-kit -> documented contracts and external provider boundaries
docs -> explain decisions; never become a runtime dependency
```

The Web application must not read SQLite or local uploads directly. The Agent
Kit must not import implementation modules from `services/api`; when an MCP
server is added, it should call the same domain contracts rather than duplicate
storage or retrieval behavior.

## Runtime Data

`data/` is intentionally outside the source tree's tracked content. It may
contain private books, notes, conversations, indexes, and local model settings.
Back it up separately and never copy it into fixtures or public examples.
