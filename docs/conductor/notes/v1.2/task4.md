# v1.2 Task 4 — conductor notes

- **OWNER GATE.** PR title starts `[OWNER GATE]`. The only dependency added is `yaml` (latest 2.x); nothing
  else in package.json changes. New `tests/fixtures/config/*.yaml` files go in their own commit, before the
  code, for owner approval; no existing fixture or snapshot changes.
- Review Focus 5 (`awkward yaml files`): empty file, only `default`, CRLF, duplicate key, `api_key_env` set to
  `""` → a startup error naming the problem; CRLF parses normally. Keys never appear in errors, logs or the
  routing table — only env var names. (Source: plan.)
