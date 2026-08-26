import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp, dedupeSpeakerNames, normalizeSpeakerName,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";
import { getSettings } from "../services/settings.js";
import { enhanceSelects } from "../custom-select.js";
import { showPrompt } from "../ui-modal.js";
import {
  INTEL_TYPES,
  INTEL_TYPE_META,
  detectTranscriptIntelligence,
  mergeIntelligenceAnnotations,
  syncActionAnnotations,
  annotationsByEntry,
  activeAnnotations,
} from "../services/transcript-intelligence.js";
import { detectMeetingTopics } from "../services/topic-navigation.js";

/** Transcript Intelligence navigation state (survives re-renders within a session). */
let tiNavIndex = -1;
let tiCategoryType = ""; // open category panel type, or ""
let tiOutsideCloseHandler = null;
/** Topics panel expanded; click-outside collapses. */
let topicsExpanded = true;
let topicsOutsideCloseHandler = null;

function detachTiOutsideClose() {
  if (tiOutsideCloseHandler) {
    document.removeEventListener("mousedown", tiOutsideCloseHandler, true);
    tiOutsideCloseHandler = null;
  }
}

function detachTopicsOutsideClose() {
  if (topicsOutsideCloseHandler) {
    document.removeEventListener("mousedown", topicsOutsideCloseHandler, true);
    topicsOutsideCloseHandler = null;
  }
}

function setTopicsExpanded(open) {
  topicsExpanded = !!open;
  const section = document.getElementById("topicNavSection");
  const body = document.getElementById("topicNavBody");
  const chevron = document.getElementById("topicNavChevron");
  if (!section) return;
  section.classList.toggle("is-collapsed", !topicsExpanded);
  section.setAttribute("aria-expanded", topicsExpanded ? "true" : "false");
  if (body) body.hidden = !topicsExpanded;
  if (chevron) {
    chevron.innerHTML = icon(topicsExpanded ? "chevronDown" : "chevronRight", 14);
  }
}

function closeTiCategoryPanel(refreshFn) {
  if (!tiCategoryType) return;
  tiCategoryType = "";
  if (typeof refreshFn === "function") refreshFn();
  else {
    const panel = document.getElementById("tiCategoryPanel");
    const summary = document.getElementById("tiSummary");
    const chips = document.getElementById("tiTypeChips");
    if (panel) {
      panel.hidden = true;
      panel.classList.remove("is-open");
      panel.innerHTML = "";
    }
    summary?.classList.remove("is-panel-open");
    chips?.querySelectorAll(".ti-type-chip.is-active").forEach((c) => c.classList.remove("is-active"));
  }
}

function sortedIntelAnnotations(pack, typeFilter = "") {
  return activeAnnotations(pack)
    .filter((a) => !typeFilter || a.type === typeFilter)
    .sort((a, b) => {
      if (a.entryIndex !== b.entryIndex) return a.entryIndex - b.entryIndex;
      return String(a.type).localeCompare(String(b.type));
    });
}

function countIntelByType(pack) {
  const counts = Object.fromEntries(INTEL_TYPES.map((t) => [t, 0]));
  for (const a of activeAnnotations(pack)) {
    if (counts[a.type] != null) counts[a.type] += 1;
  }
  return counts;
}

function jumpToTranscriptIndex(entryIndex) {
  const entry = dom.transcriptContainer?.querySelector(
    `.transcript-entry[data-index="${entryIndex}"]`
  );
  if (!entry) return;
  entry.scrollIntoView({ block: "center", behavior: "smooth" });
  entry.classList.add("ti-flash");
  setTimeout(() => entry.classList.remove("ti-flash"), 1600);
}

function highlightOpenMarker(annId) {
  dom.transcriptContainer?.querySelectorAll(".ti-marker.is-open").forEach((el) => {
    el.classList.remove("is-open");
  });
  if (!annId) return;
  const btn = dom.transcriptContainer?.querySelector(`.ti-marker[data-ti-id="${annId}"]`);
  btn?.classList.add("is-open");
}

function focusIntelAnnotation(meeting, ann, searchPrefill, { openPopover = true } = {}) {
  if (!ann) return;
  const list = sortedIntelAnnotations(meeting.transcriptIntelligence);
  tiNavIndex = list.findIndex((a) => a.id === ann.id);
  jumpToTranscriptIndex(ann.entryIndex);
  highlightOpenMarker(ann.id);
  updateTiDockLabel(meeting);
  if (!openPopover) return;
  // Wait for scroll so popover can flip above/below with correct space
  setTimeout(() => {
    const btn = dom.transcriptContainer?.querySelector(`.ti-marker[data-ti-id="${ann.id}"]`);
    if (btn) openIntelPopover(btn, meeting, ann, searchPrefill);
  }, 220);
}

function updateTiDockLabel(meeting) {
  const label = document.getElementById("tiDockPos");
  if (!label) return;
  const list = sortedIntelAnnotations(meeting.transcriptIntelligence);
  if (!list.length) {
    label.textContent = "0 / 0";
    return;
  }
  const idx = tiNavIndex >= 0 && tiNavIndex < list.length ? tiNavIndex : 0;
  label.textContent = `${idx + 1} / ${list.length}`;
}

function jumpIntelByOffset(meeting, searchPrefill, offset) {
  const list = sortedIntelAnnotations(meeting.transcriptIntelligence);
  if (!list.length) {
    showToast("No intelligence markers yet");
    return;
  }
  if (tiNavIndex < 0) tiNavIndex = offset > 0 ? -1 : 0;
  tiNavIndex = (tiNavIndex + offset + list.length) % list.length;
  focusIntelAnnotation(meeting, list[tiNavIndex], searchPrefill, { openPopover: true });
}

function jumpToNextActionIntel(meeting, searchPrefill) {
  const actions = sortedIntelAnnotations(meeting.transcriptIntelligence, "action");
  if (!actions.length) {
    showToast("No action markers — run Transcript Intelligence first");
    return;
  }
  const list = sortedIntelAnnotations(meeting.transcriptIntelligence);
  const current = tiNavIndex >= 0 ? list[tiNavIndex] : null;
  if (current) {
    const at = actions.findIndex((a) => a.id === current.id);
    if (at >= 0) {
      focusIntelAnnotation(meeting, actions[(at + 1) % actions.length], searchPrefill);
      return;
    }
    const after = actions.find((a) => a.entryIndex >= current.entryIndex);
    focusIntelAnnotation(meeting, after || actions[0], searchPrefill);
    return;
  }
  focusIntelAnnotation(meeting, actions[0], searchPrefill);
}

function buildCategoryPeopleHtml(meeting, type) {
  const anns = sortedIntelAnnotations(meeting.transcriptIntelligence, type);
  const meta = INTEL_TYPE_META[type] || INTEL_TYPE_META.important;
  if (!anns.length) {
    return `<p class="ti-cat-empty">No ${escapeHtml(meta.label.toLowerCase())} markers.</p>`;
  }
  const byPerson = new Map();
  for (const a of anns) {
    const person = normalizeSpeakerName(a.speaker || "Unknown", meeting);
    if (!byPerson.has(person)) byPerson.set(person, []);
    byPerson.get(person).push(a);
  }
  const people = [...byPerson.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return `
    <div class="ti-cat-head">
      <span class="ti-badge" style="--ti-color:${meta.color}">${escapeHtml(meta.short)} ${escapeHtml(meta.label)}</span>
      <span class="ti-cat-count">${anns.length} · ${people.length} people</span>
    </div>
    <div class="ti-cat-people">
      ${people
        .map(
          ([person, items]) => `
        <div class="ti-cat-person">
          <div class="ti-cat-person-name">
            <span class="people-avatar" style="width:22px;height:22px;font-size:9px;border-radius:7px;background:${stringToColor(person)}">${escapeHtml(
              (person || "?").charAt(0).toUpperCase()
            )}</span>
            ${escapeHtml(person)}
            <span class="ti-cat-person-n">${items.length}</span>
          </div>
          <ul class="ti-cat-items">
            ${items
              .map(
                (a) => `
              <li>
                <button type="button" class="ti-cat-item" data-ti-jump-id="${escapeAttr(a.id)}">
                  <span class="ti-cat-item-ts">${escapeHtml(a.timestamp || "—")}</span>
                  <span class="ti-cat-item-label">${escapeHtml(a.label || a.quote || meta.label)}</span>
                </button>
              </li>`
              )
              .join("")}
          </ul>
        </div>`
        )
        .join("")}
    </div>`;
}

function renderIntelSummaryHtml(meeting) {
  const pack = meeting.transcriptIntelligence;
  const active = activeAnnotations(pack);
  if (!active.length) return "";

  const counts = countIntelByType(pack);
  const chips = INTEL_TYPES.filter((t) => counts[t] > 0)
    .map((t) => {
      const meta = INTEL_TYPE_META[t];
      const on = tiCategoryType === t ? "is-active" : "";
      return `<button type="button" class="ti-type-chip ${on}" data-ti-type="${escapeAttr(t)}" style="--ti-color:${meta.color}" title="${escapeAttr(meta.label)}">
        <span class="ti-type-short">${escapeHtml(meta.short)}</span>
        <span class="ti-type-n">${counts[t]}</span>
      </button>`;
    })
    .join("");

  const panelOpen = tiCategoryType && counts[tiCategoryType] > 0;
  return `
    <section class="ti-summary ${panelOpen ? "is-panel-open" : ""}" id="tiSummary" aria-label="Intelligence totals">
      <div class="ti-summary-row">
        <span class="ti-summary-label">${active.length} markers</span>
        <div class="ti-type-chips" id="tiTypeChips">${chips}</div>
        <span class="ti-dock-pos" id="tiDockPos" title="Current marker">—</span>
      </div>
      <div class="ti-category-panel ${panelOpen ? "is-open" : ""}" id="tiCategoryPanel" ${panelOpen ? "" : "hidden"}>
        ${panelOpen ? buildCategoryPeopleHtml(meeting, tiCategoryType) : ""}
      </div>
    </section>`;
}

function renderTiFloatNavHtml(hasMarkers) {
  if (!hasMarkers) return "";
  return `
    <div class="ti-float-nav" id="tiFloatNav" aria-label="Marker navigation">
      <button type="button" class="ti-jump-circle ti-jump-prev" id="tiPrevBtn" title="Previous marker" aria-label="Previous marker">
        <span class="ti-jump-icon ti-jump-up">${icon("chevronDown", 20)}</span>
      </button>
      <button type="button" class="ti-jump-circle ti-jump-next" id="tiNextBtn" title="Next marker" aria-label="Next marker">
        <span class="ti-jump-icon ti-jump-down">${icon("chevronDown", 20)}</span>
      </button>
    </div>`;
}

function renderTopicsSectionHtml(topicNav) {
  const topics = topicNav?.topics || [];
  const generatedAt = topicNav?.generatedAt;
  const emptyReason = topicNav?.emptyReason || "";
  const lastError = topicNav?.lastError || "";
  const hasRun = !!(generatedAt || lastError);

  let body = "";
  if (!hasRun) {
    body = `<p class="tn-empty">Generate a chronological list of major topics, then click one to jump in the transcript.</p>`;
  } else if (lastError && !topics.length) {
    body = `<p class="tn-error">${escapeHtml(lastError)}</p>`;
  } else if (!topics.length) {
    body = `<p class="tn-empty">${escapeHtml(emptyReason || "No clear major topics were found in this transcript.")}</p>`;
  } else {
    body = `${
      lastError ? `<p class="tn-error">${escapeHtml(lastError)}</p>` : ""
    }<ol class="tn-list">
      ${topics
        .map(
          (t) => `
        <li>
          <button type="button" class="tn-item" data-entry-index="${escapeAttr(String(t.entryIndex))}" title="${escapeAttr(t.description || t.title)}">
            <span class="tn-ts">${escapeHtml(t.startTimestamp || "—")}${t.endTimestamp ? `–${escapeHtml(t.endTimestamp)}` : ""}</span>
            <span class="tn-main">
              <span class="tn-title">${escapeHtml(t.title)}</span>
              ${t.description ? `<span class="tn-desc">${escapeHtml(t.description)}</span>` : ""}
            </span>
          </button>
        </li>`
        )
        .join("")}
    </ol>`;
  }

  const btnLabel = hasRun
    ? `${icon("refresh", 13)} Regenerate`
    : `${icon("listChecks", 13)} Generate topics`;
  const btnClass = hasRun ? "generate-btn secondary-gen" : "generate-btn";

  return `
    <section class="tn-section ${topicsExpanded ? "" : "is-collapsed"}" id="topicNavSection" aria-label="Topic navigation" aria-expanded="${topicsExpanded ? "true" : "false"}">
      <div class="tn-head" id="topicNavHead">
        <button type="button" class="tn-head-toggle" id="topicNavToggle" aria-controls="topicNavBody" title="${topicsExpanded ? "Minimize topics" : "Expand topics"}">
          <span class="tn-chevron" id="topicNavChevron">${icon(topicsExpanded ? "chevronDown" : "chevronRight", 14)}</span>
          <span class="tn-head-text">
            <h3 class="tn-heading">${icon("listChecks", 14)} Topics</h3>
            ${
              generatedAt
                ? `<p class="tn-meta">Updated ${escapeHtml(new Date(generatedAt).toLocaleString())}</p>`
                : `<p class="tn-meta">Major discussion chapters for this meeting</p>`
            }
          </span>
        </button>
        <button type="button" class="${btnClass}" id="topicNavBtn">${btnLabel}</button>
      </div>
      <div class="tn-body" id="topicNavBody" ${topicsExpanded ? "" : "hidden"}>${body}</div>
    </section>`;
}

async function runTopicNavigation(meeting, searchPrefill) {
  const btn = document.getElementById("topicNavBtn");
  const body = document.getElementById("topicNavBody");
  if (!btn) return;
  setTopicsExpanded(true);
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:13px;height:13px"></span> Finding topics…`;
  if (body) {
    body.innerHTML = `<p class="tn-loading"><span class="spinner" style="width:14px;height:14px"></span> Analyzing transcript for major topics…</p>`;
  }
  try {
    const pack = await detectMeetingTopics(meeting.transcript, meeting);
    pack.lastError = "";
    await MeetingStore.setTopicNavigation(meeting.id, pack);
    meeting.topicNavigation = pack;
    if (state.currentMeetingId === meeting.id && state.currentMeeting) {
      state.currentMeeting.topicNavigation = pack;
    }
    const n = (pack.topics || []).length;
    showToast(
      n
        ? `Found ${n} topic${n === 1 ? "" : "s"}`
        : pack.emptyReason || "No clear topics found"
    );
    renderTranscript(meeting, searchPrefill);
  } catch (err) {
    const msg = err.message || "Topic navigation failed";
    const pack = {
      ...(meeting.topicNavigation || {}),
      topics: meeting.topicNavigation?.topics || [],
      generatedAt: meeting.topicNavigation?.generatedAt || "",
      lastError: msg,
    };
    await MeetingStore.setTopicNavigation(meeting.id, pack);
    meeting.topicNavigation = pack;
    if (state.currentMeetingId === meeting.id && state.currentMeeting) {
      state.currentMeeting.topicNavigation = pack;
    }
    showToast(msg);
    renderTranscript(meeting, searchPrefill);
  }
}

function closeIntelPopover() {
  document.getElementById("tiPopover")?.remove();
}

function positionIntelPopover(pop, anchorBtn) {
  const rect = anchorBtn.getBoundingClientRect();
  const gap = 10;
  const margin = 12;
  const popW = Math.min(380, window.innerWidth - margin * 2);
  pop.style.width = `${popW}px`;
  pop.style.maxHeight = `${Math.min(window.innerHeight - margin * 2, 520)}px`;
  // Force layout for measured height
  pop.style.left = "0px";
  pop.style.top = "0px";
  pop.style.visibility = "hidden";
  const ph = pop.offsetHeight || 280;
  const pw = pop.offsetWidth || popW;

  const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
  const spaceAbove = rect.top - gap - margin;
  // Prefer above whenever the box won't fully fit below
  const placeAbove = spaceBelow < ph && spaceAbove >= Math.min(ph, 140);

  let top = placeAbove ? rect.top - gap - ph : rect.bottom + gap;
  let left = rect.left + rect.width / 2 - pw / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - Math.min(ph, window.innerHeight - margin * 2) - margin));

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.visibility = "";
  pop.classList.toggle("is-above", placeAbove);
  pop.classList.toggle("is-below", !placeAbove);

  // Keep the Q / ! marker itself on-screen and not covered
  const still = anchorBtn.getBoundingClientRect();
  if (still.top < margin || still.bottom > window.innerHeight - margin) {
    anchorBtn.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function contextSnippet(transcript, entryIndex, radius = 2) {
  const start = Math.max(0, entryIndex - radius);
  const end = Math.min((transcript || []).length - 1, entryIndex + radius);
  const rows = [];
  for (let i = start; i <= end; i++) {
    const e = transcript[i];
    if (!e) continue;
    rows.push({
      i,
      speaker: e.speaker || "",
      text: e.text || "",
      timestamp: e.timestamp || "",
      focus: i === entryIndex,
    });
  }
  return rows;
}

function openIntelPopover(anchorBtn, meeting, annotation, searchPrefill) {
  closeIntelPopover();
  highlightOpenMarker(annotation.id);
  const meta = INTEL_TYPE_META[annotation.type] || INTEL_TYPE_META.important;
  const ctx = contextSnippet(meeting.transcript, annotation.entryIndex);
  const list = sortedIntelAnnotations(meeting.transcriptIntelligence);
  const at = list.findIndex((a) => a.id === annotation.id);
  if (at >= 0) tiNavIndex = at;

  const pop = document.createElement("div");
  pop.id = "tiPopover";
  pop.className = "ti-popover";
  pop.innerHTML = `
    <div class="ti-popover-head">
      <span class="ti-badge ti-badge-${escapeAttr(annotation.type)}" style="--ti-color:${meta.color}">${escapeHtml(meta.label)}</span>
      <div class="ti-popover-nav">
        <button type="button" class="ti-nav-btn" data-ti-act="prev" title="Previous marker">${icon("chevronLeft", 14)}</button>
        <button type="button" class="ti-nav-btn" data-ti-act="next" title="Next marker">${icon("chevronRight", 14)}</button>
        <button type="button" class="ti-popover-close" aria-label="Close">${icon("x", 14)}</button>
      </div>
    </div>
    <p class="ti-popover-label">${escapeHtml(annotation.label)}</p>
    ${annotation.quote ? `<blockquote class="ti-popover-quote">${escapeHtml(annotation.quote)}</blockquote>` : ""}
    <div class="ti-popover-meta">
      ${annotation.timestamp ? `<span>${icon("clock", 11)} ${escapeHtml(annotation.timestamp)}</span>` : ""}
      ${annotation.speaker ? `<span>${icon("users", 11)} ${escapeHtml(normalizeSpeakerName(annotation.speaker, meeting))}</span>` : ""}
      <span>${at >= 0 ? at + 1 : "—"} / ${list.length || 0}</span>
    </div>
    <div class="ti-popover-context">
      <div class="ti-popover-context-title">Surrounding transcript</div>
      ${ctx
        .map(
          (row) => `
        <div class="ti-ctx-row ${row.focus ? "is-focus" : ""}">
          <span class="ti-ctx-ts">${escapeHtml(row.timestamp || "—")}</span>
          <div class="ti-ctx-body">
            <strong>${escapeHtml(normalizeSpeakerName(row.speaker, meeting))}</strong>
            <span>${escapeHtml(row.text)}</span>
          </div>
        </div>`
        )
        .join("")}
    </div>
    <div class="ti-popover-actions">
      <button type="button" class="ti-btn ghost" data-ti-act="jump">${icon("eye", 13)} Jump to line</button>
      <button type="button" class="ti-btn danger" data-ti-act="dismiss">${icon("x", 13)} Dismiss marker</button>
    </div>`;

  document.body.appendChild(pop);
  positionIntelPopover(pop, anchorBtn);
  updateTiDockLabel(meeting);

  const goRelative = (dir) => {
    jumpIntelByOffset(meeting, searchPrefill, dir);
  };

  pop.querySelector(".ti-popover-close")?.addEventListener("click", () => {
    closeIntelPopover();
    highlightOpenMarker(null);
  });
  pop.querySelector('[data-ti-act="jump"]')?.addEventListener("click", () => {
    jumpToTranscriptIndex(annotation.entryIndex);
  });
  pop.querySelector('[data-ti-act="prev"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    goRelative(-1);
  });
  pop.querySelector('[data-ti-act="next"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    goRelative(1);
  });
  pop.querySelector('[data-ti-act="dismiss"]')?.addEventListener("click", async () => {
    const updated = await MeetingStore.dismissTranscriptAnnotation(meeting.id, annotation.id);
    if (updated) {
      Object.assign(meeting, updated);
      state.currentMeeting = updated;
    }
    closeIntelPopover();
    showToast("Marker dismissed");
    renderTranscript(meeting, searchPrefill);
  });

  const onDoc = (e) => {
    if (!pop.isConnected) {
      document.removeEventListener("mousedown", onDoc, true);
      return;
    }
    if (pop.contains(e.target)) return;
    if (anchorBtn === e.target || anchorBtn.contains(e.target)) return;
    if (e.target.closest?.(".ti-marker")) return;
    if (e.target.closest?.(".ti-float-nav, .ti-summary, .ti-type-chip, .ti-cat-item")) return;
    closeIntelPopover();
    highlightOpenMarker(null);
    document.removeEventListener("mousedown", onDoc, true);
  };
  setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);

  const onResize = () => {
    if (!pop.isConnected || !anchorBtn.isConnected) {
      window.removeEventListener("resize", onResize);
      return;
    }
    positionIntelPopover(pop, anchorBtn);
  };
  window.addEventListener("resize", onResize);
}

async function runTranscriptIntelligence(meeting, searchPrefill) {
  const btn = document.getElementById("transcriptIntelBtn");
  if (!btn) return;
  btn.disabled = true;
  const prev = btn.innerHTML;
  btn.innerHTML = `<span class="spinner" style="width:13px;height:13px"></span> Analyzing…`;
  try {
    const detected = await detectTranscriptIntelligence(meeting.transcript, meeting);
    let pack = mergeIntelligenceAnnotations(meeting.transcriptIntelligence, detected);
    const synced = syncActionAnnotations(activeAnnotations(pack), meeting.actionItems || []);
    const dismissed = (pack.annotations || []).filter((a) => a.dismissed);
    pack = {
      annotations: [...dismissed, ...synced.annotations],
      analyzedAt: pack.analyzedAt,
    };

    await MeetingStore.setTranscriptIntelligence(meeting.id, pack);
    meeting.transcriptIntelligence = pack;

    if (synced.created > 0) {
      await MeetingStore.setActionItems(meeting.id, synced.actionItems);
      meeting.actionItems = synced.actionItems;
      bridge.renderActionItems?.(meeting);
      bridge.renderSidebar?.();
    }

    try {
      await bridge.autoScoreMeeting?.(meeting, { silent: true });
    } catch (_) {}

    const active = activeAnnotations(pack).length;
    showToast(
      active
        ? `Found ${active} moment${active === 1 ? "" : "s"}${synced.created ? ` · ${synced.created} new action item${synced.created === 1 ? "" : "s"}` : ""}`
        : "No notable moments detected"
    );
    renderTranscript(meeting, searchPrefill);
  } catch (err) {
    showToast(err.message || "Transcript Intelligence failed");
    btn.disabled = false;
    btn.innerHTML = prev;
  }
}

// === TRANSCRIPT ===
export async function renderTranscript(meeting, prefillQuery) {
  closeIntelPopover();
  detachTiOutsideClose();
  detachTopicsOutsideClose();
  const transcript = meeting.transcript || [];
  const speakers = dedupeSpeakerNames(transcript.map((e) => e.speaker), meeting);
  const bookmarkedIndexes = new Set((meeting.bookmarks || []).map((b) => b.entryIndex));
  const settings = await getSettings();
  const showTs = settings.showTranscriptTimestamps !== false;
  const dense = !!settings.denseTranscript;
  const byEntry = annotationsByEntry(meeting.transcriptIntelligence);
  const active = activeAnnotations(meeting.transcriptIntelligence);
  const activeCount = active.length;
  const analyzedAt = meeting.transcriptIntelligence?.analyzedAt;
  const topicNav = meeting.topicNavigation;
  if (tiCategoryType && !active.some((a) => a.type === tiCategoryType)) {
    tiCategoryType = "";
  }

  dom.transcriptContainer.innerHTML = `
    <div class="transcript-scroll" id="transcriptScroll">
      <div class="transcript-toolbar">
        <input type="text" class="transcript-search" id="transcriptSearch" placeholder="Search transcript..." value="${escapeAttr(prefillQuery || "")}">
        <select class="speaker-filter" id="speakerFilter">
          <option value="">All speakers</option>
          ${speakers.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
        </select>
        <button type="button" class="generate-btn" id="transcriptIntelBtn" title="Detect decisions, actions, questions, risks, and more">
          ${icon("zap", 13)} Transcript Intelligence${activeCount ? ` (${activeCount})` : ""}
        </button>
      </div>
      ${
        analyzedAt
          ? `<p class="ti-status-line">Last analyzed ${escapeHtml(new Date(analyzedAt).toLocaleString())} · markers are annotations only — transcript text is unchanged</p>`
          : `<p class="ti-status-line">Run Transcript Intelligence to label decisions, actions, questions, risks, and mentions on this meeting (works on older meetings too).</p>`
      }
      ${renderIntelSummaryHtml(meeting)}
      ${renderTopicsSectionHtml(topicNav)}
      <div id="transcriptEntries" class="transcript-entries${activeCount ? " has-ti-float" : ""}">
        ${transcript
          .map((entry, i) => {
            const markers = byEntry.get(i) || [];
            const markerHtml = markers.length
              ? `<div class="ti-markers" aria-label="Intelligence markers">
                  ${markers
                    .map((ann) => {
                      const meta = INTEL_TYPE_META[ann.type] || INTEL_TYPE_META.important;
                      return `<button type="button" class="ti-marker ti-marker-${escapeAttr(ann.type)}" data-ti-id="${escapeAttr(ann.id)}" style="--ti-color:${meta.color}" title="${escapeAttr(meta.label + ": " + ann.label)}">${escapeHtml(meta.short)}</button>`;
                    })
                    .join("")}
                </div>`
              : "";
            return `
          <div class="transcript-entry ${dense ? "is-dense" : ""} ${bookmarkedIndexes.has(i) ? "bookmarked" : ""} ${markers.length ? "has-ti" : ""}" data-speaker="${escapeHtml(entry.speaker)}" data-index="${i}">
            <div class="transcript-speaker">
              <span class="speaker-avatar" style="background:${stringToColor(entry.speaker)}">${entry.speaker.charAt(0).toUpperCase()}</span>
              <span class="speaker-name" data-speaker-name="${escapeAttr(entry.speaker)}">${escapeHtml(normalizeSpeakerName(entry.speaker, meeting))}</span>
            </div>
            <div class="transcript-body">
              <div class="transcript-text">${escapeHtml(entry.text)}</div>
              ${markerHtml}
            </div>
            <div class="transcript-time">
              <button class="transcript-bookmark-btn ${bookmarkedIndexes.has(i) ? "active" : ""}" data-bookmark-index="${i}" title="Highlight this moment">${icon("highlighter", 14)}</button>
              <span class="${showTs ? "" : "ts-hidden"}">${escapeHtml(entry.timestamp || "")}</span>
            </div>
          </div>`;
          })
          .join("")}
      </div>
    </div>
    ${renderTiFloatNavHtml(activeCount > 0)}`;

  enhanceSelects(dom.transcriptContainer);

  const searchEl = dom.transcriptContainer.querySelector("#transcriptSearch");
  const filterEl = dom.transcriptContainer.querySelector("#speakerFilter");

  function filterEntries() {
    const q = (searchEl.value || "").toLowerCase();
    const speaker = filterEl.value;
    const entries = dom.transcriptContainer.querySelectorAll(".transcript-entry");
    let firstMatch = null;
    entries.forEach((entry) => {
      const matchSpeaker = !speaker || entry.dataset.speaker === speaker;
      const matchText = !q || (entry.textContent || "").toLowerCase().includes(q);
      entry.style.display = matchSpeaker && matchText ? "" : "none";
      const isHighlighted = q && matchText && q.length > 0;
      entry.classList.toggle("highlight", isHighlighted);
      if (isHighlighted && !firstMatch) firstMatch = entry;
    });
    if (firstMatch) firstMatch.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  searchEl.addEventListener("input", filterEntries);
  filterEl.addEventListener("change", filterEntries);
  if (prefillQuery) filterEntries();

  document.getElementById("transcriptIntelBtn")?.addEventListener("click", () => {
    runTranscriptIntelligence(meeting, searchEl.value);
  });

  document.getElementById("topicNavBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    runTopicNavigation(meeting, searchEl.value);
  });

  document.getElementById("topicNavToggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setTopicsExpanded(!topicsExpanded);
  });

  detachTopicsOutsideClose();
  topicsOutsideCloseHandler = (e) => {
    if (!topicsExpanded) return;
    const section = document.getElementById("topicNavSection");
    if (!section || !section.isConnected) {
      detachTopicsOutsideClose();
      return;
    }
    if (section.contains(e.target)) return;
    setTopicsExpanded(false);
  };
  document.addEventListener("mousedown", topicsOutsideCloseHandler, true);

  dom.transcriptContainer.querySelectorAll(".tn-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.entryIndex, 10);
      if (Number.isNaN(idx)) return;
      jumpToTranscriptIndex(idx);
    });
  });

  // Type totals: chips stay; panel toggles people-by-category
  const refreshCategoryPanel = () => {
    const panel = document.getElementById("tiCategoryPanel");
    const chips = document.getElementById("tiTypeChips");
    const summary = document.getElementById("tiSummary");
    if (!panel || !chips) return;
    chips.querySelectorAll(".ti-type-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.tiType === tiCategoryType);
    });
    summary?.classList.toggle("is-panel-open", !!tiCategoryType);
    if (tiCategoryType) {
      panel.hidden = false;
      panel.classList.add("is-open");
      panel.innerHTML = buildCategoryPeopleHtml(meeting, tiCategoryType);
      panel.querySelectorAll("[data-ti-jump-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ann = annById.get(btn.dataset.tiJumpId);
          if (ann) focusIntelAnnotation(meeting, ann, searchEl.value, { openPopover: true });
        });
      });
    } else {
      panel.hidden = true;
      panel.classList.remove("is-open");
      panel.innerHTML = "";
    }
  };

  const annById = new Map(active.map((a) => [a.id, a]));

  document.getElementById("tiTypeChips")?.querySelectorAll(".ti-type-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = chip.dataset.tiType || "";
      // Toggle panel, but chips themselves always remain
      tiCategoryType = tiCategoryType === t ? "" : t;
      refreshCategoryPanel();
    });
  });
  if (tiCategoryType) refreshCategoryPanel();

  // Click anywhere outside the markers summary to collapse the category panel
  detachTiOutsideClose();
  tiOutsideCloseHandler = (e) => {
    if (!tiCategoryType) return;
    const summary = document.getElementById("tiSummary");
    if (!summary) return;
    if (summary.contains(e.target)) return;
    closeTiCategoryPanel(refreshCategoryPanel);
  };
  document.addEventListener("mousedown", tiOutsideCloseHandler, true);

  const pulseJump = (id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.remove("is-jumping");
    // reflow so animation restarts
    void btn.offsetWidth;
    btn.classList.add("is-jumping");
    setTimeout(() => btn.classList.remove("is-jumping"), 500);
  };

  const bindNav = (id, offset) => {
    document.getElementById(id)?.addEventListener("click", (e) => {
      e.stopPropagation();
      pulseJump(id);
      jumpIntelByOffset(meeting, searchEl.value, offset);
    });
  };
  bindNav("tiPrevBtn", -1);
  bindNav("tiNextBtn", 1);

  updateTiDockLabel(meeting);

  dom.transcriptContainer.querySelectorAll(".ti-marker").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const ann = annById.get(btn.dataset.tiId);
      if (!ann) return;
      // Keep marker visible: scroll gently then open popover above/below as needed
      const list = sortedIntelAnnotations(meeting.transcriptIntelligence);
      tiNavIndex = list.findIndex((a) => a.id === ann.id);
      updateTiDockLabel(meeting);
      highlightOpenMarker(ann.id);
      openIntelPopover(btn, meeting, ann, searchEl.value);
    });
  });

  dom.transcriptContainer.querySelectorAll(".speaker-name").forEach((el) => {
    el.addEventListener("click", () => openRenameSpeakerModal(meeting, el.dataset.speakerName));
  });

  dom.transcriptContainer.querySelectorAll(".transcript-bookmark-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.bookmarkIndex, 10);
      const entry = transcript[idx];
      if (btn.classList.contains("active")) {
        const bm = (meeting.bookmarks || []).find((b) => b.entryIndex === idx);
        if (bm) {
          await MeetingStore.removeBookmark(meeting.id, bm.id);
          meeting.bookmarks = (meeting.bookmarks || []).filter((b) => b.id !== bm.id);
        }
        showToast("Highlight removed");
      } else {
        const bookmarks = await MeetingStore.addBookmark(meeting.id, {
          label: entry.text.slice(0, 70),
          timestamp: entry.timestamp,
          entryIndex: idx,
        });
        meeting.bookmarks = bookmarks;
        showToast("Highlighted");
      }
      renderTranscript(meeting, searchEl.value);
      bridge.renderHighlights(meeting);
    });
  });
}

export async function openRenameSpeakerModal(meeting, oldName) {
  const newName = await showPrompt(`Rename "${oldName}" everywhere in this meeting's transcript.`, {
    title: "Rename speaker",
    defaultValue: oldName,
    okLabel: "Rename everywhere",
    cancelLabel: "Cancel",
  });
  if (!newName || newName.trim() === oldName) return;
  const updated = await MeetingStore.renameSpeaker(meeting.id, oldName, newName.trim());
  state.currentMeeting = updated;
  showToast(`Renamed "${oldName}" to "${newName.trim()}"`);
  bridge.loadMeeting(meeting.id, "transcript");
}
