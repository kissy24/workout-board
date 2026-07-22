# Workout Board development workflow

These instructions apply to the entire repository.

## Start from a clean, current base

1. Inspect `git status` before changing files. Preserve unrelated user changes and never discard them to make the tree clean.
2. For new work, update the default branch with `git checkout main` and `git pull --ff-only origin main`.
3. Create a focused branch from `main` using `feat/`, `fix/`, `docs/`, `test/`, or `chore/` followed by a short kebab-case description. Do not commit directly to `main`.
4. Install exactly the locked dependencies with `bun install --frozen-lockfile`. This also configures the repository's tracked pre-commit hook.

## Implement and verify

- Keep each change scoped to the user's request. Update tests and README documentation when behavior, setup, or commands change.
- Use Bun for package management and scripts. Do not introduce Node/npm commands.
- For UI changes, check both desktop and mobile layouts, light and dark color schemes, keyboard focus, overflow, and interactive states. Use demo mode (`WORKOUT_BOARD_DEMO=1 bun run dev`) when real data is unnecessary.
- Before committing, run `bun run format`, review the complete diff, and run `bun run precommit`.
- The pre-commit hook repeats the required type, lint, test, build, and staged-whitespace checks. Do not bypass it with `--no-verify` unless the user explicitly authorizes that exception.
- Run `bun run security` when dependencies or the lockfile change.

## Commit and open a pull request

1. Use a concise Conventional Commit message such as `fix: prevent stale dashboard assets`.
2. Push the topic branch to `origin`.
3. Open a pull request against `main`. Include a summary of user-visible changes and the exact validation performed.
4. Wait for every GitHub Actions job to finish. Investigate failures and update the same branch until CI is green.
5. Report the PR link, commit, and CI result. Do not merge the PR unless the user asks you to merge it.

After a merged PR, sync local `main` before beginning the next task. Only delete local or remote branches when requested or when deletion is clearly part of the user's workflow.
