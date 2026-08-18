# Security Policy

## Local Data and Secrets

- Never commit `.env`, API keys, uploaded books, conversations, SQLite files,
  indexes, or generated artifacts.
- Configure model credentials through environment variables or the local UI.
  API responses must only expose whether a key is configured.
- Treat imported documents, web material, and reader notes as untrusted input.
  They may be cited as evidence but must not change system instructions.
- Keep the default service binding on `127.0.0.1`. Public deployment requires
  authentication, transport security, and an explicit threat-model review.

## Reporting

Until a public issue tracker and security contact are configured, do not post
suspected vulnerabilities in public documentation. Keep a private reproduction
record with affected version, impact, and minimal steps, then establish the
repository's security contact before publication.
