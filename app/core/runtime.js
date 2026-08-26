/**
 * Shared app runtime — state, DOM refs, and icon helper.
 * Feature modules import from here; avoid putting view logic in this file.
 */

export const state = {
  route: "home",
  currentMeetingId: null,
  currentMeeting: null,
  currentTab: "chat",
  isSidebarCollapsed: false,
  isRightSidebarCollapsed: true,
  isGenerating: false,
  aiAbort: null,
  settingsTab: "providers",
  editingTemplateId: "default",
  pendingSearchQuery: "",
  focusMode: false,
  askSelectedIds: [],
  askMeetingsCache: new Map(),
  askShowPrompts: false,
};

export const dom = {};

export function icon(name, size = 18) {
  return window.icon(name, size);
}

export function cacheDom() {
  dom.app = document.getElementById("app");
  dom.leftSidebar = document.getElementById("left-sidebar");
  dom.viewHome = document.getElementById("view-home");
  dom.viewMeetings = document.getElementById("view-meetings");
  dom.viewFavorites = document.getElementById("view-favorites");
  dom.viewSpaces = document.getElementById("view-spaces");
  dom.viewTasks = document.getElementById("view-tasks");
  dom.viewPeople = document.getElementById("view-people");
  dom.viewSearch = document.getElementById("view-search");
  dom.viewAsk = document.getElementById("view-ask");
  dom.viewSettings = document.getElementById("view-settings");
  dom.viewMeeting = document.getElementById("view-meeting");
  dom.collapseSidebar = document.getElementById("collapseSidebar");
  dom.collapseRightSidebar = document.getElementById("collapseRightSidebar");
  dom.rightSidebar = document.getElementById("right-sidebar");
  dom.recentMeetingsList = document.getElementById("recentMeetingsList");
  dom.meetingCount = document.getElementById("meetingCount");
  dom.meetingSearch = document.getElementById("meetingSearch");
  dom.chatContainer = document.getElementById("chatContainer");
  dom.transcriptContainer = document.getElementById("transcriptContainer");
  dom.summaryContainer = document.getElementById("summaryContainer");
  dom.actionItemsContainer = document.getElementById("actionItemsContainer");
  dom.highlightsContainer = document.getElementById("highlightsContainer");
  dom.toast = document.getElementById("toast");
  dom.storageFill = document.getElementById("storageFill");
  dom.storageText = document.getElementById("storageText");
  dom.meetingViewTitle = document.getElementById("meetingViewTitle");
  dom.meetingViewMeta = document.getElementById("meetingViewMeta");
  dom.meetingTagsRow = document.getElementById("meetingTagsRow");
  dom.btnFavorite = document.getElementById("btnFavorite");
  dom.btnPin = document.getElementById("btnPin");
  dom.btnDeleteMeeting = document.getElementById("btnDeleteMeeting");
  dom.btnEditTitle = document.getElementById("btnEditTitle");
  dom.backToHome = document.getElementById("backToHome");
  dom.rightHome = document.getElementById("rightHome");
  dom.rightMeeting = document.getElementById("rightMeeting");
  dom.navItems = document.querySelectorAll(".nav-item");
}
