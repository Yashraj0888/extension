import { state, dom, icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml, escapeAttr, formatDate, stringToColor, renderMarkdown, showToast,
  debounce, autoGrowTextarea, platformIcon, getIstHour, parseDurationMinutes,
  initialsFrom, formatMeetingStamp,
} from "../core/utils.js";

import MeetingStore from "../services/meeting-store.js";
import { PROVIDER_DEFS, testConnection } from "../services/providers.js";
import {
  getSettings,
  saveSettings,
  ensureHostPermission,
  getAllTemplates,
  DEFAULT_PROMPT,
} from "../services/settings.js";
import { bindCustomSelects, enhanceSelects } from "../custom-select.js";
import { showConfirm } from "../ui-modal.js";
import {
  getBackupMode,
  hasBackupFolderAccess,
  isFolderBackupSupported,
  pickBackupFolder,
  reconnectBackupFolder,
  restoreMeetingsFromFolderInteractive,
  syncAllMeetingsToFolderAfterLink,
} from "../services/folder-backup.js";
import Calendar from "../services/calendar.js";

// === SETTINGS (providers, templates, data) ===
export async function renderSettings() {
  document.querySelectorAll("[data-settings-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.settingsTab === state.settingsTab);
    btn.onclick = () => {
      state.settingsTab = btn.dataset.settingsTab;
      renderSettings();
    };
  });

  const settings = await getSettings();
  const content = document.getElementById("settingsContent");

  if (state.settingsTab === "providers") {
    content.innerHTML = renderProvidersPanelHtml(settings);
    bindProvidersPanel(settings);
  } else if (state.settingsTab === "templates") {
    content.innerHTML = renderTemplatesPanelHtml();
    bindTemplatesPanel(settings);
  } else if (state.settingsTab === "calendar") {
    content.innerHTML = renderCalendarPanelHtml(settings);
    bindCalendarPanel(settings);
  } else if (state.settingsTab === "preferences") {
    content.innerHTML = renderPreferencesPanelHtml(settings);
    bindPreferencesPanel(settings);
  } else {
    content.innerHTML = renderDataPanelHtml(settings);
    bindDataPanel(settings);
  }
  enhanceSelects(content);
}

export function modelFieldHtml(def, cfg) {
  if (!def.models.length) {
    return `<div class="form-group"><label>Model name</label><input type="text" data-field="customModel" value="${escapeAttr(cfg.model)}" placeholder="model name" /></div>`;
  }
  const known = def.models.map((m) => m.id);
  const isCustom = cfg.model && !known.includes(cfg.model);
  return `
    <div class="form-group">
      <label>Model</label>
      <select data-field="modelSelect">
        ${def.models.map((m) => `<option value="${m.id}" ${cfg.model === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
        <option value="__custom__" ${isCustom ? "selected" : ""}>Custom model name…</option>
      </select>
    </div>
    <div class="form-group" data-custom-model-group style="${isCustom ? "" : "display:none"}">
      <label>Custom model name</label>
      <input type="text" data-field="customModel" value="${isCustom ? escapeAttr(cfg.model) : ""}" />
    </div>`;
}

export function renderProvidersPanelHtml(settings) {
  const active = settings.aiProvider || "gemini";
  const options = Object.values(PROVIDER_DEFS)
    .map((d) => `<option value="${d.id}" ${d.id === active ? "selected" : ""}>${d.label}</option>`)
    .join("");
  return `
    <div class="right-card" style="max-width:560px">
      <div class="form-group">
        <label>AI provider</label>
        <select id="activeProviderSelect" class="select-block">${options}</select>
      </div>
      <p class="empty-state-sm" style="padding-top:0;margin-bottom:12px">Choose a provider first — its key, model, and options appear below.</p>
      <div id="providerFieldsHost"></div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px;gap:8px">
        <button class="quick-btn secondary" id="testActiveProviderBtn" type="button">${icon("refresh", 14)} Test connection</button>
        <button class="quick-btn" id="saveProvidersBtn" type="button">${icon("check", 15)} Save provider</button>
      </div>
      <span class="test-status" id="providerTestStatus" style="display:block;margin-top:8px"></span>
    </div>`;
}

export function renderActiveProviderFields(settings, providerId) {
  const def = PROVIDER_DEFS[providerId];
  const cfg = settings.providers[providerId] || {};
  const host = document.getElementById("providerFieldsHost");
  if (!host || !def) return;
  host.innerHTML = `
    <div class="provider-fields" data-provider="${def.id}">
      <div class="form-group">
        <label>${def.keyLabel}${def.helpUrl ? ` · <a href="${def.helpUrl}" target="_blank" rel="noopener">get a key</a>` : ""}</label>
        <div style="display:flex;gap:6px">
          <input type="password" id="pfApiKey" class="select-block" placeholder="${def.keyPlaceholder}" value="${escapeAttr(cfg.apiKey)}" style="flex:1" />
          <button type="button" class="quick-btn secondary" id="pfToggleKey" style="padding:8px 10px">${icon("eye", 14)}</button>
        </div>
      </div>
      ${def.needsBaseUrl ? `
      <div class="form-group">
        <label>Base URL (OpenAI-compatible)</label>
        <input type="text" id="pfBaseUrl" class="select-block" placeholder="https://your-endpoint.com/v1" value="${escapeAttr(cfg.baseUrl)}" />
      </div>` : ""}
      ${modelFieldHtml(def, cfg)}
    </div>`;

  document.getElementById("pfToggleKey")?.addEventListener("click", () => {
    const input = document.getElementById("pfApiKey");
    if (input) input.type = input.type === "password" ? "text" : "password";
  });
  const modelSelect = host.querySelector('[data-field="modelSelect"]');
  if (modelSelect) {
    modelSelect.addEventListener("change", () => {
      const group = host.querySelector("[data-custom-model-group]");
      if (group) group.style.display = modelSelect.value === "__custom__" ? "" : "none";
    });
  }
  enhanceSelects(host);
}

export function readActiveProviderForm(providerId) {
  const def = PROVIDER_DEFS[providerId];
  const apiKey = (document.getElementById("pfApiKey")?.value || "").trim();
  const baseUrl = (document.getElementById("pfBaseUrl")?.value || "").trim();
  const modelSelect = document.querySelector('#providerFieldsHost [data-field="modelSelect"]');
  let model = "";
  if (modelSelect) {
    model = modelSelect.value === "__custom__"
      ? (document.querySelector('#providerFieldsHost [data-field="customModel"]')?.value || "").trim()
      : modelSelect.value;
  } else {
    model = (document.querySelector('#providerFieldsHost [data-field="customModel"]')?.value || "").trim();
  }
  if (!model) model = def.defaultModel;
  return { apiKey, model, baseUrl };
}

export function bindProvidersPanel(settings) {
  const select = document.getElementById("activeProviderSelect");
  renderActiveProviderFields(settings, select.value);
  select.addEventListener("change", () => {
    renderActiveProviderFields(settings, select.value);
    document.getElementById("providerTestStatus").textContent = "";
  });

  document.getElementById("testActiveProviderBtn").addEventListener("click", async () => {
    const providerId = select.value;
    const cfg = readActiveProviderForm(providerId);
    const statusEl = document.getElementById("providerTestStatus");
    statusEl.className = "test-status";
    statusEl.innerHTML = `<span class="spinner" style="width:12px;height:12px"></span> Testing…`;
    try {
      await testConnection({ provider: providerId, ...cfg });
      statusEl.className = "test-status ok";
      statusEl.textContent = "Connected successfully";
    } catch (err) {
      statusEl.className = "test-status err";
      statusEl.textContent = "Failed: " + err.message.slice(0, 90);
    }
  });

  document.getElementById("saveProvidersBtn").addEventListener("click", async () => {
    const providerId = select.value;
    const cfg = readActiveProviderForm(providerId);
    if (providerId === "custom" && cfg.baseUrl) await ensureHostPermission(cfg.baseUrl);
    settings.providers[providerId] = cfg;
    settings.aiProvider = providerId;
    await saveSettings(settings);
    showToast("AI provider saved");
    renderRightSettings();
  });
}

export async function renderRightSettings() {
  const el = document.getElementById("rightSettings");
  if (!el) return;
  const settings = await getSettings();
  const def = PROVIDER_DEFS[settings.aiProvider] || PROVIDER_DEFS.gemini;
  const cfg = settings.providers?.[settings.aiProvider] || {};
  el.innerHTML = `
    <div class="right-card">
      <h4 class="right-card-title">Active AI</h4>
      <p class="empty-state-sm" style="padding-top:0">${def.label}<br><strong>${escapeHtml(cfg.model || def.defaultModel || "—")}</strong></p>
    </div>
    <div class="right-card">
      <h4 class="right-card-title">Export tips</h4>
      <p class="empty-state-sm" style="padding-top:0;line-height:1.5">After a meeting you’ll be asked whether to download a summary. Formats: Word, Markdown, TXT, RTF, HTML, and PDF.</p>
    </div>
    <div class="right-card">
      <h4 class="right-card-title">Privacy</h4>
      <p class="empty-state-sm" style="padding-top:0;line-height:1.5">Keys and transcripts stay in this browser via <code>chrome.storage</code>.</p>
      <p class="empty-state-sm" id="settingsStorageNote" style="padding-top:8px;margin:0;line-height:1.5">Unlimited local storage — keep as many meetings as disk allows.</p>
    </div>`;
}

export async function openQuickSearchModal() {
  const existing = document.getElementById("collapsedSearchModal");
  if (existing) existing.remove();
  const meetings = await MeetingStore.listMeetings();
  const overlay = document.createElement("div");
  overlay.id = "collapsedSearchModal";
  overlay.className = "app-modal-overlay";
  overlay.innerHTML = `
    <div class="app-modal-card" role="dialog" aria-modal="true">
      <div class="app-modal-head">
        <h3>Find a meeting</h3>
        <button type="button" class="app-modal-close" id="csmClose">${icon("x", 16)}</button>
      </div>
      <input type="text" id="csmInput" class="csm-search-input" placeholder="Search by title or transcript…" autocomplete="off" />
      <div id="csmResults" class="csm-results"></div>
    </div>`;
  document.body.appendChild(overlay);

  const render = async (q) => {
    const query = (q || "").toLowerCase().trim();
    const box = overlay.querySelector("#csmResults");
    let list = meetings.filter((m) => !query || (m.title || "").toLowerCase().includes(query));

    if (query.length >= 2) {
      try {
        const deep = await MeetingStore.searchTranscripts(query);
        const seen = new Set(list.map((m) => m.id));
        for (const hit of deep) {
          if (!seen.has(hit.meeting.id)) {
            seen.add(hit.meeting.id);
            list.push(hit.meeting);
          }
        }
      } catch (_) {}
    }

    list = list.slice(0, 40);
    if (!list.length) {
      box.innerHTML = '<p class="empty-state-sm">No matches</p>';
      return;
    }
    box.innerHTML = list
      .map(
        (m) => `<button type="button" class="csm-item" data-id="${m.id}">
          <strong>${escapeHtml(m.title || "Untitled")}${m.isPrivate ? " · private" : ""}</strong>
          <span>${formatDate(m.date)} · ${m.participantCount || 0} people</span>
        </button>`
      )
      .join("");
    box.querySelectorAll(".csm-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        overlay.remove();
        bridge.navigate("meeting", { meetingId: btn.dataset.id, tab: "summary" });
      });
    });
  };

  const close = () => overlay.remove();
  overlay.querySelector("#csmClose").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  const input = overlay.querySelector("#csmInput");
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => render(input.value), 120);
  });
  render("");
  setTimeout(() => input.focus(), 30);
}

const openCollapsedSearchModal = openQuickSearchModal;

export function renderTemplatesPanelHtml() {
  return `
    <div class="template-pill-list" id="templatePillList"></div>
    <div class="right-card" style="max-width:720px">
      <div class="form-group">
        <label>Template name</label>
        <input type="text" id="templateName" placeholder="Template name" />
      </div>
      <div class="form-group">
        <label>Prompt</label>
        <textarea id="templatePrompt" class="settings-textarea" spellcheck="false"></textarea>
      </div>
      <div class="settings-actions">
        <button class="quick-btn" id="saveTemplateBtn">${icon("check", 14)} Save & set active</button>
        <button class="quick-btn secondary" id="setActiveTemplateBtn">Set as active</button>
        <button class="quick-btn secondary" id="newTemplateBtn">${icon("plus", 14)} New template</button>
        <button class="quick-btn secondary" id="deleteTemplateBtn" style="color:var(--danger)">Delete</button>
      </div>
      <p class="empty-state-sm" id="templateHint"></p>
    </div>`;
}

export function bindTemplatesPanel(settings) {
  function renderPills() {
    const all = getAllTemplates(settings);
    document.getElementById("templatePillList").innerHTML = all
      .map((t) => `<div class="template-pill ${t.id === state.editingTemplateId ? "active" : ""}" data-id="${t.id}">${escapeHtml(t.name)}${t.builtIn ? " · built-in" : ""}</div>`)
      .join("");
    document.querySelectorAll(".template-pill").forEach((el) => {
      el.addEventListener("click", () => loadTemplate(el.dataset.id));
    });
  }

  function loadTemplate(id) {
    const all = getAllTemplates(settings);
    const t = all.find((x) => x.id === id) || { id: null, name: "", prompt: DEFAULT_PROMPT };
    state.editingTemplateId = t.id;
    document.getElementById("templateName").value = t.name;
    document.getElementById("templatePrompt").value = t.prompt;
    const saveBtn = document.getElementById("saveTemplateBtn");
    const deleteBtn = document.getElementById("deleteTemplateBtn");
    const hint = document.getElementById("templateHint");
    if (t.builtIn) {
      saveBtn.textContent = "Duplicate as new template";
      deleteBtn.style.display = "none";
      hint.textContent = "This is a built-in template. Saving creates your own editable copy.";
    } else {
      saveBtn.innerHTML = `${icon("check", 14)} Save & set active`;
      deleteBtn.style.display = t.id ? "" : "none";
      hint.textContent = "";
    }
    renderPills();
  }

  renderPills();
  loadTemplate(settings.activeTemplateId || "default");

  document.getElementById("newTemplateBtn").addEventListener("click", () => {
    state.editingTemplateId = null;
    document.getElementById("templateName").value = "";
    document.getElementById("templatePrompt").value = "";
    document.getElementById("saveTemplateBtn").innerHTML = `${icon("check", 14)} Save & set active`;
    document.getElementById("deleteTemplateBtn").style.display = "none";
    document.getElementById("templateHint").textContent = "";
    renderPills();
  });

  document.getElementById("saveTemplateBtn").addEventListener("click", async () => {
    const name = document.getElementById("templateName").value.trim() || "Untitled template";
    const prompt = document.getElementById("templatePrompt").value;
    const all = getAllTemplates(settings);
    const existing = all.find((t) => t.id === state.editingTemplateId);

    if (existing && !existing.builtIn) {
      existing.name = name;
      existing.prompt = prompt;
      settings.activeTemplateId = existing.id;
    } else {
      const newId = "tpl-" + Date.now();
      settings.promptTemplates.push({ id: newId, name, prompt });
      settings.activeTemplateId = newId;
      state.editingTemplateId = newId;
    }
    await saveSettings(settings);
    showToast("Template saved and set active");
    renderSettings();
  });

  document.getElementById("setActiveTemplateBtn").addEventListener("click", async () => {
    if (!state.editingTemplateId) return;
    settings.activeTemplateId = state.editingTemplateId;
    await saveSettings(settings);
    showToast("Active template updated");
    renderPills();
  });

  document.getElementById("deleteTemplateBtn").addEventListener("click", async () => {
    if (!state.editingTemplateId) return;
    if (!(await showConfirm("Delete this template?", { title: "Delete template", confirmLabel: "Delete", danger: true }))) return;
    settings.promptTemplates = settings.promptTemplates.filter((t) => t.id !== state.editingTemplateId);
    if (settings.activeTemplateId === state.editingTemplateId) settings.activeTemplateId = "default";
    await saveSettings(settings);
    state.editingTemplateId = "default";
    showToast("Template deleted");
    renderSettings();
  });
}

export function renderCalendarPanelHtml(settings) {
  const redirect = Calendar.getOAuthRedirectUrl();
  const extId = Calendar.getExtensionId();
  return `
    <div class="right-card" style="max-width:640px">
      <h4 class="right-card-title">${icon("calendar", 16)} Connect Google Calendar</h4>
      <p class="empty-state-sm" style="padding-top:0;line-height:1.55">
        Link your Google Calendar to show upcoming meetings on Home. You create a free OAuth app in Google Cloud and paste the Client ID here — your credentials stay in your browser sync storage.
      </p>

      <div class="calendar-setup-steps">
        <p><strong>1.</strong> Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console → Credentials</a> (create a project if needed).</p>
        <p><strong>2.</strong> Enable the <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener">Google Calendar API</a>.</p>
        <p><strong>3.</strong> Configure the <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noopener">OAuth consent screen</a> (External → add your email as a test user).</p>
        <p><strong>4.</strong> Create credentials → <strong>OAuth client ID</strong> → type <strong>Web application</strong>.</p>
        <p><strong>5.</strong> Under <em>Authorized redirect URIs</em>, add this exact URL:</p>
        <div class="oauth-copy-row">
          <input type="text" id="calendarRedirectUri" class="select-block" readonly value="${escapeAttr(redirect)}" placeholder="https://YOUR_EXTENSION_ID.chromiumapp.org/" />
          <button type="button" class="quick-btn secondary" id="copyRedirectUriBtn">${icon("copy", 14)} Copy</button>
        </div>
        <p class="empty-state-sm" style="margin-top:8px">Extension ID: <code id="calendarExtId">${escapeHtml(extId || "reload the extension to see this")}</code></p>
        <p><strong>6.</strong> Copy the <strong>Client ID</strong> (ends in <code>.apps.googleusercontent.com</code>) and paste it below.</p>
      </div>

      <div class="form-group" style="margin-top:16px">
        <label>Google OAuth Client ID</label>
        <input type="text" id="googleOAuthClientId" class="select-block" placeholder="123456789-abc.apps.googleusercontent.com" value="${escapeAttr(settings.googleOAuthClientId || "")}" autocomplete="off" />
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
        <button class="quick-btn" id="saveCalendarOAuthBtn" type="button">${icon("check", 15)} Save Client ID</button>
        <button class="quick-btn secondary" id="connectCalendarSettingsBtn" type="button">${icon("calendar", 14)} Connect account</button>
        <button class="quick-btn secondary" id="disconnectCalendarBtn" type="button">${icon("x", 14)} Disconnect</button>
      </div>
      <p class="empty-state-sm" id="calendarConnectStatus" style="margin-top:10px"></p>
    </div>`;
}

export async function bindCalendarPanel(settings) {
  const statusEl = document.getElementById("calendarConnectStatus");
  const refreshStatus = async () => {
    if (!statusEl) return;
    const connected = await Calendar.isCalendarConnected();
    statusEl.textContent = connected
      ? "Connected — upcoming events appear on Home under Today's meetings."
      : settings.googleOAuthClientId
        ? "Client ID saved. Click Connect account to sign in with Google."
        : "Not connected. Complete the steps above and save your Client ID.";
  };
  await refreshStatus();

  const redirectInput = document.getElementById("calendarRedirectUri");
  const extIdEl = document.getElementById("calendarExtId");
  const oauthInfo = await Calendar.refreshOAuthInfoFromBackground();
  const redirect = oauthInfo.redirectUrl || Calendar.getOAuthRedirectUrl();
  const extId = oauthInfo.extensionId || Calendar.getExtensionId();
  if (redirectInput && redirect) redirectInput.value = redirect;
  if (extIdEl && extId) extIdEl.textContent = extId;

  document.getElementById("copyRedirectUriBtn")?.addEventListener("click", async () => {
    const val = document.getElementById("calendarRedirectUri")?.value || Calendar.getOAuthRedirectUrl();
    if (!val) {
      showToast("Reload the extension first, then come back to this tab");
      return;
    }
    await navigator.clipboard.writeText(val);
    showToast("Redirect URI copied");
  });

  document.getElementById("saveCalendarOAuthBtn")?.addEventListener("click", async () => {
    const val = document.getElementById("googleOAuthClientId")?.value?.trim() || "";
    settings.googleOAuthClientId = val;
    await saveSettings({ googleOAuthClientId: val });
    showToast("Client ID saved");
    await refreshStatus();
  });

  document.getElementById("connectCalendarSettingsBtn")?.addEventListener("click", async () => {
    const val = document.getElementById("googleOAuthClientId")?.value?.trim() || settings.googleOAuthClientId;
    if (!val) {
      showToast("Save your Client ID first");
      return;
    }
    settings.googleOAuthClientId = val;
    await saveSettings({ googleOAuthClientId: val });
    try {
      await Calendar.connectGoogleCalendar();
      showToast("Google Calendar connected");
      await refreshStatus();
      if (state.route === "home") bridge.renderHome();
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || "Connection failed";
      showToast(err.message || "Connection failed");
    }
  });

  document.getElementById("disconnectCalendarBtn")?.addEventListener("click", async () => {
    await Calendar.disconnectGoogleCalendar();
    showToast("Calendar disconnected");
    await refreshStatus();
    if (state.route === "home") bridge.renderHome();
  });
}

export function renderDataPanelHtml(settings) {
  const fmt = settings.docFormat || "pdf";
  return `
    <div class="settings-grid">
      <div class="right-card">
        <h4 class="right-card-title">Default export format</h4>
        <p class="empty-state-sm" style="padding-top:0;margin-bottom:10px">Used when you choose to download a summary after a meeting. You’ll always be asked first.</p>
        <select id="docFormat" class="select-block">
          <option value="doc" ${fmt === "doc" ? "selected" : ""}>Word (.doc)</option>
          <option value="md" ${fmt === "md" ? "selected" : ""}>Markdown (.md)</option>
          <option value="txt" ${fmt === "txt" ? "selected" : ""}>Plain text (.txt)</option>
          <option value="rtf" ${fmt === "rtf" ? "selected" : ""}>Rich text (.rtf)</option>
          <option value="html" ${fmt === "html" ? "selected" : ""}>HTML report (.html)</option>
          <option value="pdf" ${fmt === "pdf" ? "selected" : ""}>PDF (.pdf)</option>
        </select>
      </div>
      <div class="right-card">
        <h4 class="right-card-title">Backup & restore</h4>
        <p class="empty-state-sm">Download every meeting as a single JSON file, or link a backup folder in Settings. API keys are excluded from exports for safety.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
          <button class="quick-btn secondary" id="exportAllBtn">${icon("download", 15)} Export JSON backup</button>
          <button class="quick-btn secondary" id="linkBackupFolderBtn">${icon("upload", 15)} Link backup folder</button>
          <button class="quick-btn secondary" id="reconnectBackupBtn" hidden>${icon("refresh", 15)} Reconnect folder</button>
          <button class="quick-btn secondary" id="restoreBackupBtn" hidden>${icon("download", 15)} Restore from folder</button>
        </div>
        <p class="empty-state-sm" id="backupModeHint" style="margin-top:8px"></p>
      </div>
      <div class="right-card" style="border-color:#edc7c7">
        <h4 class="right-card-title" style="color:var(--danger)">Danger zone</h4>
        <p class="empty-state-sm">Permanently erase every meeting and setting stored by this extension.</p>
        <button class="quick-btn secondary" id="clearAllBtn" style="margin-top:6px;color:var(--danger);border-color:#edc7c7">${icon("trash", 15)} Erase all local data</button>
      </div>
      <div class="right-card">
        <h4 class="right-card-title">Google Meet support</h4>
        <p class="empty-state-sm">Live capture works on meet.google.com when captions are enabled.</p>
      </div>
    </div>`;
}

export function renderPreferencesPanelHtml(settings) {
  const row = (id, title, sub, checked) => `
    <label class="pref-toggle">
      <input type="checkbox" data-pref="${id}" ${checked ? "checked" : ""} />
      <div><strong>${title}</strong><span>${sub}</span></div>
    </label>`;
  return `
    <div class="settings-grid">
      <div class="right-card">
        <h4 class="right-card-title">Capture & launch</h4>
        ${row("autoDownloadSummary", "Offer summary download at end", "Confirm scope and format before saving.", settings.autoDownloadSummary !== false)}
        ${row("openLastMeetingOnLaunch", "Reopen last meeting on launch", "Jump back into the meeting you were viewing.", settings.openLastMeetingOnLaunch !== false)}
        ${row("collapseSidebarOnStart", "Start with collapsed sidebar", "Open the notes library in icon-rail mode.", !!settings.collapseSidebarOnStart)}
      </div>
      <div class="right-card">
        <h4 class="right-card-title">Privacy & organization</h4>
        ${row("hidePrivateFromHome", "Hide private meetings on Home", "Private meetings stay out of Home recent lists.", settings.hidePrivateFromHome !== false)}
        ${row("confirmBeforeDelete", "Confirm before deleting meetings", "Show a confirmation dialog before permanent delete.", settings.confirmBeforeDelete !== false)}
        ${row("autoPinWithActions", "Auto-pin meetings with action items", "Pin a meeting when open action items are saved.", !!settings.autoPinWithActions)}
      </div>
      <div class="right-card">
        <h4 class="right-card-title">Reading & copy</h4>
        ${row("showTranscriptTimestamps", "Show transcript timestamps", "Display timestamps next to each caption line.", settings.showTranscriptTimestamps !== false)}
        ${row("denseTranscript", "Compact transcript spacing", "Tighter line spacing for long meetings.", !!settings.denseTranscript)}
        ${row("copyIncludesTimestamps", "Include timestamps when copying", "Keep [mm:ss] prefixes in copied transcripts.", settings.copyIncludesTimestamps !== false)}
      </div>
    </div>`;
}

export function bindPreferencesPanel(settings) {
  document.querySelectorAll("[data-pref]").forEach((input) => {
    input.addEventListener("change", async () => {
      const key = input.dataset.pref;
      settings[key] = !!input.checked;
      await saveSettings({ [key]: settings[key] });
      showToast("Preference saved");
      if (key === "collapseSidebarOnStart" && settings[key] && !state.isSidebarCollapsed) {
        state.isSidebarCollapsed = true;
        dom.leftSidebar.classList.add("collapsed");
        bridge.updateCollapseIcon();
      }
      if (state.route === "meeting" && state.currentMeeting &&
          (key === "showTranscriptTimestamps" || key === "denseTranscript")) {
        await bridge.renderTranscript(state.currentMeeting);
      }
      if (state.route === "home") bridge.renderHome();
    });
  });
}

export function bindDataPanel(settings) {
  const modeHint = document.getElementById("backupModeHint");
  const reconnectBtn = document.getElementById("reconnectBackupBtn");
  const restoreBtn = document.getElementById("restoreBackupBtn");

  async function refreshBackupUi() {
    const mode = await getBackupMode();
    const linked = mode === "folder";
    const hasAccess = linked ? await hasBackupFolderAccess() : false;

    if (modeHint) {
      if (!linked) {
        modeHint.textContent = "Using local browser storage. Link a folder to survive extension reinstall.";
      } else if (hasAccess) {
        modeHint.textContent = "Folder backup is linked and active. New meetings are mirrored there automatically.";
      } else {
        modeHint.textContent = "Folder is linked but access expired. Reconnect to resume automatic backups.";
      }
    }
    if (reconnectBtn) reconnectBtn.hidden = !(linked && !hasAccess);
    if (restoreBtn) restoreBtn.hidden = !linked;
  }

  refreshBackupUi();

  document.getElementById("docFormat").addEventListener("change", async (e) => {
    settings.docFormat = e.target.value;
    await saveSettings(settings);
    showToast("Default export format updated");
  });

  document.getElementById("exportAllBtn").addEventListener("click", () => bridge.exportBackup());
  document.getElementById("linkBackupFolderBtn")?.addEventListener("click", async () => {
    if (!isFolderBackupSupported()) {
      showToast("Folder backup isn’t supported in this browser");
      return;
    }
    try {
      await pickBackupFolder();
      const { written } = await syncAllMeetingsToFolderAfterLink(MeetingStore);
      showToast(written ? `Folder linked · ${written} meeting(s) backed up` : "Backup folder linked");
      await refreshBackupUi();
    } catch (err) {
      if (err?.name === "AbortError") {
        showToast("Folder linking cancelled");
        return;
      }
      showToast("Couldn’t link backup folder");
      console.warn(err);
    }
  });

  reconnectBtn?.addEventListener("click", async () => {
    try {
      await reconnectBackupFolder();
      showToast("Folder access restored");
      await refreshBackupUi();
    } catch (err) {
      if (err?.name === "AbortError") return;
      showToast("Couldn’t reconnect folder access");
      console.warn(err);
    }
  });

  restoreBtn?.addEventListener("click", async () => {
    try {
      const { restored } = await restoreMeetingsFromFolderInteractive(MeetingStore);
      showToast(restored ? `Restored ${restored} meeting${restored === 1 ? "" : "s"}` : "No new meetings to restore");
      if (restored > 0) await bridge.renderSidebar();
      await refreshBackupUi();
    } catch (err) {
      if (err?.name === "AbortError") return;
      showToast("Couldn’t restore from folder");
      console.warn(err);
    }
  });

  document.getElementById("clearAllBtn").addEventListener("click", async () => {
    if (!(await showConfirm("This will permanently delete every meeting, transcript, and setting. Continue?", {
      title: "Erase all data",
      confirmLabel: "Erase everything",
      danger: true,
    }))) return;
    await new Promise((r) => chrome.storage.local.clear(r));
    await new Promise((r) => chrome.storage.sync.clear(r));
    showToast("All data erased");
    setTimeout(() => location.reload(), 800);
  });
}
