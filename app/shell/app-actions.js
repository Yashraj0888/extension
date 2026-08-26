import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";

export async function exportBackup() {
  const local = await new Promise((r) => chrome.storage.local.get(null, r));
  const sync = await new Promise((r) => chrome.storage.sync.get(null, r));
  if (sync.providers) for (const p of Object.values(sync.providers)) if (p && p.apiKey) p.apiKey = "";
  const payload = { exportedAt: new Date().toISOString(), local, sync };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const reader = new FileReader();
  reader.onloadend = () => {
    chrome.downloads.download({
      url: reader.result,
      filename: `ai-meeting-notes-backup-${new Date().toISOString().slice(0, 10)}.json`,
      saveAs: true,
    });
    showToast("Backup download started");
  };
  reader.readAsDataURL(blob);
}

function isEmptyNote(meeting) {
  if (!meeting) return false;
  const title = (meeting.title || "").trim();
  const untitled =
    !title ||
    title === "Untitled notes" ||
    title === "Untitled Meeting";
  return (
    untitled &&
    !(meeting.transcript || []).length &&
    !(meeting.participants || []).length &&
    !(meeting.bookmarks || []).length &&
    !(meeting.tags || []).length &&
    !(meeting.actionItems || []).length &&
    !(meeting.spaceIds || []).length
  );
}

export async function createBlankMeeting() {
  // Reuse the current note when it is still empty (avoids spam from double-clicks).
  if (state.currentMeetingId) {
    const current =
      (state.currentMeeting?.id === state.currentMeetingId && state.currentMeeting) ||
      (await MeetingStore.getMeeting(state.currentMeetingId));
    if (isEmptyNote(current)) {
      bridge.navigate("meeting", { meetingId: current.id, tab: "chat" });
      return;
    }
  }

  // Also reuse a recent empty untitled note if one already exists.
  const recent = await MeetingStore.listMeetings();
  for (const meta of recent.slice(0, 8)) {
    const title = (meta.title || "").trim();
    if (title && title !== "Untitled notes" && title !== "Untitled Meeting") continue;
    const existing = await MeetingStore.getMeeting(meta.id);
    if (isEmptyNote(existing)) {
      bridge.navigate("meeting", { meetingId: existing.id, tab: "chat" });
      return;
    }
  }

  const meeting = {
    title: "Untitled notes",
    date: new Date().toISOString(),
    duration: "—",
    participants: [],
    transcript: [],
    bookmarks: [],
    status: "completed",
    isFavorite: false,
    isPinned: false,
    language: "en",
    platform: "import",
    transcriptConfidence: 1,
  };
  const id = await MeetingStore.saveMeeting(meeting);
  bridge.navigate("meeting", { meetingId: id, tab: "chat" });
  showToast("Blank meeting created");
}

export function toggleFocusMode() {
  state.focusMode = !state.focusMode;
  document.getElementById("app")?.classList.toggle("focus-mode", state.focusMode);
  const btn = document.getElementById("navBtnFocus");
  btn?.classList.toggle("is-active", state.focusMode);
  if (btn) btn.title = state.focusMode ? "Exit focus mode" : "Focus mode — hide sidebars";
  showToast(state.focusMode ? "Focus mode on" : "Focus mode off");
}

export function openShortcutsModal() {
  const existing = document.getElementById("shortcutsModal");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "shortcutsModal";
  overlay.className = "app-modal-overlay";
  overlay.innerHTML = `
    <div class="app-modal-card" role="dialog" aria-modal="true" style="max-width:420px">
      <div class="app-modal-head">
        <h3>Keyboard shortcuts</h3>
        <button type="button" class="app-modal-close" id="scClose">${icon("x", 16)}</button>
      </div>
      <div class="shortcuts-grid">
        <div><span>Quick search</span><code>⌘K</code></div>
        <div><span>Ask AI / chat tab</span><code>⌥J</code></div>
        <div><span>Transcript tab</span><code>⌥T</code></div>
        <div><span>Summary tab</span><code>⌥S</code></div>
        <div><span>Meeting tabs 1–5</span><code>⌘1…⌘5</code></div>
        <div><span>New blank meeting</span><code>⌘N</code></div>
        <div><span>Settings</span><code>⌘,</code></div>
        <div><span>Toggle details panel</span><code>⌘.</code></div>
        <div><span>Focus mode</span><code>⌘\\</code></div>
        <div><span>Close modal</span><code>Esc</code></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("#scClose").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}

export async function triggerImportTranscript() {
  const { parseImportFile, IMPORT_ACCEPT } = await import("../services/import-transcript.js");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = IMPORT_ACCEPT;
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = await parseImportFile(file);

      // Full JSON backup from Export — restore meetings found in the dump.
      if (parsed.backup?.local) {
        const local = parsed.backup.local;
        const keys = Object.keys(local).filter((k) => k.startsWith("meeting_"));
        let count = 0;
        let lastId = null;
        for (const key of keys) {
          const m = local[key];
          if (!m || typeof m !== "object") continue;
          // Keep original id when present so linked summaries can be restored too.
          const id = await MeetingStore.saveMeeting({ ...m });
          lastId = id;
          const summaries = local[`ai_summaries_${m.id || id}`];
          if (summaries && typeof summaries === "object") {
            for (const [type, pack] of Object.entries(summaries)) {
              if (pack?.content) {
                await MeetingStore.saveSummary(id, type, pack.content, {
                  generated: pack.generated,
                  provider: pack.provider,
                  model: pack.model,
                });
              }
            }
          }
          count += 1;
        }
        if (!count) {
          showToast("No meetings found in that backup file");
          return;
        }
        await bridge.renderSidebar();
        if (lastId) bridge.navigate("meeting", { meetingId: lastId, tab: "summary" });
        showToast(`Imported ${count} meeting${count === 1 ? "" : "s"} from backup`);
        return;
      }

      const meeting = parsed.meeting || {
        title: parsed.title,
        date: new Date().toISOString(),
        duration: "Imported",
        participants: [
          ...new Set(
            (parsed.transcript || [])
              .map((r) => r.speaker)
              .filter((s) => s && s !== "Speaker")
          ),
        ],
        transcript: parsed.transcript || [],
        bookmarks: [],
        status: "completed",
        isFavorite: false,
        isPinned: false,
        language: "en",
        platform: "import",
        transcriptConfidence: 1,
        summaryPreview: parsed.summaryMarkdown
          ? String(parsed.summaryMarkdown).slice(0, 180)
          : "",
      };

      // Drop id so we always create a fresh local meeting on file import.
      delete meeting.id;
      const id = await MeetingStore.saveMeeting(meeting);

      if (parsed.summaryMarkdown) {
        await MeetingStore.saveSummary(id, "standard", parsed.summaryMarkdown, {
          imported: true,
          sourceFormat: parsed.format,
        });
      }

      const openTab = parsed.summaryMarkdown && !(parsed.transcript || []).some((r) => r.speaker !== "Speaker")
        ? "summary"
        : "transcript";
      bridge.navigate("meeting", { meetingId: id, tab: openTab });
      showToast(`Imported ${parsed.format ? `.${parsed.format}` : "file"}`);
    } catch (err) {
      console.error("[AfterMeet] Import failed:", err);
      showToast(err?.message || "Import failed");
    }
  };
  input.click();
}

export function bindTopNavbar() {
  document.getElementById("navBtnNewMeeting")?.addEventListener("click", () => createBlankMeeting());
  document.getElementById("navBtnImport")?.addEventListener("click", () => triggerImportTranscript());
  document.getElementById("navBtnExport")?.addEventListener("click", () => exportBackup());
  document.getElementById("navBtnAsk")?.addEventListener("click", () => bridge.navigate("ask"));
  document.getElementById("navBtnShortcuts")?.addEventListener("click", () => openShortcutsModal());
  document.getElementById("navBtnFocus")?.addEventListener("click", () => toggleFocusMode());
}
