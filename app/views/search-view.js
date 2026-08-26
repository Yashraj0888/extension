import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";

// === GLOBAL FULL-TEXT SEARCH ===
export async function renderSearchView(prefill) {
  const input = document.getElementById("globalSearchInput");
  input.value = prefill || "";
  document.getElementById("globalSearchResults").innerHTML = "";
  if (prefill) await performGlobalSearch(prefill);

  input.oninput = debounce(() => performGlobalSearch(input.value.trim()), 250);
}

export function highlightMatch(text, query) {
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(new RegExp(`(${q})`, "ig"), "<mark>$1</mark>");
}

export async function performGlobalSearch(query) {
  const resultsEl = document.getElementById("globalSearchResults");
  if (!query) {
    resultsEl.innerHTML = '<p class="empty-state">Type to search across every meeting transcript you\'ve captured.</p>';
    return;
  }
  const results = await MeetingStore.searchTranscripts(query);
  if (results.length === 0) {
    resultsEl.innerHTML = `<p class="empty-state">No matches for "${escapeHtml(query)}".</p>`;
    return;
  }
  resultsEl.innerHTML = results
    .map(
      (r) => `
      <div class="search-result-card" data-id="${r.meeting.id}">
        <div class="search-result-title">${highlightMatch(r.meeting.title, query)}</div>
        <div class="search-result-meta">${formatDate(r.meeting.date)} · ${r.matchCount} match${r.matchCount === 1 ? "" : "es"}</div>
        ${r.matches.map((m) => `<div class="search-result-snippet"><strong>${escapeHtml(m.speaker)}:</strong> ${highlightMatch(m.text, query)}</div>`).join("")}
      </div>`
    )
    .join("");

  resultsEl.querySelectorAll(".search-result-card").forEach((el) => {
    el.addEventListener("click", () => {
      bridge.navigate("meeting", { meetingId: el.dataset.id, tab: "transcript", searchQuery: query });
    });
  });
}
