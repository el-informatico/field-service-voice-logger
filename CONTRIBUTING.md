# Contributing — triple pre-commit validation

This repo enforces three mechanical commit gates. They are tripwires, not
containment: `git commit --no-verify` bypasses them, which is why the
behavioral rules below matter as much as the hooks.

## 1. No AI-tool attribution in commit messages

No `Co-Authored-By:` trailers naming an AI vendor, no
"(generated|written|authored|assisted) with/by <vendor>" credits, no
robot-emoji signatures. Subject-matter mentions of AI tools (e.g. "remove
the Anthropic path") and human co-author trailers keep passing.
Gate: `scripts/hooks/commit-msg`.

## 2 & 3. No sensitive tokens in staged added lines or commit messages

Staged ADDED lines (and the commit message itself) must not introduce:

- host user-home paths (Linux home, Windows-mount, raw Windows profile paths)
- sibling-project identifiers from the author's machine (other local
  project names, local infrastructure names)

Matching is literal, one string per line, against a local list stored at
`$(git rev-parse --absolute-git-dir)/sensitive-tokens` — inside the git
dir, per-clone, and never tracked. A fresh clone reseeds the list from the
author's local reference copy kept outside every repository. If the list
is absent or empty the check is disabled (fail-open bootstrap); if it
exists but is unreadable, the commit is refused (fail-closed).
Gate: `scripts/hooks/pre-commit` → `scripts/guard-sensitive-content.sh`.

## Behavioral rules (bind even where hooks can't see)

- Never write AI-attribution trailers yourself; the hook is a tripwire,
  not an excuse.
- Never commit with `--no-verify`.
- Planning notes or scratch files that must quote raw sensitive strings
  (local paths, sibling names, hostnames) live OUTSIDE this working tree —
  never inside it, even untracked. In repo content and replies, use
  tokenized/category references ("a sibling project", "the internal
  benchmark workspace"), not the raw strings.
- Binary staged content is not scanned; linked worktrees carry a different
  git dir and thus a different token list.

## Wiring

```bash
git config core.hooksPath scripts/hooks   # once per clone
chmod +x scripts/hooks/* scripts/guard-sensitive-content.sh
```
