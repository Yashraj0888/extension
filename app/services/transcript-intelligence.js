// Transcript Intelligence — annotate important moments without rewriting the transcript.

import { callAI } from "./providers.js";
import { getSettings, getActiveProviderConfig } from "./settings.js";

export const INTEL_TYPES = ["decision", "action", "question", "important", "risk", "mention"];

export const INTEL_TYPE_META = {
  decision: { label: "Decision", short: "Dec", color: "#0f766e" },
  action: { label: "Action", short: "Act", color: "#15803d" },
  question: { label: "Question", short: "Q", color: "#0369a1" },
  important: { label: "Important", short: "!", color: "#b45309" },
  risk: { label: "Risk", short: "Risk", color: "#b91c1c" },
  mention: { label: "Mention", short: "@", color: "#57534e" },
};

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function actionTextsSimilar(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 12 && nb.includes(na)) return true;
  if (nb.length >= 12 && na.includes(nb)) return true;
  const wa = new Set(na.split(" ").filter((w) => w.length > 2));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (wa.size < 3 || wb.size < 3) return false;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap += 1;
  const ratio = overlap / Math.min(wa.size, wb.size);
  return ratio >= 0.72;
}

export function annotationFingerprint(ann) {
  return `${ann.type}|${ann.entryIndex}|${normalizeText(ann.label).slice(0, 48)}`;
}

function numberedTranscript(transcript) {
  return (transcript || [])
    .map((e, i) => `[${i}] [${e.timestamp || ""}] ${e.speaker || "Speaker"}: ${e.text || ""}`)
    .join("\n");
}

function parseIntelligenceJson(raw) {
  try {
    const match = String(raw || "").match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeType(t) {
  const key = String(t || "")
    .toLowerCase()
    .trim();
  if (INTEL_TYPES.includes(key)) return key;
  if (key.startsWith("decid")) return "decision";
  if (key.startsWith("act")) return "action";
  if (key.startsWith("quest")) return "question";
  if (key.startsWith("import")) return "important";
  if (key.startsWith("risk") || key.startsWith("block") || key.startsWith("concern")) return "risk";
  if (key.startsWith("mention") || key.startsWith("name") || key.startsWith("person")) return "mention";
  return "";
}

/**
 * Call the configured AI provider and return raw annotation candidates.
 * Does not mutate the transcript.
 */
export async function detectTranscriptIntelligence(transcript, meetingContext = {}) {
  const settings = await getSettings();
  const cfg = getActiveProviderConfig(settings);
  if (cfg.provider !== "custom" && !cfg.apiKey) {
    throw new Error(`${cfg.provider} API key is not configured. Open Settings to add it.`);
  }

  const lines = transcript || [];
  if (lines.length === 0) {
    throw new Error("This meeting has no transcript to analyze.");
  }

  const systemInstruction = `You analyze meeting transcripts and mark important moments.
Respond with STRICT JSON ONLY — a JSON array, no markdown fences, no commentary.
Each element must be:
{
  "type": "decision" | "action" | "question" | "important" | "risk" | "mention",
  "entryIndex": <integer index from the numbered transcript>,
  "label": "short human-readable description (max ~12 words)",
  "quote": "short quote from that line supporting the label"
}

Type guide:
- decision: something was decided or agreed
- action: a concrete task / commitment / follow-up to do
- question: an open question that still matters
- important: key fact, constraint, or noteworthy statement
- risk: blocker, concern, risk, or dependency issue
- mention: notable named person, product, deadline, or resource called out

Rules:
- Use ONLY entryIndex values that exist in the transcript below.
- Prefer the most specific line; do not invent text.
- Do not rewrite the transcript — annotations only.
- Skip trivial chit-chat.
- Return [] if nothing notable.
- Cap at 40 items.

MEETING: ${meetingContext.title || "Meeting"}
PARTICIPANTS: ${(meetingContext.participants || []).join(", ") || "Unknown"}

NUMBERED TRANSCRIPT:
${numberedTranscript(lines)}`;

  const raw = await callAI({
    ...cfg,
    promptText: "Detect and label important transcript moments as strict JSON.",
    systemInstruction,
  });

  const lastIndex = lines.length - 1;
  return parseIntelligenceJson(raw)
    .map((item, i) => {
      const type = normalizeType(item.type);
      let entryIndex = Number(item.entryIndex);
      if (!Number.isFinite(entryIndex)) entryIndex = -1;
      entryIndex = Math.round(entryIndex);
      if (!type || entryIndex < 0 || entryIndex > lastIndex) return null;
      const entry = lines[entryIndex] || {};
      const label = String(item.label || item.quote || entry.text || "Detected moment")
        .trim()
        .slice(0, 140);
      const quote = String(item.quote || entry.text || "")
        .trim()
        .slice(0, 220);
      return {
        id: `ti-${Date.now()}-${i}-${entryIndex}`,
        type,
        entryIndex,
        label,
        quote,
        speaker: entry.speaker || "",
        timestamp: entry.timestamp || "",
        dismissed: false,
        linkedActionItemId: null,
        createdAt: Date.now(),
      };
    })
    .filter(Boolean);
}

/**
 * Merge new detections with prior annotations.
 * Keeps dismissed fingerprints so re-runs on older meetings do not revive rejected markers.
 * Replaces previous active markers with the latest detection set.
 */
export function mergeIntelligenceAnnotations(existingPack, detected) {
  const existing = existingPack?.annotations || [];
  const dismissed = existing.filter((a) => a.dismissed);
  const dismissedFingerprints = new Set(dismissed.map((a) => annotationFingerprint(a)));
  const dismissedLineTypes = new Set(dismissed.map((a) => `${a.type}|${a.entryIndex}`));

  const fresh = [];
  const seenLineTypes = new Set();
  for (const ann of detected) {
    const fp = annotationFingerprint(ann);
    const lineType = `${ann.type}|${ann.entryIndex}`;
    if (dismissedFingerprints.has(fp) || dismissedLineTypes.has(lineType)) continue;
    if (seenLineTypes.has(lineType)) continue;
    seenLineTypes.add(lineType);
    fresh.push(ann);
  }

  return {
    annotations: [...dismissed, ...fresh],
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * For action annotations, link to an existing action item when text matches;
 * otherwise create a new action item (no duplicates).
 */
export function syncActionAnnotations(annotations, actionItems) {
  const items = [...(actionItems || [])];
  let created = 0;
  let linked = 0;

  const nextAnns = annotations.map((ann) => {
    if (ann.dismissed || ann.type !== "action") return ann;
    if (ann.linkedActionItemId && items.some((it) => it.id === ann.linkedActionItemId)) {
      return ann;
    }
    const match = items.find((it) => actionTextsSimilar(it.text, ann.label) || actionTextsSimilar(it.text, ann.quote));
    if (match) {
      linked += 1;
      return { ...ann, linkedActionItemId: match.id };
    }
    const id = `ai-ti-${Date.now()}-${ann.entryIndex}`;
    items.push({
      id,
      text: ann.label || ann.quote || "Follow up",
      owner: "",
      deadline: "",
      priority: "",
      context: ann.quote ? `From transcript @ ${ann.timestamp || "line " + ann.entryIndex}` : "From Transcript Intelligence",
      done: false,
      fromIntelligence: true,
      sourceEntryIndex: ann.entryIndex,
    });
    created += 1;
    return { ...ann, linkedActionItemId: id };
  });

  // Backfill sourceEntryIndex on newly linked existing items
  for (const ann of nextAnns) {
    if (ann.dismissed || ann.type !== "action" || ann.linkedActionItemId == null) continue;
    const idx = items.findIndex((it) => it.id === ann.linkedActionItemId);
    if (idx >= 0 && (items[idx].sourceEntryIndex == null || items[idx].sourceEntryIndex < 0)) {
      items[idx] = { ...items[idx], sourceEntryIndex: ann.entryIndex };
    }
  }

  return { annotations: nextAnns, actionItems: items, created, linked };
}

export function activeAnnotations(pack) {
  return (pack?.annotations || []).filter((a) => !a.dismissed);
}

export function annotationsByEntry(pack) {
  const map = new Map();
  for (const ann of activeAnnotations(pack)) {
    const list = map.get(ann.entryIndex) || [];
    list.push(ann);
    map.set(ann.entryIndex, list);
  }
  return map;
}

export default {
  INTEL_TYPES,
  INTEL_TYPE_META,
  detectTranscriptIntelligence,
  mergeIntelligenceAnnotations,
  syncActionAnnotations,
  activeAnnotations,
  annotationsByEntry,
  actionTextsSimilar,
  annotationFingerprint,
};
