import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, renderMarkdown, showToast,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";
import AIService, { isGenericMeetingTitle, parseMeetingTitleFromSummary } from "../services/ai.js";
import { autoLabelMeeting } from "../services/meeting-tags.js";
import { generateMeetingScore } from "../services/meeting-score.js";
import { enhanceSelects } from "../custom-select.js";

let expandedDetailKey = "";

function openScoreSource(meetingId, entryIndex) {
  if (!meetingId) return;
  const params = { meetingId, tab: "transcript" };
  if (typeof entryIndex === "number" && entryIndex >= 0) {
    params.entryIndex = entryIndex;
  }
  bridge.navigate("meeting", params);
}

function renderDetailItems(items, emptyLabel, { showOwner = false } = {}) {
  if (!items?.length) {
    return `<p class="ms-detail-empty">${escapeHtml(emptyLabel)}</p>`;
  }
  return `<ul class="ms-detail-list">
    ${items
      .map((it) => {
        const title = it.text || it.label || "Item";
        const ts = it.timestamp || "";
        const owner = String(it.owner || "").trim();
        const canJump = typeof it.entryIndex === "number" && it.entryIndex >= 0;
        const ownerHtml =
          showOwner && owner
            ? `<span class="ms-owner-chip" title="Owner">${escapeHtml(owner)}</span>`
            : showOwner
              ? `<span class="ms-owner-chip is-unknown" title="Owner">Unknown</span>`
              : "";
        return `
      <li class="ms-detail-item">
        <div class="ms-detail-main">
          <div class="ms-detail-title">${escapeHtml(title)}</div>
          <div class="ms-detail-meta">
            ${ownerHtml}
            ${ts ? `<span class="ms-detail-ts">${icon("clock", 11)} ${escapeHtml(ts)}</span>` : ""}
          </div>
        </div>
        ${
          canJump
            ? `<button type="button" class="ms-view-btn" data-entry="${it.entryIndex}">${icon("eye", 12)} View in transcript</button>`
            : `<span class="ms-view-disabled">No transcript link</span>`
        }
      </li>`;
      })
      .join("")}
  </ul>`;
}

function renderScoreCard(scorePack, meeting) {
  if (scorePack?.unavailable) {
    return `
      <div class="meeting-score-card is-empty" id="meetingScoreCard">
        <div class="meeting-score-head">
          <div>
            <h3 class="meeting-score-title">Meeting Score</h3>
            <p class="meeting-score-value ms-unavailable">Unavailable</p>
            <p class="meeting-score-sub">${escapeHtml(
              scorePack.error || "Score could not be generated for this meeting."
            )}</p>
          </div>
        </div>
      </div>`;
  }

  if (!scorePack || typeof scorePack.score !== "number") {
    return `
      <div class="meeting-score-card is-empty" id="meetingScoreCard">
        <div class="meeting-score-head">
          <div>
            <h3 class="meeting-score-title">Meeting Score</h3>
            <p class="meeting-score-sub">Generated automatically after meeting analysis from decisions, actions, and questions.</p>
          </div>
        </div>
      </div>`;
  }

  const toneClass =
    scorePack.score >= 80 ? "is-strong" : scorePack.score >= 60 ? "is-ok" : "is-weak";
  const details = scorePack.details || {};
  const lines = scorePack.lines || [];

  return `
    <div class="meeting-score-card ${toneClass}" id="meetingScoreCard">
      <div class="meeting-score-head">
        <div>
          <h3 class="meeting-score-title">Meeting Score</h3>
          <p class="meeting-score-value"><strong>${scorePack.score}</strong> / ${scorePack.max || 100}</p>
          ${
            scorePack.computedAt
              ? `<p class="meeting-score-sub">Based on this meeting’s stored decisions, actions, and questions</p>`
              : ""
          }
        </div>
      </div>
      <ul class="meeting-score-breakdown" id="meetingScoreLines">
        ${lines
          .map((row) => {
            const open = expandedDetailKey === row.detailKey;
            const sign = row.tone === "warn" ? "⚠" : "✓";
            const clickable =
              row.detailKey &&
              (row.count > 0 ||
                row.detailKey === "decisions" ||
                row.detailKey === "actions" ||
                row.detailKey === "openQuestions" ||
                row.detailKey === "uncertainOwners" ||
                row.detailKey === "missingOwners");
            return `
          <li class="is-${escapeAttr(row.tone === "warn" ? "minus" : "plus")} ${open ? "is-expanded" : ""}">
            <button type="button" class="ms-line-btn ${clickable ? "is-clickable" : ""}" data-ms-detail="${escapeAttr(
              row.detailKey || ""
            )}" ${clickable ? "" : "disabled"}>
              <span class="ms-sign">${sign}</span>
              <span class="ms-line-text">${escapeHtml(row.text)}</span>
              ${clickable ? `<span class="ms-line-chevron">${icon(open ? "chevronDown" : "chevronRight", 14)}</span>` : ""}
            </button>
            ${
              open
                ? `<div class="ms-detail-panel" data-detail-panel="${escapeAttr(row.detailKey)}">
                    ${renderDetailItems(
                      details[row.detailKey] || [],
                      row.tone === "warn" ? "No matching items." : "Nothing to show.",
                      {
                        showOwner:
                          row.detailKey === "withOwners" ||
                          row.detailKey === "uncertainOwners" ||
                          row.detailKey === "missingOwners" ||
                          row.detailKey === "actions" ||
                          row.detailKey === "withDeadlines" ||
                          row.detailKey === "missingDeadlines",
                      }
                    )}
                  </div>`
                : ""
            }
          </li>`;
          })
          .join("")}
      </ul>
    </div>`;
}

function bindScoreCard(meeting) {
  const card = document.getElementById("meetingScoreCard");
  if (!card) return;

  card.querySelectorAll(".ms-line-btn.is-clickable").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.msDetail || "";
      expandedDetailKey = expandedDetailKey === key ? "" : key;
      refreshScoreCard(meeting);
    });
  });

  card.querySelectorAll(".ms-view-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const entryIndex = parseInt(btn.dataset.entry, 10);
      openScoreSource(meeting.id, entryIndex);
    });
  });
}

async function refreshScoreCard(meeting) {
  const host = document.getElementById("meetingScoreMount");
  if (!host) return;
  host.innerHTML = renderScoreCard(meeting.meetingScore, meeting);
  bindScoreCard(meeting);
}

/**
 * Auto-generate Meeting Score and persist. Never throws to callers.
 * On failure: keep prior score if present; otherwise store unavailable state.
 */
export async function autoScoreMeeting(meeting, { silent = true } = {}) {
  if (!meeting?.id) return null;
  try {
    const pack = await generateMeetingScore(meeting);
    await MeetingStore.setMeetingScore(meeting.id, pack);
    meeting.meetingScore = pack;
    if (state.currentMeetingId === meeting.id && state.currentMeeting) {
      state.currentMeeting.meetingScore = pack;
    }
    await refreshScoreCard(meeting);
    if (!silent) showToast(`Meeting Score: ${pack.score}/100`);
    return pack;
  } catch (err) {
    console.warn("[Meeting Score]", err);
    if (!meeting.meetingScore || typeof meeting.meetingScore.score !== "number") {
      const unavailable = {
        unavailable: true,
        error: err.message || "Score unavailable",
        computedAt: new Date().toISOString(),
        version: 2,
      };
      try {
        await MeetingStore.setMeetingScore(meeting.id, unavailable);
        meeting.meetingScore = unavailable;
        if (state.currentMeetingId === meeting.id && state.currentMeeting) {
          state.currentMeeting.meetingScore = unavailable;
        }
      } catch (_) {}
      await refreshScoreCard(meeting);
    }
    return null;
  }
}

/** @deprecated name kept for bridge callers — now auto-scores without a regenerate UI */
export async function regenerateMeetingScore(meeting, opts = {}) {
  return autoScoreMeeting(meeting, opts);
}

// === SUMMARY ===
export function renderSummary(meeting) {
  expandedDetailKey = "";
  dom.summaryContainer.innerHTML = `
    <div id="meetingScoreMount">${renderScoreCard(meeting.meetingScore, meeting)}</div>
    <div class="summary-toolbar">
      <select class="summary-type-select" id="summaryType">
        <option value="executive">Executive summary</option>
        <option value="engineering">Engineering summary</option>
        <option value="decisions">Key decisions</option>
        <option value="action-items">Action items</option>
      </select>
      <button class="generate-btn" id="generateSummaryBtn">${icon("wand", 13)} Generate</button>
      <button class="generate-btn" id="regenerateSummaryBtn" style="display:none;background:var(--bg-tint);color:var(--text-secondary);border:1px solid var(--border)">Regenerate</button>
    </div>
    <div class="summary-content" id="summaryContent">
      <p class="empty-state">Click "Generate" to create a summary for this meeting.</p>
    </div>`;

  enhanceSelects(dom.summaryContainer);
  bindScoreCard(meeting);

  // Upgrade legacy packs / fill missing scores after analysis data exists
  if (
    meeting.transcript?.length &&
    (!meeting.meetingScore ||
      meeting.meetingScore.unavailable ||
      meeting.meetingScore.version < 4 ||
      !Array.isArray(meeting.meetingScore.lines))
  ) {
    autoScoreMeeting(meeting, { silent: true });
  }

  MeetingStore.getSummaries(meeting.id).then((summaries) => {
    const type = document.getElementById("summaryType").value;
    if (summaries[type]) {
      document.getElementById("summaryContent").innerHTML = renderMarkdown(summaries[type].content);
      document.getElementById("regenerateSummaryBtn").style.display = "";
    }
  });

  document.getElementById("generateSummaryBtn").addEventListener("click", () => generateSummary(meeting));
  document.getElementById("regenerateSummaryBtn").addEventListener("click", () => generateSummary(meeting));
  document.getElementById("summaryType").addEventListener("change", async () => {
    const type = document.getElementById("summaryType").value;
    const summaries = await MeetingStore.getSummaries(meeting.id);
    if (summaries[type]) {
      document.getElementById("summaryContent").innerHTML = renderMarkdown(summaries[type].content);
      document.getElementById("regenerateSummaryBtn").style.display = "";
    } else {
      document.getElementById("summaryContent").innerHTML =
        '<p class="empty-state">Click "Generate" to create this summary.</p>';
      document.getElementById("regenerateSummaryBtn").style.display = "none";
    }
  });
}

export async function generateSummary(meeting) {
  const type = document.getElementById("summaryType").value;
  const btn = document.getElementById("generateSummaryBtn");
  const regenBtn = document.getElementById("regenerateSummaryBtn");
  btn.disabled = true;
  btn.textContent = "Generating...";
  if (regenBtn) regenBtn.style.display = "none";

  try {
    const content = await AIService.summarize(meeting.transcript, type, meeting);
    await MeetingStore.saveSummary(meeting.id, type, content);
    const fresh = await MeetingStore.getMeeting(meeting.id);
    if (fresh?.actionItems && state.currentMeetingId === meeting.id) {
      meeting.actionItems = fresh.actionItems;
      state.currentMeeting.actionItems = fresh.actionItems;
    }
    document.getElementById("summaryContent").innerHTML = renderMarkdown(content);
    if (regenBtn) regenBtn.style.display = "";
    showToast("Summary generated");
    bridge.renderSidebar?.();

    if (!meeting.titleRenamed && isGenericMeetingTitle(meeting.title)) {
      try {
        let suggested = parseMeetingTitleFromSummary(content);
        if (!suggested) {
          suggested = await AIService.generateMeetingTitle(meeting.transcript, content, meeting);
        }
        if (suggested && suggested !== meeting.title) {
          await MeetingStore.updateMeetingMeta(meeting.id, { title: suggested });
          meeting.title = suggested;
          if (state.currentMeetingId === meeting.id) {
            state.currentMeeting.title = suggested;
            dom.meetingViewTitle.textContent = suggested;
            bridge.setNavbar(suggested, document.getElementById("navbarSub")?.textContent || "");
            bridge.renderSidebar();
          }
        }
      } catch (_) {}
    }

    if (!meeting.tagsAutoApplied) {
      try {
        const tags = await autoLabelMeeting(meeting, content);
        const preview = content
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"))
          .map((l) => l.replace(/^[-*•]\s*/, ""))
          .find((l) => l.length > 15)
          ?.slice(0, 140) || "";
        await MeetingStore.updateMeetingMeta(meeting.id, {
          tags,
          tagsAutoApplied: true,
          ...(preview ? { summaryPreview: preview } : {}),
        });
        if (state.currentMeetingId === meeting.id) {
          state.currentMeeting.tags = tags;
          state.currentMeeting.tagsAutoApplied = true;
        }
      } catch (_) {}
    }

    await autoScoreMeeting(meeting, { silent: true });
  } catch (err) {
    document.getElementById("summaryContent").innerHTML =
      `<p style="color:var(--danger)">Error: ${escapeHtml(err.message)}</p>`;
  }

  btn.disabled = false;
  btn.innerHTML = `${icon("wand", 13)} Generate`;
}
