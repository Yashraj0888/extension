import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";
import AIService from "../services/ai.js";
import {
  hasCompletedBackupConsent,
  setBackupMode,
} from "../services/folder-backup.js";
import { showConfirm, showPrompt } from "../ui-modal.js";
import {
  GLOBAL_PROMPTS,
  GLOBAL_QUICK_ACTIONS,
  suggestionButtonsHtml,
  quickActionsHtml,
  chatMessageHtml,
  chatUserTurnHtml,
  chatAssistantTurnHtml,
  thinkingMessageHtml,
  startPixelLoader,
  setChatSendBusy,
  bindChatCopyActions,
} from "../chat-ui.js";
import { isAbortError } from "../services/providers.js";

// === ASK AI ACROSS SELECTED MEETINGS ===
export async function preloadAskMeeting(id) {
  if (!id) return null;
  if (state.askMeetingsCache.has(id)) return state.askMeetingsCache.get(id);
  const meeting = await MeetingStore.getMeeting(id);
  if (meeting) state.askMeetingsCache.set(id, meeting);
  return meeting;
}

export async function addMeetingsToAsk(ids, { animateId = null } = {}) {
  const added = [];
  for (const id of ids) {
    if (!id || state.askSelectedIds.includes(id)) continue;
    state.askSelectedIds.push(id);
    added.push(id);
    // Load transcript in the background so chat is ready when the user asks
    preloadAskMeeting(id).catch(() => {});
  }
  if (added.length) {
    state.askShowPrompts = false;
    await renderAsk({ animateId: animateId || added[0] });
  }
  return added;
}

export function removeMeetingFromAsk(id) {
  state.askSelectedIds = state.askSelectedIds.filter((x) => x !== id);
  state.askMeetingsCache.delete(id);
  renderAsk();
}

export async function openAskMeetingPicker() {
  const meetings = await MeetingStore.listMeetings();
  const existing = document.getElementById("askMeetingPicker");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "askMeetingPicker";
  overlay.className = "app-modal-overlay";
  const selected = new Set(state.askSelectedIds);

  const paint = (q = "") => {
    const query = q.toLowerCase().trim();
    const list = meetings
      .filter((m) => !query || (m.title || "").toLowerCase().includes(query))
      .slice(0, 60);
    const box = overlay.querySelector("#askPickList");
    if (!list.length) {
      box.innerHTML = '<p class="empty-state-sm">No meetings found</p>';
      return;
    }
    box.innerHTML = list
      .map(
        (m) => `<label class="ask-pick-row">
          <input type="checkbox" data-id="${m.id}" ${selected.has(m.id) ? "checked" : ""} />
          <div>
            <strong>${escapeHtml(m.title || "Untitled")}</strong>
            <span>${formatDate(m.date)} · ${m.participantCount || 0} people</span>
          </div>
        </label>`
      )
      .join("");
    box.querySelectorAll("input[data-id]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) selected.add(input.dataset.id);
        else selected.delete(input.dataset.id);
      });
    });
  };

  overlay.innerHTML = `
    <div class="app-modal-card" role="dialog" aria-modal="true" style="max-width:460px">
      <div class="app-modal-head">
        <h3>Add meetings</h3>
        <button type="button" class="app-modal-close" id="askPickClose">${icon("x", 16)}</button>
      </div>
      <input type="text" id="askPickSearch" class="csm-search-input" placeholder="Search meetings…" autocomplete="off" />
      <div id="askPickList" class="ask-pick-list"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button type="button" class="quick-btn secondary" id="askPickCancel">Cancel</button>
        <button type="button" class="quick-btn" id="askPickSave">${icon("plus", 14)} Add selected</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  paint();

  const close = () => overlay.remove();
  overlay.querySelector("#askPickClose").addEventListener("click", close);
  overlay.querySelector("#askPickCancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#askPickSearch").addEventListener("input", (e) => paint(e.target.value));
  overlay.querySelector("#askPickSave").addEventListener("click", async () => {
    const ids = [...selected];
    close();
    const newly = ids.filter((id) => !state.askSelectedIds.includes(id));
    state.askSelectedIds = ids;
    for (const id of newly) preloadAskMeeting(id).catch(() => {});
    await renderAsk({ animateId: newly[0] || null });
    if (newly.length) showToast(newly.length === 1 ? "Meeting added" : `${newly.length} meetings added`);
  });
  setTimeout(() => overlay.querySelector("#askPickSearch")?.focus(), 30);
}

export function askSelectedChipsHtml(animateId) {
  return state.askSelectedIds
    .map((id) => {
      const cached = state.askMeetingsCache.get(id);
      const title = cached?.title || id;
      const anim = id === animateId ? " is-entering" : "";
      return `<span class="ask-meet-chip${anim}" data-id="${escapeAttr(id)}">
        ${icon("meet", 12)}
        <span class="ask-meet-chip-title">${escapeHtml(title)}</span>
        <button type="button" class="ask-meet-chip-remove" data-remove="${escapeAttr(id)}" title="Remove" aria-label="Remove">${icon("x", 12)}</button>
      </span>`;
    })
    .join("");
}

export async function renderAsk({ animateId = null } = {}) {
  const conv = await MeetingStore.getGlobalConversation();
  const container = document.getElementById("globalChatContainer");
  const aiAvatar = icon("askAi", 14);
  const hasMeetings = state.askSelectedIds.length > 0;

  // Ensure titles for chips (meta is enough if cache miss)
  if (hasMeetings) {
    const metas = await MeetingStore.listMeetings();
    for (const id of state.askSelectedIds) {
      if (!state.askMeetingsCache.has(id)) {
        const meta = metas.find((m) => m.id === id);
        if (meta) state.askMeetingsCache.set(id, meta);
        preloadAskMeeting(id).catch(() => {});
      }
    }
  }

  const composerDisabled = !hasMeetings;
  const showSuggestions = hasMeetings && (state.askShowPrompts || conv.length === 0);

  let messagesBlock = "";
  if (!hasMeetings) {
    messagesBlock = `
      <div class="chat-empty ask-gate">
        <div class="ask-gate-icon">${icon("bot", 28)}</div>
        <div class="ask-gate-title">Hello there! How can I help you today?</div>
        <div class="ask-gate-sub">Select one or more meetings first — then ask about decisions, actions, and themes.</div>
        <button type="button" class="quick-btn ask-add-cta" id="askAddMeetingsBtn">${icon("plus", 15)} Add Meetings to begin</button>
      </div>`;
  } else if (conv.length === 0) {
    messagesBlock = `
      <div class="chat-empty">
        <div class="chat-empty-hero">
          <div class="chat-empty-icon">${icon("askAi", 20)}</div>
          <div>
            <div class="chat-empty-title">Ready when you are</div>
            <div class="chat-empty-subtitle">Ask about the ${state.askSelectedIds.length} selected meeting${state.askSelectedIds.length === 1 ? "" : "s"}. Transcripts load in the background.</div>
          </div>
        </div>
        ${
          showSuggestions
            ? `<div class="chat-suggestions-label">Suggested prompts</div>
               <div class="chat-suggestions">${suggestionButtonsHtml(GLOBAL_PROMPTS, icon)}</div>`
            : ""
        }
      </div>`;
  } else {
    messagesBlock = conv
      .map((m, i) =>
        m.role === "assistant"
          ? chatAssistantTurnHtml({
              contentHtml: renderMarkdown(m.content),
              avatarHtml: aiAvatar,
              index: i,
              durationMs: m.durationMs,
              iconFn: icon,
            })
          : chatUserTurnHtml({
              contentHtml: escapeHtml(m.content),
              avatarHtml: "You",
              index: i,
              iconFn: icon,
            })
      )
      .join("");
  }

  container.innerHTML = `
    <div class="ask-selected-bar">
      <div class="ask-selected-chips" id="askSelectedChips">
        ${hasMeetings ? askSelectedChipsHtml(animateId) : `<span class="ask-selected-empty">No meetings selected</span>`}
      </div>
      <button type="button" class="quick-btn secondary ask-add-btn" id="askAddMeetingsBtn">${icon("plus", 14)} Add Meetings</button>
    </div>
    <div class="chat-messages">${messagesBlock}</div>
    <div class="chat-input-area ${composerDisabled ? "is-disabled" : ""}">
      ${
        hasMeetings
          ? `<div class="chat-quick-actions">${quickActionsHtml(GLOBAL_QUICK_ACTIONS, icon)}</div>`
          : `<div class="ask-composer-hint">Select meetings first to start chatting</div>`
      }
      <div class="chat-input-row">
        <textarea id="globalChatInput" placeholder="${
          composerDisabled ? "Select meetings first to start chatting" : "Ask anything about the selected meetings…"
        }" rows="1" ${composerDisabled ? "disabled" : ""}></textarea>
        <button id="globalChatSendBtn" title="Send" ${composerDisabled ? "disabled" : ""}>${icon("send", 15)}</button>
      </div>
    </div>`;

  if (conv.length && hasMeetings) {
    const msgContainer = container.querySelector(".chat-messages");
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  container.querySelectorAll("#askAddMeetingsBtn").forEach((btn) => {
    btn.addEventListener("click", () => openAskMeetingPicker());
  });
  container.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeMeetingFromAsk(btn.dataset.remove));
  });
  container.querySelectorAll(".chat-suggestion").forEach((btn) => {
    btn.addEventListener("click", () => sendGlobalMessage(btn.dataset.prompt));
  });
  container.querySelectorAll(".qa-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prompts = {
        summary: "Summarize the selected meetings. Cover key topics, decisions, and next steps.",
        actions: "What are all open action items in the selected meetings? Group by meeting and owner.",
        insights: "What are the key insights and themes across the selected meetings?",
        prompts: "__toggle_prompts__",
      };
      const val = prompts[btn.dataset.action] || btn.dataset.action;
      if (val === "__toggle_prompts__") {
        state.askShowPrompts = !state.askShowPrompts;
        renderAsk();
        return;
      }
      sendGlobalMessage(val);
    });
  });

  const inputEl = document.getElementById("globalChatInput");
  const sendBtn = document.getElementById("globalChatSendBtn");
  if (sendBtn && inputEl) {
    sendBtn.addEventListener("click", () => {
      if (state.isGenerating) {
        state.aiAbort?.abort();
        return;
      }
      sendGlobalMessage(inputEl.value.trim());
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.isGenerating) {
        e.preventDefault();
        state.aiAbort?.abort();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendGlobalMessage(inputEl.value.trim());
      }
    });
    autoGrowTextarea(inputEl);
  }

  bindChatCopyActions(container, () => MeetingStore.getGlobalConversation());
}

export async function sendGlobalMessage(text) {
  if (!text || state.isGenerating) return;
  if (!state.askSelectedIds.length) {
    showToast("Add meetings first");
    openAskMeetingPicker();
    return;
  }
  state.isGenerating = true;

  const userConv = await MeetingStore.addGlobalMessage({ role: "user", content: text });
  const container = document.getElementById("globalChatContainer");
  const messagesEl = container.querySelector(".chat-messages");
  const wasEmpty = messagesEl.querySelector(".chat-empty");
  if (wasEmpty) messagesEl.innerHTML = "";

  const aiAvatar = icon("askAi", 14);
  messagesEl.insertAdjacentHTML(
    "beforeend",
    chatUserTurnHtml({
      contentHtml: escapeHtml(text),
      avatarHtml: "You",
      index: userConv.length - 1,
      iconFn: icon,
    })
  );
  const loadingId = "gloading-" + Date.now();
  const cancelHtml = `<button type="button" class="chat-cancel-btn" data-cancel-ai title="Stop generating">${icon("square", 11)} Stop</button>`;
  messagesEl.insertAdjacentHTML(
    "beforeend",
    thinkingMessageHtml({ id: loadingId, avatarHtml: aiAvatar, scope: "global", cancelHtml })
  );
  const loadingEl = document.getElementById(loadingId);
  const stopLoader = startPixelLoader(loadingEl?.querySelector(".pixel-loader"), { scope: "global" });
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const startedAt = Date.now();
  const ac = new AbortController();
  state.aiAbort = ac;
  loadingEl?.querySelector("[data-cancel-ai]")?.addEventListener("click", () => ac.abort());

  const inputEl = document.getElementById("globalChatInput");
  const sendBtn = document.getElementById("globalChatSendBtn");
  if (inputEl) inputEl.value = "";
  setChatSendBusy(sendBtn, true, icon);

  try {
    const meetings = [];
    for (const id of state.askSelectedIds) {
      const m = (await preloadAskMeeting(id)) || (await MeetingStore.getMeeting(id));
      if (m) meetings.push(m);
    }
    if (!meetings.length) throw new Error("Could not load the selected meetings.");

    const conv = await MeetingStore.getGlobalConversation();
    const response = await AIService.askAcrossMeetings(conv, meetings, { signal: ac.signal });
    stopLoader();
    document.getElementById(loadingId)?.remove();
    const durationMs = Date.now() - startedAt;
    await MeetingStore.addGlobalMessage({ role: "assistant", content: response, durationMs });
    const convNow = await MeetingStore.getGlobalConversation();
    messagesEl.insertAdjacentHTML(
      "beforeend",
      chatAssistantTurnHtml({
        contentHtml: renderMarkdown(response),
        avatarHtml: aiAvatar,
        index: convNow.length - 1,
        durationMs,
        iconFn: icon,
      })
    );
    messagesEl.scrollTop = messagesEl.scrollHeight;
    bindChatCopyActions(container, () => MeetingStore.getGlobalConversation());
  } catch (err) {
    stopLoader();
    document.getElementById(loadingId)?.remove();
    if (isAbortError(err)) {
      showToast("Stopped");
    } else {
      messagesEl.insertAdjacentHTML(
        "beforeend",
        chatMessageHtml({
          role: "assistant",
          contentHtml: escapeHtml(err.message),
          avatarHtml: icon("x", 13),
          isError: true,
        })
      );
    }
  }

  state.isGenerating = false;
  state.aiAbort = null;
  setChatSendBusy(sendBtn, false, icon);
  if (inputEl) inputEl.focus();
}

export async function maybeAskBackupConsent() {
  // Default silently to local storage — never touch the folder API on launch.
  if (!(await hasCompletedBackupConsent())) {
    await setBackupMode("local");
  }
}

