# Security Policy

Telegrarr handles Telegram API credentials, a live Telegram session, and login
credentials, and it downloads and writes files to your media library. We take
security seriously and appreciate responsible disclosure.

## Supported versions

Telegrarr moves quickly. Security fixes are applied to the latest released minor
version only; please upgrade before reporting.

| Version | Supported |
| --- | --- |
| 1.0.x | ✅ |
| Upstream Telearr | ❌ — report to [Wishaal/Telearr](https://github.com/Wishaal/Telearr) |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.**

Instead, use one of the following private channels:

1. **GitHub Security Advisories** (preferred): open a private report via the
   repository's **Security → Report a vulnerability** tab.
2. **Email:** send details to **security@telearr.app** (or the maintainer contact
   listed in the repository metadata).

Please include as much of the following as you can:

- A description of the vulnerability and its impact.
- The version / commit you tested.
- Step-by-step reproduction instructions or a proof-of-concept.
- Any relevant logs, configuration, or affected component
  (e.g. auth, downloader, Newznab/SABnzbd API).

Please do **not** include real secrets (API hashes, tokens, passwords) in your
report — redact them.

## What to expect

- **Acknowledgement** within 5 business days.
- An initial assessment and severity classification shortly after.
- Coordinated disclosure: we'll work with you on a fix and a disclosure timeline,
  and credit you in the release notes if you'd like.
- Please give us a reasonable window to release a fix before any public
  disclosure.

## Scope

In scope:

- Authentication / session handling (`app/auth.py`).
- The Newznab indexer and SABnzbd download-client APIs and their API-key check.
- Path handling in the namer/downloader (e.g. path traversal into unintended
  directories).
- Secret handling and exposure via the API/UI.
- Dependency vulnerabilities that are exploitable in Telegrarr's configuration.

Out of scope:

- Issues that require an already-compromised host or root access.
- Exposing Telegrarr directly to the internet without a reverse proxy/TLS — this is
  explicitly discouraged (see below); harden your deployment first.
- Denial of service from self-inflicted misconfiguration.

## Deployment hardening

Telegrarr is designed to run behind your own network boundary:

- Run it as the intended unprivileged UID (`PUID`/`PGID`), not root.
- Keep `.env` at mode `0600` and never commit it.
- Set a strong random `TELEARR_SECRET_KEY` and a strong admin password.
- The container publishes port `8790` on your LAN — do **not** expose it directly
  to the internet. Front it with a reverse proxy providing TLS and, ideally, an
  additional authentication layer.
- Treat the Newznab/SABnzbd API key like a password.

Thank you for helping keep Telegrarr and its users safe.
