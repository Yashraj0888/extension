# AfterMeet — Feature overview (temp)

> Temporary product map of **what users can do** across the extension. Focus is features only — not setup or architecture.

---

## Big picture

Users capture live captions in **Google Meet**, save meetings locally, then work with them in a full **notes library** app: browse, search, filter, chat with AI, generate summaries and action items, organize with labels/spaces, connect Google Calendar, and export.

Surfaces:

1. **Toolbar popup** — quick status, AI keys, launch actions  
2. **Notes library (app)** — Home, meetings, Ask AI, Settings  
3. **On-page widget** — live capture during Meet  

---

## 1. Toolbar popup

- See whether you’re **in a meeting / recording**
- Toggle **light / dark** theme
- **Open notes library**
- **Start Meet**
- Glance at totals: meetings, open actions, highlights
- **Open last meeting**
- **Copy open action items** across recent meetings
- Configure **AI provider** (Gemini, OpenAI, Claude, DeepSeek, or Custom OpenAI-compatible)
- Paste API key, pick model / custom model, set base URL (custom)
- **Test connection** and **Save settings**
- Toggles: ask before taking notes; offer summary download at end
- Choose **default export format** (PDF, Word, Markdown, TXT, RTF, HTML)
- Meet captions help, and link to **full Settings**

---

## 2. App shell (everywhere in the library)

### Left sidebar
- Click **AfterMeet** brand → go **Home**
- Collapse / expand sidebar
- Search recent meetings; collapsed mode opens a **Find a meeting** modal
- Navigate: **Home**, **All meetings**, **My Tasks**, **People**, **Favorites**, **Search**, **Ask AI**, **Settings**
- Open any **Recent** meeting; use **⋯** menu on each item
- Storage note: unlimited local storage (shown in Settings → Privacy)

### Top bar
- **New notes** (blank meeting)
- **Import** transcript (`.txt` / `.md` / `.json`)
- **Export** full JSON backup (keys stripped)
- Jump to **Ask AI**
- **Keyboard shortcuts** modal
- **Focus mode** (hide sidebars)
- Theme toggle (right-click cycles light → dark → system)

### Shortcuts (examples)
- ⌘/Ctrl+K quick search · ⌥+J Ask AI / chat · ⌥+T transcript · ⌥+S summary  
- ⌘/Ctrl+1–5 meeting tabs · ⌘/Ctrl+N new · ⌘/Ctrl+, settings · ⌘/Ctrl+. details · ⌘/Ctrl+\ focus  

---

## 3. Home

- Greeting + profile initials; global search over recent meetings
- Quick actions: Meet, Import
- Provider status card; analytics (meetings, time, averages, favorites / trends)

### Today / Upcoming
- Tabs: **Today’s meetings** | **Upcoming (24h)** (calendar)
- See recorded cards + upcoming calendar events (time, countdown, tags)
- Open recorded card → meeting; **⋯** on cards
- **View calendar**, **Connect calendar**, **View all** meetings

### Recent meetings table
- Tabs: All / Meet / Starred / With notes
- Filters: **Date** (including **Custom…** calendar range picker), **People**, **Duration**
- Open row, star/unstar, row **⋯** menu

### Meeting menus (cards / rows / recent)
- Open · Ask AI about this · Transcript · Summary  
- Rename · Favorite · Pin · Copy open actions · Delete  

---

## 4. All meetings

- Card grid of every meeting (platform, when, duration, people, preview, tags, private)
- Filter by **tag pills**
- Open → Chat; same **⋯** menu

---

## 5. My Tasks

- Sidebar nav **My Tasks** (+ open-task count for items assigned to you)
- Aggregates the **same** `actionItems` stored on each meeting (no separate task DB)
- Stats: Overdue / Due Today / This Week / Open / Completed
- Each row: source meeting, owner, priority, deadline; click opens meeting (transcript jump when `sourceEntryIndex` exists)
- Edit owner / deadline / priority · complete · delete
- Filters: status, meeting, priority, deadline presence
- Per-meeting Action items tab unchanged and stays in sync

---

## 5b. People Insights

- Sidebar nav **People** (participant count)
- Built only from existing meeting data: participants / speakers, talk-share %, action-item owners, Transcript Intelligence decisions/questions/mentions, and name mentions in transcript lines
- Per person: meetings participated, open/completed actions, decisions & questions involving them, relevant transcript mentions
- Click any row to open the source meeting (transcript jump when a line index exists)
- No personality assessments, sentiment scores, or productivity judgments — and no separate participant database

---

## 6. Favorites

- Grid of starred meetings only; open / menu same as elsewhere

---

## 6. Search

- Full-text search across transcripts
- Results with match count + speaker snippets (query highlighted)
- Open → that meeting’s **Transcript** with search applied

---

## 7. Ask AI (across meetings)

- Add meetings first (picker: search, multi-select)
- Selected meetings as removable chips
- Suggested prompts + quick actions (Summary, Action Items, Key Insights, Quick Prompts)
- Free-text chat (Enter send); clear conversation
- Can add a meeting into Ask from a meeting’s **⋯** menu

---

## 8. Single meeting

### Header
- Back home; rename title; meta (date, duration, people, Meet)
- Add/remove **tags**; Pin; Favorite; Delete

### Tabs

| Tab | What you can do |
|-----|-----------------|
| **AI chat** | Suggested prompts + free Q&A on this transcript; history kept |
| **Transcript** | Search, filter by speaker, rename speaker (everywhere), highlight lines, timestamps/dense via Preferences; **Topic Navigation** — AI chronological major topics (title, start/end timestamp, short description) persisted on the meeting; click a topic to jump to that transcript line; Generate / Regenerate with loading, empty, and error states; skips noisy/similar topics; **Transcript Intelligence** — AI markers (Decision / Action / Question / Important / Risk / Mention) on lines without rewriting text; click marker for context; dismiss bad markers; persists on meeting; works on older meetings when you run the button; Action markers link/create action items without duplicates; totals strip (`!` / `Q` / …) with people-by-category panel; Prev/Next jump between markers; sticky **Jump to action items**; popover flips above when space is tight so markers stay visible |
| **Summary** | Types (e.g. Executive / Engineering / Decisions / Actions); Generate / Regenerate; may auto-suggest title & labels; **Meeting Score** (0–100) auto-generated after analysis — fixed rubric (Decisions 20 / Actions 20 / Ownership 20 / Deadlines 15 / Questions resolved 15 / Completeness 10); counts from stored meeting data only; clickable ✓/⚠ lines expand exact items with timestamps + View in transcript; no Regenerate button; soft-fails to Unavailable without blocking save |
| **Action items** | Re-scan with AI; check done; delete; owners / priority / deadlines when present; **Commitment Detector** — AI finds implied commitments (“I’ll send that…”) as Potential Commitments (person, deadline, timestamp, confidence); Add to Actions or Dismiss; never auto-creates tasks; preserves transcript source; skips duplicates of existing action items |
| **Highlights** | Jump to bookmarked lines; remove highlight |

---

## 9. Right details panel

- Collapse / expand; rail jumps to sections

### On Home
- Quick stats; **Pinned** list; shortcuts cheat sheet

### On a meeting
- **Details:** owner, private toggle, share brief (clipboard), link/edit **recording URL**, add **label**, add to **space** (create/select), duplicate, favorite, pin  
- **Participants:** talk-share donut + %, expand/collapse; double-click speaker to rename (merges provisional “You” with your real name)  
- **Export:** copy transcript / summary; download Markdown / Word; print / PDF  

### On Settings
- Side tips: active AI, export, privacy  

---

## 10. Settings

| Tab | What you can do |
|-----|-----------------|
| **AI providers** | Choose provider, key, model / custom model, base URL; test & save |
| **Prompt templates** | Built-ins (Standard, Concise, Standup, Sales) + custom; edit, activate, new, delete |
| **Google Calendar** | Client ID, redirect URI, connect / disconnect |
| **Preferences** | Download offer; reopen last meeting; collapsed sidebar start; hide private on Home; confirm delete; auto-pin with actions; transcript timestamps / dense / copy timestamps |
| **Data & privacy** | Default export format; JSON backup; link / reconnect / restore **backup folder**; erase all data; Meet notes |

---

## 11. Live capture (Google Meet)

- Capturing starts automatically when you join an active Google Meet call
- End-of-meeting modal with close control to dismiss and open the summary
- Auto-enable captions when possible
- Floating widget: status, people/time/line stats, live preview
- Three fixed-size modes: expanded, compact, and mini pill
- **Open notes app** · **Highlight moment** (⌘/Ctrl+B) · **Pause / Resume** · **Clear transcript** · **Finish** · **Close** (confirm stop & save)
- Periodic auto-save; save when call ends / tab closes

### End-of-meeting flow
- Summary scope: entire meeting or **my parts only** (pick/type your name)
- Optional download in chosen format
- Open summary only, or generate & continue

---

## 12. Ways meetings get into the app

- Live capture (Google Meet)  
- Blank **New notes**  
- **Import** transcript file  
- **Duplicate** meeting  
- JSON backup export / restore; optional **folder backup** mirror  

Meetings can be **private**, **favorited**, **pinned**, **tagged**, put in **spaces**, and linked to a **recording**.

---

## Feature map (at a glance)

```
Popup ──► Open app / Start Meet / AI keys / quick stats
                │
                ▼
         Notes library
    ┌─────┬─────┬──────┬──────┬─────┬────────┐
    Home  All  Tasks People Fav  Search  Ask AI  Settings
      │                              │
      ├ Today / Upcoming (Calendar)  ├ Providers
      ├ Filters + table              ├ Templates
      └ Analytics                    ├ Calendar OAuth
                                     ├ Preferences
                                     └ Backup / erase
                │
                ▼
         Meeting workspace
    Chat · Transcript · Summary · Actions · Highlights
                │
         Right panel: details · talk share · export

Meet page ──► Widget (record, pause, highlight, finish)
```

---

*Temp doc — product features only. See `README.md` for install and setup.*
