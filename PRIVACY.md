# Privacy Policy

**Last updated:** 21 October 2026

This Privacy Policy explains how **AfterMeet** (“we”, “us”) handles information when you use the AfterMeet Chrome extension and local app.

AfterMeet is designed to be **local-first**: meeting content stays on your machine unless **you** send it to a third-party AI provider or export/backup it yourself.

---

## 1. Who we are

AfterMeet is a Chrome extension that helps you capture Google Meet captions, generate AI summaries and action items, and keep meeting notes on your device.

We do **not** operate a central AfterMeet cloud that receives your transcripts by default. There is no AfterMeet account required to use the core extension.

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

Local storage uses Chrome APIs such as `storage` and `unlimitedStorage`.

**Chrome Sync note:** your *settings* (theme, preferences, prompt templates, AI provider choice, and any AI provider API keys you enter) are saved with `chrome.storage.sync`. If you are signed in to Chrome with sync enabled, Chrome may sync these settings, **including API keys**, across your own devices through your Google account. Meeting content (transcripts, summaries, chats) is stored with `chrome.storage.local` and is **not** synced by AfterMeet. Calendar OAuth tokens are stored locally only. Backup/export files exclude API keys and OAuth tokens.

Optional folder backup writes JSON (or similar) to a directory **you** select via the browser’s file access prompts.

### What we do not collect

The AfterMeet extension does **not** include analytics SDKs that send meeting content to AfterMeet servers. We do not require an AfterMeet account, and we do not receive your transcripts unless you contact us and voluntarily share them (for example when reporting a bug).

---

## 3. Information sent off your device

### AI providers (only if you configure them)

When you run summary, action-item, chat, or similar features, AfterMeet sends prompt content (often including transcript excerpts and meeting context) from **your browser** to the API endpoint of the provider **you** chose (for example Google Gemini, OpenAI, Anthropic, DeepSeek, or a custom OpenAI-compatible URL).

Those providers process data under their own privacy policies. Review:

- [Google AI / Gemini privacy](https://policies.google.com/privacy)
- [OpenAI privacy](https://openai.com/privacy)
- [Anthropic privacy](https://www.anthropic.com/legal/privacy)
- Your custom endpoint’s policy

**API keys** you enter are stored on your device (via Chrome storage) and used only to authenticate those requests. Do not share keys in screenshots or support messages.

### Google Meet

Caption text is read from the Meet page in your browser only after you choose **“Yes, record”** in the in-call prompt for that call. You are responsible for telling other participants that you are taking notes and for complying with any consent or recording laws that apply to them. Google’s products remain governed by Google’s terms and privacy policy.

### Google Calendar (optional)

If you connect Calendar, OAuth tokens and calendar-related requests go to Google APIs using the client configuration you supply. Tokens are stored locally. AfterMeet requests only the read-only scope `https://www.googleapis.com/auth/calendar.readonly` to show your upcoming meetings.

**Google API Services User Data Policy / Limited Use.** AfterMeet’s use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Calendar data is used only to display your upcoming meetings inside the extension on your device. It is not transferred to AfterMeet or to third parties for advertising, is not sold, and is not read by humans except as needed to provide support if you explicitly share it with us.

### Fonts and other network requests

The extension bundles its fonts and does not load scripts or other code from remote servers. The only network requests it makes are to Google Meet (the page you are on), the AI provider endpoint you configure, and (if you connect Calendar) Google’s OAuth and Calendar APIs.

### Data we do not do

We do not sell or transfer user data to third parties outside the approved use cases above, do not use or transfer it for purposes unrelated to the extension’s single purpose (taking notes on your meetings), and do not use or transfer it to determine creditworthiness or for lending purposes.

### Exports and backups

If you export Markdown/Word/PDF/JSON or enable folder backup, files exist wherever **you** save them. Protect those files like any confidential notes.

---

## 4. Permissions (Chrome)

The extension requests permissions described in its Chrome Web Store listing / `manifest.json`, including (as applicable):

- Access to `meet.google.com` (content script) to read captions while you capture a meeting
- `storage` / `unlimitedStorage` to keep meeting notes locally
- `downloads` for exports (PDF, Word, Markdown, JSON backups)
- `identity` for the optional Google Calendar OAuth flow
- Host access to the AI endpoints (Gemini, OpenAI, Anthropic, DeepSeek) and Google APIs you use
- Optional host access, requested at runtime for one origin only, if you use a custom OpenAI-compatible endpoint

Permissions exist so the extension can function; they are not a license for AfterMeet to access your machine beyond what the extension needs to provide its features.

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

Protect your browser profile, device encryption, and API keys. No method of electronic storage is 100% secure. To report a security issue, contact us using the details in the Contact section below.

---

## 9. Changes

We may update this Privacy Policy from time to time. The “Last updated” date will change when we do. Continued use of AfterMeet after an update means you accept the revised policy. Review it when you upgrade the extension.

---

## 10. Contact

For privacy questions or security reports about AfterMeet, contact:

- Email: [yashraj88813@gmail.com](mailto:yashraj88813@gmail.com)
- Chrome Web Store listing support / contact options for AfterMeet (when published)

Related: [Terms of use](TERMS.md)

---

*This document describes how AfterMeet handles information. It is not legal advice.*
