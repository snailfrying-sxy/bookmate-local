# BookMate Local

> **When a book truly enters a life, it rarely ends with an answer. More often,
> it leaves behind a question that takes a long time to finish.**

At that moment, what we want is not another synopsis. We want a book-friend who
can enter the same context: someone who understands why we stopped at a page,
lets an unfinished thought take shape, resonates without merely agreeing, and
can still remember much later where the conversation was left.

That kind of meeting is rare. Reading the same book is only the beginning. Two
people still need compatible depth and rhythm, time for one another, and the
patience to keep learning how the other thinks. Many things worth saying about
books remain unspoken simply because there is no one nearby who can receive the
next sentence.

## Bozhou Learns You Through Your Reading

BookMate begins with that absence. Its purpose is to let every reader build a
private, long-term AI book-friend of their own: **Bozhou**.

You can begin with a book read years ago, a single passage, an uncertain memory,
or a question that has just surfaced in ordinary life. Bozhou does not rush to
turn it into a polished answer. It first tries to understand what you are
reaching for, then stays with the feeling, contradiction, or unfinished thought
inside it. When evidence matters, it returns to the book. When it does not, it
lets the conversation breathe.

Resonance here does not mean constant agreement. A conversation worth returning
to should hold both the ease of being understood and the surprise of another
perspective. Bozhou can ask gently, disagree with reasons, and leave a question
open. It moves only half a step at a time so that new understanding can emerge
between turns instead of arriving as a wall of conclusions.

Nor does it pretend to have understood you from the start. Whatever Bozhou
learns comes from the reading traces you choose to share and the memories you
explicitly confirm: what mattered, where you disagreed, and which question the
two of you have not finished. The next conversation can then return to that
place rather than begin with another introduction.

## Your Library Is Shared Reading Ground

The private library in BookMate is not a pile of files waiting to be "consumed"
by AI, nor a showcase for RAG. It holds the context a reader and Bozhou need in
order to think together: books, editions, marked passages, unfinished
reflections, open questions, and the conversation threads the reader chooses to
keep.

A book is therefore more than a PDF or EPUB. A paper book, a title read in
another app, or even a work remembered only through one character can still
have a room of its own. As reading and conversation continue, the library gains
shape and helps Bozhou stay faithful to the reader's edition, progress, spoiler
boundary, and actual thoughts.

Retrieval, RAG, model selection, catalog search, and price tools matter, but
they belong behind the conversation. They should provide evidence when trust
requires it and open a path when the reader wants the next book. Technology has
one job here: to receive a thought with care and let a book keep happening after
it has been closed.

Bozhou remains a transparent AI book-friend, not an imitation human, author, or
character. It does not invent lived experience, quotations, pages, or sources,
and it never decides on its own what should become lasting memory. Books, notes,
conversations, and confirmed memories stay local by default. If the reader
chooses a remote model, BookMate discloses which relevant context may leave the
device.

## What Bozhou Can Do Today

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

Open **Preferences & models** at the lower left. The interface presents every
available connection as one list of **book-friend models**: chat only shows the
readable name you choose, never its deployment layer, protocol, or server
address. Use **Add model** when you want another option:

1. Give it a recognizable chat name, such as `Deep conversation` or
   `A quiet local model`.
2. Select the API shape. **Chat Completions compatible** is the usual choice
   for OpenAI-compatible providers.
3. Enter the provider Base URL (normally including `/v1`), the exact model ID,
   and an optional API key.
4. Save it and use **Try it** to verify the connection.
5. Choose a default for new chats, or select any saved profile from the compact
   **This turn's model** control above the message composer.

The model selector never displays API keys. Switching the model changes the
model used for the next message; it does not change the selected book room,
reader notes, or spoiler policy.

The same settings area contains an optional display name for the local
interface. It does not become companion memory and is not automatically sent
to a model provider. Books, documents, and reading traces remain in the
separate **Local Library** area in the upper-right corner.

Behind the scenes, the packaged default model comes from deployment settings
while saved model profiles are user-managed connections for Ollama, LAN, or
other compatible services. Both appear together in the same chat selector.
Test each model with a real text response; being able to list a model endpoint
is not sufficient proof that inference is working.

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
