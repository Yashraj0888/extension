// Popup script for AfterMeet
import { PROVIDER_DEFS, testConnection } from "./app/services/providers.js";
import { getSettings, saveSettings, ensureHostPermission } from "./app/services/settings.js";
import { bindCustomSelects, enhanceSelects } from "./app/custom-select.js";
import { showAlert } from "./app/ui-modal.js";
import { initTheme, bindThemeToggles, getThemePref, setThemeAnimation } from "./app/theme.js";

let currentSettings = null;
let currentProvider = "gemini";

const dom = {};

function cacheDom() {
  [
    "providerSelect", "apiKeyLabel", "apiKeyHelpLink", "apiKey", "toggleKeyVisibility",
    "baseUrlGroup", "baseUrl", "selectedModel", "customModelGroup", "customModel",
    "testConnectionBtn", "testStatus", "docFormat", "autoDownloadSummary", "saveBtn",
    "optionsBtn", "toast", "openAppBtn", "joinMeetBtn", "liveBadge",
    "liveBadgeText", "statMeetings", "statActions", "statHighlights", "openLastBtn",
    "copyActionsBtn",
  ].forEach((id) => { dom[id] = document.getElementById(id); });
}

function setHidden(el, hidden) {
  if (!el) return;
  el.hidden = !!hidden;
  // Keep custom-select wrapper in sync when wrapping a select
  const wrap = el.classList?.contains("cselect") ? el : el.closest?.(".cselect");
  if (wrap && wrap !== el) wrap.hidden = !!hidden;
}

function isVisible(el) {
  return !!(el && !el.hidden && el.style.display !== "none");
}

function showToast(message) {
  if (!dom.toast) return;
  if (message) dom.toast.textContent = message;
  dom.toast.classList.add("is-on");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    dom.toast.classList.remove("is-on");
    dom.toast.textContent = "Saved";
  }, 1600);
}

function renderProviderSelect() {
  dom.providerSelect.innerHTML = Object.values(PROVIDER_DEFS)
    .map((p) => `<option value="${p.id}" ${p.id === currentProvider ? "selected" : ""}>${p.label}</option>`)
    .join("");
  dom.providerSelect.value = currentProvider;
  dom.providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
  enhanceSelects(document);
}

function renderProviderFields() {
  const def = PROVIDER_DEFS[currentProvider];
  const cfg = currentSettings.providers[currentProvider] || {};

  dom.apiKeyLabel.textContent = def.keyLabel;
  dom.apiKey.placeholder = def.keyPlaceholder;
  dom.apiKey.value = cfg.apiKey || "";
  dom.apiKeyHelpLink.style.display = def.helpUrl ? "" : "none";
  dom.apiKeyHelpLink.href = def.helpUrl || "#";

  setHidden(dom.baseUrlGroup, !def.needsBaseUrl);
  dom.baseUrl.value = cfg.baseUrl || "";

  if (def.models.length) {
    setHidden(dom.selectedModel, false);
    const wrap = dom.selectedModel.closest(".cselect");
    if (wrap) setHidden(wrap, false);
    dom.selectedModel.innerHTML =
      def.models.map((m) => `<option value="${m.id}">${m.label}</option>`).join("") +
      `<option value="__custom__">Custom model…</option>`;
    const known = def.models.map((m) => m.id);
    if (known.includes(cfg.model)) {
      dom.selectedModel.value = cfg.model;
      setHidden(dom.customModelGroup, true);
    } else {
      dom.selectedModel.value = "__custom__";
      setHidden(dom.customModelGroup, false);
      dom.customModel.value = cfg.model || "";
    }
    dom.selectedModel.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    setHidden(dom.selectedModel, true);
    const wrap = dom.selectedModel.closest(".cselect");
    if (wrap) setHidden(wrap, true);
    setHidden(dom.customModelGroup, false);
    dom.customModel.value = cfg.model || "";
  }

  dom.testStatus.textContent = "";
  dom.testStatus.className = "popup__status";
  enhanceSelects(document);
}

function readProviderCfgFromForm() {
  const def = PROVIDER_DEFS[currentProvider];
  let model = isVisible(dom.customModelGroup)
    ? dom.customModel.value.trim()
    : dom.selectedModel.value;
  if (!model || model === "__custom__") model = def.defaultModel;
  return {
    apiKey: dom.apiKey.value.trim(),
    model,
    baseUrl: dom.baseUrl.value.trim(),
  };
}

async function loadGlanceStats() {
  chrome.storage.local.get(["meetings_meta"], async (result) => {
    const meta = result.meetings_meta || [];
    dom.statMeetings.textContent = String(meta.length);

    let actions = 0;
    let highlights = 0;
    const ids = meta.slice(0, 40).map((m) => m.id);
    if (!ids.length) {
      dom.statActions.textContent = "0";
      dom.statHighlights.textContent = "0";
      return;
    }
    const keys = ids.map((id) => "meeting_" + id);
    chrome.storage.local.get(keys, (bag) => {
      for (const id of ids) {
        const m = bag["meeting_" + id];
        if (!m) continue;
        const items = m.actionItems || [];
        actions += items.filter((a) => !a.done).length;
        highlights += (m.bookmarks || []).length;
      }
      dom.statActions.textContent = String(actions);
      dom.statHighlights.textContent = String(highlights);
    });
  });
}

async function init() {
  cacheDom();
  setThemeAnimation("circle-spread", 560);
  await initTheme();
  bindThemeToggles(document);

  currentSettings = await getSettings();
  currentProvider = currentSettings.aiProvider || "gemini";
  dom.docFormat.value = currentSettings.docFormat || "pdf";
  if (dom.autoDownloadSummary) {
    dom.autoDownloadSummary.checked = currentSettings.autoDownloadSummary !== false;
  }

  renderProviderSelect();
  renderProviderFields();
  bindCustomSelects(document);
  loadGlanceStats();

  // Reveal after selects are enhanced — prevents first-open layout swap
  document.body.classList.add("is-ready");
  // Enable theme-toggle transitions only after the first painted frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.add("theme-motion-on");
    });
  });

  dom.providerSelect.addEventListener("change", () => {
    currentProvider = dom.providerSelect.value;
    renderProviderFields();
  });

  dom.selectedModel.addEventListener("change", () => {
    setHidden(dom.customModelGroup, dom.selectedModel.value !== "__custom__");
  });

  dom.toggleKeyVisibility.addEventListener("click", () => {
    dom.apiKey.type = dom.apiKey.type === "password" ? "text" : "password";
  });

  dom.testConnectionBtn.addEventListener("click", async () => {
    const cfg = readProviderCfgFromForm();
    dom.testConnectionBtn.disabled = true;
    dom.testStatus.className = "popup__status";
    dom.testStatus.innerHTML = `<span class="popup__spinner"></span>`;
    try {
      await testConnection({ provider: currentProvider, ...cfg });
      dom.testStatus.className = "popup__status is-ok";
      dom.testStatus.textContent = "Connected";
    } catch (err) {
      dom.testStatus.className = "popup__status is-err";
      dom.testStatus.textContent = "Failed";
      console.error("[AI Note-Taker] Test connection failed:", err);
    }
    dom.testConnectionBtn.disabled = false;
  });

  dom.saveBtn.addEventListener("click", async () => {
    const cfg = readProviderCfgFromForm();
    if (currentProvider === "custom" && cfg.baseUrl) {
      await ensureHostPermission(cfg.baseUrl);
    }
    currentSettings.providers[currentProvider] = cfg;
    currentSettings.aiProvider = currentProvider;
    currentSettings.docFormat = dom.docFormat.value;
    currentSettings.autoDownloadSummary = !!dom.autoDownloadSummary.checked;
    currentSettings.theme = getThemePref();
    await saveSettings(currentSettings);
    showToast("Saved");
  });

  dom.optionsBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("app/app.html#settings") });
  });
  dom.openAppBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("app/app.html") });
  });
  dom.joinMeetBtn.addEventListener("click", () => chrome.tabs.create({ url: "https://meet.google.com/" }));

  dom.openLastBtn.addEventListener("click", () => {
    chrome.storage.local.get(["lastMeetingId", "meetings_meta"], (r) => {
      const id = r.lastMeetingId || (r.meetings_meta && r.meetings_meta[0] && r.meetings_meta[0].id);
      if (id) chrome.storage.local.set({ lastMeetingId: id });
      chrome.tabs.create({ url: chrome.runtime.getURL("app/app.html") });
    });
  });

  dom.copyActionsBtn.addEventListener("click", () => {
    chrome.storage.local.get(["meetings_meta"], (result) => {
      const meta = result.meetings_meta || [];
      const ids = meta.slice(0, 40).map((m) => m.id);
      const keys = ids.map((id) => "meeting_" + id);
      chrome.storage.local.get(keys, async (bag) => {
        const lines = [];
        for (const id of ids) {
          const m = bag["meeting_" + id];
          if (!m || !m.actionItems) continue;
          for (const a of m.actionItems) {
            if (a.done) continue;
            lines.push(`- [${m.title}] ${a.owner ? a.owner + ": " : ""}${a.text || a.title || a}`);
          }
        }
        const text = lines.length ? lines.join("\n") : "No open action items.";
        try {
          await navigator.clipboard.writeText(text);
          showToast("Actions copied");
        } catch (e) {
          await showAlert(text, { title: "Open action items", okLabel: "Close" });
        }
      });
    });
  });

  chrome.tabs.query({ url: ["https://meet.google.com/*"] }, (tabs) => {
    if (tabs.length > 0) {
      dom.liveBadge.classList.add("is-on");
      dom.liveBadgeText.textContent = "In a meeting";
      chrome.storage.local.get(["meetings_meta"], (result) => {
        const meta = result.meetings_meta || [];
        const recording = meta.find((m) => m.status === "recording");
        if (recording) dom.liveBadgeText.textContent = "Recording";
      });
    }
  });
}

init().catch((err) => {
  console.error("[AI Note-Taker] Popup init failed:", err);
  document.body.classList.add("is-ready");
});
