<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Staking Wallet Web Agent Guide

## Project Scope

- Primary repository: `D:\Ai\staking-wallet-web`.
- Legacy repository: `D:\Ai\Staking-Wallet`.
- Treat the legacy repository as read-only unless the user explicitly requests legacy work.
- Do not copy secrets, private keys, mnemonic phrases, service-role keys, production credentials, or local `.env` values into chat, docs, scripts, commits, or logs.
- When a secret-like value must be mentioned, print `[REDACTED]` instead of the value.

## Two-Computer Git Safety Rules

These rules are for working safely across a home PC and a laptop.

- Git is the handoff boundary between machines.
- Before editing, check the current branch, HEAD, upstream, ahead/behind state, and working tree status.
- Do not start new work while a merge, rebase, cherry-pick, revert, or bisect is in progress.
- Do not overwrite local work from the other computer.
- Do not run `git reset`, `git clean`, `git checkout --`, `git stash`, rebase, force-push, or branch deletion unless the user explicitly requests it.
- Use `git pull --ff-only` for sync when the working tree is clean and the branch is only behind upstream.
- Never force-push. If histories diverge, stop and report the branch, upstream, ahead/behind counts, and changed files.
- Do not commit generated output, dependency folders, local environment files, key material, mnemonic fixtures outside tests, build artifacts, or local tool caches.
- Do not push directly to `main` unless the user explicitly asks for that exact action.
- Keep package, lockfile, migration, generated type, and report changes scoped to the active task.
- Project local ports to check during handoff: `3000`, `3010`, `55721`, `55722`, `55723`, `55724`.

## Trigger Phrase: "작업 시작"

When the user says `작업 시작`, run the start check before making edits:

```powershell
node scripts/git-workflow/start.mjs
```

Required handling:

- Report repository path, machine name, branch, HEAD, upstream, ahead/behind state, and working tree status.
- If the working tree is dirty, identify existing changed files and ask whether they belong to the current task before editing.
- If the branch is behind upstream and the working tree is clean, prefer `git pull --ff-only` only when the user has not forbidden sync commands.
- If histories diverge or a Git operation is in progress, stop and report.
- Confirm that no local `.env` or secret-like file is about to be staged.

## Trigger Phrase: "작업 종료"

When the user says `작업 종료`, run the end check:

```powershell
node scripts/git-workflow/end.mjs
```

Required handling:

- Show changed files and whether anything is staged.
- Run task-appropriate verification before recommending a commit.
- Confirm package and lockfile changes are intentional when they exist.
- Confirm no `.env`, secret, private key, mnemonic, local build output, or dependency folder is staged.
- Do not commit or push unless the user explicitly asks.

## Trigger Phrase: "저장하고 넘겨줘"

When the user says `저장하고 넘겨줘`, treat it as a handoff request for the current branch.

First run:

```powershell
node scripts/git-workflow/handoff.mjs
```

Then proceed only if the checks pass:

- Stage only files that belong to the active task.
- Re-check the staged file list with `git diff --cached --name-only`.
- Re-check secrets before committing. Print only file paths and redact values.
- Commit with a clear conventional commit message. If the task or user supplied a commit message, use it exactly.
- Push the current branch to its upstream. If no upstream exists, ask before setting one.
- Do not push if the branch is diverged, if the working tree contains unrelated changes, or if the target is `main` without explicit permission.
- After push, report branch, commit SHA, upstream, clean/dirty status, and any remaining untracked files.

If the user adds `commit 금지`, `push 금지`, or equivalent wording, run only the handoff check and report the prepared changes.

## Script Contract

The scripts in `scripts/git-workflow/` are read-only safety checks.

- They do not stage, commit, push, pull, reset, clean, stash, install packages, run migrations, or edit files.
- They report Git state, local environment-file presence by file name only, secret-like path candidates by file name only, and common local development ports.
- They are safe to run from either computer before or after work.

## Commit And Push Guardrails

- Always review `git status --short` before staging.
- Always review `git diff --cached --name-only` after staging.
- Commit only files that are in the task scope.
- Never include `.env`, `.env.local`, `.env.*.local`, service-role credentials, database URLs, private keys, mnemonic phrases, wallet keypairs, build output, or dependency folders.
- Never use `npm audit fix`, dependency upgrades, generated migrations, or generated type changes as part of an unrelated handoff.
- After a successful commit or push, report what changed and what remains.
