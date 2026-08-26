import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, meetingListAvatar, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp, formatTime, formatWhenDetailed,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";
import { getSettings } from "../services/settings.js";
import { PROVIDER_DEFS } from "../services/providers.js";
import { showConfirm, showPrompt } from "../ui-modal.js";
import { pickDateRange, formatRangeLabel } from "../ui-date-range.js";
import Calendar from "../services/calendar.js";

let homeFilterState = {
  tab: "all",
  date: "all",
  dateFrom: "",
  dateTo: "",
  people: "all",
  duration: "any",
  search: "",
};

let homeMeetStripTab = "today";
let homeMeetingsCache = [];
let homeNotesCache = new Set();
const HOME_TABLE_PAGE_SIZE = 5;
let homeTablePage = 1;
let homeTableFilterKey = "";

export async function promptRenameMeeting(meetingId) {
  const meeting = await MeetingStore.getMeeting(meetingId);
  if (!meeting) return;
  const current = meeting.title || "Untitled Meeting";
  const newTitle = await showPrompt("Give this meeting a clear name.", {
    title: "Rename meeting",
    defaultValue: current,
    placeholder: "Meeting title",
    okLabel: "Save",
  });
  if (newTitle == null) return;
  const trimmed = newTitle.trim() || "Untitled Meeting";
  if (trimmed === current) return;

  await MeetingStore.updateMeetingMeta(meetingId, { title: trimmed, titleRenamed: true });

  if (state.currentMeetingId === meetingId && state.currentMeeting) {
    state.currentMeeting.title = trimmed;
    state.currentMeeting.titleRenamed = true;
    if (dom.meetingViewTitle) dom.meetingViewTitle.textContent = trimmed;
    bridge.setNavbar(trimmed, document.getElementById("navbarSub")?.textContent || "");
  }

  if (state.route === "home") renderHome();
  else if (state.route === "meetings") bridge.renderAllMeetings();
  else if (state.route === "favorites") bridge.renderFavorites();
  else if (state.route === "spaces") bridge.renderSpaces();

  await bridge.renderSidebar();
  showToast("Meeting renamed");
}

// === HOME ===
export async function renderProviderStatusCard() {
  const settings = await getSettings();
  const provider = settings.aiProvider || "gemini";
  const def = PROVIDER_DEFS[provider];
  const cfg = settings.providers?.[provider] || {};
  const hasKey = provider === "custom" ? !!cfg.baseUrl : !!cfg.apiKey;
  const el = document.getElementById("providerStatusCard");

  if (!hasKey) {
    el.innerHTML = `
      <div class="provider-status-card warn">
        ${icon("key", 20)}
        <div class="psc-text"><strong>No AI provider configured yet.</strong> Add an API key to unlock chat, summaries, and action-item extraction.</div>
        <a data-route-link="settings">Configure now →</a>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="provider-status-card">
        ${icon("cube", 20)}
        <div class="psc-text">Using <strong>${def.label}</strong> · <strong>${escapeHtml(cfg.model || def.defaultModel)}</strong> for chat, summaries, and action items.</div>
        <a data-route-link="settings">Change →</a>
      </div>`;
  }
  el.querySelector("[data-route-link]")?.addEventListener("click", () => bridge.navigate("settings"));
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatHoursLabel(minutes) {
  return round2(minutes / 60).toFixed(2) + "h";
}

function yesterdayTrend(todayVal, yesterdayVal, unit = "") {
  const a = round2(todayVal);
  const b = round2(yesterdayVal);
  if (a === 0 && b === 0) return { text: "", cls: "neutral" };
  const diff = round2(a - b);
  if (diff === 0) return { text: "No change", cls: "neutral" };
  const up = diff > 0;
  const abs = Math.abs(diff);
  const absLabel = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return {
    text: `${up ? "↑" : "↓"} ${absLabel}${unit} from yesterday`,
    cls: up ? "up" : "down",
  };
}

export async function renderAnalyticsStrip() {
  const all = homeMeetingsCache.length ? homeMeetingsCache : await MeetingStore.listMeetings();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  const todayMeetings = all.filter((m) => new Date(m.date).toDateString() === today);
  const yesterdayMeetings = all.filter((m) => new Date(m.date).toDateString() === yesterday);

  const totalMinutes = all.reduce((sum, m) => sum + parseDurationMinutes(m.duration), 0);
  const todayMinutes = todayMeetings.reduce((sum, m) => sum + parseDurationMinutes(m.duration), 0);
  const yesterdayMinutes = yesterdayMeetings.reduce((sum, m) => sum + parseDurationMinutes(m.duration), 0);
  const avgMinutes = all.length ? Math.round(totalMinutes / all.length) : 0;
  const favCount = all.filter((m) => m.isFavorite).length;

  const todayAvg = todayMeetings.length ? round2(todayMinutes / todayMeetings.length) : null;
  const yesterdayAvg = yesterdayMeetings.length ? round2(yesterdayMinutes / yesterdayMeetings.length) : null;

  const cards = [
    {
      value: all.length,
      label: "Meetings captured",
      iconName: "calendar",
      trend: yesterdayTrend(todayMeetings.length, yesterdayMeetings.length, ""),
    },
    {
      value: formatHoursLabel(totalMinutes),
      label: "Total time recorded",
      iconName: "clock",
      trend: yesterdayTrend(todayMinutes / 60, yesterdayMinutes / 60, "h"),
    },
    {
      value: avgMinutes + " min",
      label: "Average meeting length",
      iconName: "barChart",
      trend:
        todayAvg != null && yesterdayAvg != null
          ? yesterdayTrend(todayAvg, yesterdayAvg, " min")
          : { text: "", cls: "neutral" },
    },
    {
      value: favCount,
      label: "Favorited meetings",
      iconName: "star",
      trend: { text: "", cls: "neutral" },
    },
  ];

  document.getElementById("analyticsStrip").innerHTML = cards
    .map(
      (c) => `
      <div class="analytics-card">
        <div class="analytics-card-top">
          <span class="a-value">${c.value}</span>
          <span class="a-icon">${icon(c.iconName, 18)}</span>
        </div>
        <div class="a-label">${escapeHtml(c.label)}</div>
        ${c.trend.text ? `<div class="a-trend ${c.trend.cls}">${escapeHtml(c.trend.text)}</div>` : ""}
      </div>`
    )
    .join("");
}

async function loadMeetingsWithNotes(meetingIds) {
  const keys = meetingIds.map((id) => `ai_summaries_${id}`);
  if (!keys.length) return new Set();
  const result = await new Promise((r) => chrome.storage.local.get(keys, r));
  const withNotes = new Set();
  for (const id of meetingIds) {
    const summaries = result[`ai_summaries_${id}`];
    if (summaries && Object.keys(summaries).some((k) => k !== "chatIndex")) withNotes.add(id);
  }
  return withNotes;
}

function filterMeetings(list) {
  const q = homeFilterState.search.toLowerCase().trim();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  return list.filter((m) => {
    if (homeFilterState.tab === "meet" && m.platform === "zoom") return false;
    if (homeFilterState.tab === "starred" && !m.isFavorite) return false;
    if (homeFilterState.tab === "notes" && !homeNotesCache.has(m.id)) return false;

    if (homeFilterState.date === "today" && formatDate(m.date) !== "Today") return false;
    if (homeFilterState.date === "week" && new Date(m.date) < weekAgo) return false;
    if (homeFilterState.date === "month" && new Date(m.date) < monthAgo) return false;
    if (homeFilterState.date === "custom") {
      const md = new Date(m.date);
      if (homeFilterState.dateFrom) {
        const from = new Date(homeFilterState.dateFrom + "T00:00:00");
        if (md < from) return false;
      }
      if (homeFilterState.dateTo) {
        const to = new Date(homeFilterState.dateTo + "T23:59:59");
        if (md > to) return false;
      }
    }

    const ppl = m.participantCount || 0;
    if (homeFilterState.people === "1" && ppl !== 1) return false;
    if (homeFilterState.people === "2" && ppl !== 2) return false;
    if (homeFilterState.people === "3+" && ppl < 3) return false;

    const mins = parseDurationMinutes(m.duration);
    if (homeFilterState.duration === "short" && mins >= 20) return false;
    if (homeFilterState.duration === "semi" && (mins < 20 || mins > 43)) return false;
    if (homeFilterState.duration === "long" && mins <= 45) return false;

    if (q) {
      const hay = `${m.title || ""} ${(m.tags || []).join(" ")} ${m.summaryPreview || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderTagPills(tags) {
  const list = (tags || []).slice(0, 4);
  if (!list.length) return "";
  return `<div class="home-tag-row">${list
    .map((t) => `<span class="home-tag-pill">${escapeHtml(t)}</span>`)
    .join("")}</div>`;
}

function todayMeetingCard(m, { isUpcoming = false, eventTime = "", countdown = "" } = {}) {
  const tags = m.tags || [];
  const mins = parseDurationMinutes(m.duration);
  return `
    <div class="today-meet-card ${isUpcoming ? "is-upcoming" : ""}" data-id="${escapeAttr(m.id || "")}" data-upcoming="${isUpcoming ? "1" : "0"}">
      <div class="today-meet-time">
        <strong>${escapeHtml(eventTime || formatTime(m.date))}</strong>
        ${countdown ? `<span class="today-meet-countdown">${escapeHtml(countdown)}</span>` : ""}
      </div>
      <div class="today-meet-title">${escapeHtml(m.title || "Untitled")}</div>
      <div class="today-meet-meta">
        ${mins ? `<span>${mins} min</span>` : ""}
        ${m.participantCount != null ? `<span>${m.participantCount === 1 ? "1 person" : `${m.participantCount} people`}</span>` : ""}
      </div>
      ${renderTagPills(tags)}
      ${!isUpcoming ? `<button type="button" class="today-meet-menu" data-card-menu="${escapeAttr(m.id)}" aria-label="More">${icon("moreVertical", 14)}</button>` : ""}
    </div>`;
}

function recentTableRow(m) {
  const hasNotes = homeNotesCache.has(m.id);
  const tags = m.tags || [];
  const mins = parseDurationMinutes(m.duration);
  const durationLabel = mins ? `${mins} min` : m.duration || "—";
  const people = m.participantCount || 0;
  const peopleLabel = people === 1 ? "1" : String(people);

  return `
    <button type="button" class="rg-fav table-icon-btn ${m.isFavorite ? "is-on" : ""}" data-row-fav="${escapeAttr(m.id)}" aria-label="Favorite">${icon("star", 15)}</button>
    <div class="rg-meeting recent-meeting-cell" data-open="${escapeAttr(m.id)}">
      <div class="recent-meeting-icon" aria-hidden="true">${meetingListAvatar(m.platform, 13)}</div>
      <div class="recent-meeting-copy">
        <div class="recent-meeting-title">${escapeHtml(m.title || "Untitled")}${m.isPrivate ? ` ${icon("shieldCheck", 11)}` : ""}</div>
        ${renderTagPills(tags)}
      </div>
    </div>
    <div class="rg-when" data-open="${escapeAttr(m.id)}">${escapeHtml(formatWhenDetailed(m.date))}</div>
    <div class="rg-duration" data-open="${escapeAttr(m.id)}">${escapeHtml(durationLabel)}</div>
    <div class="rg-people" data-open="${escapeAttr(m.id)}">${escapeHtml(peopleLabel)}</div>
    <div class="rg-source" data-open="${escapeAttr(m.id)}"><span class="source-pill">${platformIcon(m.platform)} ${m.platform === "zoom" ? "Imported" : "Meet"}</span></div>
    <div class="rg-notes" data-open="${escapeAttr(m.id)}">${hasNotes ? `<span class="notes-pill">${icon("fileText", 12)} Notes</span>` : `<span class="text-muted">—</span>`}</div>
    <button type="button" class="rg-actions table-icon-btn" data-row-menu="${escapeAttr(m.id)}" aria-label="Options">${icon("moreVertical", 15)}</button>`;
}

async function renderTodaySection(all) {
  const scroll = document.getElementById("todayMeetingsScroll");
  const hint = document.getElementById("calendarHint");
  const connectBtn = document.getElementById("connectCalendarBtn");
  if (!scroll) return;

  syncMeetingsStripTabs();

  const todayRecorded = all.filter((m) => formatDate(m.date) === "Today");
  let calendarEvents = [];
  try {
    calendarEvents =
      homeMeetStripTab === "upcoming"
        ? await Calendar.getUpcoming24hCalendarEvents()
        : await Calendar.getTodaysCalendarEvents();
  } catch (_) {}

  const recordedTitles = new Set(todayRecorded.map((m) => (m.title || "").toLowerCase()));
  const cards = [];

  if (homeMeetStripTab === "upcoming") {
    for (const ev of calendarEvents) {
      if (recordedTitles.has((ev.title || "").toLowerCase())) continue;
      const mins = Calendar.minutesUntil(ev.start);
      const countdown =
        mins != null ? (mins <= 0 ? "now" : mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)}h`) : "";
      cards.push(
        todayMeetingCard(
          { id: "", title: ev.title, tags: ["upcoming"], duration: "", participantCount: null },
          { isUpcoming: true, eventTime: Calendar.formatEventTime(ev.start), countdown }
        )
      );
    }
    if (!cards.length) {
      scroll.innerHTML =
        '<p class="empty-state-sm">No upcoming meetings in the next 24 hours — connect your calendar to see scheduled events.</p>';
    } else {
      scroll.innerHTML = cards.join("");
    }
  } else {
    const upcoming = calendarEvents.filter(
      (ev) => !recordedTitles.has((ev.title || "").toLowerCase())
    );

    for (const ev of upcoming) {
      const mins = Calendar.minutesUntil(ev.start);
      const countdown = mins != null && mins <= 120 ? (mins <= 0 ? "now" : `in ${mins} min`) : "";
      cards.push(
        todayMeetingCard(
          { id: "", title: ev.title, tags: ["upcoming"], duration: "", participantCount: null },
          { isUpcoming: true, eventTime: Calendar.formatEventTime(ev.start), countdown }
        )
      );
    }

    for (const m of todayRecorded) {
      cards.push(todayMeetingCard(m));
    }

    if (!cards.length) {
      scroll.innerHTML = '<p class="empty-state-sm">No meetings today — start a Meet or connect your calendar.</p>';
    } else {
      scroll.innerHTML = cards.join("");
      bindTodayCardClicks(scroll);
    }
  }

  const connected = await Calendar.isCalendarConnected();
  if (connectBtn) {
    connectBtn.style.display = connected ? "none" : "";
    connectBtn.textContent = connected ? "Calendar connected" : "Connect calendar";
    if (!connectBtn.dataset.bound) {
      connectBtn.dataset.bound = "1";
      connectBtn.addEventListener("click", () => connectCalendarFromHome());
    }
  }

  if (hint) {
    if (!connected) {
      hint.style.display = "";
      hint.innerHTML = `Set up OAuth in <button type="button" class="link-btn" id="calendarHintSettings">Settings → Google Calendar</button>, or <button type="button" class="link-btn" id="calendarHintConnect">connect now</button> if you already added your Client ID.`;
      hint.querySelector("#calendarHintSettings")?.addEventListener("click", () => bridge.navigate("settings", { settingsTab: "calendar" }));
      hint.querySelector("#calendarHintConnect")?.addEventListener("click", () => connectCalendarFromHome());
    } else {
      hint.style.display = "none";
    }
  }
}

function syncMeetingsStripTabs() {
  document.querySelectorAll(".meetings-strip-tab").forEach((tab) => {
    const active = tab.dataset.meetStrip === homeMeetStripTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function bindMeetingsStripTabs() {
  if (bindMeetingsStripTabs._bound) return;
  bindMeetingsStripTabs._bound = true;

  document.querySelectorAll(".meetings-strip-tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      if (tab.dataset.meetStrip === homeMeetStripTab) return;
      homeMeetStripTab = tab.dataset.meetStrip;
      await renderTodaySection(homeMeetingsCache);
    });
  });
}

async function connectCalendarFromHome() {
  const settings = await getSettings();
  if (!settings.googleOAuthClientId?.trim()) {
    const go = await showConfirm(
      "Add your Google OAuth Client ID under Settings → Google Calendar, then connect your account.",
      { title: "Calendar setup required", confirmLabel: "Open Settings", cancelLabel: "Not now" }
    );
    if (go) bridge.navigate("settings", { settingsTab: "calendar" });
    return;
  }
  try {
    await Calendar.connectGoogleCalendar();
    showToast("Calendar connected");
    await renderHome();
  } catch (err) {
    showToast(err.message || "Calendar connect failed");
  }
}

function renderRecentTable(list) {
  const grid = document.getElementById("recentMeetingsGrid");
  const pager = document.getElementById("recentMeetingsPager");
  if (!grid) return;

  grid.querySelectorAll(".rg-row, .rg-empty").forEach((el) => el.remove());

  const filtered = filterMeetings(list);
  const filterKey = JSON.stringify(homeFilterState);
  if (filterKey !== homeTableFilterKey) {
    homeTableFilterKey = filterKey;
    homeTablePage = 1;
  }

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "rg-empty";
    empty.textContent = "No meetings match your filters.";
    grid.appendChild(empty);
    if (pager) {
      pager.hidden = true;
      pager.innerHTML = "";
    }
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / HOME_TABLE_PAGE_SIZE));
  if (homeTablePage > totalPages) homeTablePage = totalPages;
  const start = (homeTablePage - 1) * HOME_TABLE_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + HOME_TABLE_PAGE_SIZE);

  const html = pageItems
    .map((m) => `<div class="rg-row" data-id="${escapeAttr(m.id)}">${recentTableRow(m)}</div>`)
    .join("");
  grid.insertAdjacentHTML("beforeend", html);

  grid.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", () => {
      bridge.navigate("meeting", { meetingId: el.dataset.open, tab: "summary" });
    });
  });

  grid.querySelectorAll("[data-row-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openMeetingCardMenu(btn, btn.dataset.rowMenu);
    });
  });

  grid.querySelectorAll("[data-row-fav]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await MeetingStore.toggleFavorite(btn.dataset.rowFav);
      await renderHome();
      showToast("Favorite updated");
    });
  });

  renderRecentPager(filtered.length, totalPages);
}

function renderRecentPager(total, totalPages) {
  const pager = document.getElementById("recentMeetingsPager");
  if (!pager) return;
  if (totalPages <= 1) {
    pager.hidden = true;
    pager.innerHTML = "";
    return;
  }

  const start = (homeTablePage - 1) * HOME_TABLE_PAGE_SIZE + 1;
  const end = Math.min(total, homeTablePage * HOME_TABLE_PAGE_SIZE);
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    pages.push(
      `<button type="button" class="recent-page-btn${i === homeTablePage ? " is-active" : ""}" data-page="${i}">${i}</button>`
    );
  }

  pager.hidden = false;
  pager.innerHTML = `
    <span class="recent-page-meta">Showing ${start}–${end} of ${total}</span>
    <div class="recent-page-btns">
      <button type="button" class="recent-page-btn" data-page="prev" ${homeTablePage <= 1 ? "disabled" : ""} aria-label="Previous page">${icon("chevronLeft", 14)}</button>
      ${pages.join("")}
      <button type="button" class="recent-page-btn" data-page="next" ${homeTablePage >= totalPages ? "disabled" : ""} aria-label="Next page">${icon("chevronRight", 14)}</button>
    </div>`;

  pager.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const raw = btn.dataset.page;
      if (raw === "prev") homeTablePage = Math.max(1, homeTablePage - 1);
      else if (raw === "next") homeTablePage = Math.min(totalPages, homeTablePage + 1);
      else homeTablePage = Number(raw) || 1;
      renderRecentTable(homeMeetingsCache);
    });
  });
}

function bindTodayCardClicks(container) {
  container.querySelectorAll(".today-meet-card:not(.is-upcoming)").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-card-menu]")) return;
      bridge.navigate("meeting", { meetingId: card.dataset.id, tab: "summary" });
    });
  });
  container.querySelectorAll("[data-card-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMeetingCardMenu(btn, btn.dataset.cardMenu);
    });
  });
}

function bindHomeFilters() {
  if (bindHomeFilters._bound) {
    renderRecentTable(homeMeetingsCache);
    return;
  }
  bindHomeFilters._bound = true;

  document.querySelectorAll("#recentToolbar .recent-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      homeFilterState.tab = tab.dataset.tab;
      document.querySelectorAll("#recentToolbar .recent-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      renderRecentTable(homeMeetingsCache);
    });
  });

  const dateSel = document.getElementById("homeFilterDate");
  const peopleSel = document.getElementById("homeFilterPeople");
  const durSel = document.getElementById("homeFilterDuration");
  const searchInput = document.getElementById("homeGlobalSearch");
  let ignoreDateChange = false;

  const syncCustomDateOption = () => {
    const customOpt = dateSel?.querySelector('option[value="custom"]');
    if (!customOpt) return;
    customOpt.textContent =
      homeFilterState.date === "custom"
        ? formatRangeLabel(homeFilterState.dateFrom, homeFilterState.dateTo)
        : "Date: Custom…";
  };

  const setDateSelectValue = (value) => {
    if (!dateSel) return;
    ignoreDateChange = true;
    dateSel.value = value;
    dateSel.dispatchEvent(new Event("change", { bubbles: true }));
    ignoreDateChange = false;
  };

  if (dateSel) {
    dateSel.value = homeFilterState.date;
    syncCustomDateOption();
    dateSel.addEventListener("change", async () => {
      if (ignoreDateChange) return;
      if (dateSel.value !== "custom") {
        homeFilterState.date = dateSel.value;
        syncCustomDateOption();
        renderRecentTable(homeMeetingsCache);
        return;
      }

      const picked = await pickDateRange({
        from: homeFilterState.dateFrom,
        to: homeFilterState.dateTo,
      });
      if (picked) {
        homeFilterState.date = "custom";
        homeFilterState.dateFrom = picked.from;
        homeFilterState.dateTo = picked.to;
        syncCustomDateOption();
      } else if (!homeFilterState.dateFrom && !homeFilterState.dateTo) {
        homeFilterState.date = "all";
        setDateSelectValue("all");
        syncCustomDateOption();
      } else {
        setDateSelectValue("custom");
        syncCustomDateOption();
      }
      renderRecentTable(homeMeetingsCache);
    });
  }
  if (peopleSel) {
    peopleSel.value = homeFilterState.people;
    peopleSel.addEventListener("change", () => {
      homeFilterState.people = peopleSel.value;
      renderRecentTable(homeMeetingsCache);
    });
  }
  if (durSel) {
    durSel.value = homeFilterState.duration;
    durSel.addEventListener("change", () => {
      homeFilterState.duration = durSel.value;
      renderRecentTable(homeMeetingsCache);
    });
  }
  if (searchInput) {
    searchInput.value = homeFilterState.search;
    searchInput.addEventListener(
      "input",
      debounce(() => {
        homeFilterState.search = searchInput.value;
        renderRecentTable(homeMeetingsCache);
      }, 180)
    );
  }

  document.getElementById("viewCalendarBtn")?.addEventListener("click", () => Calendar.openGoogleCalendar());
  document.getElementById("todayViewAll")?.addEventListener("click", () => bridge.navigate("meetings"));
}

async function hydrateHomeProfile() {
  const profile = document.getElementById("homeProfile");
  const result = await new Promise((r) => chrome.storage.local.get(["localDisplayName"], r));
  const name = result.localDisplayName || "You";
  if (profile) {
    profile.textContent = initialsFrom(name);
    profile.title = name;
    profile.style.background = stringToColor(name);
  }

  const hour = getIstHour();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const greetEl = document.getElementById("homeGreeting");
  if (greetEl) greetEl.textContent = `${greeting}, ${name.split(/\s+/)[0]}`;
}

export async function renderHome() {
  const settings = await getSettings();
  let all = await MeetingStore.listMeetings();
  if (settings.hidePrivateFromHome !== false) {
    all = all.filter((m) => !m.isPrivate);
  }

  homeMeetingsCache = all;
  homeNotesCache = await loadMeetingsWithNotes(all.map((m) => m.id));

  await hydrateHomeProfile();
  await renderProviderStatusCard();
  await renderAnalyticsStrip();
  await renderTodaySection(all);
  renderRecentTable(all);
  bindMeetingsStripTabs();
  bindHomeFilters();

  const searchIcon = document.getElementById("homeSearchIcon");
  if (searchIcon) searchIcon.innerHTML = icon("search", 16);

  await bridge.renderSidebar();
}

export function meetingCard(m) {
  const meeting = m.transcript
    ? m
    : {
        title: m.title,
        date: m.date,
        duration: m.duration || "0 mins",
        participantCount: m.participantCount || 0,
        id: m.id,
        tags: m.tags,
        platform: m.platform,
        isPrivate: m.isPrivate,
      };
  const preview = meeting.transcript
    ? meeting.transcript.map((e) => e.text).join(" ")
    : "";
  const tags = meeting.tags || [];
  return `
    <div class="meeting-card" data-id="${meeting.id}">
      <div class="meeting-card-title-row">
        ${platformIcon(meeting.platform)}
        <div class="meeting-card-title">${escapeHtml(meeting.title)}${meeting.isPrivate ? ` ${icon("shieldCheck", 12)}` : ""}</div>
        <button type="button" class="meeting-card-menu-btn" data-card-menu="${meeting.id}" title="More actions" aria-label="More actions">${icon("moreVertical", 16)}</button>
      </div>
      <div class="meeting-card-meta">
        <span>${icon("calendar", 12)} ${formatDate(meeting.date)}</span>
        <span>${icon("clock", 12)} ${meeting.duration}</span>
        <span>${icon("users", 12)} ${meeting.participantCount || 0} people</span>
      </div>
      ${preview ? `<div class="meeting-card-preview">${escapeHtml(preview.slice(0, 160))}${preview.length > 160 ? "…" : ""}</div>` : ""}
      ${tags.length ? `<div class="meeting-card-tags">${tags.map((t) => `<span class="tag-chip">${icon("tag", 10)} ${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    </div>`;
}

export function closeCardMenus() {
  document.querySelectorAll(".meeting-card-menu").forEach((el) => el.remove());
}

/** Place the menu fully on-screen: prefer below, flip above, or scroll if needed. */
function positionMeetingCardMenu(menu, anchorBtn) {
  const rect = anchorBtn.getBoundingClientRect();
  const pad = 8;
  const gap = 6;
  const menuW = Math.max(menu.offsetWidth || 0, 210);

  let left = rect.right - menuW;
  left = Math.min(Math.max(pad, left), window.innerWidth - menuW - pad);

  menu.style.maxHeight = "";
  menu.style.overflowY = "";
  const naturalH = menu.scrollHeight;
  const spaceBelow = window.innerHeight - rect.bottom - gap - pad;
  const spaceAbove = rect.top - gap - pad;

  let top;
  const openBelow = naturalH <= spaceBelow || spaceBelow >= spaceAbove;
  if (openBelow) {
    if (naturalH > spaceBelow) {
      menu.style.maxHeight = `${Math.max(140, spaceBelow)}px`;
      menu.style.overflowY = "auto";
    }
    top = rect.bottom + gap;
  } else {
    if (naturalH > spaceAbove) {
      menu.style.maxHeight = `${Math.max(140, spaceAbove)}px`;
      menu.style.overflowY = "auto";
    }
    top = rect.top - gap - menu.offsetHeight;
  }

  const h = menu.offsetHeight;
  top = Math.min(Math.max(pad, top), window.innerHeight - h - pad);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function openMeetingCardMenu(anchorBtn, meetingId) {
  closeCardMenus();
  const menu = document.createElement("div");
  menu.className = "meeting-card-menu";
  menu.innerHTML = `
    <button type="button" data-act="open">${icon("external", 14)} Open meeting</button>
    <button type="button" data-act="ask">${icon("askAi", 14)} Ask AI about this</button>
    <button type="button" data-act="transcript">${icon("fileText", 14)} Open transcript</button>
    <button type="button" data-act="summary">${icon("wand", 14)} Open summary</button>
    <button type="button" data-act="rename">${icon("edit", 14)} Rename</button>
    <button type="button" data-act="favorite">${icon("star", 14)} Toggle favorite</button>
    <button type="button" data-act="pin">${icon("pin", 14)} Toggle pin</button>
    <button type="button" data-act="copy">${icon("copy", 14)} Copy open actions</button>
    <button type="button" data-act="delete" class="is-danger">${icon("trash", 14)} Delete</button>
  `;
  document.body.appendChild(menu);
  positionMeetingCardMenu(menu, anchorBtn);

  const onDoc = (e) => {
    if (!menu.contains(e.target) && e.target !== anchorBtn) {
      menu.remove();
      document.removeEventListener("mousedown", onDoc, true);
      window.removeEventListener("resize", onReposition);
    }
  };
  const onReposition = () => {
    if (!menu.isConnected) {
      window.removeEventListener("resize", onReposition);
      return;
    }
    positionMeetingCardMenu(menu, anchorBtn);
  };
  document.addEventListener("mousedown", onDoc, true);
  window.addEventListener("resize", onReposition);

  menu.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      menu.remove();
      document.removeEventListener("mousedown", onDoc, true);
      window.removeEventListener("resize", onReposition);
      if (act === "open") {
        bridge.navigate("meeting", { meetingId, tab: "chat" });
        return;
      }
      if (act === "ask") {
        await bridge.addMeetingsToAsk([meetingId], { animateId: meetingId });
        bridge.navigate("ask");
        showToast("Meeting added to Ask AI");
        return;
      }
      if (act === "transcript") {
        bridge.navigate("meeting", { meetingId, tab: "transcript" });
        return;
      }
      if (act === "summary") {
        bridge.navigate("meeting", { meetingId, tab: "summary" });
        return;
      }
      if (act === "rename") {
        await promptRenameMeeting(meetingId);
        return;
      }
      if (act === "favorite") {
        await MeetingStore.toggleFavorite(meetingId);
        if (state.route === "home") renderHome();
        if (state.route === "meetings") bridge.renderAllMeetings();
        if (state.route === "favorites") bridge.renderFavorites();
        if (state.route === "spaces") bridge.renderSpaces();
        await bridge.renderSidebar();
        showToast("Favorite updated");
        return;
      }
      if (act === "pin") {
        await MeetingStore.togglePin(meetingId);
        bridge.renderRightHome();
        await bridge.renderSidebar();
        showToast("Pin updated");
        return;
      }
      if (act === "copy") {
        const meeting = await MeetingStore.getMeeting(meetingId);
        const lines = (meeting?.actionItems || [])
          .filter((a) => !a.done)
          .map((a) => `- ${a.owner ? a.owner + ": " : ""}${a.text || a.title || a}`);
        await navigator.clipboard.writeText(lines.length ? lines.join("\n") : "No open action items.");
        showToast("Actions copied");
        return;
      }
      if (act === "delete") {
        const settings = await getSettings();
        if (settings.confirmBeforeDelete !== false) {
          if (!(await showConfirm("Delete this meeting? This cannot be undone.", {
            title: "Delete meeting",
            confirmLabel: "Delete",
            danger: true,
          }))) return;
        }
        await MeetingStore.deleteMeeting(meetingId);
        state.askSelectedIds = state.askSelectedIds.filter((id) => id !== meetingId);
        state.askMeetingsCache.delete(meetingId);
        if (state.currentMeetingId === meetingId) bridge.navigate("home");
        else if (state.route === "home") renderHome();
        else if (state.route === "meetings") bridge.renderAllMeetings();
        else if (state.route === "favorites") bridge.renderFavorites();
        else if (state.route === "spaces") bridge.renderSpaces();
        else if (state.route === "ask") bridge.renderAsk();
        await bridge.renderSidebar();
        showToast("Meeting deleted");
      }
    });
  });
}

export function bindCardClicks(container) {
  container.querySelectorAll(".meeting-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-card-menu]")) return;
      bridge.navigate("meeting", { meetingId: card.dataset.id, tab: "chat" });
    });
  });
  container.querySelectorAll("[data-card-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMeetingCardMenu(btn, btn.dataset.cardMenu);
    });
  });
}
