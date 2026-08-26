import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";

// === HIGHLIGHTS ===
export function renderHighlights(meeting) {
  const bookmarks = meeting.bookmarks || [];
  if (bookmarks.length === 0) {
    dom.highlightsContainer.innerHTML = `<p class="empty-state">No highlights yet. Click the ${icon("highlighter", 12)} icon next to any line in the Transcript tab to mark it as a highlight.</p>`;
    return;
  }
  dom.highlightsContainer.innerHTML = bookmarks
    .map(
      (b) => `
    <div class="highlight-row" data-entry-index="${b.entryIndex}" data-bookmark-id="${b.id}">
      ${icon("highlighter", 18)}
      <div class="h-body">
        <div class="h-label">${escapeHtml(b.label)}</div>
        <div class="h-time">${escapeHtml(b.timestamp || "")}</div>
      </div>
      <button class="h-delete" data-remove="${b.id}">${icon("x", 15)}</button>
    </div>`
    )
    .join("");

  dom.highlightsContainer.querySelectorAll(".highlight-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".h-delete")) return;
      const idx = parseInt(row.dataset.entryIndex, 10);
      document.querySelector('.tab[data-tab="transcript"]').click();
      setTimeout(() => {
        const entry = dom.transcriptContainer.querySelector(`.transcript-entry[data-index="${idx}"]`);
        if (entry) entry.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 60);
    });
  });

  dom.highlightsContainer.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const updated = await MeetingStore.removeBookmark(meeting.id, btn.dataset.remove);
      meeting.bookmarks = updated;
      renderHighlights(meeting);
      showToast("Highlight removed");
    });
  });
}
