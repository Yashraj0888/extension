# Privacy Policy

**Last updated:** 26 August 2026

This Privacy Policy explains how **AfterMeet** handles information when you use the open-source Chrome extension and local app.

AfterMeet is designed to be **local-first**: meeting content stays on your machine unless **you** send it to a third-party AI provider or export/backup it yourself.

---

## 1. Who we are

AfterMeet is maintained as an open-source project. Repository maintainers do **not** run a central AfterMeet cloud that receives your transcripts by default.

If you use a fork or a redistribution packaged by someone else, that distributor’s practices may differ — review their materials.

---

## 2. Information the extension processes

### On your device (local)

Depending on how you use AfterMeet, the extension may store locally in Chrome storage (and optional backup folders you choose):

| Data | Examples |
|------|----------|
| Meeting content | Transcripts, summaries, action items, chat messages, highlights, bookmarks |
| Meeting metadata | Titles, dates, duration estimates, participants / speaker labels, tags, spaces |
| App preferences | Theme, UI settings, export defaults |
| Integration settings | AI provider choice, model names, API keys you paste, Calendar OAuth tokens / client ID you configure |
| Capture state | In-progress caption buffers while a Meet call is active |

Local storage uses Chrome APIs such as `storage` and `unlimitedStorage`. Optional folder backup writes JSON (or similar) to a directory **you** select via the browser’s file access prompts.

### Not collected by project maintainers by default

The official open-source build does **not** include analytics SDKs that phone home meeting content to AfterMeet maintainers. There is no AfterMeet account system in the core extension.

---

## 3. Information sent off your device

### AI providers (only if you configure them)

When you run summary, action-item, chat, or similar features, AfterMeet sends prompt content (often including transcript excerpts and meeting context) from **your browser** to the API endpoint of the provider **you** chose (for example Google Gemini, OpenAI, Anthropic, DeepSeek, or a custom OpenAI-compatible URL).

Those providers process data under their own privacy policies. Review:

- [Google AI / Gemini privacy](https://policies.google.com/privacy)
- [OpenAI privacy](https://openai.com/privacy)
- [Anthropic privacy](https://www.anthropic.com/legal/privacy)
- Your custom endpoint’s policy

**API keys** you enter are stored locally and used to authenticate those requests. Do not share keys in issues, PRs, or screenshots.

### Google Meet

Caption text is read from the Meet page in your browser while you use capture. Google’s products remain governed by Google’s terms and privacy policy.

### Google Calendar (optional)

If you connect Calendar, OAuth tokens and calendar-related requests go to Google APIs using the client configuration you supply. Tokens are stored locally.

### Exports and backups

If you export Markdown/Word/PDF/JSON or enable folder backup, files exist wherever **you** save them. Protect those files like any confidential notes.

---

## 4. Permissions (Chrome)

The extension requests permissions described in `manifest.json`, including (as applicable):

- Access to `meet.google.com` for caption capture
- Storage for local notes
- Tabs / scripting / activeTab for the Meet experience and app
- Downloads for exports
- Identity for optional Calendar OAuth
- Host access to AI and Google API endpoints you use
- Optional broader host access if you use a custom HTTP(S) AI endpoint

Permissions exist so the extension can function; they are not a license for maintainers to access your machine.

---

## 5. Private meetings and controls

Where the product offers a **private** meeting flag or similar controls, use them to limit what appears in overview surfaces on **your** install. That does not encrypt data against someone with access to your browser profile.

You can typically erase local AfterMeet data from in-app **Data & privacy** settings (wording may vary by version). Uninstalling the extension removes extension storage associated with it, subject to Chrome’s behavior.

---

## 6. Children

AfterMeet is not directed at children under 13 (or the minimum age in your region). Do not use it to process children’s data in violation of applicable law (for example COPPA).

---

## 7. International use

You are responsible for complying with privacy and employment laws that apply to your meetings and participants (including cross-border transfer rules when you send data to an AI provider in another country).

---

## 8. Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities. No method of electronic storage is 100% secure; protect your browser profile, device encryption, and API keys.

---

## 9. Changes

We may update this policy by editing this file. The “Last updated” date will change. Review it when you upgrade.

---

## 10. Contact

- Security: [SECURITY.md](SECURITY.md)
- General questions: GitHub Issues on the project repository
- Terms of use: [TERMS.md](TERMS.md)

---

*This document describes the intended behavior of the open-source AfterMeet extension. It is not legal advice.*
