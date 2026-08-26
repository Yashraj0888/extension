import { icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, showToast,
} from "../core/utils.js";
import MeetingStore from "../services/meeting-store.js";
import { showPrompt } from "../ui-modal.js";

const SELF_NAME_ALIASES = /^(you|me)$/i;

let tasksFilter = {
  status: "open", // open | overdue | today | week | completed | all
  meetingId: "all",
  priority: "all",
  date: "all", // all | has-deadline | no-deadline
};

function isRealPersonName(name) {
  const n = String(name || "").trim();
  return n.length >= 2 && !SELF_NAME_ALIASES.test(n);
}

/** Extension user display name (Meet local identity, else who recorded recent meetings). */
export async function getExtensionUserName() {
  try {
    const result = await new Promise((r) => chrome.storage.local.get(["localDisplayName"], r));
    const stored = String(result.localDisplayName || "").trim();
    if (isRealPersonName(stored)) return stored;
  } catch (_) {}

  try {
    const recent = await MeetingStore.getRecentFull(12);
    for (const meeting of recent) {
      const recordedBy = String(meeting?.recordedBy || "").trim();
      if (isRealPersonName(recordedBy)) {
        try {
          chrome.storage.local.set({ localDisplayName: recordedBy });
        } catch (_) {}
        return recordedBy;
      }
    }
  } catch (_) {}

  return "";
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namesMatch(owner, user) {
  const o = String(owner || "").trim().toLowerCase();
  const u = String(user || "").trim().toLowerCase();
  if (!o || !u) return false;
  if (o === u) return true;
  const uFirst = u.split(/\s+/).filter(Boolean)[0] || "";
  const oFirst = o.split(/\s+/).filter(Boolean)[0] || "";
  if (uFirst.length >= 3 && (o === uFirst || oFirst === uFirst)) return true;
  if (o.startsWith(u + " ") || u.startsWith(o + " ")) return true;
  if (uFirst.length >= 4 && (o.includes(u) || oFirst === uFirst)) return true;
  return false;
}

/** True when an action item is assigned to the extension user (not other participants). */
export function taskBelongsToUser(task, userName) {
  const owner = String(task?.owner || "").trim();

  if (SELF_NAME_ALIASES.test(owner)) return true;

  const aliases = [userName, task?.recordedBy, task?.meetingRecordedBy]
    .map((n) => String(n || "").trim())
    .filter(isRealPersonName);

  if (aliases.some((alias) => namesMatch(owner, alias))) return true;

  const text = String(task?.text || "").trim();
  if (text && aliases.length) {
    for (const alias of aliases) {
      try {
        if (new RegExp(`^${escapeRegExp(alias)}\\b`, "i").test(text)) return true;
        const first = alias.split(/\s+/).filter(Boolean)[0] || "";
        if (first.length >= 4 && new RegExp(`^${escapeRegExp(first)}\\b`, "i").test(text)) {
          return true;
        }
      } catch (_) {}
    }
  }

  return false;
}

async function listMyActionItems() {
  const all = await MeetingStore.listAllActionItems();
  const userName = await getExtensionUserName();
  return all.filter((t) => taskBelongsToUser(t, userName));
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Parse free-text deadlines into a Date when possible. */
export function parseTaskDeadline(deadline) {
  const s = String(deadline || "").trim();
  if (!s || /^tbd$/i.test(s) || /^n\/?a$/i.test(s) || /^none$/i.test(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T12:00:00");
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t);
  // Soft relative phrases
  const lower = s.toLowerCase();
  const today = startOfDay();
  if (lower === "today" || lower === "eod") return today;
  if (lower === "tomorrow") {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }
  return null;
}

export function taskBucket(task) {
  if (task.done) return "completed";
  const due = parseTaskDeadline(task.deadline);
  if (!due) return "open";
  const today0 = startOfDay();
  const today1 = endOfDay();
  const weekEnd = endOfDay(new Date(today0.getTime() + 6 * 86400000));
  if (due.getTime() < today0.getTime()) return "overdue";
  if (due.getTime() <= today1.getTime()) return "today";
  if (due.getTime() <= weekEnd.getTime()) return "week";
  return "open";
}

function summarizeTasks(rows) {
  const stats = { open: 0, overdue: 0, today: 0, week: 0, completed: 0 };
  for (const t of rows) {
    const b = taskBucket(t);
    if (b === "completed") stats.completed += 1;
    else {
      stats.open += 1;
      if (b === "overdue") stats.overdue += 1;
      if (b === "today") stats.today += 1;
      if (b === "week" || b === "today" || b === "overdue") {
        // this week strip includes overdue + today + rest of week for the "This Week" headline?
        // Spec: Overdue / Due Today / This Week as separate counts
      }
      if (b === "week") stats.week += 1;
    }
  }
  // "This Week" headline = due within the next 7 days excluding overdue (today + week)
  stats.weekHeadline = stats.today + stats.week;
  return stats;
}

function filterTasks(rows) {
  return rows.filter((t) => {
    const bucket = taskBucket(t);
    if (tasksFilter.status === "open" && t.done) return false;
    if (tasksFilter.status === "completed" && !t.done) return false;
    if (tasksFilter.status === "overdue" && bucket !== "overdue") return false;
    if (tasksFilter.status === "today" && bucket !== "today") return false;
    if (tasksFilter.status === "week" && !(bucket === "today" || bucket === "week")) return false;

    if (tasksFilter.meetingId !== "all" && t.meetingId !== tasksFilter.meetingId) return false;

    const pri = String(t.priority || "").toLowerCase();
    if (tasksFilter.priority !== "all" && pri !== tasksFilter.priority) return false;

    const due = parseTaskDeadline(t.deadline);
    if (tasksFilter.date === "has-deadline" && !due) return false;
    if (tasksFilter.date === "no-deadline" && due) return false;

    return true;
  });
}

function priorityClass(p) {
  const x = String(p || "").toLowerCase();
  if (x === "high") return "is-high";
  if (x === "medium") return "is-medium";
  if (x === "low") return "is-low";
  return "";
}

async function openTaskSource(task) {
  const params = {
    meetingId: task.meetingId,
    tab: typeof task.sourceEntryIndex === "number" && task.sourceEntryIndex >= 0 ? "transcript" : "actionitems",
  };
  if (typeof task.sourceEntryIndex === "number" && task.sourceEntryIndex >= 0) {
    params.entryIndex = task.sourceEntryIndex;
  }
  bridge.navigate("meeting", params);
}

export async function renderMyTasks() {
  const host = document.getElementById("view-tasks");
  if (!host) return;

  const userName = await getExtensionUserName();
  const all = await listMyActionItems();
  const stats = summarizeTasks(all);
  const filtered = filterTasks(all);

  const meetings = [];
  const seen = new Set();
  for (const t of all) {
    if (seen.has(t.meetingId)) continue;
    seen.add(t.meetingId);
    meetings.push({ id: t.meetingId, title: t.meetingTitle });
  }

  const rowsById = new Map(filtered.map((t) => [`${t.meetingId}::${t.id}`, t]));

  host.innerHTML = `
    <div class="tasks-page">
      <div class="home-header">
        <div>
          <h1 class="home-title">My Tasks</h1>
          <p class="home-subtitle">${
            userName
              ? `Only action items assigned to ${escapeHtml(userName)}`
              : "Only action items assigned to you — set your name by capturing a Meet call once"
          }</p>
        </div>
      </div>

      <div class="tasks-stats">
        <button type="button" class="tasks-stat ${tasksFilter.status === "overdue" ? "is-active" : ""}" data-stat="overdue">
          <span class="tasks-stat-label">Overdue</span>
          <strong>${stats.overdue}</strong>
        </button>
        <button type="button" class="tasks-stat ${tasksFilter.status === "today" ? "is-active" : ""}" data-stat="today">
          <span class="tasks-stat-label">Due Today</span>
          <strong>${stats.today}</strong>
        </button>
        <button type="button" class="tasks-stat ${tasksFilter.status === "week" ? "is-active" : ""}" data-stat="week">
          <span class="tasks-stat-label">This Week</span>
          <strong>${stats.weekHeadline}</strong>
        </button>
        <button type="button" class="tasks-stat ${tasksFilter.status === "open" ? "is-active" : ""}" data-stat="open">
          <span class="tasks-stat-label">Open</span>
          <strong>${stats.open}</strong>
        </button>
        <button type="button" class="tasks-stat ${tasksFilter.status === "completed" ? "is-active" : ""}" data-stat="completed">
          <span class="tasks-stat-label">Completed</span>
          <strong>${stats.completed}</strong>
        </button>
      </div>

      <div class="tasks-filters">
        <select id="tasksFilterStatus" class="home-filter-select" data-no-cselect="1">
          <option value="open" ${tasksFilter.status === "open" ? "selected" : ""}>Status: Open</option>
          <option value="overdue" ${tasksFilter.status === "overdue" ? "selected" : ""}>Status: Overdue</option>
          <option value="today" ${tasksFilter.status === "today" ? "selected" : ""}>Status: Due today</option>
          <option value="week" ${tasksFilter.status === "week" ? "selected" : ""}>Status: This week</option>
          <option value="completed" ${tasksFilter.status === "completed" ? "selected" : ""}>Status: Completed</option>
          <option value="all" ${tasksFilter.status === "all" ? "selected" : ""}>Status: All</option>
        </select>
        <select id="tasksFilterMeeting" class="home-filter-select" data-no-cselect="1">
          <option value="all">Meeting: All</option>
          ${meetings
            .map(
              (m) =>
                `<option value="${escapeAttr(m.id)}" ${tasksFilter.meetingId === m.id ? "selected" : ""}>${escapeHtml(m.title)}</option>`
            )
            .join("")}
        </select>
        <select id="tasksFilterPriority" class="home-filter-select" data-no-cselect="1">
          <option value="all" ${tasksFilter.priority === "all" ? "selected" : ""}>Priority: All</option>
          <option value="high" ${tasksFilter.priority === "high" ? "selected" : ""}>Priority: High</option>
          <option value="medium" ${tasksFilter.priority === "medium" ? "selected" : ""}>Priority: Medium</option>
          <option value="low" ${tasksFilter.priority === "low" ? "selected" : ""}>Priority: Low</option>
        </select>
        <select id="tasksFilterDate" class="home-filter-select" data-no-cselect="1">
          <option value="all" ${tasksFilter.date === "all" ? "selected" : ""}>Deadline: Any</option>
          <option value="has-deadline" ${tasksFilter.date === "has-deadline" ? "selected" : ""}>Deadline: Set</option>
          <option value="no-deadline" ${tasksFilter.date === "no-deadline" ? "selected" : ""}>Deadline: Missing</option>
        </select>
      </div>

      <div class="tasks-list" id="tasksList">
        ${
          filtered.length === 0
            ? `<p class="empty-state">No tasks assigned to you match these filters.${
                userName ? ` Showing only items for ${escapeHtml(userName)}.` : ""
              }</p>`
            : filtered
                .map((t) => {
                  const key = `${t.meetingId}::${t.id}`;
                  const bucket = taskBucket(t);
                  const dueLabel = t.deadline || "No deadline";
                  return `
            <div class="task-row ${t.done ? "is-done" : ""} bucket-${bucket}" data-task-open="${escapeAttr(key)}">
              <input type="checkbox" data-task-toggle="${escapeAttr(key)}" ${t.done ? "checked" : ""} title="Mark complete" />
              <div class="task-main">
                <div class="task-text">${escapeHtml(t.text)}</div>
                <div class="task-meta">
                  <button type="button" class="task-source" data-task-meeting="${escapeAttr(key)}" title="Open source meeting">
                    ${icon("calendar", 12)} ${escapeHtml(t.meetingTitle)}
                  </button>
                  <button type="button" class="task-chip" data-edit-owner="${escapeAttr(key)}" title="Edit owner">
                    ${icon("users", 11)} ${escapeHtml(t.owner || "No owner")}
                  </button>
                  <button type="button" class="task-chip" data-edit-deadline="${escapeAttr(key)}" title="Edit deadline">
                    ${icon("clock", 11)} ${escapeHtml(dueLabel)}
                  </button>
                  ${
                    typeof t.sourceEntryIndex === "number" && t.sourceEntryIndex >= 0
                      ? `<span class="task-chip is-muted">${icon("fileText", 11)} Transcript line</span>`
                      : ""
                  }
                  ${t.context ? `<span class="task-chip is-muted" title="${escapeAttr(t.context)}">${escapeHtml(String(t.context).slice(0, 48))}${String(t.context).length > 48 ? "…" : ""}</span>` : ""}
                </div>
              </div>
              <select class="task-priority ${priorityClass(t.priority)}" data-edit-priority="${escapeAttr(key)}" title="Priority" data-no-cselect="1">
                <option value="" ${!t.priority ? "selected" : ""}>—</option>
                <option value="high" ${String(t.priority).toLowerCase() === "high" ? "selected" : ""}>High</option>
                <option value="medium" ${String(t.priority).toLowerCase() === "medium" ? "selected" : ""}>Medium</option>
                <option value="low" ${String(t.priority).toLowerCase() === "low" ? "selected" : ""}>Low</option>
              </select>
              <button type="button" class="task-delete" data-task-delete="${escapeAttr(key)}" title="Delete">${icon("trash", 14)}</button>
            </div>`;
                })
                .join("")
        }
      </div>
    </div>`;

  host.querySelectorAll("[data-task-toggle]").forEach((cb) => {
    const key = cb.dataset.taskToggle;
    cb.addEventListener("change", async (e) => {
      e.stopPropagation();
      const row = rowsById.get(key);
      if (!row) return;
      await MeetingStore.toggleActionItem(row.meetingId, row.id);
      showToast(cb.checked ? "Marked complete" : "Reopened");
      await renderMyTasks();
      bridge.renderSidebar?.();
    });
  });

  // Re-bind using rowsById (keys are meetingId::id)
  host.querySelectorAll("[data-task-open]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("input,select,button")) return;
      const row = rowsById.get(el.dataset.taskOpen);
      if (row) openTaskSource(row);
    });
  });

  host.querySelectorAll("[data-task-meeting]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = rowsById.get(btn.dataset.taskMeeting);
      if (row) openTaskSource(row);
    });
  });

  host.querySelectorAll("[data-edit-owner]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = rowsById.get(btn.dataset.editOwner);
      if (!row) return;
      const next = await showPrompt("Who owns this task?", {
        title: "Edit owner",
        defaultValue: row.owner || "",
        placeholder: "Name",
        okLabel: "Save",
      });
      if (next == null) return;
      await MeetingStore.updateActionItem(row.meetingId, row.id, { owner: next.trim() });
      showToast("Owner updated");
      await renderMyTasks();
      bridge.renderSidebar?.();
    });
  });

  host.querySelectorAll("[data-edit-deadline]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = rowsById.get(btn.dataset.editDeadline);
      if (!row) return;
      const current = parseTaskDeadline(row.deadline);
      const defaultValue = current
        ? `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`
        : String(row.deadline || "");
      const next = await showPrompt("Deadline (YYYY-MM-DD or any date text).", {
        title: "Edit deadline",
        defaultValue: defaultValue,
        placeholder: "2026-08-20",
        okLabel: "Save",
      });
      if (next == null) return;
      await MeetingStore.updateActionItem(row.meetingId, row.id, { deadline: next.trim() });
      showToast("Deadline updated");
      await renderMyTasks();
      bridge.renderSidebar?.();
    });
  });

  host.querySelectorAll("[data-edit-priority]").forEach((sel) => {
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", async (e) => {
      e.stopPropagation();
      const row = rowsById.get(sel.dataset.editPriority);
      if (!row) return;
      await MeetingStore.updateActionItem(row.meetingId, row.id, { priority: sel.value });
      showToast("Priority updated");
      await renderMyTasks();
      bridge.renderSidebar?.();
    });
  });

  host.querySelectorAll("[data-task-delete]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = rowsById.get(btn.dataset.taskDelete);
      if (!row) return;
      await MeetingStore.deleteActionItem(row.meetingId, row.id);
      showToast("Task deleted");
      await renderMyTasks();
      bridge.renderSidebar?.();
    });
  });

  host.querySelectorAll("[data-stat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tasksFilter.status = btn.dataset.stat;
      renderMyTasks();
    });
  });

  const bindFilter = (id, key) => {
    const el = document.getElementById(id);
    el?.addEventListener("change", () => {
      tasksFilter[key] = el.value;
      renderMyTasks();
    });
  };
  bindFilter("tasksFilterStatus", "status");
  bindFilter("tasksFilterMeeting", "meetingId");
  bindFilter("tasksFilterPriority", "priority");
  bindFilter("tasksFilterDate", "date");
}

/** Keep My Tasks nav count in sync (sidebar list removed). */
export async function renderSidebarTasks() {
  const countEl = document.getElementById("tasksNavCount");
  if (!countEl) return;

  let rows = [];
  try {
    rows = await listMyActionItems();
  } catch (_) {
    rows = [];
  }
  countEl.textContent = String(rows.filter((t) => !t.done).length);
}
