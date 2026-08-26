// Shared modern chat UI helpers: pixel-grid thinking loader + prompt chips.

const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const THINKING_LABELS_GLOBAL = [
  "Reading recent meetings…",
  "Finding decisions…",
  "Gathering action items…",
  "Cross-checking speakers…",
  "Connecting the threads…",
  "Drafting a clear answer…",
  "Almost there…",
];

const THINKING_LABELS_MEETING = [
  "Indexing this meeting…",
  "Using the meeting brief…",
  "Finding decisions…",
  "Mapping action items…",
  "Checking the thread…",
  "Drafting a clear answer…",
  "Almost there…",
];

const activeLoaders = new Map();

function formatElapsed(ds) {
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export function pixelLoaderHtml(label = "Thinking…") {
  const cells = CHEVRON_DELAYS.map(
    (d, i) =>
      `<span class="pixel-cell" style="animation-delay:${d}ms" data-i="${i}"></span>`
  ).join("");
  return `
    <div class="pixel-loader" role="status" aria-live="polite">
      <span class="pixel-grid" aria-hidden="true">${cells}</span>
      <span class="pixel-label">${label}</span>
      <span class="pixel-elapsed font-mono">0.0s</span>
    </div>`;
}

export function startPixelLoader(rootEl, { scope = "meeting" } = {}) {
  if (!rootEl) return () => {};
  const labels = scope === "global" ? THINKING_LABELS_GLOBAL : THINKING_LABELS_MEETING;
  const labelEl = rootEl.querySelector(".pixel-label");
  const elapsedEl = rootEl.querySelector(".pixel-elapsed");
  let ds = 0;
  let labelIdx = 0;
  if (labelEl) labelEl.textContent = labels[0];

  const tick = setInterval(() => {
    ds += 1;
    if (elapsedEl) elapsedEl.textContent = formatElapsed(ds);
  }, 100);

  const rotate = setInterval(() => {
    labelIdx = (labelIdx + 1) % labels.length;
    if (labelEl) {
      labelEl.classList.add("is-swap");
      labelEl.textContent = labels[labelIdx];
      requestAnimationFrame(() => labelEl.classList.remove("is-swap"));
    }
  }, 2200);

  const stop = () => {
    clearInterval(tick);
    clearInterval(rotate);
    activeLoaders.delete(rootEl);
  };
  activeLoaders.set(rootEl, stop);
  return stop;
}

export function stopPixelLoader(rootEl) {
  const stop = activeLoaders.get(rootEl);
  if (stop) stop();
}

export const GLOBAL_PROMPTS = [
  {
    icon: "listChecks",
    title: "Open action items",
    prompt: "What are all my open action items across recent meetings? Group by meeting and owner.",
  },
  {
    icon: "calendar",
    title: "This week’s recap",
    prompt: "Summarize what happened this week across all meetings. Highlight decisions and next steps.",
  },
  {
    icon: "star",
    title: "Key decisions",
    prompt: "List the most important decisions from recent meetings, with who decided and why.",
  },
  {
    icon: "users",
    title: "My commitments",
    prompt: "What did I personally commit to across recent meetings? Include deadlines if mentioned.",
  },
  {
    icon: "alertTriangle",
    title: "Risks & blockers",
    prompt: "What blockers, risks, or unresolved issues came up across recent meetings?",
  },
  {
    icon: "target",
    title: "Budget & pricing",
    prompt: "Which meetings mentioned budget, pricing, cost, or spend? Quote the key points.",
  },
  {
    icon: "clock",
    title: "Upcoming deadlines",
    prompt: "Extract every deadline or due date mentioned in recent meetings.",
  },
  {
    icon: "mail",
    title: "Follow-up draft",
    prompt: "Draft a concise follow-up email covering open actions and decisions from the last few meetings.",
  },
  {
    icon: "flame",
    title: "Unresolved threads",
    prompt: "What topics were raised but never resolved across recent meetings? List open questions.",
  },
  {
    icon: "users",
    title: "Who owns what",
    prompt: "Build a responsibility map: person → commitments from recent meetings.",
  },
];

export const GLOBAL_QUICK_ACTIONS = [
  { action: "summary", icon: "wand", label: "Summary" },
  { action: "actions", icon: "listChecks", label: "Action Items" },
  { action: "insights", icon: "star", label: "Key Insights" },
  { action: "prompts", icon: "zap", label: "Quick Prompts" },
];

export const MEETING_PROMPTS = [
  {
    icon: "wand",
    title: "Full summary",
    prompt: "Summarize this meeting in detail. Cover key topics, decisions, action items, and next steps.",
  },
  {
    icon: "listChecks",
    title: "Action items",
    prompt: "Extract all tasks and action items. Format as a markdown table: Task | Owner | Priority | Deadline.",
  },
  {
    icon: "plus",
    title: "Add to My Tasks",
    prompt: "Add these action items to my tasks.",
  },
  {
    icon: "star",
    title: "Decisions",
    prompt: "List every decision made in this meeting. For each, explain what was decided and why.",
  },
  {
    icon: "users",
    title: "My parts",
    prompt: "What did I say or commit to in this meeting? List my action items and opinions.",
  },
  {
    icon: "alertTriangle",
    title: "Blockers & risks",
    prompt: "What blockers, risks, or open questions remain after this meeting?",
  },
  {
    icon: "clock",
    title: "Deadlines",
    prompt: "What deadlines or timelines were mentioned? Who owns each one?",
  },
  {
    icon: "target",
    title: "Priorities",
    prompt: "What should I work on first based on this meeting? Rank by impact and urgency.",
  },
  {
    icon: "mail",
    title: "Follow-up email",
    prompt: "Draft a professional follow-up email summarizing outcomes, action items, and next steps.",
  },
];

export const MEETING_QUICK_ACTIONS = [
  { action: "summarize", icon: "wand", label: "Summarize" },
  { action: "tasks", icon: "listChecks", label: "Tasks" },
  { action: "addTasks", icon: "plus", label: "Add to Tasks" },
  { action: "decisions", icon: "star", label: "Decisions" },
  { action: "email", icon: "mail", label: "Email" },
];

export function suggestionButtonsHtml(prompts, iconFn) {
  return prompts
    .map(
      (p) => `
      <button type="button" class="chat-suggestion" data-prompt="${escapeAttr(p.prompt)}">
        <span class="chat-suggestion-icon">${iconFn(p.icon, 14)}</span>
        <span class="chat-suggestion-text">${escapeHtml(p.title)}</span>
      </button>`
    )
    .join("");
}

export function quickActionsHtml(actions, iconFn) {
  return actions
    .map(
      (a) =>
        `<button type="button" class="qa-btn" data-action="${a.action}">${iconFn(a.icon, 13)} ${a.label}</button>`
    )
    .join("");
}

export function chatMessageHtml({ role, contentHtml, avatarHtml, isError = false, footerHtml = "" }) {
  const cls = ["chat-message", role === "user" ? "user" : "assistant", isError ? "is-error" : ""]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="${cls}">
      <div class="chat-avatar ${role === "user" ? "is-user" : isError ? "is-error" : "is-ai"}">${avatarHtml}</div>
      <div class="chat-bubble">
        ${contentHtml}
        ${footerHtml ? `<div class="chat-bubble-actions">${footerHtml}</div>` : ""}
      </div>
    </div>`;
}

export function formatTook(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "";
  const s = n / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(1)}s`;
}

function chatCopyBtnHtml(kind, iconFn) {
  const label = kind === "prompt" ? "Copy" : "Copy";
  return `<button type="button" class="chat-copy-btn" data-copy="${kind}" data-label="${label}" title="${label}">${iconFn("copy", 11)} <span class="chat-copy-label">${label}</span></button>`;
}

export function chatReplyMetaHtml({ index, durationMs, iconFn, kind }) {
  const took = kind === "response" ? formatTook(durationMs) : "";
  return `<div class="chat-msg-meta chat-msg-meta-${kind}" data-msg-index="${index}">
    ${took ? `<span class="chat-msg-took">Took ${escapeHtml(took)}</span>` : ""}
    ${chatCopyBtnHtml(kind, iconFn)}
  </div>`;
}

export function chatUserTurnHtml({ contentHtml, avatarHtml, index, iconFn }) {
  const msg = chatMessageHtml({
    role: "user",
    contentHtml,
    avatarHtml,
  });
  return `<div class="chat-user-turn">${msg}${chatReplyMetaHtml({ index, iconFn, kind: "prompt" })}</div>`;
}

export function chatAssistantTurnHtml({
  contentHtml,
  avatarHtml,
  index,
  durationMs,
  iconFn,
  footerHtml = "",
  isError = false,
}) {
  const msg = chatMessageHtml({
    role: "assistant",
    contentHtml,
    avatarHtml,
    isError,
    footerHtml: isError ? "" : footerHtml,
  });
  if (isError) return msg;
  return `<div class="chat-assistant-turn">${msg}${chatReplyMetaHtml({ index, durationMs, iconFn, kind: "response" })}</div>`;
}

export function bindChatCopyActions(root, getConversation) {
  if (!root) return;
  root._getChatConv = getConversation;
  if (root.dataset.copyBound === "1") return;
  root.dataset.copyBound = "1";
  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn || !root.contains(btn)) return;
    const meta = btn.closest(".chat-msg-meta");
    const idx = parseInt(meta?.dataset.msgIndex, 10);
    if (Number.isNaN(idx)) return;
    let conv = [];
    try {
      conv = (await root._getChatConv?.()) || [];
    } catch (_) {
      return;
    }
    const text = conv[idx]?.content || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const labelEl = btn.querySelector(".chat-copy-label");
    const original = btn.dataset.label || labelEl?.textContent || "";
    btn.classList.add("is-copied");
    if (labelEl) labelEl.textContent = "Copied";
    setTimeout(() => {
      btn.classList.remove("is-copied");
      if (labelEl) labelEl.textContent = original;
    }, 1200);
    try {
      const { showToast } = await import("./core/utils.js");
      showToast(btn.dataset.copy === "prompt" ? "Prompt copied" : "Response copied");
    } catch (_) {}
  });
}

export function thinkingMessageHtml({ id, avatarHtml, scope = "meeting", cancelHtml = "" }) {
  return `
    <div class="chat-message assistant is-thinking" id="${id}">
      <div class="chat-avatar is-ai">${avatarHtml}</div>
      <div class="chat-bubble chat-bubble-thinking">
        ${pixelLoaderHtml(scope === "global" ? THINKING_LABELS_GLOBAL[0] : THINKING_LABELS_MEETING[0])}
        ${cancelHtml}
      </div>
    </div>`;
}

export function setChatSendBusy(btn, busy, iconFn) {
  if (!btn) return;
  btn.classList.toggle("is-stop", !!busy);
  btn.disabled = false;
  btn.title = busy ? "Stop generating" : "Send";
  btn.setAttribute("aria-label", busy ? "Stop generating" : "Send");
  btn.innerHTML = busy ? iconFn("square", 14) : iconFn("send", 15);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
