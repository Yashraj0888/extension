import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, showToast,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";
import AIService from "../services/ai.js";
import { getSettings } from "../services/settings.js";
import {
  detectCommitments,
  mergeCommitmentDetections,
  activePotentialCommitments,
  dismissCommitment,
  addCommitmentToActions,
} from "../services/commitment-detector.js";

function confidenceLabel(c) {
  const key = String(c || "medium").toLowerCase();
  if (key === "high") return "High";
  if (key === "low") return "Low";
  return "Medium";
}

function renderCommitmentsSection(meeting) {
  const pack = meeting.commitmentDetection;
  const potential = activePotentialCommitments(pack);
  const analyzedAt = pack?.analyzedAt;
  const lastError = pack?.lastError || "";
  const hasRun = !!(analyzedAt || lastError);

  let body = "";
  if (!hasRun) {
    body = `<p class="cd-empty">Scan the transcript for implied commitments like “I’ll send that tomorrow” — they stay here until you add or dismiss them.</p>`;
  } else if (lastError && !potential.length && !(pack?.commitments || []).length) {
    body = `<p class="cd-error">${escapeHtml(lastError)}</p>`;
  } else if (!potential.length) {
    body = `<p class="cd-empty">${escapeHtml(
      pack?.emptyReason ||
        (analyzedAt
          ? "No open potential commitments. Dismissed or already-added items stay out of this list."
          : "No implied commitments were found.")
    )}</p>`;
  } else {
    body = `${
      lastError ? `<p class="cd-error">${escapeHtml(lastError)}</p>` : ""
    }<ul class="cd-list">
      ${potential
        .map(
          (c) => `
        <li class="cd-card" data-cd-id="${escapeAttr(c.id)}">
          <div class="cd-card-main">
            <div class="cd-task">${escapeHtml(c.text)}</div>
            <div class="cd-meta">
              ${c.person ? `<span>${icon("users", 11)} ${escapeHtml(c.person)}</span>` : ""}
              ${c.deadline ? `<span>${icon("clock", 11)} ${escapeHtml(c.deadline)}</span>` : ""}
              ${
                c.timestamp || typeof c.entryIndex === "number"
                  ? `<button type="button" class="cd-ts-btn" data-cd-jump="${c.entryIndex}" title="Jump to transcript">
                      ${icon("eye", 11)} ${escapeHtml(c.timestamp || `Line ${c.entryIndex}`)}
                    </button>`
                  : ""
              }
              <span class="cd-confidence is-${escapeAttr(c.confidence || "medium")}" title="Detection confidence">
                ${confidenceLabel(c.confidence)} confidence
              </span>
            </div>
            ${c.quote ? `<blockquote class="cd-quote">${escapeHtml(c.quote)}</blockquote>` : ""}
          </div>
          <div class="cd-actions">
            <button type="button" class="generate-btn cd-add" data-cd-add="${escapeAttr(c.id)}">${icon("plus", 13)} Add to Actions</button>
            <button type="button" class="cd-dismiss" data-cd-dismiss="${escapeAttr(c.id)}">${icon("x", 13)} Dismiss</button>
          </div>
        </li>`
        )
        .join("")}
    </ul>`;
  }

  const btnLabel = hasRun
    ? `${icon("refresh", 13)} Re-detect`
    : `${icon("target", 13)} Detect commitments`;
  const btnClass = hasRun ? "generate-btn secondary-gen" : "generate-btn";
  const countBadge = potential.length ? ` (${potential.length})` : "";

  return `
    <section class="cd-section" id="commitmentSection" aria-label="Potential commitments">
      <div class="cd-head">
        <div>
          <h3 class="cd-heading">${icon("target", 14)} Potential Commitments${countBadge}</h3>
          ${
            analyzedAt
              ? `<p class="cd-sub">Updated ${escapeHtml(new Date(analyzedAt).toLocaleString())} · not added as tasks until you confirm</p>`
              : `<p class="cd-sub">Implied commitments from the transcript — review before creating action items</p>`
          }
        </div>
        <button type="button" class="${btnClass}" id="commitmentDetectBtn">${btnLabel}</button>
      </div>
      <div class="cd-body" id="commitmentBody">${body}</div>
    </section>`;
}

async function syncMeetingState(meeting) {
  if (state.currentMeetingId === meeting.id && state.currentMeeting) {
    state.currentMeeting.actionItems = meeting.actionItems;
    state.currentMeeting.commitmentDetection = meeting.commitmentDetection;
  }
}

async function runCommitmentDetection(meeting) {
  const btn = document.getElementById("commitmentDetectBtn");
  const body = document.getElementById("commitmentBody");
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:13px;height:13px"></span> Detecting…`;
  if (body) {
    body.innerHTML = `<p class="cd-loading"><span class="spinner" style="width:14px;height:14px"></span> Scanning transcript for implied commitments…</p>`;
  }
  try {
    const detected = await detectCommitments(meeting.transcript, meeting);
    const pack = mergeCommitmentDetections(
      meeting.commitmentDetection,
      detected,
      meeting.actionItems || []
    );
    await MeetingStore.setCommitmentDetection(meeting.id, pack);
    meeting.commitmentDetection = pack;
    await syncMeetingState(meeting);
    const n = activePotentialCommitments(pack).length;
    showToast(
      n
        ? `Found ${n} potential commitment${n === 1 ? "" : "s"}`
        : pack.emptyReason || "No potential commitments found"
    );
    renderActionItems(meeting);
  } catch (err) {
    const msg = err.message || "Commitment detection failed";
    const pack = {
      ...(meeting.commitmentDetection || {}),
      commitments: meeting.commitmentDetection?.commitments || [],
      analyzedAt: meeting.commitmentDetection?.analyzedAt || "",
      lastError: msg,
    };
    await MeetingStore.setCommitmentDetection(meeting.id, pack);
    meeting.commitmentDetection = pack;
    await syncMeetingState(meeting);
    showToast(msg);
    renderActionItems(meeting);
  }
}

async function handleAddCommitment(meeting, commitmentId) {
  const result = addCommitmentToActions(
    meeting.commitmentDetection,
    commitmentId,
    meeting.actionItems || []
  );
  await MeetingStore.setActionItems(meeting.id, result.actionItems);
  await MeetingStore.setCommitmentDetection(meeting.id, result.pack);
  meeting.actionItems = result.actionItems;
  meeting.commitmentDetection = result.pack;
  await syncMeetingState(meeting);

  if (result.created) {
    const settings = await getSettings();
    if (settings.autoPinWithActions && !meeting.isPinned) {
      await MeetingStore.togglePin(meeting.id);
      meeting.isPinned = true;
      bridge.updatePinBtn?.(true);
    }
    showToast("Added to Actions");
  } else if (result.linked) {
    showToast("Already in Actions — linked existing item");
  } else {
    showToast("Could not add commitment");
  }

  renderActionItems(meeting);
  bridge.renderSidebar?.();
  bridge.renderRightMeeting?.(meeting);
}

async function handleDismissCommitment(meeting, commitmentId) {
  const pack = dismissCommitment(meeting.commitmentDetection, commitmentId);
  await MeetingStore.setCommitmentDetection(meeting.id, pack);
  meeting.commitmentDetection = pack;
  await syncMeetingState(meeting);
  showToast("Commitment dismissed");
  renderActionItems(meeting);
}

// === ACTION ITEMS ===
export function renderActionItems(meeting) {
  const items = meeting.actionItems || [];
  dom.actionItemsContainer.innerHTML = `
    ${renderCommitmentsSection(meeting)}
    <div class="action-items-toolbar">
      <h3>${items.length} action item${items.length === 1 ? "" : "s"}</h3>
      <button class="generate-btn" id="rescanActionItemsBtn">${icon("refresh", 13)} Re-scan with AI</button>
    </div>
    <div id="actionItemsList">
      ${items.length === 0 ? '<p class="empty-state">No action items yet. Click "Re-scan with AI" to extract them, or add from Potential Commitments.</p>' : ""}
      ${items
        .map(
          (it) => `
        <div class="action-item-row ${it.done ? "done" : ""}" data-id="${it.id}">
          <input type="checkbox" ${it.done ? "checked" : ""} data-toggle="${it.id}" />
          <div class="ai-body">
            <div class="ai-text">${escapeHtml(it.text)}</div>
            <div class="ai-meta">
              ${it.owner ? `<span>${icon("users", 11)} ${escapeHtml(it.owner)}</span>` : ""}
              ${it.priority ? `<span>${icon("target", 11)} ${escapeHtml(it.priority)}</span>` : ""}
              ${it.deadline ? `<span>${icon("clock", 11)} ${escapeHtml(it.deadline)}</span>` : ""}
              ${
                typeof it.sourceEntryIndex === "number" && it.sourceEntryIndex >= 0
                  ? `<button type="button" class="cd-ts-btn ai-source-jump" data-jump="${it.sourceEntryIndex}" title="Jump to transcript">
                      ${icon("eye", 11)} ${escapeHtml(it.sourceTimestamp || "Transcript")}
                    </button>`
                  : ""
              }
              ${it.context ? `<span>${icon("messageSquare", 11)} ${escapeHtml(it.context)}</span>` : ""}
            </div>
          </div>
          <button class="ai-delete" data-delete="${it.id}">${icon("x", 15)}</button>
        </div>`
        )
        .join("")}
    </div>`;

  document.getElementById("commitmentDetectBtn")?.addEventListener("click", () => {
    runCommitmentDetection(meeting);
  });

  dom.actionItemsContainer.querySelectorAll("[data-cd-add]").forEach((btn) => {
    btn.addEventListener("click", () => handleAddCommitment(meeting, btn.dataset.cdAdd));
  });

  dom.actionItemsContainer.querySelectorAll("[data-cd-dismiss]").forEach((btn) => {
    btn.addEventListener("click", () => handleDismissCommitment(meeting, btn.dataset.cdDismiss));
  });

  dom.actionItemsContainer.querySelectorAll("[data-cd-jump], .ai-source-jump").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.cdJump ?? btn.dataset.jump, 10);
      if (Number.isNaN(idx) || idx < 0) return;
      bridge.navigate("meeting", {
        meetingId: meeting.id,
        tab: "transcript",
        entryIndex: idx,
      });
    });
  });

  dom.actionItemsContainer.querySelectorAll("[data-toggle]").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const updated = await MeetingStore.toggleActionItem(meeting.id, cb.dataset.toggle);
      meeting.actionItems = updated;
      renderActionItems(meeting);
      bridge.renderSidebar?.();
    });
  });

  dom.actionItemsContainer.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const remaining = (meeting.actionItems || []).filter((it) => it.id !== btn.dataset.delete);
      await MeetingStore.setActionItems(meeting.id, remaining);
      meeting.actionItems = remaining;
      renderActionItems(meeting);
      bridge.renderSidebar?.();
    });
  });

  document.getElementById("rescanActionItemsBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("rescanActionItemsBtn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="width:13px;height:13px"></span> Scanning...`;
    try {
      const extracted = await AIService.extractActionItems(meeting.transcript, meeting);
      const merged = [...(meeting.actionItems || []), ...extracted];
      await MeetingStore.setActionItems(meeting.id, merged);
      meeting.actionItems = merged;
      const settings = await getSettings();
      if (settings.autoPinWithActions && extracted.length && !meeting.isPinned) {
        await MeetingStore.togglePin(meeting.id);
        meeting.isPinned = true;
        bridge.updatePinBtn(true);
      }
      renderActionItems(meeting);
      bridge.renderSidebar?.();
      showToast(`Found ${extracted.length} action item${extracted.length === 1 ? "" : "s"}`);
    } catch (err) {
      showToast("Error: " + err.message);
      btn.disabled = false;
      btn.innerHTML = `${icon("refresh", 13)} Re-scan with AI`;
    }
  });
}
