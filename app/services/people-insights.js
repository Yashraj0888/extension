// People Insights — factual aggregates from meetings only (no speculative scoring).

import MeetingStore from "./meeting-store.js";
import {
  normalizeSpeakerName,
  dedupeSpeakerNames,
  stringToColor,
} from "../core/utils.js";
import { activeAnnotations } from "./transcript-intelligence.js";

export function personKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact or safe first-name match against a known roster key. */
export function namesReferToSame(a, b) {
  const ka = personKey(a);
  const kb = personKey(b);
  if (!ka || !kb || ka === "unknown" || kb === "unknown") return false;
  if (ka === kb) return true;
  const pa = ka.split(" ").filter(Boolean);
  const pb = kb.split(" ").filter(Boolean);
  if (pa.length === 1 && pb.length > 1 && pb[0] === pa[0]) return true;
  if (pb.length === 1 && pa.length > 1 && pa[0] === pb[0]) return true;
  return false;
}

/** Same talk-share math as the meeting right panel (word counts → %). */
function talkShareForMeeting(meeting) {
  const counts = {};
  for (const e of meeting.transcript || []) {
    const name = normalizeSpeakerName(e.speaker, meeting);
    const words = (e.text || "").trim().split(/\s+/).filter(Boolean).length;
    counts[name] = (counts[name] || 0) + Math.max(words, 1);
  }
  for (const p of dedupeSpeakerNames(meeting.participants, meeting)) {
    if (counts[p] == null) counts[p] = 0;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(counts)
    .map(([name, words]) => ({
      name,
      words,
      pct: Math.round((words / total) * 100),
      color: stringToColor(name),
    }))
    .sort((a, b) => b.words - a.words);
}

function findPersonBucket(map, rawName) {
  const key = personKey(rawName);
  if (!key || key === "unknown") return null;
  if (map.has(key)) return map.get(key);
  for (const [k, bucket] of map) {
    if (namesReferToSame(k, key)) return bucket;
  }
  return null;
}

function ensurePerson(map, displayName) {
  const key = personKey(displayName);
  if (!key || key === "unknown") return null;
  let bucket = findPersonBucket(map, displayName);
  if (bucket) {
    if (String(displayName).trim().length > String(bucket.name).length) {
      bucket.name = String(displayName).trim();
    }
    return bucket;
  }
  bucket = {
    key,
    name: String(displayName).trim(),
    meetings: [],
    meetingIds: new Set(),
    actions: [],
    decisions: [],
    questions: [],
    mentions: [],
  };
  map.set(key, bucket);
  return bucket;
}

function textMentionsName(text, name) {
  const hay = String(text || "");
  const needle = String(name || "").trim();
  if (!hay || !needle || needle.length < 2) return false;
  try {
    const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return re.test(hay);
  } catch (_) {
    return hay.toLowerCase().includes(needle.toLowerCase());
  }
}

function annotationInvolvesPerson(ann, personName, meeting) {
  const speaker = normalizeSpeakerName(ann.speaker, meeting);
  if (namesReferToSame(speaker, personName)) return true;
  if (textMentionsName(ann.label, personName) || textMentionsName(ann.quote, personName)) {
    return true;
  }
  return false;
}

/**
 * Build people profiles from stored meetings + action items + TI annotations.
 * No AI calls; no personality / sentiment / productivity judgments.
 */
export async function buildPeopleInsights() {
  const meta = await MeetingStore.listMeetings();
  const map = new Map();

  for (const m of meta) {
    const meeting = await MeetingStore.getMeeting(m.id);
    if (!meeting) continue;

    const roster = dedupeSpeakerNames(
      [
        ...(meeting.participants || []),
        ...((meeting.transcript || []).map((e) => e.speaker)),
      ],
      meeting
    );
    if (!roster.length) continue;

    const talk = talkShareForMeeting(meeting);
    const talkByName = new Map(talk.map((s) => [personKey(s.name), s]));

    for (const name of roster) {
      const bucket = ensurePerson(map, name);
      if (!bucket) continue;
      if (bucket.meetingIds.has(meeting.id)) continue;
      bucket.meetingIds.add(meeting.id);
      const share = talkByName.get(personKey(name)) || talk.find((s) => namesReferToSame(s.name, name));
      bucket.meetings.push({
        meetingId: meeting.id,
        title: meeting.title || m.title || "Untitled Meeting",
        date: meeting.date || m.date || "",
        platform: meeting.platform || m.platform || "meet",
        talkSharePct: share ? share.pct : null,
        talkWords: share ? share.words : null,
      });
    }

    for (const it of meeting.actionItems || []) {
      if (!(it.text || "").trim()) continue;
      const ownerRaw = String(it.owner || "").trim();
      if (!ownerRaw) continue;
      const owner = normalizeSpeakerName(ownerRaw, meeting);
      const bucket = findPersonBucket(map, owner) || ensurePerson(map, owner);
      if (!bucket) continue;
      let sourceEntryIndex =
        typeof it.sourceEntryIndex === "number" ? it.sourceEntryIndex : -1;
      if (sourceEntryIndex < 0) {
        const linked = (meeting.transcriptIntelligence?.annotations || []).find(
          (a) => !a.dismissed && a.linkedActionItemId === it.id && typeof a.entryIndex === "number"
        );
        if (linked) sourceEntryIndex = linked.entryIndex;
      }
      bucket.actions.push({
        id: it.id,
        text: it.text,
        done: !!it.done,
        deadline: it.deadline || "",
        priority: it.priority || "",
        meetingId: meeting.id,
        meetingTitle: meeting.title || m.title || "Untitled Meeting",
        meetingDate: meeting.date || m.date || "",
        sourceEntryIndex,
        sourceTimestamp: it.sourceTimestamp || "",
      });
    }

    const anns = activeAnnotations(meeting.transcriptIntelligence);
    for (const name of roster) {
      const bucket = findPersonBucket(map, name);
      if (!bucket) continue;

      for (const ann of anns) {
        if (!annotationInvolvesPerson(ann, name, meeting)) continue;
        const row = {
          id: ann.id,
          type: ann.type,
          label: ann.label || "",
          quote: ann.quote || "",
          timestamp: ann.timestamp || "",
          entryIndex: typeof ann.entryIndex === "number" ? ann.entryIndex : -1,
          meetingId: meeting.id,
          meetingTitle: meeting.title || m.title || "Untitled Meeting",
          meetingDate: meeting.date || m.date || "",
        };
        if (ann.type === "decision") bucket.decisions.push(row);
        else if (ann.type === "question") bucket.questions.push(row);
        else if (ann.type === "mention") bucket.mentions.push(row);
      }

      let perMeeting = 0;
      const lines = meeting.transcript || [];
      for (let i = 0; i < lines.length; i++) {
        if (perMeeting >= 4) break;
        const e = lines[i];
        const speaker = normalizeSpeakerName(e.speaker, meeting);
        if (namesReferToSame(speaker, name)) continue;
        if (!textMentionsName(e.text, name)) continue;
        const dup = bucket.mentions.some(
          (x) => x.meetingId === meeting.id && x.entryIndex === i
        );
        if (dup) continue;
        bucket.mentions.push({
          id: `tm-${meeting.id}-${i}`,
          type: "transcript",
          label: `Mentioned by ${speaker}`,
          quote: (e.text || "").slice(0, 180),
          timestamp: e.timestamp || "",
          entryIndex: i,
          meetingId: meeting.id,
          meetingTitle: meeting.title || m.title || "Untitled Meeting",
          meetingDate: meeting.date || m.date || "",
        });
        perMeeting += 1;
      }
    }
  }

  const people = [...map.values()].map((p) => {
    const openActions = p.actions.filter((a) => !a.done);
    const completedActions = p.actions.filter((a) => a.done);
    p.meetings.sort((a, b) => new Date(b.date) - new Date(a.date));
    p.actions.sort((a, b) => new Date(b.meetingDate) - new Date(a.meetingDate));
    p.decisions.sort((a, b) => new Date(b.meetingDate) - new Date(a.meetingDate));
    p.questions.sort((a, b) => new Date(b.meetingDate) - new Date(a.meetingDate));
    p.mentions.sort((a, b) => new Date(b.meetingDate) - new Date(a.meetingDate));
    if (p.mentions.length > 40) p.mentions = p.mentions.slice(0, 40);
    return {
      key: p.key,
      name: p.name,
      meetings: p.meetings,
      meetingCount: p.meetings.length,
      actions: p.actions,
      openActions,
      completedActions,
      openCount: openActions.length,
      completedCount: completedActions.length,
      decisions: p.decisions,
      questions: p.questions,
      mentions: p.mentions,
    };
  });

  people.sort((a, b) => {
    if (b.meetingCount !== a.meetingCount) return b.meetingCount - a.meetingCount;
    return a.name.localeCompare(b.name);
  });

  return people;
}

export default { buildPeopleInsights, personKey, namesReferToSame };
