import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";
import { getSettings } from "../services/settings.js";
import { showConfirm } from "../ui-modal.js";

// === EVENT HANDLERS ===
export function setupEvents() {
  dom.collapseSidebar.addEventListener("click", () => {
    state.isSidebarCollapsed = !state.isSidebarCollapsed;
    dom.leftSidebar.classList.toggle("collapsed", state.isSidebarCollapsed);
    bridge.updateCollapseIcon();
  });

  dom.collapseRightSidebar?.addEventListener("click", () => {
    state.isRightSidebarCollapsed = !state.isRightSidebarCollapsed;
    dom.rightSidebar?.classList.toggle("collapsed", state.isRightSidebarCollapsed);
    bridge.updateRightCollapseIcon();
  });

  document.querySelectorAll(".right-rail-action[data-target]").forEach((button) => {
    button.addEventListener("click", () => {
      state.isRightSidebarCollapsed = false;
      dom.rightSidebar?.classList.remove("collapsed");
      bridge.updateRightCollapseIcon();
      requestAnimationFrame(() => {
        document.getElementById(button.dataset.target)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
  });

  // Collapsed sidebar: tapping the search icon opens a quick-find modal.
  document.getElementById("searchIcon")?.addEventListener("click", (e) => {
    if (!state.isSidebarCollapsed) return;
    e.preventDefault();
    e.stopPropagation();
    bridge.openCollapsedSearchModal();
  });
  document.querySelector(".sidebar-search-inner")?.addEventListener("click", (e) => {
    if (!state.isSidebarCollapsed) return;
    if (e.target.closest("#meetingSearch")) return;
    bridge.openCollapsedSearchModal();
  });

  document.querySelectorAll(".nav-item[data-route]").forEach((el) => {
    el.addEventListener("click", () => bridge.navigate(el.dataset.route));
  });

  document.getElementById("appBrandHome")?.addEventListener("click", () => bridge.navigate("home"));

  dom.backToHome.addEventListener("click", () => bridge.navigate("home"));

  dom.btnFavorite.addEventListener("click", async () => {
    const isFav = await MeetingStore.toggleFavorite(state.currentMeetingId);
    state.currentMeeting.isFavorite = isFav;
    bridge.updateFavoriteBtn(isFav);
    showToast(isFav ? "Added to favorites" : "Removed from favorites");
    bridge.renderRightHome();
    bridge.renderSidebar();
  });

  dom.btnPin.addEventListener("click", async () => {
    const isPinned = await MeetingStore.togglePin(state.currentMeetingId);
    state.currentMeeting.isPinned = isPinned;
    bridge.updatePinBtn(isPinned);
    showToast(isPinned ? "Meeting pinned" : "Meeting unpinned");
    bridge.renderRightHome();
    bridge.renderSidebar();
  });

  dom.btnDeleteMeeting.addEventListener("click", async () => {
    const settings = await getSettings();
    if (settings.confirmBeforeDelete !== false) {
      if (!(await showConfirm("Delete this meeting? This cannot be undone.", {
        title: "Delete meeting",
        confirmLabel: "Delete",
        danger: true,
      }))) return;
    }
    await MeetingStore.deleteMeeting(state.currentMeetingId);
    bridge.navigate("home");
    showToast("Meeting deleted");
  });

  dom.btnEditTitle.addEventListener("click", () => {
    if (state.currentMeetingId) bridge.promptRenameMeeting(state.currentMeetingId);
  });

  document.querySelectorAll(".tab[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.tab;
      state.currentTab = tabName;
      document.querySelectorAll(".tab[data-tab]").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".tab-content").forEach((tc) => (tc.style.display = "none"));
      document.getElementById(`tab-${tabName}`).style.display = "";
    });
  });

  dom.meetingSearch.addEventListener("input", (e) => {
    bridge.renderSidebar(e.target.value.trim());
  });

  document.getElementById("openMeetBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://meet.google.com/" });
  });

  document.getElementById("clearGlobalChatBtn").addEventListener("click", async () => {
    if (!(await showConfirm("Clear the cross-meeting Ask AI conversation?", {
      title: "Clear conversation",
      confirmLabel: "Clear",
      danger: true,
    }))) return;
    await MeetingStore.clearGlobalConversation();
    bridge.renderAsk();
    showToast("Conversation cleared");
  });

  document.getElementById("importTranscriptBtn").addEventListener("click", () => bridge.triggerImportTranscript());

  bridge.bindTopNavbar();

  document.addEventListener("keydown", (e) => {
    const code = e.code || "";
    const meta = e.metaKey || e.ctrlKey;
    const alt = e.altKey && !meta;
    const inEditable =
      /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;

    const closeTopModal = () => {
      const modal =
        document.getElementById("collapsedSearchModal") ||
        document.getElementById("shortcutsModal") ||
        document.getElementById("spacePickerModal");
      if (modal) {
        modal.remove();
        return true;
      }
      return false;
    };

    // Escape — close modals / blur search
    if (code === "Escape") {
      if (closeTopModal()) {
        e.preventDefault();
        return;
      }
      if (!inEditable && document.activeElement === dom.meetingSearch) {
        dom.meetingSearch.blur();
      }
      return;
    }

    // ⌘/Ctrl+K — always open quick search modal (use code: reliable on all layouts)
    if (meta && code === "KeyK") {
      e.preventDefault();
      bridge.openQuickSearchModal();
      return;
    }

    // ⌘/Ctrl+N — new blank meeting
    if (meta && code === "KeyN" && !inEditable) {
      e.preventDefault();
      bridge.createBlankMeeting();
      return;
    }

    // ⌘/Ctrl+, — settings
    if (meta && code === "Comma") {
      e.preventDefault();
      bridge.navigate("settings");
      return;
    }

    // ⌘/Ctrl+. — toggle right details panel
    if (meta && code === "Period" && !inEditable) {
      e.preventDefault();
      state.isRightSidebarCollapsed = !state.isRightSidebarCollapsed;
      dom.rightSidebar?.classList.toggle("collapsed", state.isRightSidebarCollapsed);
      bridge.updateRightCollapseIcon();
      return;
    }

    // ⌘/Ctrl+\ — focus mode
    if (meta && code === "Backslash") {
      e.preventDefault();
      bridge.toggleFocusMode();
      return;
    }

    // ⌘/Ctrl+1..5 — meeting tabs
    if (meta && !inEditable && state.route === "meeting") {
      const tabMap = {
        Digit1: "chat",
        Digit2: "transcript",
        Digit3: "summary",
        Digit4: "actionitems",
        Digit5: "highlights",
      };
      if (tabMap[code]) {
        e.preventDefault();
        document.querySelector(`.tab[data-tab="${tabMap[code]}"]`)?.click();
        return;
      }
    }

    // ⌥/Alt+J — Ask AI / chat tab
    // Use e.code (KeyJ). On macOS Option+J changes e.key to "∆", which broke shortcuts.
    if (alt && code === "KeyJ") {
      e.preventDefault();
      if (state.route === "meeting") {
        document.querySelector('.tab[data-tab="chat"]')?.click();
        setTimeout(() => document.getElementById("chatInput")?.focus(), 40);
      } else {
        bridge.navigate("ask");
        setTimeout(() => document.getElementById("globalChatInput")?.focus(), 50);
      }
      return;
    }

    // ⌥/Alt+T — transcript tab
    if (alt && code === "KeyT") {
      e.preventDefault();
      if (state.route === "meeting") {
        document.querySelector('.tab[data-tab="transcript"]')?.click();
      } else if (state.currentMeetingId) {
        bridge.navigate("meeting", { meetingId: state.currentMeetingId, tab: "transcript" });
      } else {
        showToast("Open a meeting first");
      }
      return;
    }

    // ⌥/Alt+S — summary tab
    if (alt && code === "KeyS" && !inEditable) {
      e.preventDefault();
      if (state.route === "meeting") {
        document.querySelector('.tab[data-tab="summary"]')?.click();
      }
      return;
    }
  });
}
