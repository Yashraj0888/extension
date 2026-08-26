import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp, normalizeSpeakerName, dedupeSpeakerNames, resolveSelfSpeakerName,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";
import { getSettings } from "../services/settings.js";
import { showConfirm, showPrompt } from "../ui-modal.js";

// === RIGHT HOME ===
export async function renderRightHome() {
  const favorites = await MeetingStore.getFavorites();
  const pinned = await MeetingStore.getPinned();
  const all = await MeetingStore.listMeetings();

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const thisWeek = all.filter((m) => new Date(m.date) >= weekStart);

  document.getElementById("statTotalMeetings").textContent = all.length;
  document.getElementById("statThisWeek").textContent = thisWeek.length;
  document.getElementById("statFavorites").textContent = favorites.length;

  const pinnedList = document.getElementById("pinnedList");
  if (pinned.length === 0) {
    pinnedList.innerHTML = '<p class="empty-state-sm">No pinned meetings</p>';
  } else {
    pinnedList.innerHTML = pinned
      .map(
        (m) => `<div class="pinned-item" data-id="${m.id}">${icon("pin", 13)} ${escapeHtml(m.title)}</div>`
      )
      .join("");
    pinnedList.querySelectorAll(".pinned-item").forEach((el) => {
      el.addEventListener("click", () => {
        bridge.navigate("meeting", { meetingId: el.dataset.id, tab: "chat" });
      });
    });
  }
}

// === RIGHT MEETING PANEL ===
export function speakerTalkStats(meeting) {
  const counts = {};
  for (const e of meeting.transcript || []) {
    const name = normalizeSpeakerName(e.speaker, meeting);
    const words = (e.text || "").trim().split(/\s+/).filter(Boolean).length;
    counts[name] = (counts[name] || 0) + Math.max(words, 1);
  }
  for (const p of dedupeSpeakerNames(meeting.participants, meeting)) {
    if (counts[p] == null) counts[p] = 0;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(counts)
    .map(([name, words]) => ({
      name,
      words,
      pct: Math.round((words / total) * 100),
      color: stringToColor(name),
    }))
    .sort((a, b) => b.words - a.words);
}

export function donutGradient(stats) {
  if (!stats.length) return "conic-gradient(var(--border) 0 100%)";
  let cursor = 0;
  const parts = stats.map((s) => {
    const start = cursor;
    cursor += Math.max(s.pct, 1);
    return `${s.color} ${start}% ${cursor}%`;
  });
  if (cursor < 100) parts.push(`var(--border) ${cursor}% 100%`);
  return `conic-gradient(${parts.join(", ")})`;
}

export async function shareMeetingBrief(meeting) {
  if (meeting.isPrivate) {
    const ok = await showConfirm(
      "This meeting is marked private. Copy a shareable brief anyway?",
      { title: "Private meeting", confirmLabel: "Copy brief" }
    );
    if (!ok) return;
  }
  const actions = (meeting.actionItems || []).filter((a) => !a.done);
  const labels = (meeting.tags || []).join(", ") || "—";
  const people = (meeting.participants || []).join(", ") || "—";
  const brief = [
    meeting.title || "Untitled meeting",
    formatMeetingStamp(meeting.date) + (meeting.duration ? ` · ${meeting.duration}` : ""),
    `Participants: ${people}`,
    `Labels: ${labels}`,
    meeting.recordingUrl ? `Recording: ${meeting.recordingUrl}` : null,
    actions.length
      ? "Open actions:\n" + actions.map((a) => `- ${a.owner ? a.owner + ": " : ""}${a.text || a.title || a}`).join("\n")
      : "Open actions: none",
  ]
    .filter(Boolean)
    .join("\n");
  await navigator.clipboard.writeText(brief);
  showToast("Meeting brief copied");
}

export async function duplicateMeeting(meeting) {
  const copy = {
    ...meeting,
    id: undefined,
    title: `${meeting.title || "Untitled"} (copy)`,
    date: new Date().toISOString(),
    isPinned: false,
    status: "completed",
  };
  delete copy.id;
  const id = await MeetingStore.saveMeeting(copy);
  bridge.navigate("meeting", { meetingId: id, tab: "summary" });
  showToast("Meeting duplicated");
}

export async function renderRightMeeting(meeting) {
  const detail = document.getElementById("meetingDetailCard");
  const participantsCard = document.getElementById("meetingParticipantsCard");
  if (!detail || !participantsCard) return;

  const ownerName = resolveSelfSpeakerName(meeting) || meeting.participants?.[0] || "You";
  const tags = meeting.tags || [];
  const spaces = await MeetingStore.listSpaces();
  const spaceIds = meeting.spaceIds || [];
  const spaceNames = spaces.filter((s) => spaceIds.includes(s.id)).map((s) => s.name);

  detail.innerHTML = `
    <div class="m-detail-card">
      <div class="m-detail-head">
        <div class="m-avatar" aria-hidden="true">${icon("user", 18)}</div>
        <div class="m-detail-meta">
          <div class="m-detail-title-row">
            <strong>${escapeHtml(ownerName)}</strong>
            <time class="m-detail-when" datetime="${escapeAttr(meeting.date || "")}">${escapeHtml(formatMeetingStamp(meeting.date))}</time>
          </div>
        </div>
      </div>
      <div class="m-label-row">
        ${meeting.isPrivate ? `<span class="m-label-pill is-private">${icon("shieldCheck", 11)} Private</span>` : ""}
        ${tags.map((t) => `<span class="m-label-pill is-tag">${icon("tag", 10)} ${escapeHtml(t)}</span>`).join("")}
        ${spaceNames.map((n) => `<span class="m-label-pill is-tag">${icon("layoutGrid", 10)} ${escapeHtml(n)}</span>`).join("")}
        ${!meeting.isPrivate && !tags.length && !spaceNames.length ? `<span class="m-label-pill is-tag">No labels yet</span>` : ""}
      </div>
      <div class="m-action-list">
        <button type="button" class="m-action-btn ${meeting.isPrivate ? "is-on" : ""}" data-m-action="private">
          ${icon("shieldCheck", 15)} ${meeting.isPrivate ? "Private meeting" : "Mark as private"}
          <span class="m-action-hint">${meeting.isPrivate ? "On" : "Off"}</span>
        </button>
        <button type="button" class="m-action-btn" data-m-action="share">${icon("share", 15)} Share this meeting</button>
        <button type="button" class="m-action-btn" data-m-action="recording">
          ${icon(meeting.recordingUrl ? "link" : "plus", 15)}
          ${meeting.recordingUrl ? "Edit recording link" : "Link recording"}
          ${meeting.recordingUrl ? `<span class="m-action-hint">Linked</span>` : ""}
        </button>
        <button type="button" class="m-action-btn" data-m-action="label">${icon("tag", 15)} Add label</button>
        <button type="button" class="m-action-btn" data-m-action="space">${icon("layoutGrid", 15)} Add to space</button>
        <button type="button" class="m-action-btn" data-m-action="duplicate">${icon("duplicate", 15)} Duplicate meeting</button>
        <button type="button" class="m-action-btn" data-m-action="favorite">
          ${icon("star", 15)} ${meeting.isFavorite ? "Unfavorite" : "Add to favorites"}
        </button>
        <button type="button" class="m-action-btn" data-m-action="pin">
          ${icon("pin", 15)} ${meeting.isPinned ? "Unpin" : "Pin meeting"}
        </button>
      </div>
    </div>`;

  const stats = speakerTalkStats(meeting);
  const open = participantsCard.dataset.open !== "0";
  participantsCard.innerHTML = `
    <div class="m-participants-card">
      <div class="m-part-head" id="mPartToggle">
        <h4>Participants</h4>
        <span class="m-part-count">${stats.length}</span>
        ${icon("chevronDown", 14)}
      </div>
      <div class="m-part-body ${open ? "" : "is-collapsed"}" id="mPartBody">
        <div class="m-donut-wrap">
          <div class="m-donut" style="background:${donutGradient(stats)}">
            <div class="m-donut-center">${escapeHtml(meeting.duration || "—")}<small>talk share</small></div>
          </div>
        </div>
        ${
          stats.length
            ? stats
                .map(
                  (s) => `<div class="m-speaker-row" data-speaker="${escapeAttr(s.name)}" title="Double-click to rename">
                    <span class="m-speaker-dot" style="background:${s.color}"></span>
                    <div class="m-speaker-main">
                      <div class="m-speaker-name">${escapeHtml(s.name)}</div>
                      <div class="m-speaker-bar"><i style="width:${Math.max(s.pct, 2)}%;background:${s.color}"></i></div>
                    </div>
                    <span class="m-speaker-pct">${s.pct}%</span>
                  </div>`
                )
                .join("")
            : `<p class="empty-state-sm">No speakers detected yet.</p>`
        }
      </div>
    </div>`;

  participantsCard.dataset.open = open ? "1" : "0";
  document.getElementById("mPartToggle")?.addEventListener("click", () => {
    const body = document.getElementById("mPartBody");
    const collapsed = body?.classList.toggle("is-collapsed");
    participantsCard.dataset.open = collapsed ? "0" : "1";
  });

  participantsCard.querySelectorAll(".m-speaker-row").forEach((row) => {
    row.addEventListener("dblclick", async () => {
      const oldName = row.dataset.speaker;
      const next = await showPrompt("Rename this speaker everywhere in the transcript.", {
        title: "Rename speaker",
        defaultValue: oldName,
        placeholder: "Display name",
        okLabel: "Rename",
      });
      if (next == null) return;
      const name = next.trim();
      if (!name || name === oldName) return;
      const updated = await MeetingStore.renameSpeaker(meeting.id, oldName, name);
      state.currentMeeting = updated;
      await bridge.loadMeeting(meeting.id, state.currentTab);
      showToast("Speaker renamed");
    });
  });

  detail.querySelectorAll("[data-m-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.mAction;
      if (action === "private") {
        const on = await MeetingStore.togglePrivate(meeting.id);
        state.currentMeeting.isPrivate = on;
        showToast(on ? "Marked private" : "No longer private");
        renderRightMeeting(state.currentMeeting);
        return;
      }
      if (action === "share") {
        await shareMeetingBrief(state.currentMeeting);
        return;
      }
      if (action === "recording") {
        const url = await showPrompt("Paste a Meet or Drive recording URL.", {
          title: "Link recording",
          defaultValue: meeting.recordingUrl || "",
          placeholder: "https://…",
          inputType: "url",
          okLabel: "Save link",
        });
        if (url == null) return;
        await MeetingStore.setRecordingUrl(meeting.id, url.trim());
        state.currentMeeting.recordingUrl = url.trim();
        showToast(url.trim() ? "Recording linked" : "Recording link cleared");
        renderRightMeeting(state.currentMeeting);
        return;
      }
      if (action === "label") {
        const label = await showPrompt("Add a label to organize this meeting.", {
          title: "Add label",
          placeholder: "e.g. Long meeting, Hiring, Q3",
          okLabel: "Add",
        });
        if (label == null || !label.trim()) return;
        const newTags = [...new Set([...(meeting.tags || []), label.trim()])];
        await MeetingStore.setTags(meeting.id, newTags);
        state.currentMeeting.tags = newTags;
        bridge.renderMeetingTags(state.currentMeeting);
        renderRightMeeting(state.currentMeeting);
        showToast("Label added");
        return;
      }
      if (action === "space") {
        await openSpacePicker(meeting);
        return;
      }
      if (action === "duplicate") {
        await duplicateMeeting(meeting);
        return;
      }
      if (action === "favorite") {
        const on = await MeetingStore.toggleFavorite(meeting.id);
        state.currentMeeting.isFavorite = on;
        bridge.updateFavoriteBtn(on);
        renderRightMeeting(state.currentMeeting);
        showToast(on ? "Added to favorites" : "Removed from favorites");
        return;
      }
      if (action === "pin") {
        const on = await MeetingStore.togglePin(meeting.id);
        state.currentMeeting.isPinned = on;
        bridge.updatePinBtn(on);
        renderRightMeeting(state.currentMeeting);
        renderRightHome();
        showToast(on ? "Pinned" : "Unpinned");
      }
    });
  });

  const settings = await getSettings();
  const withTs = settings.copyIncludesTimestamps !== false;

  document.getElementById("btnCopyTranscript").onclick = () => {
    const text = (meeting.transcript || [])
      .map((e) => (withTs && e.timestamp ? `[${e.timestamp}] ${e.speaker}: ${e.text}` : `${e.speaker}: ${e.text}`))
      .join("\n");
    navigator.clipboard.writeText(text).then(() => showToast("Transcript copied"));
  };

  document.getElementById("btnCopySummary").onclick = async () => {
    const summaries = await MeetingStore.getSummaries(meeting.id);
    const type = document.getElementById("summaryType")?.value || "executive";
    const summary = summaries[type];
    if (!summary) { showToast("Generate a summary first"); return; }
    navigator.clipboard.writeText(summary.content).then(() => showToast("Summary copied"));
  };

  document.getElementById("btnDownloadMD").onclick = () => {
    const text = (meeting.transcript || [])
      .map((e) => (withTs && e.timestamp ? `[${e.timestamp}] ${e.speaker}: ${e.text}` : `${e.speaker}: ${e.text}`))
      .join("\n");
    const blob = new Blob([`# ${meeting.title}\n\n${text}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: `${meeting.title || "meeting"}.md`, saveAs: true });
  };

  document.getElementById("btnDownloadDoc").onclick = () => {
    const text = (meeting.transcript || [])
      .map((e) => (withTs && e.timestamp ? `[${e.timestamp}] ${e.speaker}: ${e.text}` : `${e.speaker}: ${e.text}`))
      .join("\n");
    const html = `<html><body><h1>${meeting.title}</h1><pre>${text}</pre></body></html>`;
    const blob = new Blob(["\ufeff" + html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename: `${meeting.title || "meeting"}.doc`,
      saveAs: true,
    });
  };

  document.getElementById("btnPrint").onclick = () => {
    const win = window.open("", "_blank");
    const text = (meeting.transcript || []).map((e) => `<p><strong>${escapeHtml(e.speaker)}</strong> <span style="color:#888">${e.timestamp || ""}</span><br>${escapeHtml(e.text)}</p>`).join("");
    win.document.write(`<html><head><title>${escapeHtml(meeting.title)}</title></head><body style="font-family:sans-serif;max-width:720px;margin:40px auto">
      <h1>${escapeHtml(meeting.title)}</h1><p style="color:#888">${formatDate(meeting.date)} · ${meeting.duration || ""}</p><hr>${text}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };
}

export async function openSpacePicker(meeting) {
  let spaces = await MeetingStore.listSpaces();
  const existing = document.getElementById("spacePickerModal");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "spacePickerModal";
  overlay.className = "app-modal-overlay";
  const selected = new Set(meeting.spaceIds || []);

  const paint = () => {
    overlay.querySelector("#spacePickerList").innerHTML = spaces.length
      ? spaces
          .map(
            (s) => `<label class="pref-toggle" style="padding:8px 0">
              <input type="checkbox" data-space-id="${s.id}" ${selected.has(s.id) ? "checked" : ""} />
              <div><strong>${escapeHtml(s.name)}</strong></div>
            </label>`
          )
          .join("")
      : `<p class="empty-state-sm">No spaces yet. Create one below.</p>`;
    overlay.querySelectorAll("[data-space-id]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) selected.add(input.dataset.spaceId);
        else selected.delete(input.dataset.spaceId);
      });
    });
  };

  overlay.innerHTML = `
    <div class="app-modal-card" role="dialog" aria-modal="true" style="max-width:420px">
      <div class="app-modal-head">
        <h3>Add to space</h3>
        <button type="button" class="app-modal-close" id="spaceClose">${icon("x", 16)}</button>
      </div>
      <div id="spacePickerList"></div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <input type="text" id="newSpaceName" class="select-block" placeholder="New space name" style="flex:1" />
        <button type="button" class="quick-btn secondary" id="createSpaceBtn">${icon("plus", 14)} Create</button>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button type="button" class="quick-btn secondary" id="spaceCancel">Cancel</button>
        <button type="button" class="quick-btn" id="spaceSave">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  paint();

  const close = () => overlay.remove();
  overlay.querySelector("#spaceClose").addEventListener("click", close);
  overlay.querySelector("#spaceCancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  overlay.querySelector("#createSpaceBtn").addEventListener("click", async () => {
    const name = overlay.querySelector("#newSpaceName").value.trim();
    if (!name) return;
    const space = await MeetingStore.createSpace(name);
    spaces = await MeetingStore.listSpaces();
    selected.add(space.id);
    overlay.querySelector("#newSpaceName").value = "";
    paint();
    showToast("Space created");
  });

  overlay.querySelector("#spaceSave").addEventListener("click", async () => {
    await MeetingStore.setMeetingSpaces(meeting.id, [...selected]);
    state.currentMeeting.spaceIds = [...selected];
    close();
    renderRightMeeting(state.currentMeeting);
    showToast(selected.size ? "Saved to space — open Spaces in the sidebar" : "Spaces updated");
    if (state.route === "spaces") bridge.renderSpaces();
  });
}
