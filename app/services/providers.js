// Multi-provider AI abstraction. Every provider exposes the same shape:
// call({ apiKey, model, baseUrl, promptText, systemInstruction }) -> Promise<string>
// This module is a plain ES module so it can be imported by both the
// background service worker (manifest declares "type": "module") and the
// app's own UI code, keeping exactly one implementation of each API call.

export const PROVIDER_DEFS = {
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    shortLabel: "Gemini",
    keyLabel: "Gemini API key",
    keyPlaceholder: "AIza...",
    helpUrl: "https://aistudio.google.com/apikey",
    // Current active models — see https://ai.google.dev/gemini-api/docs/models
    defaultModel: "gemini-3.6-flash",
    models: [
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (latest)" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI (GPT)",
    shortLabel: "GPT",
    keyLabel: "OpenAI API key",
    keyPlaceholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
    // GPT-5.6 family — see https://openai.com/index/gpt-5-6/
    defaultModel: "gpt-5.6-terra",
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol (flagship)" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra (balanced)" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna (fast)" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    ],
  },
  claude: {
    id: "claude",
    label: "Anthropic Claude",
    shortLabel: "Claude",
    keyLabel: "Anthropic API key",
    keyPlaceholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
    // Current Claude line — see https://www.anthropic.com/claude/sonnet
    defaultModel: "claude-sonnet-5",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
      { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
    ],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    shortLabel: "DeepSeek",
    keyLabel: "DeepSeek API key",
    keyPlaceholder: "sk-...",
    helpUrl: "https://platform.deepseek.com/api_keys",
    // V4 models — see https://api-docs.deepseek.com/
    defaultModel: "deepseek-v4-flash",
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    ],
  },
  custom: {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    shortLabel: "Custom endpoint",
    keyLabel: "API key",
    keyPlaceholder: "Paste key (leave blank if not required)",
    helpUrl: "",
    defaultModel: "",
    models: [],
    needsBaseUrl: true,
  },
};

function stripHtml(text) {
  return (text || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function callGemini({ apiKey, model, promptText, systemInstruction, signal }) {
  if (!apiKey) throw new Error("Gemini API key is missing.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini API error (${res.status})`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return stripHtml(text);
}

async function callOpenAICompatible({ apiKey, model, baseUrl, promptText, systemInstruction, signal }) {
  const root = (baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const url = `${root}/chat/completions`;
  const messages = [];
  if (systemInstruction) messages.push({ role: "system", content: systemInstruction });
  messages.push({ role: "user", content: promptText });
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages }),
    signal,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `API error (${res.status})`);
  }
  return stripHtml(data?.choices?.[0]?.message?.content || "");
}

async function callClaude({ apiKey, model, promptText, systemInstruction, signal }) {
  if (!apiKey) throw new Error("Anthropic API key is missing.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemInstruction || undefined,
      messages: [{ role: "user", content: promptText }],
    }),
    signal,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Claude API error (${res.status})`);
  }
  const text = (data?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return stripHtml(text);
}

async function callDeepSeek(args) {
  return callOpenAICompatible({
    ...args,
    baseUrl: args.baseUrl || "https://api.deepseek.com",
  });
}

export async function callAI({ provider, apiKey, model, baseUrl, promptText, systemInstruction, signal }) {
  const args = { apiKey, model, baseUrl, promptText, systemInstruction, signal };
  switch (provider) {
    case "gemini":
      return callGemini(args);
    case "openai":
      return callOpenAICompatible({ ...args, baseUrl: baseUrl || "https://api.openai.com/v1" });
    case "claude":
      return callClaude(args);
    case "deepseek":
      return callDeepSeek(args);
    case "custom":
      return callOpenAICompatible(args);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export function isAbortError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return true;
  return /aborted|AbortError|The user aborted/i.test(String(err.message || ""));
}

export async function testConnection({ provider, apiKey, model, baseUrl }) {
  const text = await callAI({
    provider,
    apiKey,
    model,
    baseUrl,
    promptText: "Reply with exactly: OK",
  });
  if (!text || text.length < 1) throw new Error("Empty response from provider");
  return true;
}
