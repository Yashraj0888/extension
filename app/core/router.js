import { state, dom, icon } from "./runtime.js";
import { bridge } from "./bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp,
} from "./utils.js";

// === ROUTER ===
export function navigate(route, params) {
  state.route = route;
  if (params && params.meetingId) state.currentMeetingId = params.meetingId;

  const views = {
    home: dom.viewHome,
    meetings: dom.viewMeetings,
    tasks: dom.viewTasks,
    people: dom.viewPeople,
    favorites: dom.viewFavorites,
    spaces: dom.viewSpaces,
    search: dom.viewSearch,
    ask: dom.viewAsk,
    settings: dom.viewSettings,
    meeting: dom.viewMeeting,
  };
  for (const [name, el] of Object.entries(views)) {
    if (!el) continue;
    if (name === route) {
      el.style.display = name === "ask" || name === "meeting" ? "flex" : "";
    } else {
      el.style.display = "none";
    }
  }

  dom.rightHome.style.display =
    route === "home" ||
    route === "meetings" ||
    route === "tasks" ||
    route === "people" ||
    route === "favorites" ||
    route === "spaces" ||
    route === "search" ||
    route === "ask"
      ? ""
      : "none";
  dom.rightMeeting.style.display = route === "meeting" ? "" : "none";
  const rightSettings = document.getElementById("rightSettings");
  if (rightSettings) rightSettings.style.display = route === "settings" ? "" : "none";
  if (dom.rightSidebar) {
    dom.rightSidebar.dataset.context =
      route === "meeting" ? "meeting" : route === "settings" ? "settings" : "home";
  }
  bridge.syncRightPanelForRoute?.(route);

  document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
  const navEl = document.getElementById(`nav-${route === "meeting" ? "meetings" : route}`);
  if (navEl) navEl.classList.add("active");

  if (route === "home") {
    setNavbar("Home", "Meeting overview");
    bridge.renderHome();
    bridge.renderRightHome();
  } else if (route === "meetings") {
    setNavbar("All meetings", "Browse everything you’ve captured");
    bridge.renderAllMeetings();
    bridge.renderRightHome();
  } else if (route === "tasks") {
    setNavbar("My Tasks", "Action items across every meeting");
    bridge.renderMyTasks();
    bridge.renderRightHome();
  } else if (route === "people") {
    setNavbar("People Insights", "Facts from meetings — no speculative scoring");
    bridge.renderPeopleInsights();
    bridge.renderRightHome();
  } else if (route === "favorites") {
    setNavbar("Favorites", "Starred meetings");
    bridge.renderFavorites();
    bridge.renderRightHome();
  } else if (route === "spaces") {
    setNavbar("Spaces", "Meetings grouped by space");
    bridge.renderSpaces(params?.spaceId);
    bridge.renderRightHome();
  } else if (route === "search") {
    setNavbar("Search", "Find meetings by title or content");
    bridge.renderSearchView(params?.query || "");
    bridge.renderRightHome();
  } else if (route === "ask") {
    setNavbar("Ask AI", "Questions across recent meetings");
    bridge.renderAsk();
    bridge.renderRightHome();
    setTimeout(() => document.getElementById("globalChatInput")?.focus(), 40);
  } else if (route === "settings") {
    if (params?.settingsTab) state.settingsTab = params.settingsTab;
    setNavbar("Settings", "Providers, templates, and data");
    bridge.renderSettings();
    bridge.renderRightSettings();
  } else if (route === "meeting") {
    setNavbar("Meeting", "Loading…");
    bridge.loadMeeting(state.currentMeetingId, params?.tab || "chat", params?.searchQuery, params?.entryIndex);
  }
}

export function setNavbar(title, sub) {
  const t = document.getElementById("navbarTitle");
  const s = document.getElementById("navbarSub");
  if (t) t.textContent = title;
  if (s) s.textContent = sub || "";
}
