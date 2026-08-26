/**
 * App entry hub — wires modules and boots the UI.
 * Feature logic lives under ./views and ./shell; shared state under ./core.
 */

import { state, dom, cacheDom, icon } from "./core/runtime.js";
import { bridge } from "./core/bridge.js";
import { showToast } from "./core/utils.js";
import { navigate, setNavbar } from "./core/router.js";

import { hydrateStaticIcons } from "./shell/hydrate-icons.js";
import { renderSidebar, updateCollapseIcon, updateRightCollapseIcon, updateStorageIndicator, bindSidebarResize, syncRightPanelForRoute } from "./shell/sidebar.js";
import { setupEvents } from "./shell/events.js";
import {
  exportBackup,
  createBlankMeeting,
  toggleFocusMode,
  openShortcutsModal,
  triggerImportTranscript,
  bindTopNavbar,
} from "./shell/app-actions.js";

import {
  renderHome,
  renderProviderStatusCard,
  renderAnalyticsStrip,
  meetingCard,
  bindCardClicks,
  openMeetingCardMenu,
  closeCardMenus,
  promptRenameMeeting,
} from "./views/home-view.js";
import { renderAllMeetings, renderFavorites, renderSpaces } from "./views/meetings-list.js";
import { renderSearchView, performGlobalSearch } from "./views/search-view.js";
import {
  renderAsk,
  sendGlobalMessage,
  addMeetingsToAsk,
  maybeAskBackupConsent,
  openAskMeetingPicker,
} from "./views/ask-view.js";
import {
  renderSettings,
  renderRightSettings,
  openQuickSearchModal,
} from "./views/settings-view.js";
import {
  loadMeeting,
  renderMeetingTags,
  updateFavoriteBtn,
  updatePinBtn,
} from "./views/meeting-view.js";
import { renderChat, bindChatEvents, sendMessage } from "./views/meeting-chat.js";
import { renderTranscript, openRenameSpeakerModal } from "./views/meeting-transcript.js";
import { renderSummary, generateSummary, regenerateMeetingScore, autoScoreMeeting } from "./views/meeting-summary.js";
import { renderActionItems } from "./views/meeting-actions.js";
import { renderMyTasks, renderSidebarTasks } from "./views/tasks-view.js";
import { renderPeopleInsights } from "./views/people-view.js";
import { renderHighlights } from "./views/meeting-highlights.js";
import {
  renderRightHome,
  renderRightMeeting,
  shareMeetingBrief,
  duplicateMeeting,
  openSpacePicker,
} from "./views/right-panel.js";

import {
  initTheme,
  bindThemeToggles,
  hydrateThemeToggleIcons,
  applyTheme,
  getThemePref,
} from "./theme.js";
import { bindCustomSelects } from "./custom-select.js";
import { getSettings } from "./services/settings.js";
import MeetingStore from "./services/meeting-store.js";

// Cross-module live bindings (views call bridge.* for peers / shell)
Object.assign(bridge, {
  // navigation / chrome
  navigate,
  setNavbar,
  showToast,
  icon,
  // shell
  renderSidebar,
  updateCollapseIcon,
  updateRightCollapseIcon,
  syncRightPanelForRoute,
  updateStorageIndicator,
  hydrateStaticIcons,
  setupEvents,
  exportBackup,
  createBlankMeeting,
  toggleFocusMode,
  openShortcutsModal,
  triggerImportTranscript,
  bindTopNavbar,
  openQuickSearchModal,
  openCollapsedSearchModal: openQuickSearchModal,
  // views
  renderHome,
  renderProviderStatusCard,
  renderAnalyticsStrip,
  meetingCard,
  bindCardClicks,
  openMeetingCardMenu,
  closeCardMenus,
  promptRenameMeeting,
  renderAllMeetings,
  renderFavorites,
  renderSpaces,
  renderSearchView,
  performGlobalSearch,
  renderAsk,
  sendGlobalMessage,
  addMeetingsToAsk,
  maybeAskBackupConsent,
  openAskMeetingPicker,
  renderSettings,
  renderRightSettings,
  loadMeeting,
  renderMeetingTags,
  updateFavoriteBtn,
  updatePinBtn,
  renderChat,
  bindChatEvents,
  sendMessage,
  renderTranscript,
  openRenameSpeakerModal,
  renderSummary,
  generateSummary,
  regenerateMeetingScore,
  autoScoreMeeting,
  renderActionItems,
  renderMyTasks,
  renderSidebarTasks,
  renderPeopleInsights,
  renderHighlights,
  renderRightHome,
  renderRightMeeting,
  shareMeetingBrief,
  duplicateMeeting,
  openSpacePicker,
});

async function init() {
  cacheDom();
  await initTheme();
  hydrateStaticIcons();
  hydrateThemeToggleIcons(icon);
  bindThemeToggles(document, { cycle: false });

  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const order = ["light", "dark", "system"];
      const i = order.indexOf(getThemePref());
      applyTheme(order[(i + 1) % order.length], { animate: true, fromEl: btn });
    });
  });

  bindCustomSelects(document);
  setupEvents();
  bindSidebarResize();
  syncRightPanelForRoute(state.route || "home");
  await renderSidebar();
  await maybeAskBackupConsent();

  const settings = await getSettings();
  if (settings.collapseSidebarOnStart) {
    state.isSidebarCollapsed = true;
    dom.leftSidebar.classList.add("collapsed");
    updateCollapseIcon();
  }

  const launchRoute = (() => {
    const hash = (location.hash || "").replace(/^#/, "").split("?")[0].toLowerCase();
    if (hash === "settings") return "settings";
    try {
      if (new URLSearchParams(location.search).get("route") === "settings") return "settings";
    } catch (_) {}
    return null;
  })();

  if (launchRoute === "settings") {
    history.replaceState(null, "", location.pathname);
    navigate("settings");
    return;
  }

  const result = await new Promise((r) =>
    chrome.storage.local.get(["lastMeetingId", "openMeetingTab"], r)
  );
  if (result.lastMeetingId && settings.openLastMeetingOnLaunch !== false) {
    const meeting = await MeetingStore.getMeeting(result.lastMeetingId);
    if (meeting) {
      const tab = result.openMeetingTab || "summary";
      navigate("meeting", { meetingId: result.lastMeetingId, tab });
      await chrome.storage.local.remove(["lastMeetingId", "openMeetingTab"]);
      return;
    }
  }
  await chrome.storage.local.remove(["openMeetingTab"]);
  navigate("home");
}

init();
