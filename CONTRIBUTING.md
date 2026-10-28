# Contributing to Telegrarr

Thanks for your interest in improving Telegrarr! This guide covers local development,
coding style, and the pull-request process. By contributing you agree that your
work is licensed under the project's [GPL-3.0](LICENSE) license.

## Ways to contribute

- Report bugs and request features via [GitHub Issues](../../issues) (use the
  templates).
- Improve documentation (`README.md`, the `docs/` guides).
- Fix bugs or build features — please open or comment on an issue first for
  anything non-trivial so we can agree on the approach.

## Project overview

Telegrarr is a [FastAPI](https://fastapi.tiangolo.com/) +
[Telethon](https://docs.telethon.dev/) app targeting **Python 3.13**. It ships as a
single Docker container that runs one uvicorn worker. The scanner keeps
process-wide asyncio state, so it is correct **only** under a single event
loop / single worker — do not raise `--workers` above 1 without moving the scanner
into its own process. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a
module-by-module tour before making structural changes.

## Local development setup

You can develop against the local Python app without Docker.

```bash
# 1. Clone and enter the repo
git clone <your-fork-url> telearr
cd telearr

# 2. Create and activate a virtual environment (Python 3.13)
python3.13 -m venv .venv
source .venv/bin/activate

# 3. Install runtime + dev dependencies
pip install -r requirements.txt -r requirements-dev.txt

# 4. Provide config
cp .env.example .env
$EDITOR .env          # at minimum: TG_API_ID, TG_API_HASH, TELEARR_SECRET_KEY,
                      # TELEARR_ADMIN_USER, TELEARR_ADMIN_PASS
```

Because config is read from environment variables (see `app/config.py`), export
your `.env` before running locally. Point the path variables at throwaway
directories so you don't touch a real library:

```bash
set -a && source .env && set +a
export TELEARR_DATA_DIR=./data
export TELEARR_TV_DIR=./library/TvShows/1080p TELEARR_TV_DIR_4K=./library/TvShows/4K
export TELEARR_MOVIES_DIR=./library/Movies/1080p TELEARR_MOVIES_DIR_4K=./library/Movies/4K
export TELEARR_OTHER_DIR=./library/Other
```

### Run the app locally

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8790
```

Open <http://127.0.0.1:8790>. First run seeds the admin user from
`TELEARR_ADMIN_USER` / `TELEARR_ADMIN_PASS`. To download anything you also need a
Telegram session — run `python authorize.py` once and follow the prompts.

### Run the tests

```bash
python -m pytest -q
```

Tests should not require network access or a real Telegram session — mock Telethon
and any HTTP calls (`httpx`) so the suite runs in CI. New behavior should come with
tests, especially the pure logic in `app/namer.py` (episode/quality parsing, path
building) and `app/settings.py` (validation/coercion), which are the easiest to
cover without I/O.

## Coding style

- **Python style:** follow [PEP 8](https://peps.python.org/pep-0008/). Keep lines
  reasonable (~100 columns, matching the existing code). Prefer clear names over
  comments, but keep the "why" comments the codebase favors.
- **Formatting/linting:** run `ruff` before pushing:
  ```bash
  ruff check app
  ruff format app        # optional, keep diffs minimal
  ```
  Do not reformat unrelated code in a feature PR — keep diffs focused.
- **Typing:** use type hints for new function signatures where it aids clarity
  (the codebase uses modern `X | None` syntax).
- **Async:** all I/O paths are `async`; never block the event loop. Offload
  blocking file/CPU work with `run_in_executor` as the downloader does.
- **Database:** always go through `db.conn()` context manager (it commits on
  success, rolls back on error). Add an index when you add a hot query path.
- **Logging:** user-facing events go through `db.log(level, message, channel_id=…)`
  so they appear in the Activity page; developer detail goes through the module
  `logging` logger.
- **Config vs settings:** boot-time, restart-required values live in
  `app/config.py` (env). Live-tunable values live in `app/settings.py` (DB-backed)
  and must be added to both `DEFAULTS`/`public()` and the `WRITABLE` coercers.

## Branch naming

Branch off `main`. Use a short, descriptive, hyphenated name with a type prefix:

- `feat/arr-newznab-caps`
- `fix/progress-bar-stuck`
- `docs/arr-integration-guide`
- `chore/bump-telethon`
- `test/namer-quality-routing`

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(optional scope): <short summary>

<optional body explaining what & why>
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`.
Examples:

```
feat(arr): serve Newznab caps endpoint
fix(downloader): re-resolve file_reference on expiry
docs: document SABnzbd client setup
```

Keep commits focused and the history readable; squash noise before opening the PR.

## Pull-request process

1. Fork the repo and create a branch from `main`.
2. Make your change, add/adjust tests, and update docs (`README.md`, `docs/`,
   `CHANGELOG.md`) when behavior or setup changes.
3. Run `python -m pytest -q` and `ruff check app` locally — CI runs the same.
4. Open a PR against `main`, fill in the
   [pull-request template](.github/pull_request_template.md), and link the issue it
   closes (`Closes #123`).
5. Keep the PR scoped to one logical change. A maintainer will review; please be
   responsive to feedback. Once approved and green, it will be merged.

### Changelog

Add a bullet under an `## [Unreleased]` heading (or the current in-progress version)
in [CHANGELOG.md](CHANGELOG.md) for anything user-visible.

## Reporting security issues

Please **do not** open a public issue for security vulnerabilities. Follow the
process in [SECURITY.md](SECURITY.md).
