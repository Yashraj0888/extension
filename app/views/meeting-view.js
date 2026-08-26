import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";
import { ensureChatIndex } from "../services/chat-index.js";

// === MEETING VIEW ===
export async function loadMeeting(id, tab, searchQuery, entryIndex) {
  const meeting = await MeetingStore.getMeeting(id);
  if (!meeting) {
    bridge.navigate("home");
    return;
  }

  if (!(meeting.actionItems || []).length) {
    try {
      await MeetingStore.hydrateActionItemsFromStoredNotes(meeting);
    } catch (_) {}
  }

  if ((meeting.transcript || []).length) {
    ensureChatIndex(meeting).catch(() => {});
  }

  state.currentMeetingId = id;
  state.currentMeeting = meeting;
  state.currentTab = tab;

  dom.meetingViewTitle.textContent = meeting.title || "Untitled Meeting";
  bridge.setNavbar(meeting.title || "Untitled Meeting", `${formatDate(meeting.date)} · ${meeting.duration || "N/A"}`);
  dom.meetingViewMeta.innerHTML = `
    <span class="meta-chip">${icon("calendar", 12)} ${formatDate(meeting.date)}</span>
    <span class="meta-chip">${icon("clock", 12)} ${meeting.duration || "N/A"}</span>
    <span class="meta-chip">${icon("users", 12)} ${(meeting.participants || []).length} participants</span>
    <span class="meta-chip">${platformIcon(meeting.platform)} ${meeting.platform === "zoom" ? "Imported meeting" : "Google Meet"}</span>
  `;

  renderMeetingTags(meeting);
  updateFavoriteBtn(meeting.isFavorite);
  updatePinBtn(meeting.isPinned);

  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  const activeTab = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (activeTab) activeTab.classList.add("active");

  document.querySelectorAll(".tab-content").forEach((tc) => (tc.style.display = "none"));
  const targetContent = document.getElementById(`tab-${tab}`);
  if (targetContent) targetContent.style.display = "";

  bridge.renderChat(meeting);
  await bridge.renderTranscript(meeting, searchQuery);
  bridge.renderSummary(meeting);
  bridge.renderActionItems(meeting);
  bridge.renderHighlights(meeting);
  await bridge.renderRightMeeting(meeting);
  await bridge.renderSidebar();

  const jumpIndex = typeof entryIndex === "number" ? entryIndex : -1;
  if (jumpIndex >= 0 && tab === "transcript") {
    setTimeout(() => {
      const entry = dom.transcriptContainer?.querySelector(`.transcript-entry[data-index="${jumpIndex}"]`);
      if (entry) {
        entry.scrollIntoView({ block: "center", behavior: "smooth" });
        entry.classList.add("ti-flash");
        setTimeout(() => entry.classList.remove("ti-flash"), 1600);
      }
    }, 80);
  }
}

export function renderMeetingTags(meeting) {
  const tags = meeting.tags || [];
  dom.meetingTagsRow.innerHTML = `
    ${tags.map((t) => `<span class="tag-chip removable" data-tag="${escapeAttr(t)}">${icon("tag", 10)} ${escapeHtml(t)} ×</span>`).join("")}
    <button class="tag-add-btn" id="btnAddTag">+ Add tag</button>
  `;
  dom.meetingTagsRow.querySelectorAll(".tag-chip.removable").forEach((el) => {
    el.addEventListener("click", async () => {
      const newTags = tags.filter((t) => t !== el.dataset.tag);
      await MeetingStore.setTags(state.currentMeetingId, newTags);
      state.currentMeeting.tags = newTags;
      renderMeetingTags(state.currentMeeting);
      showToast("Tag removed");
    });
  });
  document.getElementById("btnAddTag").addEventListener("click", () => {
    const btn = document.getElementById("btnAddTag");
    btn.outerHTML = `<input type="text" class="tag-add-input" id="newTagInput" placeholder="Tag name" />`;
    const input = document.getElementById("newTagInput");
    input.focus();
    input.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        const newTags = [...tags, input.value.trim()];
        await MeetingStore.setTags(state.currentMeetingId, newTags);
        state.currentMeeting.tags = newTags;
        renderMeetingTags(state.currentMeeting);
        showToast("Tag added");
      } else if (e.key === "Escape") {
        renderMeetingTags(state.currentMeeting);
      }
    });
    input.addEventListener("blur", () => renderMeetingTags(state.currentMeeting));
  });
}

export function updateFavoriteBtn(isFav) {
  dom.btnFavorite.classList.toggle("favorited", !!isFav);
  dom.btnFavorite.title = isFav ? "Remove favorite" : "Mark as favorite";
}

export function updatePinBtn(isPinned) {
  dom.btnPin.classList.toggle("pinned", !!isPinned);
  dom.btnPin.title = isPinned ? "Unpin meeting" : "Pin meeting";
}
