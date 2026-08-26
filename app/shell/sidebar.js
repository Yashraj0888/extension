import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, meetingListAvatar, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";
import { renderSidebarTasks } from "../views/tasks-view.js";

const SIDEBAR_WIDTH_KEY = "amn_sidebar_width";
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 216;

function clampSidebarWidth(px) {
  const cap = Math.min(SIDEBAR_MAX, Math.floor(window.innerWidth * 0.45));
  return Math.max(SIDEBAR_MIN, Math.min(cap, Math.round(px)));
}

function readStoredSidebarWidth() {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = Number(raw);
    if (Number.isFinite(n)) return clampSidebarWidth(n);
  } catch (_) {}
  return SIDEBAR_DEFAULT;
}

export function applySidebarWidth(px, { persist = false } = {}) {
  const width = clampSidebarWidth(px);
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
  if (persist) {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    } catch (_) {}
  }
  return width;
}

export function bindSidebarResize() {
  const sidebar = dom.leftSidebar;
  const handle = document.getElementById("sidebarResizeHandle");
  if (!sidebar || !handle || handle.dataset.bound === "1") return;
  handle.dataset.bound = "1";

  applySidebarWidth(readStoredSidebarWidth());

  let startX = 0;
  let startWidth = 0;

  const onMove = (e) => {
    const next = startWidth + (e.clientX - startX);
    applySidebarWidth(next);
  };

  const onUp = () => {
    sidebar.classList.remove("is-resizing");
    document.body.classList.remove("is-sidebar-resizing");
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width")) || SIDEBAR_DEFAULT;
    applySidebarWidth(current, { persist: true });
  };

  handle.addEventListener("pointerdown", (e) => {
    if (state.isSidebarCollapsed || sidebar.classList.contains("collapsed")) return;
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    sidebar.classList.add("is-resizing");
    document.body.classList.add("is-sidebar-resizing");
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  window.addEventListener("resize", () => {
    if (state.isSidebarCollapsed) return;
    applySidebarWidth(readStoredSidebarWidth());
  });
}

// === SIDEBAR ===
export async function renderSidebar(filter) {
  const meetings = filter
    ? await MeetingStore.listMeetings(filter)
    : await MeetingStore.listMeetings();

  const listEl = dom.recentMeetingsList;
  if (meetings.length === 0) {
    listEl.innerHTML = '<p class="empty-state-sm">No meetings yet</p>';
  } else {
    listEl.innerHTML = meetings
      .map(
        (m) => {
          const title = m.title || "Untitled Meeting";
          return `
        <div class="meeting-item ${m.id === state.currentMeetingId ? "active" : ""}" data-id="${m.id}" title="${escapeAttr(title)}">
          <div class="meeting-item-avatar ${m.platform === "zoom" ? "is-zoom" : "is-meet"}" aria-hidden="true">${meetingListAvatar(m.platform, 22)}</div>
          <div class="meeting-item-info">
            <div class="meeting-item-title">${escapeHtml(title)}</div>
            <div class="meeting-item-meta">${formatDate(m.date)} · ${m.participantCount} people</div>
          </div>
          <button type="button" class="meeting-item-menu-btn" data-sidebar-menu="${escapeAttr(m.id)}" title="Meeting options" aria-label="Meeting options">${icon("moreVertical", 14)}</button>
        </div>`;
        }
      )
      .join("");

    listEl.querySelectorAll(".meeting-item").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-sidebar-menu]")) return;
        const id = el.dataset.id;
        bridge.navigate("meeting", { meetingId: id, tab: "chat" });
      });
    });

    listEl.querySelectorAll("[data-sidebar-menu]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        bridge.openMeetingCardMenu(btn, btn.dataset.sidebarMenu);
      });
    });
  }

  const count = await MeetingStore.listMeetings();
  const badge = document.getElementById("meetingCount");
  if (badge) badge.textContent = String(count.length);
  if (dom.meetingCount) dom.meetingCount = badge;
  updateStorageIndicator(count.length);
  await renderSidebarTasks();
}

export function updateStorageIndicator(_meetingCount) {
  const note = document.getElementById("settingsStorageNote");
  if (note) {
    note.textContent = "Unlimited local storage — keep as many meetings as disk allows.";
  }
}

export function updateCollapseIcon() {
  if (!dom.collapseSidebar) return;
  dom.collapseSidebar.title = state.isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
  dom.collapseSidebar.setAttribute("aria-label", dom.collapseSidebar.title);
  dom.collapseSidebar.innerHTML = state.isSidebarCollapsed
    ? icon("chevronRight", 15)
    : icon("panelLeft", 15);
}

export function updateRightCollapseIcon() {
  if (!dom.collapseRightSidebar) return;
  const title = state.isRightSidebarCollapsed ? "Expand panel" : "Collapse panel";
  dom.collapseRightSidebar.title = title;
  dom.collapseRightSidebar.setAttribute("aria-label", title);
  dom.collapseRightSidebar.innerHTML = state.isRightSidebarCollapsed
    ? icon("chevronLeft", 15)
    : icon("panelRight", 15);
}

/** Open right panel on meeting pages; keep it collapsed everywhere else. */
export function syncRightPanelForRoute(route) {
  const shouldOpen = route === "meeting";
  state.isRightSidebarCollapsed = !shouldOpen;
  dom.rightSidebar?.classList.toggle("collapsed", state.isRightSidebarCollapsed);
  updateRightCollapseIcon();
}
