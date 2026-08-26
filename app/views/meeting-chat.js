import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, renderMarkdown, showToast, autoGrowTextarea,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";
import AIService from "../services/ai.js";
import { getSettings } from "../services/settings.js";
import {
  isAddToMyTasksIntent,
  parseActionItemsFromMarkdown,
  collectTasksFromChatSources,
  pickTasksForMyList,
} from "../services/action-item-parse.js";
import { getExtensionUserName } from "./tasks-view.js";
import {
  ensureChatIndex,
  getChatIndex,
  isUnsatisfiedWithAnswer,
  lastSubstantiveUserQuestion,
  relevantTranscriptExcerpts,
} from "../services/chat-index.js";
import {
  MEETING_PROMPTS,
  MEETING_QUICK_ACTIONS,
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

function lastAssistantContent(conv) {
  for (let i = (conv || []).length - 1; i >= 0; i--) {
    if (conv[i]?.role === "assistant" && conv[i].content) return conv[i].content;
  }
  return "";
}

function addTasksButtonHtml(index, count) {
  return `<button type="button" class="chat-add-tasks" data-add-tasks="${index}">
    ${icon("plus", 12)} Add ${count} to My Tasks
  </button>`;
}

function assistantFooter(content, index) {
  const count = parseActionItemsFromMarkdown(content).length;
  if (!count) return "";
  return addTasksButtonHtml(index, count);
}

async function persistChatTasks(meeting, items, { quiet = false } = {}) {
  const userName = await getExtensionUserName();
  const prepared = pickTasksForMyList(items, userName || meeting.recordedBy || "");
  if (!prepared.length) return { addedCount: 0, items: meeting.actionItems || [] };
  const result = await MeetingStore.addActionItems(meeting.id, prepared);
  if (result.addedCount > 0) {
    meeting.actionItems = result.items;
    if (state.currentMeetingId === meeting.id && state.currentMeeting) {
      state.currentMeeting.actionItems = result.items;
    }
    const settings = await getSettings();
    if (settings.autoPinWithActions && !meeting.isPinned) {
      await MeetingStore.togglePin(meeting.id);
      meeting.isPinned = true;
      bridge.updatePinBtn?.(true);
    }
    showToast(
      result.addedCount === 1
        ? "Added 1 task to My Tasks"
        : `Added ${result.addedCount} tasks to My Tasks`
    );
    bridge.renderSidebar?.();
  } else if (!quiet) {
    showToast("Those tasks are already in My Tasks");
  }
  return result;
}

async function addMessageTasksToMyList(meeting, markdown) {
  const parsed = parseActionItemsFromMarkdown(markdown);
  const fallback = parsed.length ? parsed : parseActionItemsFromMarkdown(markdown, { loose: true });
  if (!fallback.length) {
    showToast("No tasks found in that reply");
    return;
  }
  await persistChatTasks(meeting, fallback);
}

function bindAddTasksButtons(meeting) {
  const host = dom.chatContainer;
  if (!host) return;
  host._addTasksMeeting = meeting;
  if (host.dataset.addTasksBound === "1") return;
  host.dataset.addTasksBound = "1";
  host.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-add-tasks]");
    if (!btn || btn.disabled) return;
    const current = host._addTasksMeeting;
    if (!current) return;
    const idx = parseInt(btn.dataset.addTasks, 10);
    btn.disabled = true;
    try {
      const conv = await MeetingStore.getAIConversation(current.id);
      const msg = conv[idx];
      if (msg?.role === "assistant" && msg.content) {
        await addMessageTasksToMyList(current, msg.content);
        btn.classList.add("is-done");
        btn.innerHTML = `${icon("check", 12)} Added to My Tasks`;
      } else {
        btn.disabled = false;
      }
    } catch (err) {
      showToast(err.message || "Could not add tasks");
      btn.disabled = false;
    }
  });
}

function addToTasksInstruction(userName, alreadyAdded) {
  const who = userName || "the current user";
  const saved = alreadyAdded || [];
  if (saved.length) {
    return `The user asked to save tasks to their AfterMeet "My Tasks" list. This is already done — ${saved.length} task(s) were saved for ${who}:
${saved.map((t) => `- ${t.text}`).join("\n")}
Confirm briefly. Do not invent extra tasks. Do not claim you cannot save tasks.`;
  }
  return `The user asked to save tasks to their AfterMeet "My Tasks" list. Those items are persisted automatically.
Identify the tasks they mean (this message, the previous list, or the transcript). Assign them to ${who} unless they named someone else.
Reply with a one-line confirmation and this list, one bullet per task:
- **[${who}]** | **[specific task]** | **Priority: medium** | **Deadline: TBD** | **Context: from chat**
Do not include other people's work unless they asked to add everyone's.`;
}

// === CHAT ===
export async function renderChat(meeting) {
  const conv = await MeetingStore.getAIConversation(meeting.id);
  const aiAvatar = icon("brain", 14);

  if (conv.length === 0) {
    dom.chatContainer.innerHTML = `
      <div class="chat-messages">
        <div class="chat-empty">
          <div class="chat-empty-hero">
            <div class="chat-empty-icon">${icon("messageSquare", 20)}</div>
            <div>
              <div class="chat-empty-title">Ask about this meeting</div>
              <div class="chat-empty-subtitle">Ask about this meeting — answers come from a detailed index, not the full transcript each time. If an answer misses something, say you’re not satisfied and it will re-read the transcript.</div>
            </div>
          </div>
          <div class="chat-suggestions-label">Suggested prompts</div>
          <div class="chat-suggestions">
            ${suggestionButtonsHtml(MEETING_PROMPTS, icon)}
          </div>
        </div>
      </div>
      <div class="chat-input-area">
        <div class="chat-quick-actions">
          ${quickActionsHtml(MEETING_QUICK_ACTIONS, icon)}
        </div>
        <div class="chat-input-row">
          <textarea id="chatInput" placeholder="Ask anything about this meeting…" rows="1"></textarea>
          <button id="chatSendBtn" title="Send">${icon("send", 15)}</button>
        </div>
      </div>`;
  } else {
    const messagesHtml = conv
      .map((m, i) =>
        m.role === "assistant"
          ? chatAssistantTurnHtml({
              contentHtml: renderMarkdown(m.content),
              avatarHtml: aiAvatar,
              index: i,
              durationMs: m.durationMs,
              iconFn: icon,
              footerHtml: assistantFooter(m.content, i),
            })
          : chatUserTurnHtml({
              contentHtml: escapeHtml(m.content),
              avatarHtml: "You",
              index: i,
              iconFn: icon,
            })
      )
      .join("");

    dom.chatContainer.innerHTML = `
      <div class="chat-messages">${messagesHtml}</div>
      <div class="chat-input-area">
        <div class="chat-quick-actions">
          ${quickActionsHtml(MEETING_QUICK_ACTIONS, icon)}
        </div>
        <div class="chat-input-row">
          <textarea id="chatInput" placeholder="Ask anything about this meeting…" rows="1"></textarea>
          <button id="chatSendBtn" title="Send">${icon("send", 15)}</button>
        </div>
      </div>`;

    const msgContainer = dom.chatContainer.querySelector(".chat-messages");
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  bindChatEvents(meeting);
  bindAddTasksButtons(meeting);
  bindChatCopyActions(dom.chatContainer, () => MeetingStore.getAIConversation(meeting.id));
}

export function bindChatEvents(meeting) {
  const inputEl = dom.chatContainer.querySelector("#chatInput");
  const sendBtn = dom.chatContainer.querySelector("#chatSendBtn");

  dom.chatContainer.querySelectorAll(".chat-suggestion").forEach((btn) => {
    btn.addEventListener("click", () => sendMessage(meeting, btn.dataset.prompt));
  });

  dom.chatContainer.querySelectorAll(".qa-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      const prompts = {
        summarize: "Summarize this meeting in detail. Include: key topics, decisions, action items, and next steps.",
        tasks: "Extract all tasks and action items from this meeting. Format as a markdown table with columns: Task, Owner, Priority, Deadline.",
        addTasks: "Add these action items to my tasks.",
        decisions: "List every decision made in this meeting. For each, explain what was decided and why.",
        email: "Draft a professional follow-up email summarizing the key outcomes of this meeting. Include action items and next steps.",
      };
      const prompt = prompts[action] || action;
      sendMessage(meeting, prompt);
    });
  });

  sendBtn.addEventListener("click", () => {
    if (state.isGenerating) {
      state.aiAbort?.abort();
      return;
    }
    sendMessage(meeting, inputEl.value.trim());
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.isGenerating) {
      e.preventDefault();
      state.aiAbort?.abort();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(meeting, inputEl.value.trim());
    }
  });
  autoGrowTextarea(inputEl);
}

export async function sendMessage(meeting, text) {
  if (!text || state.isGenerating) return;
  state.isGenerating = true;

  const wantsMyTasks = isAddToMyTasksIntent(text);
  const unsatisfied = isUnsatisfiedWithAnswer(text);
  const userConv = await MeetingStore.addAIMessage(meeting.id, { role: "user", content: text });

  const messagesEl = dom.chatContainer.querySelector(".chat-messages");
  const wasEmpty = messagesEl.querySelector(".chat-empty");
  if (wasEmpty) messagesEl.innerHTML = "";

  const aiAvatar = icon("brain", 14);
  messagesEl.insertAdjacentHTML(
    "beforeend",
    chatUserTurnHtml({
      contentHtml: escapeHtml(text),
      avatarHtml: "You",
      index: userConv.length - 1,
      iconFn: icon,
    })
  );

  const loadingId = "loading-" + Date.now();
  const cancelHtml = `<button type="button" class="chat-cancel-btn" data-cancel-ai title="Stop generating">${icon("square", 11)} Stop</button>`;
  messagesEl.insertAdjacentHTML(
    "beforeend",
    thinkingMessageHtml({ id: loadingId, avatarHtml: aiAvatar, scope: "meeting", cancelHtml })
  );
  const loadingEl = document.getElementById(loadingId);
  const stopLoader = startPixelLoader(loadingEl?.querySelector(".pixel-loader"), { scope: "meeting" });
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const startedAt = Date.now();
  const ac = new AbortController();
  state.aiAbort = ac;
  loadingEl?.querySelector("[data-cancel-ai]")?.addEventListener("click", () => ac.abort());

  const inputEl = dom.chatContainer.querySelector("#chatInput");
  const sendBtn = dom.chatContainer.querySelector("#chatSendBtn");
  if (inputEl) inputEl.value = "";
  setChatSendBusy(sendBtn, true, icon);

  try {
    const updatedConv = await MeetingStore.getAIConversation(meeting.id);
    const userName = await getExtensionUserName();
    const ownerName = userName || meeting.recordedBy || "";

    let alreadyAdded = [];
    if (wantsMyTasks) {
      const previous = lastAssistantContent(updatedConv.slice(0, -1));
      const early = pickTasksForMyList(
        collectTasksFromChatSources({ userText: text, previousAssistant: previous }),
        ownerName
      );
      if (early.length) {
        await persistChatTasks(meeting, early);
        alreadyAdded = early;
      }
    }

    const extraInstruction = wantsMyTasks ? addToTasksInstruction(ownerName, alreadyAdded) : "";
    const priorQuestion = lastSubstantiveUserQuestion(updatedConv, text);

    let chatIndex = "";
    try {
      chatIndex = unsatisfied
        ? (await getChatIndex(meeting.id)) || (await ensureChatIndex(meeting, { signal: ac.signal }))
        : await ensureChatIndex(meeting, { signal: ac.signal });
    } catch (err) {
      if (isAbortError(err)) throw err;
      console.warn("[AfterMeet] Chat index skipped:", err.message);
    }

    const excerpts = unsatisfied
      ? relevantTranscriptExcerpts(
          meeting.transcript,
          `${priorQuestion}\n${text}\n${lastAssistantContent(updatedConv.slice(0, -1))}`
        )
      : "";

    if (unsatisfied) {
      showToast("Checking the transcript for missing details…");
      ensureChatIndex(meeting, {
        force: true,
        focus: `User was not satisfied.\nFeedback: ${text}\nOriginal question: ${priorQuestion}`,
        signal: ac.signal,
      }).catch(() => {});
    }

    const rescue = unsatisfied
      ? `The user is not satisfied with the previous answer.
Re-answer more completely using the meeting index AND the transcript excerpts.
Original question: ${priorQuestion}
Feedback: ${text}`
      : "";

    const response = await AIService.chat(updatedConv, meeting, {
      extraInstruction: [extraInstruction, rescue].filter(Boolean).join("\n\n"),
      chatIndex,
      transcriptExcerpts: excerpts,
      useFullTranscript: !chatIndex,
      signal: ac.signal,
    });

    stopLoader();
    document.getElementById(loadingId)?.remove();

    await MeetingStore.addAIMessage(meeting.id, {
      role: "assistant",
      content: response,
      durationMs: Date.now() - startedAt,
    });

    if (wantsMyTasks) {
      const previous = lastAssistantContent(updatedConv.slice(0, -1));
      const collected = collectTasksFromChatSources({
        userText: text,
        previousAssistant: previous,
        newAssistant: response,
      });
      const prepared = pickTasksForMyList(collected, ownerName);
      if (prepared.length) {
        await persistChatTasks(meeting, prepared, { quiet: alreadyAdded.length > 0 });
      } else if (!alreadyAdded.length) {
        showToast("Couldn't find tasks to add — list them as bullets or use Add to My Tasks on a reply");
      }
    } else {
      const fresh = await MeetingStore.getMeeting(meeting.id);
      if (fresh?.actionItems && state.currentMeetingId === meeting.id) {
        meeting.actionItems = fresh.actionItems;
        state.currentMeeting.actionItems = fresh.actionItems;
      }
      bridge.renderSidebar?.();
    }

    const convNow = await MeetingStore.getAIConversation(meeting.id);
    const assistantIndex = convNow.length - 1;
    messagesEl.insertAdjacentHTML(
      "beforeend",
      chatAssistantTurnHtml({
        contentHtml: renderMarkdown(response),
        avatarHtml: aiAvatar,
        index: assistantIndex,
        durationMs: convNow[assistantIndex]?.durationMs,
        iconFn: icon,
        footerHtml: assistantFooter(response, assistantIndex),
      })
    );
    messagesEl.scrollTop = messagesEl.scrollHeight;
    bindAddTasksButtons(meeting);
    bindChatCopyActions(dom.chatContainer, () => MeetingStore.getAIConversation(meeting.id));
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
