# Contributing to AfterMeet

Thanks for helping improve AfterMeet. By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

This guide assumes the repo uses a **protected `main` branch**: you cannot push commits straight to `main`. All changes go through a **pull request (PR)**.

Also see: [Terms of Use](TERMS.md) · [Privacy Policy](PRIVACY.md) · [Security Policy](SECURITY.md) · [MIT License](LICENSE)

---

## Rules of the road

| Rule | Detail |
|------|--------|
| No direct pushes to `main` | Open a PR instead |
| No force-pushes to `main` | Blocked by branch protection |
| Reviews required | At least **1 approval** (Code Owners when enabled) |
| Keep PRs small | One concern per PR when possible |
| Never commit secrets | No API keys, OAuth client secrets, or `.env` files with real values |

---

## 1. Fork and clone

1. Click **Fork** on the GitHub repo (if you are not a collaborator with write access).
2. Clone **your** fork:

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/aftermeet.git
cd aftermeet
```

3. Add the upstream remote (replace with the official org/user):

```bash
git remote add upstream https://github.com/UPSTREAM_OWNER/aftermeet.git
git remote -v
```

---

## 2. Sync with `main` before you start

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

If you work only on a fork without `upstream` yet:

```bash
git checkout main
git pull origin main
```

---

## 3. Create a branch

Never commit on `main` for contribution work.

```bash
git checkout -b feature/short-description
```

Branch name ideas:

- `feature/ask-ai-filters`
- `fix/caption-dedupe`
- `docs/readme-screenshots`

---

## 4. Make and test changes

1. Edit the code in this repo (no build step for normal use).
2. In Chrome: `chrome://extensions` → **Reload** AfterMeet.
3. Close any open AfterMeet app tabs, then open the app again from the popup.
4. For capture changes: join a Meet call, turn **captions** on, confirm the widget / transcript.
5. For AI / Settings: use **Test connection** (use your own keys locally — do not commit them).

---

## 5. Commit

```bash
git status
git add .
git commit -m "Explain why this change helps users"
```

Good commit messages focus on **why**, not a file list.

Do **not** commit:

- Real API keys or tokens  
- Personal meeting transcripts  
- Local-only files (for example real `.env` contents)

`.env.example` is fine; keep it placeholder-only.

---

## 6. Push and open a pull request

```bash
git push -u origin feature/short-description
```

Then on GitHub:

1. Open a **Pull Request** into **`main`** of the upstream repo.
2. Fill in what changed and how you tested it.
3. Wait for CI (if enabled) and a **Code Owner / maintainer review**.
4. Address review comments with new commits on the **same branch** (do not open a second PR for tiny fixes).

Example PR body:

```markdown
## Summary
- What problem this solves

## Test plan
- [ ] Reloaded unpacked extension
- [ ] Verified on meet.google.com with captions
- [ ] Checked Settings / AI if touched
```

---

## 7. After your PR is merged

```bash
git checkout main
git pull upstream main
git branch -d feature/short-description
```

---

## Code Owners

Reviewers are defined in [`.github/CODEOWNERS`](.github/CODEOWNERS). When branch protection has **Require review from Code Owners** enabled, matching paths auto-request those people.

Maintainers: replace `@YOUR_GITHUB_USERNAME` in that file with real GitHub handles after the repo is created.

---

## Maintainer checklist (protect `main`)

Do this once on GitHub after the repo exists:

1. **Settings → Branches → Add branch ruleset** (or classic branch protection) for `main`
2. Enable:
   - Require a pull request before merging  
   - Require approvals: **1**  
   - Require review from Code Owners  
   - Dismiss stale pull request approvals when new commits are pushed  
   - Block force pushes  
   - Restrict deletions  
3. Optionally require status checks when you add CI  
4. Limit **Allow specified actors to bypass** — prefer nobody, or admins only  

Collaborators should have **Write** (push branches + open PRs). Only trusted people need **Admin**.

---

## Questions

Open a GitHub **Issue** for bugs or feature ideas before large PRs when the change is unclear. That saves wasted work on both sides.
