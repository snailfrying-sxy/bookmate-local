# BookMate Local

BookMate Local is a local-first personal library and long-term AI reading
companion. Its companion, Bozhou, helps a reader continue a thoughtful
conversation about books they have read, are reading, or only remember. It is
not a summary generator or a generic RAG wrapper.

## What It Does

- Keeps a stable book room separate from uploaded editions and supporting files.
- Lets readers capture quotes, reflections, questions, reading progress, and
  spoiler boundaries even when no ebook is available.
- Provides a separate import workspace for files and editions, reading traces,
  and creating a book room before a file is available.
- Stores books, notes, conversations, memories, documents, and indexes locally
  in SQLite and a single data directory.
- Supports OpenAI Chat Completions-compatible and Responses-style text APIs.
- Saves multiple local model profiles, tests each connection, and lets the
  reader choose a saved model for an individual chat turn.
- Keeps API keys out of API responses. A selected remote model may receive the
  relevant reader prompt, excerpts, and notes; the interface discloses this.
- Provides deliberate search controls: off, ask first, or automatic routing for
  dynamic questions. The current demo does not silently perform web searches.

## Quick Start

### Windows

Install Python 3.11+ and Node.js 22+, then run:

```powershell
.\start-local.ps1
```

Or double-click `start-local.cmd`. The app starts at
`http://localhost:8000` and stores private runtime data in `./data`.

### Docker

Install Docker Desktop (or a compatible Docker Compose implementation), then
run:

```powershell
docker compose up --build
```

Open `http://localhost:8000`.

## Configure Models

Open **Preferences & model settings** at the lower left, then use **Add model
configuration**:

1. Give the configuration a recognizable name, such as `Daily conversation` or
   `Local Ollama`.
2. Select the API shape. **Chat Completions compatible** is the usual choice
   for OpenAI-compatible providers.
3. Enter the provider Base URL (normally including `/v1`), the exact model ID,
   and an optional API key.
4. Save it locally and use **Test** to verify the connection.
5. Choose a default for new chats, or select any saved profile from the compact
   **This turn's model** control above the message composer.

The model selector never displays API keys. Switching the model changes the
model used for the next message; it does not change the selected book room,
reader notes, or spoiler policy.

The same settings area contains an optional display name for the local
interface. It does not become companion memory and is not automatically sent
to a model provider. Books, documents, and reading traces remain in the
separate **Local Library** area in the upper-right corner.

For a model process running on the host while using Docker, do not use
`127.0.0.1` from inside the container. Use
`http://host.docker.internal:11434/v1` (or the equivalent reachable host).

Environment variables remain available for a single legacy/default connection
and take precedence over values saved through the older settings endpoint:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

The Windows launcher only reads the documented allow-listed environment
variables and never prints their values.

## Local Development

### API

```powershell
Push-Location services\api
..\..\.venv\Scripts\python.exe -m pytest -q
Pop-Location
```

### Web

```powershell
Push-Location apps\web
npm run build
npm audit --omit=dev
Pop-Location
```

## Privacy And Safety

- The local server binds to `127.0.0.1` by default. Do not expose it publicly
  without authentication and a security review.
- Uploaded books, pasted notes, and OCR text are evidence, never instructions
  for the companion.
- Removing a book detaches its documents; it does not remove the original user
  files. Removing a BookMate document removes BookMate's local copy and index.
- Exported data includes conversations, memories, and library metadata, but not
  original book files or API keys.
- Use only books and annotations you may lawfully possess and process.

## License And Commercial Use

This repository is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).
It is source available for personal, educational, research, and other
noncommercial uses. It is not an OSI-approved open-source license.

Commercial use is **not** granted by this repository. It requires separate
written authorization from the copyright holder. See [NOTICE](NOTICE) and
[CONTRIBUTING.md](CONTRIBUTING.md) for the accompanying notices and
contribution terms.
