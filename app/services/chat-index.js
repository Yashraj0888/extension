import AIService from "./ai.js";
import MeetingStore from "./meeting-store.js";

export const CHAT_INDEX_TYPE = "chatIndex";

const inflight = new Map();

function hashText(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return (h | 0).toString(36);
}

export function transcriptFingerprint(transcript) {
  const lines = transcript || [];
  const sample = lines
    .map((e) => `${e.timestamp || ""}|${e.speaker || ""}|${e.text || ""}`)
    .join("\n");
  return `${lines.length}:${hashText(sample)}`;
}

export function isUnsatisfiedWithAnswer(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  return (
    /\b(not |un)satisfied\b/.test(t) ||
    /\b(not happy|unhappy) with\b/.test(t) ||
    /\b(that'?s|this is|it'?s) (wrong|incorrect|incomplete|inaccurate)\b/.test(t) ||
    /\byou (missed|skipped|got that wrong|didn'?t (cover|answer|mention|include))\b/.test(t) ||
    /\b(try again|regenerate|re-?scan|re-?index|re-?read|re-?do)\b/.test(t) ||
    /\b(look at|use|from|check) the (full )?transcript\b/.test(t) ||
    /\b(answer again|redo (the )?answer)\b/.test(t) ||
    /\bnot what i (asked|meant|wanted)\b/.test(t) ||
    /\b(more complete|too shallow|too vague|missing details?)\b/.test(t)
  );
}

export function lastSubstantiveUserQuestion(conv, currentText) {
  const list = conv || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const msg = list[i];
    if (msg?.role !== "user" || !msg.content) continue;
    if (msg.content === currentText) continue;
    if (isUnsatisfiedWithAnswer(msg.content)) continue;
    return String(msg.content).trim();
  }
  return String(currentText || "").trim();
}

const STOP = new Set(
  "the a an and or but for with from that this those these into onto about what who why how when where not you your they them their was were been being have has had did does will would should could just more also than then into over after before".split(
    " "
  )
);

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

/** Pull only the transcript lines that match a question — cheap local scan, no AI. */
export function relevantTranscriptExcerpts(transcript, query, { maxChars = 10000 } = {}) {
  const lines = transcript || [];
  if (!lines.length) return "";
  const keys = [...new Set(tokens(query))];
  if (!keys.length) {
    return transcriptToTextLocal(lines.slice(0, 40));
  }

  const scores = lines.map((e, i) => {
    const hay = `${e.speaker || ""} ${e.text || ""}`.toLowerCase();
    let s = 0;
    for (const k of keys) if (hay.includes(k)) s += 1;
    return { i, s };
  });
  const hits = scores.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i);
  const picked = new Set();
  for (const hit of hits) {
    for (let j = Math.max(0, hit.i - 2); j <= Math.min(lines.length - 1, hit.i + 2); j++) {
      picked.add(j);
    }
    const draft = [...picked].sort((a, b) => a - b);
    const size = draft.reduce((n, idx) => n + lineSize(lines[idx]), 0);
    if (size >= maxChars) break;
  }

  let idxs = [...picked].sort((a, b) => a - b);
  if (!idxs.length) {
    idxs = [...Array(Math.min(40, lines.length)).keys()];
  }

  const out = [];
  let last = -2;
  for (const i of idxs) {
    if (i > last + 1) out.push("…");
    out.push(`[${lines[i].timestamp || ""}] ${lines[i].speaker || ""}: ${lines[i].text || ""}`);
    last = i;
  }
  let text = out.join("\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n…";
  return text;
}

function lineSize(e) {
  return `[${e.timestamp}] ${e.speaker}: ${e.text}\n`.length;
}

function transcriptToTextLocal(lines) {
  return (lines || []).map((e) => `[${e.timestamp}] ${e.speaker}: ${e.text}`).join("\n");
}

async function readStoredIndex(meetingId) {
  const summaries = await MeetingStore.getSummaries(meetingId);
  return summaries[CHAT_INDEX_TYPE] || null;
}

export async function getChatIndex(meetingId) {
  const stored = await readStoredIndex(meetingId);
  return stored?.content || "";
}

/**
 * Build (or reuse) a detailed indexed brief of the transcript.
 * Chat answers from this instead of re-sending the full transcript.
 */
export async function ensureChatIndex(meeting, { force = false, focus = "", signal } = {}) {
  if (!meeting?.id || !(meeting.transcript || []).length) return "";

  const fp = transcriptFingerprint(meeting.transcript);
  const cacheKey = `${meeting.id}:${force ? "force" : fp}`;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const job = (async () => {
    const existing = await readStoredIndex(meeting.id);
    if (!force && existing?.content && existing.transcriptHash === fp) {
      return existing.content;
    }

    const content = await AIService.generateChatIndex(meeting.transcript, meeting, {
      focus,
      previous: force ? existing?.content || "" : "",
      signal,
    });
    if (!content) return existing?.content || "";

    await MeetingStore.saveSummary(meeting.id, CHAT_INDEX_TYPE, content, {
      transcriptHash: fp,
    });
    return content;
  })();

  inflight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    inflight.delete(cacheKey);
  }
}
