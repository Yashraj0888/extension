import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";

export function hydrateStaticIcons() {
  document.getElementById("brandIcon").innerHTML =
    `<img src="../icons/icon48.png" alt="AfterMeet" width="26" height="26">`;
  document.getElementById("collapseSidebar").innerHTML = icon("panelLeft", 15);
  const collapseRight = document.getElementById("collapseRightSidebar");
  if (collapseRight) collapseRight.innerHTML = icon("panelRight", 15);
  const railIcons = {
    homeStatsCard: "barChart",
    homePinnedCard: "pin",
    homeShortcutsCard: "keyboard",
    meetingDetailCard: "fileText",
    meetingParticipantsCard: "users",
    meetingExportCard: "download",
    rightSettings: "settings",
  };
  document.querySelectorAll(".right-rail-action[data-target]").forEach((button) => {
    button.innerHTML = icon(railIcons[button.dataset.target] || "panelRight", 17);
  });
  document.getElementById("searchIcon").innerHTML = icon("search", 14);
  document.getElementById("openMeetBtn").innerHTML = `${icon("meet", 16)} Start on Meet`;
  document.getElementById("importTranscriptBtn").innerHTML = `${icon("upload", 16)} Import transcript`;
  document.getElementById("backToHome").innerHTML = icon("arrowLeft", 16);
  document.getElementById("btnEditTitle").innerHTML = icon("edit", 13);
  document.getElementById("clearGlobalChatBtn").innerHTML = `${icon("trash", 13)} Clear conversation`;
  const askMark = document.getElementById("askTitleMark");
  if (askMark) askMark.innerHTML = icon("askAi", 20);

  const setNavBtn = (id, name, label) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `${icon(name, 14)}<span class="nav-btn-label">${label}</span>`;
  };
  setNavBtn("navBtnNewMeeting", "plus", "New notes");
  setNavBtn("navBtnImport", "upload", "Import");
  setNavBtn("navBtnExport", "download", "Export");
  setNavBtn("navBtnAsk", "askAi", "Ask AI");
  setNavBtn("navBtnShortcuts", "keyboard", "Shortcuts");
  setNavBtn("navBtnFocus", "focus", "Focus");

  document.getElementById("nav-home").innerHTML = `${icon("home", 16)} <span class="nav-label">Home</span>`;
  document.getElementById("nav-meetings").innerHTML = `${icon("calendar", 16)} <span class="nav-label">All meetings</span> <span class="nav-count" id="meetingCount">0</span>`;
  document.getElementById("nav-tasks").innerHTML = `${icon("listChecks", 16)} <span class="nav-label">My Tasks</span> <span class="nav-count" id="tasksNavCount">0</span>`;
  document.getElementById("nav-people").innerHTML = `${icon("users", 16)} <span class="nav-label">People</span> <span class="nav-count" id="peopleNavCount">0</span>`;
  document.getElementById("nav-favorites").innerHTML = `${icon("star", 16)} <span class="nav-label">Favorites</span>`;
  document.getElementById("nav-spaces").innerHTML = `${icon("layoutGrid", 16)} <span class="nav-label">Spaces</span>`;
  document.getElementById("nav-search").innerHTML = `${icon("search", 16)} <span class="nav-label">Search</span>`;
  document.getElementById("nav-ask").innerHTML = `${icon("askAi", 16)} <span class="nav-label">Ask AI</span>`;
  document.getElementById("nav-settings").innerHTML = `${icon("settings", 16)} <span class="nav-label">Settings</span>`;

  // Re-cache nodes replaced above (innerHTML recreates them).
  dom.meetingCount = document.getElementById("meetingCount");
  dom.navItems = document.querySelectorAll(".nav-item");
  bridge.updateCollapseIcon();
  bridge.updateRightCollapseIcon();

  dom.btnFavorite.innerHTML = icon("star", 16);
  dom.btnPin.innerHTML = icon("pin", 16);
  dom.btnDeleteMeeting.innerHTML = icon("trash", 16);

  document.querySelector('.tab[data-tab="chat"]').innerHTML = `${icon("messageSquare", 14)} AI chat`;
  document.querySelector('.tab[data-tab="transcript"]').innerHTML = `${icon("fileText", 14)} Transcript`;
  document.querySelector('.tab[data-tab="summary"]').innerHTML = `${icon("wand", 14)} Summary`;
  document.querySelector('.tab[data-tab="actionitems"]').innerHTML = `${icon("listChecks", 14)} Action items`;
  document.querySelector('.tab[data-tab="highlights"]').innerHTML = `${icon("highlighter", 14)} Highlights`;

  document.getElementById("btnCopyTranscript").innerHTML = `${icon("copy", 15)} Copy transcript`;
  document.getElementById("btnCopySummary").innerHTML = `${icon("copy", 15)} Copy summary`;
  document.getElementById("btnDownloadMD").innerHTML = `${icon("download", 15)} Download Markdown`;
  document.getElementById("btnDownloadDoc").innerHTML = `${icon("fileWord", 15)} Download Word`;
  document.getElementById("btnPrint").innerHTML = `${icon("printer", 15)} Print / Save PDF`;
}
