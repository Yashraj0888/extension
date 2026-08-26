// Shared confirm / alert modals (replaces window.alert / window.confirm).

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureStyles() {
  if (document.getElementById("ui-modal-styles")) return;
  const style = document.createElement("style");
  style.id = "ui-modal-styles";
  style.textContent = `
    .ui-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 100000;
      background: rgba(10, 16, 14, 0.48);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      animation: ui-modal-fade 0.16s ease;
    }
    [data-theme="dark"] .ui-modal-overlay {
      background: rgba(4, 8, 7, 0.62);
    }
    @keyframes ui-modal-fade {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .ui-modal-card {
      width: 100%;
      max-width: 380px;
      background: var(--bg-raised, #fff);
      border: 1px solid var(--border, #d8e3df);
      border-radius: 20px;
      box-shadow: 0 18px 50px rgba(16, 28, 24, 0.16);
      overflow: hidden;
      color: var(--text-primary, #14201c);
      animation: ui-modal-up 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    }
    [data-theme="dark"] .ui-modal-card {
      box-shadow: 0 22px 56px rgba(0, 0, 0, 0.42);
    }
    @keyframes ui-modal-up {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to { opacity: 1; transform: none; }
    }
    .ui-modal-icon {
      display: none;
      width: 40px;
      height: 40px;
      margin: 22px 22px 0;
      border-radius: 12px;
      place-items: center;
      background: var(--danger-soft, #fee2e2);
      color: var(--danger, #b91c1c);
    }
    .ui-modal-card.is-danger .ui-modal-icon { display: grid; }
    .ui-modal-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 14px 0 22px;
    }
    .ui-modal-card.is-danger .ui-modal-head { padding-top: 12px; }
    .ui-modal-title {
      margin: 0;
      padding-top: 4px;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--text-primary, #14201c);
      line-height: 1.25;
    }
    .ui-modal-close {
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text-muted, #6b7c75);
      cursor: pointer;
      display: grid;
      place-items: center;
      flex-shrink: 0;
      transition: background 0.14s ease, color 0.14s ease;
    }
    .ui-modal-close:hover {
      background: var(--bg-hover, #e4ebe8);
      color: var(--text-primary, #14201c);
    }
    .ui-modal-body {
      padding: 8px 22px 8px;
      font-size: 14px;
      line-height: 1.55;
      color: var(--text-secondary, #3d4f48);
    }
    .ui-modal-body p { margin: 0; }
    .ui-modal-actions {
      display: flex;
      gap: 10px;
      justify-content: stretch;
      padding: 16px 22px 22px;
      background: transparent;
      border-top: none;
    }
    .ui-modal-btn {
      flex: 1;
      min-height: 40px;
      padding: 0 14px;
      border-radius: 12px;
      font: inherit;
      font-size: 13.5px;
      font-weight: 650;
      cursor: pointer;
      border: 1px solid transparent;
      background: var(--bg-tint, #eef3f1);
      color: var(--text-secondary, #3d4f48);
      transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease, transform 0.12s ease;
    }
    [data-theme="dark"] .ui-modal-btn {
      background: rgba(255,255,255,0.06);
      color: var(--text-primary, #e8efeb);
    }
    .ui-modal-btn:hover {
      background: var(--bg-hover, #e4ebe8);
      color: var(--text-primary, #14201c);
    }
    [data-theme="dark"] .ui-modal-btn:hover {
      background: rgba(255,255,255,0.1);
    }
    .ui-modal-btn:active { transform: scale(0.98); }
    .ui-modal-btn.primary {
      border-color: transparent;
      background: var(--brand, #0f766e);
      color: #fff;
    }
    .ui-modal-btn.primary:hover {
      background: var(--brand-hover, #0d5f59);
      color: #fff;
    }
    .ui-modal-btn.danger {
      border-color: transparent;
      background: var(--danger, #b91c1c);
      color: #fff;
    }
    .ui-modal-btn.danger:hover { filter: brightness(1.06); }
    .ui-modal-input {
      width: 100%;
      box-sizing: border-box;
      height: 42px;
      padding: 0 12px;
      border-radius: 12px;
      border: 1px solid var(--border-strong, #c2d2cc);
      background: var(--bg-raised, #fff);
      color: var(--text-primary, #14201c);
      font: inherit;
      font-size: 14px;
      outline: none;
      transition: border-color 0.14s ease, box-shadow 0.14s ease;
    }
    .ui-modal-input:focus {
      border-color: var(--brand, #0f766e);
      box-shadow: 0 0 0 3px var(--brand-soft, #d8f0ec);
    }
    @media (prefers-reduced-motion: reduce) {
      .ui-modal-overlay, .ui-modal-card { animation: none !important; }
    }
  `;
  document.documentElement.appendChild(style);
}

function showDialog({ title, body, actions, danger = false }) {
  ensureStyles();
  return new Promise((resolve) => {
    const existing = document.getElementById("ui-modal-root");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "ui-modal-root";
    overlay.className = "ui-modal-overlay";
    overlay.setAttribute("role", "presentation");
    overlay.innerHTML = `
      <div class="ui-modal-card${danger ? " is-danger" : ""}" role="dialog" aria-modal="true" aria-labelledby="ui-modal-title">
        <div class="ui-modal-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </div>
        <div class="ui-modal-head">
          <h3 class="ui-modal-title" id="ui-modal-title"></h3>
          <button type="button" class="ui-modal-close" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 7 7 17"/><path d="m7 7 10 10"/></svg>
          </button>
        </div>
        <div class="ui-modal-body"></div>
        <div class="ui-modal-actions"></div>
      </div>`;

    overlay.querySelector(".ui-modal-title").textContent = title || "";
    const bodyEl = overlay.querySelector(".ui-modal-body");
    if (typeof body === "string") {
      bodyEl.innerHTML = `<p>${escapeHtml(body)}</p>`;
    } else if (body instanceof Node) {
      bodyEl.appendChild(body);
    } else {
      bodyEl.textContent = "";
    }

    const actionsEl = overlay.querySelector(".ui-modal-actions");
    const cancelAction = (actions || []).find((a) => a.id === "cancel" || a.secondary);

    const finish = (value) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(cancelAction ? cancelAction.id : false);
      }
    };
    document.addEventListener("keydown", onKey);

    overlay.querySelector(".ui-modal-close").addEventListener("click", () => {
      finish(cancelAction ? cancelAction.id : false);
    });

    for (const a of actions || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "ui-modal-btn" +
        (a.primary ? " primary" : "") +
        (a.danger ? " danger" : "") +
        (a.secondary ? " secondary" : "");
      btn.textContent = a.label;
      btn.addEventListener("click", () => finish(a.id));
      actionsEl.appendChild(btn);
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(cancelAction ? cancelAction.id : false);
    });

    (document.body || document.documentElement).appendChild(overlay);
    const primary = actionsEl.querySelector(".primary") || actionsEl.querySelector(".ui-modal-btn");
    setTimeout(() => primary?.focus(), 20);
  });
}

export function showAlert(message, { title = "Notice", okLabel = "OK" } = {}) {
  return showDialog({
    title,
    body: String(message || ""),
    actions: [{ id: "ok", label: okLabel, primary: true }],
  }).then(() => undefined);
}

export function showConfirm(
  message,
  {
    title = "Confirm",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = false,
  } = {}
) {
  return showDialog({
    title,
    body: String(message || ""),
    danger,
    actions: [
      { id: "cancel", label: cancelLabel, secondary: true },
      { id: "ok", label: confirmLabel, primary: !danger, danger },
    ],
  }).then((id) => id === "ok");
}

export async function showPrompt(
  message,
  {
    title = "Input",
    defaultValue = "",
    placeholder = "",
    okLabel = "Save",
    cancelLabel = "Cancel",
    inputType = "text",
  } = {}
) {
  ensureStyles();

  const body = document.createElement("div");
  const p = document.createElement("p");
  p.textContent = String(message || "");
  p.style.margin = "0 0 10px";
  const input = document.createElement("input");
  input.type = inputType;
  input.className = "ui-modal-input";
  input.value = defaultValue || "";
  input.placeholder = placeholder || "";
  input.autocomplete = "off";
  body.appendChild(p);
  body.appendChild(input);

  const resultPromise = showDialog({
    title,
    body,
    actions: [
      { id: "cancel", label: cancelLabel, secondary: true },
      { id: "ok", label: okLabel, primary: true },
    ],
  });

  setTimeout(() => {
    input.focus();
    input.select();
  }, 30);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.querySelector("#ui-modal-root .ui-modal-btn.primary")?.click();
    }
  });

  const id = await resultPromise;
  if (id !== "ok") return null;
  return input.value;
}

export { showDialog };
