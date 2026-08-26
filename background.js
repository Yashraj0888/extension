// Background service worker for AI Meeting Note-Taker.
// Runs as an ES module (see manifest "type":"module") so it can share the
// exact same provider-calling code as the app UI.
import { callAI } from "./app/services/providers.js";
import { getSettings, getActivePromptText } from "./app/services/settings.js";
import AIService, { isGenericMeetingTitle, parseMeetingTitleFromSummary } from "./app/services/ai.js";
import { autoLabelMeeting } from "./app/services/meeting-tags.js";
import { generateMeetingScore, computeMeetingScore } from "./app/services/meeting-score.js";
import MeetingStore from "./app/services/meeting-store.js";
import { ensureChatIndex } from "./app/services/chat-index.js";

// Initialize default settings on install.
chrome.runtime.onInstalled.addListener(() => {
  getSettings();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "OPEN_APP") {
    chrome.tabs.create({ url: chrome.runtime.getURL("app/app.html") });
    sendResponse({ success: true });
    return false;
  }

  if (request.type === "GENERATE_NOTES") {
    handleGenerateNotes(request.data)
      .then((res) => sendResponse({ success: true, data: res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (request.type === "DOWNLOAD_DOC") {
    handleDownloadDoc(request.data)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === "AUTO_GENERATE_AND_DOWNLOAD") {
    (async () => {
      try {
        const notesRes = await handleGenerateNotes(request.data);
        // Persist summary for the app Summary tab.
        if (request.data.meetingId && notesRes.rawText) {
          await saveMeetingSummary(request.data.meetingId, notesRes.rawText);
          await maybeAutoRenameMeetingTitle(
            request.data.meetingId,
            request.data.transcript,
            notesRes.rawText,
            request.data.meetingTitle
          );
          await maybeAutoLabelMeeting(request.data.meetingId, notesRes.rawText);
          await maybeAutoScoreMeeting(request.data.meetingId, notesRes.rawText);
          MeetingStore.getMeeting(request.data.meetingId)
            .then((m) => (m ? ensureChatIndex(m) : null))
            .catch(() => {});
        }
        if (request.data.download && notesRes.rawText) {
          const settings = await getSettings();
          await handleDownloadDoc({
            text: notesRes.rawText,
            meetingTitle: notesRes.meetingTitle,
            participants: notesRes.participants,
            duration: notesRes.duration,
            format: request.data.format || settings.docFormat || "pdf",
          });
        }
        if (request.data.openApp !== false) {
          if (request.data.meetingId) {
            await chrome.storage.local.set({
              lastMeetingId: request.data.meetingId,
              openMeetingTab: "summary",
            });
          }
          chrome.tabs.create({ url: chrome.runtime.getURL("app/app.html") });
        }
        sendResponse({ success: true, data: notesRes });
      } catch (e) {
        console.error("[AI Note-Taker Background Auto-Export Error]:", e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

});

const STRUCTURED_SUMMARY_PROMPT = `You are an expert meeting assistant. Create meeting notes in PLAIN MARKDOWN (no HTML).

Use EXACTLY this section order and headings:

# Meeting Title
- ONE concise descriptive title for this meeting (4–10 words). No quotes, no "Meeting about" prefix.

# Central Theme
- 2-4 sentences on the main topic and outcome.

# Tasks
- Bulleted list of concrete work items discussed (not yet assigned if unclear).

# Action Items
- Bulleted list with rich detail per item using this exact tag format:
  **[Owner]** | **[Specific task with deliverable/context]** | **Priority: high/medium/low** | **Deadline: date or timeframe or TBD** | **Context: one sentence on why it matters**

# Tasks by Person
## [Person Name]
- Their tasks / commitments
(Repeat a ## heading for each person who has work. Skip people with none.)

Rules: No preamble. No HTML. Keep bullets tight and actionable.`;

async function saveMeetingSummary(meetingId, content) {
  const key = `ai_summaries_${meetingId}`;
  const result = await chrome.storage.local.get([key]);
  const summaries = result[key] || {};
  summaries.executive = { content, createdAt: Date.now() };
  await chrome.storage.local.set({ [key]: summaries });
  try {
    await MeetingStore.mergeParsedActionItems(meetingId, content);
  } catch (_) {}
}

async function maybeAutoRenameMeetingTitle(meetingId, transcript, summary, currentTitle) {
  const meetingKey = `meeting_${meetingId}`;
  const result = await chrome.storage.local.get([meetingKey, "meetings_meta"]);
  const meeting = result[meetingKey];
  if (!meeting || meeting.titleRenamed) return;

  const existingTitle = currentTitle || meeting.title || "";
  if (!isGenericMeetingTitle(existingTitle)) return;

  try {
    let newTitle = parseMeetingTitleFromSummary(summary);
    if (!newTitle) {
      newTitle = await AIService.generateMeetingTitle(transcript, summary, meeting);
    }
    if (!newTitle || newTitle === existingTitle) return;

    meeting.title = newTitle;
    await chrome.storage.local.set({ [meetingKey]: meeting });

    const meta = result.meetings_meta || [];
    const idx = meta.findIndex((m) => m.id === meetingId);
    if (idx >= 0) {
      meta[idx].title = newTitle;
      await chrome.storage.local.set({ meetings_meta: meta });
    }
  } catch (e) {
    console.warn("[AI Note-Taker] Title generation skipped:", e.message);
  }
}

function extractSummaryPreview(summary) {
  const lines = String(summary || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const clean = line.replace(/^[-*•]\s*/, "");
    if (clean.length > 15) return clean.slice(0, 140);
  }
  return "";
}

async function maybeAutoLabelMeeting(meetingId, summary) {
  const meetingKey = `meeting_${meetingId}`;
  const result = await chrome.storage.local.get([meetingKey, "meetings_meta"]);
  const meeting = result[meetingKey];
  if (!meeting || meeting.tagsAutoApplied) return;

  try {
    const tags = await autoLabelMeeting(meeting, summary);
    const preview = extractSummaryPreview(summary);
    meeting.tags = tags;
    meeting.tagsAutoApplied = true;
    if (preview) meeting.summaryPreview = preview;
    await chrome.storage.local.set({ [meetingKey]: meeting });

    const meta = result.meetings_meta || [];
    const idx = meta.findIndex((m) => m.id === meetingId);
    if (idx >= 0) {
      meta[idx].tags = tags;
      if (preview) meta[idx].summaryPreview = preview;
      await chrome.storage.local.set({ meetings_meta: meta });
    }
  } catch (e) {
    console.warn("[AI Note-Taker] Auto-label skipped:", e.message);
  }
}

async function maybeAutoScoreMeeting(meetingId, summaryText) {
  const meetingKey = `meeting_${meetingId}`;
  const summariesKey = `ai_summaries_${meetingId}`;
  try {
    const result = await chrome.storage.local.get([meetingKey, summariesKey]);
    const meeting = result[meetingKey];
    if (!meeting) return;
    const summaries = result[summariesKey] || {};
    if (summaryText && !summaries.executive) {
      summaries.executive = { content: summaryText, createdAt: Date.now() };
    }
    // Prefer AI-assisted score; fall back to fact-only sync score so saving never breaks.
    let pack;
    try {
      pack = await generateMeetingScore({
        ...meeting,
        _summariesCache: summaries,
        lastSummaryContent: summaryText || summaries.executive?.content || "",
      });
    } catch (e) {
      console.warn("[AI Note-Taker] AI meeting score failed, using fact score:", e.message);
      pack = computeMeetingScore({
        ...meeting,
        _summariesCache: summaries,
        lastSummaryContent: summaryText || summaries.executive?.content || "",
      });
    }
    meeting.meetingScore = pack;
    await chrome.storage.local.set({ [meetingKey]: meeting });
  } catch (e) {
    console.warn("[AI Note-Taker] Meeting score skipped:", e.message);
  }
}

async function handleGenerateNotes({
  transcript,
  meetingTitle,
  startTime,
  duration,
  participants,
  structured,
  focusSpeaker,
  summaryScope,
}) {
  const settings = await getSettings();
  const provider = settings.aiProvider || "gemini";
  const providerCfg = settings.providers?.[provider] || {};

  if (provider !== "custom" && !providerCfg.apiKey) {
    throw new Error(
      `${provider} API key is not configured. Open the extension popup or settings to add it.`
    );
  }

  let promptText = structured ? STRUCTURED_SUMMARY_PROMPT : getActivePromptText(settings);
  if (summaryScope === "personal" && focusSpeaker) {
    promptText += `\n\nIMPORTANT: Produce a personal summary for "${focusSpeaker}" only. Emphasize what they said, committed to, and owe. Still keep the required section structure. Mention other people only when needed for context.`;
  }

  const participantList = participants && participants.length ? participants.join(", ") : "Unknown";

  const fullPrompt = `${promptText}

---
MEETING INFORMATION:
Title: ${meetingTitle || "Meeting"}
Date & Time: ${startTime || new Date().toLocaleString()}
Duration: ${duration || "N/A"}
Participants: ${participantList}
${focusSpeaker ? `Focus speaker: ${focusSpeaker}` : ""}
---
TRANSCRIPT:
${transcript}`;

  const rawText = await callAI({
    provider,
    apiKey: providerCfg.apiKey,
    model: providerCfg.model,
    baseUrl: providerCfg.baseUrl,
    promptText: fullPrompt,
  });

  return {
    rawText,
    meetingTitle: meetingTitle || "Meeting",
    startTime: startTime || new Date().toLocaleString(),
    duration: duration || "N/A",
    participants: participantList,
  };
}

async function handleDownloadDoc({ text, meetingTitle, format = "pdf", participants, duration }) {
  const cleanTitle = (meetingTitle || "Meeting_Notes").replace(/[^a-zA-Z0-9_-]/g, "_");
  const dateStr = new Date().toISOString().slice(0, 10);
  const fmt = (format || "pdf").toLowerCase();

  let blob;
  let filename;
  if (fmt === "md") {
    filename = `${cleanTitle}_${dateStr}.md`;
    blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  } else if (fmt === "txt") {
    filename = `${cleanTitle}_${dateStr}.txt`;
    blob = new Blob([markdownToPlain(text)], { type: "text/plain;charset=utf-8" });
  } else if (fmt === "rtf") {
    filename = `${cleanTitle}_${dateStr}.rtf`;
    blob = new Blob([buildRtf(text, meetingTitle)], { type: "application/rtf" });
  } else if (fmt === "html") {
    filename = `${cleanTitle}_${dateStr}.html`;
    blob = new Blob([buildHtmlReport(text, meetingTitle, participants, duration)], {
      type: "text/html;charset=utf-8",
    });
  } else if (fmt === "pdf") {
    filename = `${cleanTitle}_${dateStr}.pdf`;
    blob = new Blob([buildSimplePdf(text, meetingTitle, participants, duration)], {
      type: "application/pdf",
    });
  } else {
    filename = `${cleanTitle}_${dateStr}.doc`;
    const wordXml = buildWordMl(text, meetingTitle, participants, duration);
    blob = new Blob([wordXml], { type: "application/msword" });
  }

  const dataUrl = await blobToDataUrl(blob);
  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
  });
}

function markdownToPlain(md) {
  return String(md || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^[-*]\s+/gm, "• ");
}

function buildRtf(text, meetingTitle) {
  const escapeRtf = (s) =>
    String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/\{/g, "\\{")
      .replace(/\}/g, "\\}")
      .replace(/\n/g, "\\par\n");
  const body = markdownToPlain(text);
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs22\\b Meeting Summary: ${escapeRtf(
    meetingTitle || "Meeting"
  )}\\b0\\par\\par ${escapeRtf(body)}}`;
}

function buildHtmlReport(text, meetingTitle, participants, duration) {
  const title = xmlEscape(meetingTitle || "Meeting Summary");
  const meta = [participants && `Participants: ${xmlEscape(participants)}`, duration && `Duration: ${xmlEscape(duration)}`]
    .filter(Boolean)
    .join(" · ");
  let body = xmlEscape(text || "")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^\- (.*)$/gm, "<li>$1</li>")
    .replace(/(?:<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n\n/g, "</p><p>");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px;color:#14201c;line-height:1.55}
h1{color:#0f766e;border-bottom:2px solid #0f766e;padding-bottom:8px}h2{margin-top:1.4em}li{margin:4px 0}</style></head>
<body><h1>Meeting Summary: ${title}</h1><p style="color:#6b7c75">${meta}</p><div>${body}</div></body></html>`;
}

// Minimal text PDF (no external deps) — opens in Preview / Acrobat.
function buildSimplePdf(text, meetingTitle, participants, duration) {
  const plain = [
    `Meeting Summary: ${meetingTitle || "Meeting"}`,
    [participants && `Participants: ${participants}`, duration && `Duration: ${duration}`].filter(Boolean).join("  |  "),
    "",
    markdownToPlain(text),
  ].join("\n");

  const lines = [];
  const maxLen = 90;
  for (const raw of plain.split("\n")) {
    let line = raw.replace(/[^\x09\x20-\x7E]/g, "?");
    while (line.length > maxLen) {
      lines.push(line.slice(0, maxLen));
      line = line.slice(maxLen);
    }
    lines.push(line);
  }

  const fontSize = 11;
  const leading = 14;
  const startY = 780;
  let y = startY;
  const contentParts = ["BT", "/F1 11 Tf", "50 780 Td", `${leading} TL`];
  for (let i = 0; i < lines.length; i++) {
    if (y < 50) break;
    const safe = lines[i].replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    if (i === 0) contentParts.push(`(${safe}) Tj`);
    else contentParts.push(`T* (${safe}) Tj`);
    y -= leading;
  }
  contentParts.push("ET");
  const stream = contentParts.join("\n");

  const objs = [];
  objs.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  objs.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n");
  objs.push(
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n"
  );
  objs.push(`4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`);
  objs.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objs) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return pdf;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function xmlEscape(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphXml(text, style) {
  const escaped = xmlEscape(text);
  if (style === "Title") {
    return `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>${escaped}</w:t></w:r></w:p>`;
  }
  if (style === "Heading1") {
    return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>${escaped}</w:t></w:r></w:p>`;
  }
  if (style === "Heading2") {
    return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>${escaped}</w:t></w:r></w:p>`;
  }
  if (style === "List") {
    return `<w:p><w:pPr><w:ind w:left="360"/></w:pPr><w:r><w:t xml:space="preserve">• ${escaped}</w:t></w:r></w:p>`;
  }
  return `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

function markdownToWordParagraphs(md) {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const parts = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      parts.push("<w:p/>");
      continue;
    }
    if (/^#\s+/.test(line)) {
      parts.push(paragraphXml(line.replace(/^#\s+/, ""), "Heading1"));
    } else if (/^##\s+/.test(line)) {
      parts.push(paragraphXml(line.replace(/^##\s+/, ""), "Heading2"));
    } else if (/^###\s+/.test(line)) {
      parts.push(paragraphXml(line.replace(/^###\s+/, ""), "Heading2"));
    } else if (/^[-*]\s+/.test(line)) {
      parts.push(paragraphXml(line.replace(/^[-*]\s+/, "").replace(/\*\*(.*?)\*\*/g, "$1"), "List"));
    } else {
      parts.push(paragraphXml(line.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1"), "Body"));
    }
  }
  return parts.join("");
}

function buildWordMl(text, meetingTitle, participants, duration) {
  const title = meetingTitle || "Meeting Summary";
  const metaBits = [];
  if (participants) metaBits.push(`Participants: ${participants}`);
  if (duration) metaBits.push(`Duration: ${duration}`);
  const metaLine = metaBits.length ? paragraphXml(metaBits.join("  ·  "), "Body") : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<?mso-application progid="Word.Document"?>
<w:wordDocument
  xmlns:w="http://schemas.microsoft.com/office/word/2003/wordml"
  xmlns:wx="http://schemas.microsoft.com/office/word/2003/auxHint"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xml:space="preserve">
  <o:DocumentProperties>
    <o:Title>${xmlEscape(title)}</o:Title>
    <o:Author>AfterMeet</o:Author>
  </o:DocumentProperties>
  <w:body>
    ${paragraphXml("Meeting Summary: " + title, "Title")}
    ${metaLine}
    ${markdownToWordParagraphs(text)}
  </w:body>
</w:wordDocument>`;
}
