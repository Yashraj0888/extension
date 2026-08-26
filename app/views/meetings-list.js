import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";

// === ALL MEETINGS ===
export let activeTagFilter = null;
export let activeSpaceFilter = null;

export async function renderAllMeetings() {
  const listEl = document.getElementById("allMeetingsList");
  const all = await MeetingStore.listMeetings();
  const allTags = await MeetingStore.getAllTags();

  const filterEl = document.getElementById("allMeetingsTagFilter");
  if (allTags.length === 0) {
    filterEl.innerHTML = "";
  } else {
    filterEl.innerHTML = [
      `<div class="tag-filter-pill ${!activeTagFilter ? "active" : ""}" data-tag="">All</div>`,
      ...allTags.map((t) => `<div class="tag-filter-pill ${activeTagFilter === t ? "active" : ""}" data-tag="${escapeHtml(t)}">${icon("tag", 11)} ${escapeHtml(t)}</div>`),
    ].join("");
    filterEl.querySelectorAll(".tag-filter-pill").forEach((el) => {
      el.addEventListener("click", () => {
        activeTagFilter = el.dataset.tag || null;
        renderAllMeetings();
      });
    });
  }

  const filtered = activeTagFilter ? all.filter((m) => (m.tags || []).includes(activeTagFilter)) : all;

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No meetings captured yet.</p>';
    return;
  }
  listEl.innerHTML = `<div class="meeting-grid">${filtered.map(bridge.meetingCard).join("")}</div>`;
  bridge.bindCardClicks(listEl.querySelector(".meeting-grid"));
}

// === FAVORITES ===
export async function renderFavorites() {
  const grid = document.getElementById("favoritesGrid");
  const favorites = await MeetingStore.getFavorites();
  if (favorites.length === 0) {
    grid.innerHTML = '<p class="empty-state">No favorites yet. Star a meeting to pin it here.</p>';
    return;
  }
  grid.innerHTML = favorites.map(bridge.meetingCard).join("");
  bridge.bindCardClicks(grid);
}

// === SPACES ===
export async function renderSpaces(preferredSpaceId) {
  const listEl = document.getElementById("spacesMeetingsList");
  const filterEl = document.getElementById("spacesFilterRow");
  if (!listEl || !filterEl) return;

  const spaces = await MeetingStore.listSpaces();
  const all = await MeetingStore.listMeetings();
  const inAnySpace = all.filter((m) => (m.spaceIds || []).length > 0);

  if (preferredSpaceId) activeSpaceFilter = preferredSpaceId;
  if (activeSpaceFilter && !spaces.some((s) => s.id === activeSpaceFilter)) {
    activeSpaceFilter = null;
  }

  if (spaces.length === 0) {
    filterEl.innerHTML = "";
    listEl.innerHTML =
      '<p class="empty-state">No spaces yet. Open a meeting, use <strong>Add to space</strong> in the details panel, then come back here.</p>';
    return;
  }

  filterEl.innerHTML = [
    `<div class="tag-filter-pill ${!activeSpaceFilter ? "active" : ""}" data-space="">All spaces</div>`,
    ...spaces.map(
      (s) =>
        `<div class="tag-filter-pill ${activeSpaceFilter === s.id ? "active" : ""}" data-space="${escapeAttr(s.id)}">${icon("layoutGrid", 11)} ${escapeHtml(s.name)}</div>`
    ),
  ].join("");

  filterEl.querySelectorAll(".tag-filter-pill").forEach((el) => {
    el.addEventListener("click", () => {
      activeSpaceFilter = el.dataset.space || null;
      renderSpaces();
    });
  });

  const filtered = activeSpaceFilter
    ? all.filter((m) => (m.spaceIds || []).includes(activeSpaceFilter))
    : inAnySpace;

  if (filtered.length === 0) {
    listEl.innerHTML = activeSpaceFilter
      ? '<p class="empty-state">No meetings in this space yet.</p>'
      : '<p class="empty-state">Spaces exist, but no meetings are assigned yet. Use <strong>Add to space</strong> on a meeting.</p>';
    return;
  }

  listEl.innerHTML = `<div class="meeting-grid">${filtered.map(bridge.meetingCard).join("")}</div>`;
  bridge.bindCardClicks(listEl.querySelector(".meeting-grid"));
}
