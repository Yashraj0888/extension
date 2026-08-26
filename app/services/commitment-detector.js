// Commitment Detector — surface implied commitments without auto-creating tasks.

import { callAI } from "./providers.js";
import { getSettings, getActiveProviderConfig } from "./settings.js";
import { actionTextsSimilar } from "./transcript-intelligence.js";

function numberedTranscript(transcript) {
  return (transcript || [])
    .map((e, i) => `[${i}] [${e.timestamp || ""}] ${e.speaker || "Speaker"}: ${e.text || ""}`)
    .join("\n");
}

function parseCommitmentsJson(raw) {
  try {
    const match = String(raw || "").match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeConfidence(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.75) return "high";
    if (value >= 0.45) return "medium";
    return "low";
  }
  const key = String(value || "")
    .toLowerCase()
    .trim();
  if (key === "high" || key === "medium" || key === "low") return key;
  if (key.startsWith("h")) return "high";
  if (key.startsWith("m")) return "medium";
  if (key.startsWith("l")) return "low";
  return "medium";
}

function commitmentFingerprint(c) {
  const text = String(c.text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  return `${c.entryIndex}|${text}`;
}

/**
 * Ask AI for implied commitments (not auto-promoted to action items).
 */
export async function detectCommitments(transcript, meetingContext = {}) {
  const settings = await getSettings();
  const cfg = getActiveProviderConfig(settings);
  if (cfg.provider !== "custom" && !cfg.apiKey) {
    throw new Error(`${cfg.provider} API key is not configured. Open Settings to add it.`);
  }

  const lines = transcript || [];
  if (lines.length < 2) {
    return {
      commitments: [],
      analyzedAt: new Date().toISOString(),
      emptyReason: "Transcript is too short to detect commitments.",
      lastError: "",
    };
  }

  const systemInstruction = `You detect IMPLIED commitments in a meeting transcript — statements where someone commits to doing something, even when not phrased as a formal action item.
Respond with STRICT JSON ONLY — a JSON array, no markdown fences, no commentary.
Each element:
{
  "text": "clear commitment / task phrased as an actionable item",
  "person": "who committed (speaker name or named person; empty if unclear)",
  "deadline": "deadline/timeframe if mentioned (e.g. tomorrow, next week), else empty string",
  "entryIndex": <integer index from the numbered transcript>,
  "confidence": "high" | "medium" | "low",
  "quote": "short supporting quote from that line"
}

Examples of commitments to catch:
- "I'll send that tomorrow."
- "We'll get back to you."
- "Let's check this next week."
- "I can take care of the docs."
- "I'll follow up with legal."

Rules:
- Only real commitments to act — not wishes, questions, or pure decisions.
- Prefer the speaker as person when they say "I/I'll"; for "we/let's" use the speaker or named owner if clear.
- Use ONLY entryIndex values that exist in the transcript.
- Do not invent commitments.
- Skip trivial/politeness filler.
- Cap at 25 items.
- Return [] if none found.

MEETING: ${meetingContext.title || "Meeting"}
PARTICIPANTS: ${(meetingContext.participants || []).join(", ") || "Unknown"}

NUMBERED TRANSCRIPT:
${numberedTranscript(lines)}`;

  const raw = await callAI({
    ...cfg,
    promptText: "Detect implied commitments as strict JSON.",
    systemInstruction,
  });

  const last = lines.length - 1;
  const commitments = parseCommitmentsJson(raw)
    .map((item, i) => {
      let entryIndex = Number(item.entryIndex);
      if (!Number.isFinite(entryIndex)) entryIndex = -1;
      entryIndex = Math.round(entryIndex);
      if (entryIndex < 0 || entryIndex > last) return null;
      const entry = lines[entryIndex] || {};
      const text = String(item.text || item.commitment || item.task || "")
        .trim()
        .slice(0, 200);
      if (!text) return null;
      const person = String(item.person || item.owner || entry.speaker || "")
        .trim()
        .slice(0, 80);
      const deadline = String(item.deadline || "")
        .trim()
        .slice(0, 80);
      const quote = String(item.quote || entry.text || "")
        .trim()
        .slice(0, 220);
      return {
        id: `cd-${Date.now()}-${i}-${entryIndex}`,
        text,
        person,
        deadline,
        entryIndex,
        timestamp: entry.timestamp || "",
        confidence: normalizeConfidence(item.confidence),
        quote,
        dismissed: false,
        linkedActionItemId: null,
      };
    })
    .filter(Boolean);

  return {
    commitments,
    analyzedAt: new Date().toISOString(),
    emptyReason: commitments.length ? "" : "No implied commitments were found in this transcript.",
    lastError: "",
  };
}

/**
 * Merge new detections with prior pack.
 * Keeps dismissed fingerprints; hides items already linked to action items;
 * skips commitments that already match existing action-item text.
 */
export function mergeCommitmentDetections(existingPack, detectedPack, actionItems = []) {
  const existing = existingPack?.commitments || [];
  const dismissed = existing.filter((c) => c.dismissed);
  const linked = existing.filter((c) => !c.dismissed && c.linkedActionItemId);
  const dismissedFp = new Set(dismissed.map((c) => commitmentFingerprint(c)));
  const linkedByFp = new Map(linked.map((c) => [commitmentFingerprint(c), c]));

  const fresh = [];
  const seen = new Set();
  for (const c of detectedPack.commitments || []) {
    const fp = commitmentFingerprint(c);
    if (dismissedFp.has(fp) || seen.has(fp)) continue;
    seen.add(fp);

    const priorLinked = linkedByFp.get(fp);
    if (priorLinked) {
      fresh.push({ ...c, linkedActionItemId: priorLinked.linkedActionItemId, dismissed: false });
      continue;
    }

    const alreadyAction = (actionItems || []).find(
      (it) =>
        actionTextsSimilar(it.text, c.text) ||
        (c.quote && actionTextsSimilar(it.text, c.quote)) ||
        (typeof it.sourceEntryIndex === "number" &&
          it.sourceEntryIndex === c.entryIndex &&
          actionTextsSimilar(it.text, c.text))
    );
    if (alreadyAction) {
      fresh.push({ ...c, linkedActionItemId: alreadyAction.id, dismissed: false });
      continue;
    }

    fresh.push({ ...c, dismissed: false, linkedActionItemId: null });
  }

  return {
    commitments: [...dismissed, ...fresh],
    analyzedAt: detectedPack.analyzedAt || new Date().toISOString(),
    emptyReason: detectedPack.emptyReason || "",
    lastError: "",
  };
}

/** Active potential commitments (not dismissed, not yet added). */
export function activePotentialCommitments(pack) {
  return (pack?.commitments || []).filter((c) => !c.dismissed && !c.linkedActionItemId);
}

export function dismissCommitment(pack, commitmentId) {
  const commitments = (pack?.commitments || []).map((c) =>
    c.id === commitmentId ? { ...c, dismissed: true } : c
  );
  return { ...pack, commitments };
}

/**
 * Convert a commitment into an action item, or link if a duplicate already exists.
 * Returns { pack, actionItems, created, linked, item }.
 */
export function addCommitmentToActions(pack, commitmentId, actionItems = []) {
  const commitments = [...(pack?.commitments || [])];
  const idx = commitments.findIndex((c) => c.id === commitmentId);
  if (idx < 0) {
    return { pack, actionItems: [...actionItems], created: false, linked: false, item: null };
  }
  const c = commitments[idx];
  if (c.dismissed) {
    return { pack, actionItems: [...actionItems], created: false, linked: false, item: null };
  }

  const items = [...(actionItems || [])];
  if (c.linkedActionItemId && items.some((it) => it.id === c.linkedActionItemId)) {
    return {
      pack,
      actionItems: items,
      created: false,
      linked: true,
      item: items.find((it) => it.id === c.linkedActionItemId),
    };
  }

  const match = items.find(
    (it) =>
      actionTextsSimilar(it.text, c.text) ||
      (c.quote && actionTextsSimilar(it.text, c.quote))
  );
  if (match) {
    let item = match;
    if (item.sourceEntryIndex == null || item.sourceEntryIndex < 0) {
      item = {
        ...item,
        sourceEntryIndex: c.entryIndex,
        sourceTimestamp: item.sourceTimestamp || c.timestamp || "",
      };
      const mi = items.findIndex((it) => it.id === match.id);
      if (mi >= 0) items[mi] = item;
    }
    commitments[idx] = { ...c, linkedActionItemId: item.id };
    return {
      pack: { ...pack, commitments },
      actionItems: items,
      created: false,
      linked: true,
      item,
    };
  }

  const id = `ai-cd-${Date.now()}-${c.entryIndex}`;
  const item = {
    id,
    text: c.text,
    owner: c.person || "",
    deadline: c.deadline || "",
    priority: "",
    context: c.quote
      ? `Commitment from transcript @ ${c.timestamp || `line ${c.entryIndex}`}`
      : "From Commitment Detector",
    done: false,
    fromCommitment: true,
    sourceEntryIndex: c.entryIndex,
    sourceTimestamp: c.timestamp || "",
  };
  items.push(item);
  commitments[idx] = { ...c, linkedActionItemId: id };
  return {
    pack: { ...pack, commitments },
    actionItems: items,
    created: true,
    linked: false,
    item,
  };
}

export default {
  detectCommitments,
  mergeCommitmentDetections,
  activePotentialCommitments,
  dismissCommitment,
  addCommitmentToActions,
};
