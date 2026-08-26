// Topic Navigation — chronological major topics for transcript jump links.

import { callAI } from "./providers.js";
import { getSettings, getActiveProviderConfig } from "./settings.js";

function numberedTranscript(transcript) {
  return (transcript || [])
    .map((e, i) => `[${i}] [${e.timestamp || ""}] ${e.speaker || "Speaker"}: ${e.text || ""}`)
    .join("\n");
}

function parseTopicsJson(raw) {
  try {
    const match = String(raw || "").match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeTs(ts) {
  return String(ts || "")
    .trim()
    .replace(/^\[|\]$/g, "");
}

function timestampToSeconds(ts) {
  const s = normalizeTs(ts);
  if (!s) return null;
  const parts = s.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function findEntryIndexForTimestamp(transcript, timestamp, preferredIndex) {
  const lines = transcript || [];
  if (!lines.length) return -1;

  const target = timestampToSeconds(timestamp);
  if (target != null) {
    let best = 0;
    for (let i = 0; i < lines.length; i++) {
      const sec = timestampToSeconds(lines[i].timestamp);
      if (sec == null) continue;
      if (sec <= target) best = i;
      else break;
    }
    // Prefer AI index when it is nearby (same second clusters / adjacent lines)
    if (Number.isFinite(preferredIndex)) {
      const p = Math.round(preferredIndex);
      if (p >= 0 && p < lines.length && Math.abs(p - best) <= 3) return p;
    }
    return best;
  }

  if (Number.isFinite(preferredIndex) && preferredIndex >= 0 && preferredIndex < lines.length) {
    return Math.round(preferredIndex);
  }

  const want = normalizeTs(timestamp).toLowerCase();
  if (want) {
    const exact = lines.findIndex((e) => normalizeTs(e.timestamp).toLowerCase() === want);
    if (exact >= 0) return exact;
  }
  return 0;
}

function titlesSimilar(a, b) {
  const na = String(a || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const nb = String(b || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(" ").filter((w) => w.length > 2));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (wa.size < 2 || wb.size < 2) return false;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap += 1;
  return overlap / Math.min(wa.size, wb.size) >= 0.7;
}

function dedupeTopics(topics) {
  const out = [];
  for (const t of topics) {
    const near = out.find(
      (x) =>
        titlesSimilar(x.title, t.title) ||
        (Math.abs((x.entryIndex ?? 0) - (t.entryIndex ?? 0)) <= 1 && titlesSimilar(x.title, t.title))
    );
    if (near) continue;
    // Drop if same start index as previous
    if (out.length && out[out.length - 1].entryIndex === t.entryIndex) continue;
    out.push(t);
  }
  return out;
}

/**
 * Ask the configured AI for major chronological topics.
 * Returns a pack ready to persist on the meeting.
 */
export async function detectMeetingTopics(transcript, meetingContext = {}) {
  const settings = await getSettings();
  const cfg = getActiveProviderConfig(settings);
  if (cfg.provider !== "custom" && !cfg.apiKey) {
    throw new Error(`${cfg.provider} API key is not configured. Open Settings to add it.`);
  }

  const lines = transcript || [];
  if (lines.length < 3) {
    return {
      topics: [],
      generatedAt: new Date().toISOString(),
      emptyReason: "Transcript is too short for useful topic navigation.",
    };
  }

  const systemInstruction = `You map a meeting transcript into a short chronological list of MAJOR topics.
Respond with STRICT JSON ONLY — a JSON array, no markdown fences, no commentary.
Each element:
{
  "title": "short topic title (2–6 words)",
  "startTimestamp": "timestamp exactly as shown in the transcript (e.g. 08:24)",
  "endTimestamp": "optional end timestamp or empty string",
  "description": "one short sentence",
  "entryIndex": <integer index from the numbered transcript where this topic begins>
}

Rules:
- Only major subject shifts — typically 3–8 topics for a normal meeting.
- Avoid similar or overlapping topics; merge near-duplicates.
- Stay chronological by start time / entryIndex.
- Use ONLY timestamps and entryIndex values that exist in the transcript.
- If there are no clear topic shifts, return [].
- Do not invent content.

MEETING: ${meetingContext.title || "Meeting"}
DURATION: ${meetingContext.duration || "Unknown"}

NUMBERED TRANSCRIPT:
${numberedTranscript(lines)}`;

  const raw = await callAI({
    ...cfg,
    promptText: "Identify the major chronological topics as strict JSON.",
    systemInstruction,
  });

  const last = lines.length - 1;
  let topics = parseTopicsJson(raw)
    .map((item, i) => {
      const title = String(item.title || "").trim().slice(0, 80);
      if (!title) return null;
      const startTimestamp = normalizeTs(item.startTimestamp || item.start || "");
      const endTimestamp = normalizeTs(item.endTimestamp || item.end || "");
      const description = String(item.description || item.summary || "")
        .trim()
        .slice(0, 180);
      let entryIndex = findEntryIndexForTimestamp(lines, startTimestamp, Number(item.entryIndex));
      if (entryIndex < 0 || entryIndex > last) entryIndex = 0;
      const entry = lines[entryIndex] || {};
      return {
        id: `topic-${Date.now()}-${i}-${entryIndex}`,
        title,
        startTimestamp: startTimestamp || entry.timestamp || "",
        endTimestamp: endTimestamp || "",
        description,
        entryIndex,
      };
    })
    .filter(Boolean);

  topics.sort((a, b) => a.entryIndex - b.entryIndex);
  topics = dedupeTopics(topics);

  // Cap to avoid noise
  if (topics.length > 10) topics = topics.slice(0, 10);

  return {
    topics,
    generatedAt: new Date().toISOString(),
    emptyReason: topics.length ? "" : "No clear major topics were found in this transcript.",
  };
}

export default { detectMeetingTopics };
