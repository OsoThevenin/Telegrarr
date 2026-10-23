# Telegrarr — agent notes

Telegrarr is a fork of [Wishaal/Telearr](https://github.com/Wishaal/Telearr). Internal identifiers
(`telearr` cookie, `TELEARR_*` env vars, module names) stay as upstream for mergeability; only
user-facing branding is Telegrarr. The v1.0.0 plan is in `docs/TELEGRARR_V1_SPEC.md`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on OsoThevenin/Telegrarr, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root and `docs/adr/` for decisions. See `docs/agents/domain.md`.
