# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest `main` / released tag | Yes |
| Older unpacked installs | Please update to latest before reporting duplicates |

AfterMeet is distributed as source you load as an unpacked Chrome extension. Security fixes ship in this repository; reload the extension after pulling updates.

## What to report

Please report:

- Cross-site scripting or injection in the app / popup / content script
- Accidental exfiltration of transcripts or API keys
- Insecure handling of OAuth tokens or storage
- Privilege issues around `optional_host_permissions` or downloads
- Dependency or supply-chain concerns in documented tooling

Please **do not** open a public issue for unfixed vulnerabilities.

## How to report

1. Prefer **GitHub Security Advisories** (Private vulnerability reporting) on this repository when enabled.
2. Otherwise contact a maintainer listed in [`.github/CODEOWNERS`](.github/CODEOWNERS) privately.

Include:

- AfterMeet version (`manifest.json` → `version`)
- Chrome version and OS
- Steps to reproduce
- Impact (what data or permission is at risk)
- Any proof-of-concept (kept minimal and non-destructive)

## Safe harbor

We appreciate good-faith research. Avoid privacy violations, service disruption, or accessing other users’ data. Do not demand ransom.

## API keys and meeting data

Never paste live API keys, OAuth client secrets, or real meeting transcripts into public issues, PRs, or screenshots. Redact them.

## Disclosure

We aim to acknowledge reports within **7 days** and to share a remediation plan when practical. Timelines vary for a volunteer-maintained project.

Thank you for helping keep AfterMeet users safe.
