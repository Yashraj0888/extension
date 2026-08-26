import { PROVIDER_DEFS } from "./providers.js";

export const DEFAULT_PROMPT = `You are an expert AI meeting assistant. Analyze the provided meeting transcript and create comprehensive, beautifully structured meeting notes in PLAIN MARKDOWN FORMAT (no HTML tags).

Follow this exact structure:
# Executive Summary
- High-level overview of the meeting topic and major outcomes.

# Key Discussion Points
- Bulleted breakdown of major topics discussed.

# Decisions Made
- Clear list of formal or informal decisions reached.

# Action Items & Next Steps
- Bulleted list specifying: [Owner] | [Task] | [Deadline if mentioned].

# Detailed Notes & Transcript Highlights
- Important quotes or detailed context.

Use markdown headings, bullets, and bold text. NEVER output HTML tags like <h1>, <div>, or <p>.`;

export const BUILT_IN_TEMPLATES = [
  { id: "default", name: "Standard notes", prompt: DEFAULT_PROMPT, builtIn: true },
  {
    id: "concise",
    name: "Concise recap",
    builtIn: true,
    prompt: `You are an expert meeting assistant. Summarize the transcript in PLAIN MARKDOWN, in under 200 words total.
# TL;DR
- 2-3 sentences max.
# Action items
- [Owner] Task (deadline if mentioned)
Keep it extremely tight. No filler, no preamble.`,
  },
  {
    id: "standup",
    name: "Daily standup",
    builtIn: true,
    prompt: `You are summarizing a daily standup. Output PLAIN MARKDOWN with one section per person who spoke:
# [Person name]
- Did: ...
- Doing: ...
- Blockers: ...
Then a final:
# Team blockers
- Bulleted list of anything blocking multiple people.`,
  },
  {
    id: "sales",
    name: "Sales call",
    builtIn: true,
    prompt: `You are a sales-ops assistant. Summarize this sales call transcript in PLAIN MARKDOWN:
# Prospect summary
- Company, role, and stated needs.
# Pain points
- Bulleted.
# Objections raised
- Bulleted, with how they were handled.
# Next steps
- [Owner] Task | Deadline
# Deal risk
- One short paragraph on likelihood to close and why.`,
  },
];

const DEFAULT_SETTINGS = {
  aiProvider: "gemini",
  providers: {
    gemini: { apiKey: "", model: PROVIDER_DEFS.gemini.defaultModel },
    openai: { apiKey: "", model: PROVIDER_DEFS.openai.defaultModel },
    claude: { apiKey: "", model: PROVIDER_DEFS.claude.defaultModel },
    deepseek: { apiKey: "", model: PROVIDER_DEFS.deepseek.defaultModel },
    custom: { apiKey: "", model: "", baseUrl: "" },
  },
  docFormat: "pdf",
  pdfExportDefaultApplied: true,
  autoDownloadSummary: true,
  askBeforeCapture: false,
  theme: "system",
  activeTemplateId: "default",
  promptTemplates: [],
  customPrompt: DEFAULT_PROMPT,
  // Preferences
  openLastMeetingOnLaunch: true,
  confirmBeforeDelete: true,
  showTranscriptTimestamps: true,
  collapseSidebarOnStart: false,
  hidePrivateFromHome: true,
  copyIncludesTimestamps: true,
  denseTranscript: false,
  autoPinWithActions: false,
  googleOAuthClientId: "",
};

function syncGet(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
}
function syncSet(items) {
  return new Promise((resolve) => chrome.storage.sync.set(items, resolve));
}

// Reads settings in the current (v3) schema, transparently migrating the
// legacy single-key ("geminiApiKey" / "selectedModel") schema used by v2.
export async function getSettings() {
  const raw = await syncGet(null);
  let changed = false;

  const settings = {
    aiProvider: raw.aiProvider || DEFAULT_SETTINGS.aiProvider,
    providers: {
      gemini: { ...DEFAULT_SETTINGS.providers.gemini, ...(raw.providers?.gemini || {}) },
      openai: { ...DEFAULT_SETTINGS.providers.openai, ...(raw.providers?.openai || {}) },
      claude: { ...DEFAULT_SETTINGS.providers.claude, ...(raw.providers?.claude || {}) },
      deepseek: { ...DEFAULT_SETTINGS.providers.deepseek, ...(raw.providers?.deepseek || {}) },
      custom: { ...DEFAULT_SETTINGS.providers.custom, ...(raw.providers?.custom || {}) },
    },
    docFormat: raw.docFormat || DEFAULT_SETTINGS.docFormat,
    pdfExportDefaultApplied: !!raw.pdfExportDefaultApplied,
    autoDownloadSummary: raw.autoDownloadSummary !== false,
    askBeforeCapture: raw.askBeforeCapture === true,
    theme: ["light", "dark", "system"].includes(raw.theme) ? raw.theme : "system",
    activeTemplateId: raw.activeTemplateId || DEFAULT_SETTINGS.activeTemplateId,
    promptTemplates: Array.isArray(raw.promptTemplates) ? raw.promptTemplates : [],
    customPrompt: raw.customPrompt || DEFAULT_SETTINGS.customPrompt,
    openLastMeetingOnLaunch: raw.openLastMeetingOnLaunch !== false,
    confirmBeforeDelete: raw.confirmBeforeDelete !== false,
    showTranscriptTimestamps: raw.showTranscriptTimestamps !== false,
    collapseSidebarOnStart: !!raw.collapseSidebarOnStart,
    hidePrivateFromHome: raw.hidePrivateFromHome !== false,
    copyIncludesTimestamps: raw.copyIncludesTimestamps !== false,
    denseTranscript: !!raw.denseTranscript,
    autoPinWithActions: !!raw.autoPinWithActions,
    googleOAuthClientId: raw.googleOAuthClientId || "",
  };

  // v2 -> v3 migration: a bare geminiApiKey/selectedModel with no providers
  // object yet means this profile predates multi-provider support.
  if (!raw.providers && raw.geminiApiKey) {
    settings.providers.gemini.apiKey = raw.geminiApiKey;
    if (raw.selectedModel) settings.providers.gemini.model = raw.selectedModel;
    changed = true;
  }

  // v3.5.6 changes the product default from Word to PDF. Apply it once to
  // existing profiles that inherited the former default; users can still
  // explicitly select another format afterward.
  if (!raw.pdfExportDefaultApplied) {
    settings.docFormat = "pdf";
    settings.pdfExportDefaultApplied = true;
    changed = true;
  }

  if (changed) await saveSettings(settings);
  return settings;
}

export async function saveSettings(patch) {
  await syncSet(patch);
}

// Custom OpenAI-compatible endpoints live on an origin we can't predict in
// advance, so we request that specific origin at save-time via Chrome's
// optional permissions API instead of declaring a blanket <all_urls> grant.
export async function ensureHostPermission(url) {
  if (!url) return true;
  let origin;
  try {
    const u = new URL(url);
    origin = `${u.protocol}//${u.hostname}/*`;
  } catch (e) {
    return false;
  }
  try {
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (has) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch (e) {
    return false;
  }
}

export function getActivePromptText(settings) {
  const all = [...BUILT_IN_TEMPLATES, ...(settings.promptTemplates || [])];
  const active = all.find((t) => t.id === settings.activeTemplateId);
  return active ? active.prompt : settings.customPrompt || DEFAULT_PROMPT;
}

export function getAllTemplates(settings) {
  return [...BUILT_IN_TEMPLATES, ...(settings.promptTemplates || [])];
}

// Convenience accessor: the {provider, apiKey, model, baseUrl} bundle ready
// to hand straight to providers.js#callAI / testConnection.
export function getActiveProviderConfig(settings) {
  const provider = settings.aiProvider || "gemini";
  const cfg = settings.providers?.[provider] || {};
  return {
    provider,
    apiKey: cfg.apiKey || "",
    model: cfg.model || PROVIDER_DEFS[provider]?.defaultModel || "",
    baseUrl: cfg.baseUrl || "",
  };
}
