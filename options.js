// Full settings hub: AI providers, prompt templates, data & privacy.
import { PROVIDER_DEFS, testConnection } from "./app/services/providers.js";
import {
  getSettings,
  saveSettings,
  ensureHostPermission,
  getAllTemplates,
  DEFAULT_PROMPT,
} from "./app/services/settings.js";
import { bindCustomSelects, enhanceSelects } from "./app/custom-select.js";
import { showConfirm } from "./app/ui-modal.js";
import { initTheme, bindThemeToggles } from "./app/theme.js";

let settings = null;
let editingTemplateId = null;

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

// ============ TABS ============
function setupTabs() {
  document.querySelectorAll(".settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".settings-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".settings-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`panel-${tab.dataset.panel}`).classList.add("active");
    });
  });
}

// ============ PROVIDERS ============
function modelSelectHtml(def, cfg) {
  if (!def.models.length) return "";
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

function escapeAttr(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function renderProviderCards() {
  const container = document.getElementById("providerCards");
  const active = settings.aiProvider || "gemini";
  const options = Object.values(PROVIDER_DEFS)
    .map((d) => `<option value="${d.id}" ${d.id === active ? "selected" : ""}>${d.label}</option>`)
    .join("");
  container.innerHTML = `
    <div class="provider-card" style="max-width:640px">
      <div class="form-group">
        <label>AI provider</label>
        <select id="activeProviderSelect">${options}</select>
      </div>
      <p class="help-text" style="margin-bottom:14px">Choose a provider first — its key and model fields appear below.</p>
      <div id="providerFieldsHost"></div>
      <div class="provider-footer" style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="testActiveProviderBtn" type="button">Test connection</button>
        <span class="test-status" id="providerTestStatus"></span>
        <button class="btn btn-primary" id="saveProvidersBtn" type="button" style="margin-left:auto">Save provider</button>
      </div>
    </div>`;
  renderActiveFields(active);
  document.getElementById("activeProviderSelect").addEventListener("change", (e) => {
    renderActiveFields(e.target.value);
    document.getElementById("providerTestStatus").textContent = "";
  });
  document.getElementById("testActiveProviderBtn").addEventListener("click", async () => {
    const providerId = document.getElementById("activeProviderSelect").value;
    const cfg = readActiveForm(providerId);
    const statusEl = document.getElementById("providerTestStatus");
    statusEl.className = "test-status";
    statusEl.textContent = "Testing…";
    try {
      await testConnection({ provider: providerId, ...cfg });
      statusEl.className = "test-status ok";
      statusEl.textContent = "Connected successfully";
    } catch (err) {
      statusEl.className = "test-status err";
      statusEl.textContent = "Failed: " + err.message.slice(0, 80);
    }
  });
  document.getElementById("saveProvidersBtn").addEventListener("click", async () => {
    const providerId = document.getElementById("activeProviderSelect").value;
    const cfg = readActiveForm(providerId);
    if (providerId === "custom" && cfg.baseUrl) await ensureHostPermission(cfg.baseUrl);
    settings.providers[providerId] = cfg;
    settings.aiProvider = providerId;
    await saveSettings(settings);
    showToast("Provider saved");
  });
  enhanceSelects(container);
}

function renderActiveFields(providerId) {
  const def = PROVIDER_DEFS[providerId];
  const cfg = settings.providers[providerId] || {};
  const host = document.getElementById("providerFieldsHost");
  host.innerHTML = `
    <div class="form-group">
      <label>${def.keyLabel}${def.helpUrl ? ` · <a href="${def.helpUrl}" target="_blank" rel="noopener">get a key</a>` : ""}</label>
      <div class="key-row">
        <input type="password" data-field="apiKey" placeholder="${def.keyPlaceholder}" value="${escapeAttr(cfg.apiKey)}" />
        <button class="icon-btn-sm" data-action="toggle-visibility" type="button" title="Show/hide">
          <svg width="15" height="15" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
    </div>
    ${def.needsBaseUrl ? `
    <div class="form-group">
      <label>Base URL</label>
      <input type="text" data-field="baseUrl" placeholder="https://your-endpoint.com/v1" value="${escapeAttr(cfg.baseUrl)}" />
    </div>` : ""}
    ${modelSelectHtml(def, cfg)}`;
  host.querySelector('[data-action="toggle-visibility"]')?.addEventListener("click", () => {
    const input = host.querySelector('[data-field="apiKey"]');
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

function readActiveForm(providerId) {
  const def = PROVIDER_DEFS[providerId];
  const host = document.getElementById("providerFieldsHost");
  const apiKey = host.querySelector('[data-field="apiKey"]')?.value.trim() || "";
  const baseUrl = host.querySelector('[data-field="baseUrl"]')?.value.trim() || "";
  const modelSelect = host.querySelector('[data-field="modelSelect"]');
  let model = "";
  if (modelSelect) {
    model = modelSelect.value === "__custom__"
      ? host.querySelector('[data-field="customModel"]')?.value.trim() || ""
      : modelSelect.value;
  } else {
    model = host.querySelector('[data-field="customModel"]')?.value.trim() || "";
  }
  if (!model) model = def.defaultModel;
  return { apiKey, model, baseUrl };
}

// ============ TEMPLATES ============
function renderTemplateList() {
  const all = getAllTemplates(settings);
  const listEl = document.getElementById("templateList");
  listEl.innerHTML = all
    .map(
      (t) => `
      <div class="template-item ${t.id === editingTemplateId ? "active" : ""}" data-id="${t.id}">
        <span>${escapeAttr(t.name)}</span>
        ${t.builtIn ? '<span class="badge">Built-in</span>' : ""}
      </div>`
    )
    .join("");

  listEl.querySelectorAll(".template-item").forEach((el) => {
    el.addEventListener("click", () => loadTemplateIntoEditor(el.dataset.id));
  });
}

function loadTemplateIntoEditor(id) {
  const all = getAllTemplates(settings);
  const t = all.find((x) => x.id === id) || { id: null, name: "", prompt: DEFAULT_PROMPT };
  editingTemplateId = t.id;
  document.getElementById("templateName").value = t.name;
  document.getElementById("templatePrompt").value = t.prompt;

  const saveBtn = document.getElementById("saveTemplateBtn");
  const deleteBtn = document.getElementById("deleteTemplateBtn");
  const hint = document.getElementById("templateHint");

  if (t.builtIn) {
    saveBtn.textContent = "Duplicate as new template";
    deleteBtn.style.display = "none";
    hint.textContent = "This is a built-in template — editing and saving will create your own custom copy.";
  } else {
    saveBtn.textContent = "Save & set active";
    deleteBtn.style.display = t.id ? "" : "none";
    hint.textContent = "";
  }

  renderTemplateList();
}

async function saveCurrentTemplate() {
  const name = document.getElementById("templateName").value.trim() || "Untitled template";
  const prompt = document.getElementById("templatePrompt").value;
  const all = getAllTemplates(settings);
  const existing = all.find((t) => t.id === editingTemplateId);

  if (existing && existing.builtIn) {
    // Fork the built-in into a fresh custom template rather than mutating it.
    const newId = "tpl-" + Date.now();
    settings.promptTemplates.push({ id: newId, name, prompt });
    settings.activeTemplateId = newId;
    editingTemplateId = newId;
  } else if (existing) {
    existing.name = name;
    existing.prompt = prompt;
    settings.activeTemplateId = existing.id;
  } else {
    const newId = "tpl-" + Date.now();
    settings.promptTemplates.push({ id: newId, name, prompt });
    settings.activeTemplateId = newId;
    editingTemplateId = newId;
  }

  await saveSettings(settings);
  renderTemplateList();
  loadTemplateIntoEditor(editingTemplateId);
  showToast("Template saved and set active");
}

async function deleteCurrentTemplate() {
  if (!editingTemplateId) return;
  if (!(await showConfirm("Delete this template?", { title: "Delete template", confirmLabel: "Delete", danger: true }))) return;
  settings.promptTemplates = settings.promptTemplates.filter((t) => t.id !== editingTemplateId);
  if (settings.activeTemplateId === editingTemplateId) settings.activeTemplateId = "default";
  await saveSettings(settings);
  editingTemplateId = "default";
  renderTemplateList();
  loadTemplateIntoEditor("default");
  showToast("Template deleted");
}

async function setCurrentTemplateActive() {
  if (!editingTemplateId) return;
  settings.activeTemplateId = editingTemplateId;
  await saveSettings(settings);
  renderTemplateList();
  showToast("Active template updated");
}

// ============ DATA & PRIVACY ============
async function exportAllData() {
  const local = await new Promise((r) => chrome.storage.local.get(null, r));
  const sync = await new Promise((r) => chrome.storage.sync.get(null, r));
  // Never export raw API keys in the backup file.
  if (sync.providers) {
    for (const p of Object.values(sync.providers)) {
      if (p && p.apiKey) p.apiKey = "";
    }
  }
  const payload = { exportedAt: new Date().toISOString(), local, sync };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const reader = new FileReader();
  reader.onloadend = () => {
    chrome.downloads.download({
      url: reader.result,
      filename: `ai-meeting-notes-backup-${new Date().toISOString().slice(0, 10)}.json`,
      saveAs: true,
    });
  };
  reader.readAsDataURL(blob);
}

async function clearAllData() {
  if (!(await showConfirm("This will permanently delete every meeting, transcript, and setting. Continue?", {
    title: "Erase all data",
    confirmLabel: "Erase everything",
    danger: true,
  }))) return;
  await new Promise((r) => chrome.storage.local.clear(r));
  await new Promise((r) => chrome.storage.sync.clear(r));
  showToast("All data erased");
  setTimeout(() => location.reload(), 800);
}

// ============ INIT ============
async function init() {
  await initTheme();
  bindThemeToggles(document);
  settings = await getSettings();
  setupTabs();
  renderProviderCards();
  renderTemplateList();
  loadTemplateIntoEditor(settings.activeTemplateId || "default");

  document.getElementById("docFormat").value = settings.docFormat || "pdf";
  document.getElementById("docFormat").addEventListener("change", async (e) => {
    settings.docFormat = e.target.value;
    await saveSettings(settings);
    showToast("Default export format updated");
  });

  const autoDl = document.getElementById("autoDownloadSummary");
  autoDl.checked = settings.autoDownloadSummary !== false;
  autoDl.addEventListener("change", async () => {
    settings.autoDownloadSummary = !!autoDl.checked;
    await saveSettings(settings);
    showToast(autoDl.checked ? "Summary download enabled" : "Summary download disabled");
  });

  document.getElementById("newTemplateBtn").addEventListener("click", () => {
    editingTemplateId = null;
    document.getElementById("templateName").value = "";
    document.getElementById("templatePrompt").value = "";
    document.getElementById("saveTemplateBtn").textContent = "Save & set active";
    document.getElementById("deleteTemplateBtn").style.display = "none";
    document.getElementById("templateHint").textContent = "";
    renderTemplateList();
  });
  document.getElementById("saveTemplateBtn").addEventListener("click", saveCurrentTemplate);
  document.getElementById("deleteTemplateBtn").addEventListener("click", deleteCurrentTemplate);
  document.getElementById("setActiveBtn").addEventListener("click", setCurrentTemplateActive);

  document.getElementById("exportAllBtn").addEventListener("click", exportAllData);
  document.getElementById("clearAllBtn").addEventListener("click", clearAllData);
  bindCustomSelects(document);
}

init();
