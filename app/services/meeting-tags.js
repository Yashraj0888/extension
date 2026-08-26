// Auto-label meetings by duration + LLM topic tags from summary.

import { callAI } from "./providers.js";
import { getSettings, getActiveProviderConfig } from "./settings.js";

export const TOPIC_TAG_OPTIONS = [
  "discussion",
  "implementation plan",
  "plan",
  "standup",
  "review",
  "brainstorm",
  "decision",
  "sync",
  "demo",
  "interview",
  "training",
  "kickoff",
  "retrospective",
  "other",
];

export const DURATION_TAG_LONG = "long meet";
export const DURATION_TAG_SEMI = "semi long meet";
export const DURATION_TAG_SHORT = "short discussion";

export function getDurationTag(minutes) {
  const m = Number(minutes) || 0;
  if (m > 45) return DURATION_TAG_LONG;
  if (m >= 20 && m <= 43) return DURATION_TAG_SEMI;
  return DURATION_TAG_SHORT;
}

export function normalizeTopicTag(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!t) return "";
  const found = TOPIC_TAG_OPTIONS.find((opt) => opt === t);
  if (found) return found;
  if (/implement/.test(t)) return "implementation plan";
  if (/discuss/.test(t)) return "discussion";
  if (/plan/.test(t)) return "plan";
  if (/stand/.test(t)) return "standup";
  if (/review/.test(t)) return "review";
  if (/brain/.test(t)) return "brainstorm";
  if (/decision/.test(t)) return "decision";
  if (/sync/.test(t)) return "sync";
  if (/demo/.test(t)) return "demo";
  if (/interview/.test(t)) return "interview";
  if (/train/.test(t)) return "training";
  return "other";
}

export function mergeMeetingTags(existingTags, topicTags, durationMinutes) {
  const durationTag = getDurationTag(durationMinutes);
  const merged = new Set();

  for (const t of topicTags || []) {
    const n = normalizeTopicTag(t);
    if (n) merged.add(n);
  }
  if (!merged.size || (merged.size === 1 && merged.has("other"))) {
    merged.clear();
    merged.add("other");
  }

  merged.add(durationTag);

  for (const t of existingTags || []) {
    const n = normalizeTopicTag(t);
    if (n && n !== durationTag && TOPIC_TAG_OPTIONS.includes(n)) merged.add(n);
  }

  return [...merged];
}

function parseTagsFromLlm(raw) {
  const text = String(raw || "").trim();
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeTopicTag).filter(Boolean);
    }
  } catch (_) {}
  return [];
}

export async function generateTopicTagsFromSummary(summary, meetingContext = {}) {
  const settings = await getSettings();
  const cfg = getActiveProviderConfig(settings);
  if (cfg.provider !== "custom" && !cfg.apiKey) return ["other"];

  const options = TOPIC_TAG_OPTIONS.filter((t) => t !== "other").join(", ");
  const systemInstruction = `You label meetings with topic tags. Pick 1–3 tags from this EXACT list:
${options}

Rules:
- Return STRICT JSON array only, e.g. ["discussion","plan"]
- Use multiple tags when the meeting covers multiple themes
- If nothing fits well, return ["other"]
- Do not invent tags outside the list

Meeting: ${meetingContext.title || "Meeting"}
Summary excerpt:
${String(summary || "").slice(0, 2500)}`;

  try {
    const raw = await callAI({
      ...cfg,
      promptText: "Choose the best topic tags now.",
      systemInstruction,
    });
    const tags = parseTagsFromLlm(raw);
    return tags.length ? tags : ["other"];
  } catch (_) {
    return ["other"];
  }
}

export async function autoLabelMeeting(meeting, summary) {
  const durationMinutes =
    meeting.durationMinutes ??
    (String(meeting.duration || "").match(/(\d+)/)
      ? parseInt(String(meeting.duration).match(/(\d+)/)[1], 10)
      : 0);

  const topicTags = await generateTopicTagsFromSummary(summary, meeting);
  const tags = mergeMeetingTags(meeting.tags, topicTags, durationMinutes);
  return tags;
}

export default {
  TOPIC_TAG_OPTIONS,
  getDurationTag,
  mergeMeetingTags,
  generateTopicTagsFromSummary,
  autoLabelMeeting,
};
