// Meeting Score — AI-assisted 100-point rubric grounded in stored meeting facts.

import { callAI } from "./providers.js";
import { getSettings, getActiveProviderConfig } from "./settings.js";
import { activeAnnotations } from "./transcript-intelligence.js";

export const SCORE_VERSION = 4;

const RUBRIC = {
  decisions: 20,
  actionItems: 20,
  ownership: 20,
  deadlines: 15,
  questionsResolved: 15,
  completeness: 10,
};

/** Verbs that look like capitalized sentence starts — never treat as people. */
const NON_OWNER_WORDS = new Set(
  [
    "contact", "ask", "tell", "get", "have", "need", "update", "write", "hold",
    "create", "review", "send", "call", "email", "follow", "check", "confirm",
    "schedule", "prepare", "draft", "share", "discuss", "decide", "ensure",
    "make", "add", "set", "run", "open", "close", "fix", "move", "bring",
    "take", "keep", "leave", "start", "stop", "continue", "finish", "complete",
    "the", "this", "that", "our", "a", "an", "to", "for", "and", "we", "you",
    "they", "team", "someone", "anyone", "everybody", "everyone",
  ].map((s) => s.toLowerCase())
);

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function hasDeadline(it) {
  const d = String(it?.deadline || "").trim();
  if (!d) return false;
  if (/^tbd$/i.test(d) || /^n\/?a$/i.test(d) || /^none$/i.test(d) || /^-$/i.test(d)) {
    return false;
  }
  return true;
}

function rosterNames(meeting) {
  const names = new Set();
  for (const p of meeting?.participants || []) {
    const n = String(p || "").trim();
    if (n && !/^(you|me|unknown)$/i.test(n)) names.add(n);
  }
  for (const e of meeting?.transcript || []) {
    const n = String(e.speaker || "").trim();
    if (n && !/^(you|me|unknown)$/i.test(n)) names.add(n);
  }
  const recordedBy = String(meeting?.recordedBy || "").trim();
  if (recordedBy && !/^(you|me)$/i.test(recordedBy)) names.add(recordedBy);
  return [...names].sort((a, b) => b.length - a.length);
}

function matchRosterName(candidate, roster) {
  const c = String(candidate || "").trim();
  if (!c || c.length < 2) return "";
  if (NON_OWNER_WORDS.has(c.toLowerCase())) return "";
  const cl = c.toLowerCase();
  for (const name of roster) {
    const nl = name.toLowerCase();
    if (nl === cl) return name;
    if (nl.startsWith(cl + " ") || cl.startsWith(nl + " ")) return name;
  }
  const firstHits = roster.filter((name) => {
    const first = name.toLowerCase().split(/\s+/)[0];
    return first === cl || cl === first;
  });
  if (firstHits.length === 1) return firstHits[0];
  return "";
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveActionEntryIndex(it, meeting) {
  if (typeof it.sourceEntryIndex === "number" && it.sourceEntryIndex >= 0) {
    return it.sourceEntryIndex;
  }
  const linked = (meeting.transcriptIntelligence?.annotations || []).find(
    (a) => !a.dismissed && a.linkedActionItemId === it.id && typeof a.entryIndex === "number"
  );
  return linked ? linked.entryIndex : -1;
}

/**
 * Extract an explicit owner from action text / transcript snippets.
 * Only strong assignment patterns — never treats "Contact Dhru…" as Dhru owning.
 * Returns { owner, confidence: 'resolved'|'uncertain'|'' }.
 */
function extractOwnerFromText(text, roster, selfName) {
  const raw = String(text || "").trim();
  if (!raw) return { owner: "", confidence: "" };

  // "I'll…" / "I will…" → local user when known
  if (/^(i'|i’ll|i will|i'm going to|i am going to)\b/i.test(raw)) {
    if (selfName && !/^(you|me)$/i.test(selfName)) {
      return { owner: selfName, confidence: "resolved" };
    }
    return { owner: "", confidence: "uncertain" };
  }

  // Team / vague we — not a named owner
  if (/^(we'|we’ll|we will|let'?s|someone|anybody|anyone)\b/i.test(raw)) {
    return { owner: "", confidence: "uncertain" };
  }

  // Pronoun without antecedent
  if (/^(he|she)\s+(?:will|should|can|to|needs?\s+to|is\s+going\s+to)\b/i.test(raw)) {
    return { owner: "", confidence: "uncertain" };
  }

  // 1) Leading roster name + assignment: "Nikhil to create…", "Nikhil will…"
  for (const name of roster) {
    const re = new RegExp(
      `^${escapeRegExp(name)}\\s+(?:to|will|should|must|needs?\\s+to|is\\s+going\\s+to|gonna|can)\\b`,
      "i"
    );
    if (re.test(raw)) return { owner: name, confidence: "resolved" };
  }

  // 2) Leading capitalized person name + assignment (even if not yet on roster)
  const leading = raw.match(
    /^([A-Z][a-zA-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*){0,2})\s+(?:to|will|should|must|needs?\s+to|is\s+going\s+to|gonna)\b/
  );
  if (leading) {
    const cand = leading[1].trim();
    if (!NON_OWNER_WORDS.has(cand.toLowerCase().split(/\s+/)[0])) {
      return { owner: matchRosterName(cand, roster) || cand, confidence: "resolved" };
    }
  }

  // 3) "assigned to Name" / "Name is responsible for…" / "Name owns…"
  const responsible = raw.match(
    /\b(?:assigned\s+to|owner[:\s]+|owned\s+by)\s+([A-Z][a-zA-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*){0,2})\b/i
  );
  if (responsible) {
    const cand = responsible[1].trim();
    const matched = matchRosterName(cand, roster) || cand;
    if (matched && !NON_OWNER_WORDS.has(matched.toLowerCase().split(/\s+/)[0])) {
      return { owner: matched, confidence: "resolved" };
    }
  }
  const owns = raw.match(
    /\b([A-Z][a-zA-Z][a-zA-Z.'-]*)(?:'s|’s)?\s+(?:going\s+to|gonna|responsible|owns?|owning)\b/
  );
  if (owns) {
    const cand = owns[1].trim();
    if (!NON_OWNER_WORDS.has(cand.toLowerCase())) {
      return { owner: matchRosterName(cand, roster) || cand, confidence: "resolved" };
    }
  }

  // 4) "ask/tell/need Name to <do work>" → Name is the doer (owner)
  //    NOT "ask Name for <thing>" / "Contact Name to obtain…" (Name is a contact target)
  const askDoer = raw.match(
    /\b(?:ask|tell|need|get|have|want)\s+([A-Z][a-zA-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*){0,2})\s+to\s+(?!me\b|us\b|him\b|her\b)([a-z]+)\b/i
  );
  if (askDoer) {
    const cand = askDoer[1].trim();
    const nextVerb = String(askDoer[2] || "").toLowerCase();
    // "ask Dhru for" won't match (uses for). "Contact Dhru to obtain" uses Contact≠ask list.
    if (!NON_OWNER_WORDS.has(cand.toLowerCase().split(/\s+/)[0]) && nextVerb !== "for") {
      return { owner: matchRosterName(cand, roster) || cand, confidence: "resolved" };
    }
  }

  // Roster-first-name at start without verb already handled; "Nikhil create …" rare form
  for (const name of roster) {
    const re = new RegExp(`^${escapeRegExp(name)}\\b`, "i");
    if (re.test(raw)) {
      // Only if followed by a clear task verb (not "and", punctuation only)
      const after = new RegExp(
        `^${escapeRegExp(name)}\\s+(?:to\\s+)?(?:create|write|update|ask|hold|send|fix|review|prepare|draft|share|call|email|check|confirm|schedule)\\b`,
        "i"
      );
      if (after.test(raw)) return { owner: name, confidence: "resolved" };
    }
  }

  return { owner: "", confidence: "" };
}

function surroundingTranscriptText(meeting, entryIndex, radius = 2) {
  const lines = meeting?.transcript || [];
  if (!lines.length || entryIndex < 0) return "";
  const start = Math.max(0, entryIndex - radius);
  const end = Math.min(lines.length - 1, entryIndex + radius);
  const chunks = [];
  for (let i = start; i <= end; i++) {
    const e = lines[i];
    chunks.push(`${e.speaker || ""}: ${e.text || ""}`);
  }
  return chunks.join("\n");
}

/**
 * Resolve ownership for scoring. Never marks "no owner" when transcript/text
 * clearly assigns a person. Ambiguous cases become "uncertain".
 * Does not invent owners from weak surrounding chatter.
 */
export function resolveActionOwnership(it, meeting) {
  const text = String(it?.text || "").trim();
  const storedOwner = String(it?.owner || "").trim();
  const entryIndex = resolveActionEntryIndex(it, meeting);
  const entry =
    entryIndex >= 0 && meeting.transcript?.[entryIndex] ? meeting.transcript[entryIndex] : null;
  const roster = rosterNames(meeting);
  const selfName = String(meeting?.recordedBy || "").trim() || "";

  // 1) Strong assignment in the action text wins ("Nikhil to create…")
  const fromText = extractOwnerFromText(text, roster, selfName);
  if (fromText.confidence === "resolved" && fromText.owner) {
    return {
      owner: fromText.owner,
      ownership: "owned",
      ownerSource: "action-text",
      entryIndex,
      timestamp: it.sourceTimestamp || entry?.timestamp || "",
    };
  }

  // 2) Explicit stored owner when it looks like a real name (not TBD)
  if (storedOwner && !/^(tbd|n\/?a|none|-|unknown|uncertain)$/i.test(storedOwner)) {
    const matched = matchRosterName(storedOwner, roster) || storedOwner;
    if (!NON_OWNER_WORDS.has(matched.toLowerCase().split(/\s+/)[0])) {
      return {
        owner: matched,
        ownership: "owned",
        ownerSource: "field",
        entryIndex,
        timestamp: it.sourceTimestamp || entry?.timestamp || "",
      };
    }
  }

  if (fromText.confidence === "uncertain") {
    return {
      owner: "",
      ownership: "uncertain",
      ownerSource: "action-text",
      entryIndex,
      timestamp: it.sourceTimestamp || entry?.timestamp || "",
    };
  }

  // 3) Exact source transcript line only (not broad context guesses)
  if (entry?.text) {
    const lineText = String(entry.text).trim();
    const fromLine = extractOwnerFromText(lineText, roster, selfName);
    if (fromLine.confidence === "resolved" && fromLine.owner) {
      return {
        owner: fromLine.owner,
        ownership: "owned",
        ownerSource: "transcript-line",
        entryIndex,
        timestamp: it.sourceTimestamp || entry.timestamp || "",
      };
    }
    // "I'll…" on a line → that speaker is the owner
    if (/^(i'|i’ll|i will|i'm going to|i am going to)\b/i.test(lineText)) {
      const speaker = String(entry.speaker || "").trim();
      if (speaker && !/^(you|me|unknown)$/i.test(speaker)) {
        return {
          owner: speaker,
          ownership: "owned",
          ownerSource: "transcript-speaker",
          entryIndex,
          timestamp: entry.timestamp || "",
        };
      }
    }
    if (fromLine.confidence === "uncertain") {
      return {
        owner: "",
        ownership: "uncertain",
        ownerSource: "transcript-line",
        entryIndex,
        timestamp: entry.timestamp || "",
      };
    }
  }

  // 3) Tight surrounding context — only strong "Name to/will" on a single line
  const ctx = surroundingTranscriptText(meeting, entryIndex, 2);
  if (ctx) {
    const lines = ctx.split("\n");
    for (const line of lines) {
      const body = line.replace(/^[^:]+:\s*/, "");
      const fromCtx = extractOwnerFromText(body, roster, selfName);
      if (fromCtx.confidence === "resolved" && fromCtx.owner) {
        // Only accept if the resolved owner string also appears in the action text
        // OR the context line clearly restates this action (shared significant words)
        const ownerInAction = new RegExp(`\\b${escapeRegExp(fromCtx.owner.split(/\s+/)[0])}\\b`, "i").test(
          text
        );
        if (ownerInAction) {
          return {
            owner: fromCtx.owner,
            ownership: "owned",
            ownerSource: "transcript-context",
            entryIndex,
            timestamp: it.sourceTimestamp || entry?.timestamp || "",
          };
        }
      }
    }
  }

  // 4) Genuinely unknown — do not guess
  return {
    owner: "",
    ownership: "missing",
    ownerSource: "none",
    entryIndex,
    timestamp: it.sourceTimestamp || entry?.timestamp || "",
  };
}

function actionDetail(it, meeting) {
  const resolved = resolveActionOwnership(it, meeting);
  const entryIndex = resolved.entryIndex;
  const entry =
    entryIndex >= 0 && meeting.transcript?.[entryIndex] ? meeting.transcript[entryIndex] : null;
  return {
    id: it.id,
    text: String(it.text || "").trim(),
    owner: resolved.owner || String(it.owner || "").trim(),
    ownership: resolved.ownership,
    ownerSource: resolved.ownerSource,
    deadline: String(it.deadline || "").trim(),
    done: !!it.done,
    timestamp: resolved.timestamp || it.sourceTimestamp || entry?.timestamp || "",
    entryIndex,
  };
}

function questionDetail(ann) {
  return {
    id: ann.id,
    text: String(ann.label || ann.quote || "Open question").trim(),
    quote: String(ann.quote || "").trim(),
    timestamp: ann.timestamp || "",
    entryIndex: typeof ann.entryIndex === "number" ? ann.entryIndex : -1,
    speaker: ann.speaker || "",
  };
}

function decisionDetail(ann) {
  return {
    id: ann.id,
    text: String(ann.label || ann.quote || "Decision").trim(),
    quote: String(ann.quote || "").trim(),
    timestamp: ann.timestamp || "",
    entryIndex: typeof ann.entryIndex === "number" ? ann.entryIndex : -1,
    speaker: ann.speaker || "",
  };
}

/**
 * Final pass: only keep actions in missingOwners when still genuinely ownerless
 * after re-checking text + transcript. Anything newly resolved moves out.
 */
function validateOwnerBuckets(actions, meeting) {
  const withOwners = [];
  const missingOwners = [];
  const uncertainOwners = [];

  for (const a of actions) {
    // Re-resolve from original meeting item when possible
    const raw = (meeting.actionItems || []).find((it) => it.id === a.id) || a;
    const resolved = resolveActionOwnership(raw, meeting);
    const detail = {
      ...a,
      owner: resolved.owner || a.owner || "",
      ownership: resolved.ownership,
      ownerSource: resolved.ownerSource,
      timestamp: resolved.timestamp || a.timestamp,
      entryIndex: resolved.entryIndex >= 0 ? resolved.entryIndex : a.entryIndex,
    };

    if (detail.ownership === "owned" && detail.owner) {
      withOwners.push(detail);
    } else if (detail.ownership === "uncertain") {
      uncertainOwners.push(detail);
    } else {
      // Extra guard: if action text still clearly names a person, do not call it ownerless
      const roster = rosterNames(meeting);
      const selfName = String(meeting?.recordedBy || "").trim();
      const again = extractOwnerFromText(detail.text, roster, selfName);
      if (again.confidence === "resolved" && again.owner) {
        withOwners.push({
          ...detail,
          owner: again.owner,
          ownership: "owned",
          ownerSource: "action-text-recheck",
        });
      } else if (again.confidence === "uncertain") {
        uncertainOwners.push({ ...detail, ownership: "uncertain", ownerSource: "action-text-recheck" });
      } else {
        missingOwners.push({ ...detail, ownership: "missing", owner: "" });
      }
    }
  }

  return { withOwners, missingOwners, uncertainOwners };
}

/**
 * Collect score evidence strictly from stored meeting data (no invented counts).
 */
export function collectScoreEvidence(meeting) {
  const actions = (meeting.actionItems || [])
    .filter((it) => String(it.text || "").trim())
    .map((it) => actionDetail(it, meeting));

  const anns = activeAnnotations(meeting.transcriptIntelligence);
  const decisions = anns.filter((a) => a.type === "decision").map(decisionDetail);
  const openQuestions = anns.filter((a) => a.type === "question").map(questionDetail);

  const { withOwners, missingOwners, uncertainOwners } = validateOwnerBuckets(actions, meeting);
  const withDeadlines = actions.filter((a) => hasDeadline(a));
  const missingDeadlines = actions.filter((a) => !hasDeadline(a));

  // Keep actions list in sync with resolved owners for display
  const byId = new Map(
    [...withOwners, ...uncertainOwners, ...missingOwners].map((a) => [a.id, a])
  );
  const syncedActions = actions.map((a) => byId.get(a.id) || a);

  const topics = meeting.topicNavigation?.topics || [];

  return {
    decisions,
    actions: syncedActions,
    withOwners,
    missingOwners,
    uncertainOwners,
    withDeadlines,
    missingDeadlines,
    openQuestions,
    topicCount: topics.length,
    transcriptLength: (meeting.transcript || []).length,
    title: meeting.title || "Meeting",
  };
}

function pointsDecisions(count) {
  if (count <= 0) return 0;
  if (count === 1) return 10;
  if (count === 2) return 16;
  return RUBRIC.decisions;
}

function pointsActionItems(count) {
  if (count <= 0) return 0;
  if (count === 1) return 8;
  if (count === 2) return 14;
  return RUBRIC.actionItems;
}

function pointsOwnership(actionCount, withOwnerCount, uncertainCount = 0) {
  if (actionCount <= 0) return Math.round(RUBRIC.ownership * 0.5);
  // Uncertain counts as half-owned — never as ownerless
  const weighted = withOwnerCount + uncertainCount * 0.5;
  return clamp((weighted / actionCount) * RUBRIC.ownership, 0, RUBRIC.ownership);
}

function pointsDeadlines(actionCount, withDeadlineCount) {
  if (actionCount <= 0) return Math.round(RUBRIC.deadlines * 0.5);
  return clamp((withDeadlineCount / actionCount) * RUBRIC.deadlines, 0, RUBRIC.deadlines);
}

function pointsQuestionsResolved(openCount) {
  // Each unanswered question meaningfully hurts (3 open → 0/15)
  return clamp(RUBRIC.questionsResolved - openCount * 5, 0, RUBRIC.questionsResolved);
}

function fallbackCompleteness(evidence) {
  if (evidence.transcriptLength < 3) return 2;
  let pts = 4;
  if (evidence.topicCount >= 3) pts += 3;
  else if (evidence.topicCount >= 1) pts += 2;
  if (evidence.decisions.length >= 2) pts += 2;
  if (evidence.actions.length >= 2) pts += 1;
  return clamp(pts, 0, RUBRIC.completeness);
}

function numberedTranscript(transcript, maxLines = 180) {
  const lines = transcript || [];
  const slice = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  return slice
    .map((e, i) => `[${i}] [${e.timestamp || ""}] ${e.speaker || "Speaker"}: ${e.text || ""}`)
    .join("\n");
}

/**
 * Ask AI only for topic/meeting completeness (0–10), given real facts.
 * Ownership / deadlines / open questions are NOT left to AI judgment.
 */
async function aiCompletenessScore(meeting, evidence) {
  const settings = await getSettings();
  const cfg = getActiveProviderConfig(settings);
  if (cfg.provider !== "custom" && !cfg.apiKey) {
    return fallbackCompleteness(evidence);
  }

  const systemInstruction = `You score ONLY "meeting/topic completeness" for a meeting, from 0 to 10.
Respond with STRICT JSON ONLY: {"completeness": <integer 0-10>, "note": "one short sentence"}
Rules:
- Use the transcript and the FACTS below. Do not invent decisions, actions, or questions.
- 10 = agenda/topics clearly covered with coherent close-out.
- 5 = partial coverage.
- 0–3 = fragmented, unclear, or almost empty.
- Do NOT score ownership, deadlines, or questions — those are scored separately from facts.

FACTS (authoritative):
- Decisions captured: ${evidence.decisions.length}
- Action items: ${evidence.actions.length}
- Actions with owners: ${evidence.withOwners.length}
- Actions with uncertain ownership: ${(evidence.uncertainOwners || []).length}
- Actions missing owners (after transcript check): ${evidence.missingOwners.length}
- Actions with deadlines: ${evidence.withDeadlines.length}
- Actions missing deadlines: ${evidence.missingDeadlines.length}
- Open questions (unanswered markers): ${evidence.openQuestions.length}
- Topics detected: ${evidence.topicCount}

MEETING: ${evidence.title}

TRANSCRIPT:
${numberedTranscript(meeting.transcript)}`;

  const raw = await callAI({
    ...cfg,
    promptText: "Return completeness JSON only.",
    systemInstruction,
  });
  try {
    const match = String(raw || "").match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    const n = Number(parsed.completeness);
    if (!Number.isFinite(n)) return fallbackCompleteness(evidence);
    return clamp(n, 0, RUBRIC.completeness);
  } catch (_) {
    return fallbackCompleteness(evidence);
  }
}

function uniqueOwnerNames(items) {
  const names = [];
  const seen = new Set();
  for (const it of items || []) {
    const o = String(it.owner || "").trim();
    if (!o || /^(unknown|uncertain|tbd)$/i.test(o)) continue;
    const key = o.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(o);
  }
  return names;
}

function buildDisplayLines(evidence) {
  const lines = [];
  const d = evidence.decisions.length;
  const a = evidence.actions.length;
  const ow = evidence.withOwners.length;
  const mo = evidence.missingOwners.length;
  const uo = (evidence.uncertainOwners || []).length;
  const md = evidence.missingDeadlines.length;
  const oq = evidence.openQuestions.length;

  if (d > 0) {
    lines.push({
      id: "decisions",
      tone: "ok",
      text: `${d} decision${d === 1 ? "" : "s"} captured`,
      detailKey: "decisions",
      count: d,
    });
  } else {
    lines.push({
      id: "decisions_none",
      tone: "warn",
      text: "No decisions captured",
      detailKey: "decisions",
      count: 0,
    });
  }

  if (a > 0) {
    lines.push({
      id: "actions",
      tone: "ok",
      text: `${a} actionable task${a === 1 ? "" : "s"}`,
      detailKey: "actions",
      count: a,
    });
  } else {
    lines.push({
      id: "actions_none",
      tone: "warn",
      text: "No actionable tasks",
      detailKey: "actions",
      count: 0,
    });
  }

  // One ownership chip: include owner names when resolved
  if (ow > 0) {
    const ownerNames = uniqueOwnerNames(evidence.withOwners);
    const nameSuffix = ownerNames.length ? ` · ${ownerNames.join(", ")}` : "";
    lines.push({
      id: "owners_ok",
      tone: "ok",
      text:
        (ow === 1 ? "1 action has an owner" : `${ow} actions have owners`) + nameSuffix,
      detailKey: "withOwners",
      count: ow,
      owners: ownerNames,
    });
  }
  if (uo > 0) {
    lines.push({
      id: "owners_uncertain",
      tone: "warn",
      text: uo === 1 ? "1 action has uncertain ownership" : `${uo} actions have uncertain ownership`,
      detailKey: "uncertainOwners",
      count: uo,
    });
  }
  if (mo > 0) {
    lines.push({
      id: "owners_missing",
      tone: "warn",
      text: mo === 1 ? "1 action has no owner" : `${mo} actions have no owner`,
      detailKey: "missingOwners",
      count: mo,
    });
  }

  if (evidence.withDeadlines.length > 0) {
    const wd = evidence.withDeadlines.length;
    lines.push({
      id: "deadlines_ok",
      tone: "ok",
      text: wd === 1 ? "1 action has a deadline" : `${wd} actions have deadlines`,
      detailKey: "withDeadlines",
      count: wd,
    });
  }
  if (md > 0) {
    lines.push({
      id: "deadlines_missing",
      tone: "warn",
      text: md === 1 ? "1 action has no deadline" : `${md} actions have no deadline`,
      detailKey: "missingDeadlines",
      count: md,
    });
  }

  if (oq > 0) {
    lines.push({
      id: "questions_open",
      tone: "warn",
      text: `${oq} question${oq === 1 ? "" : "s"} remain unanswered`,
      detailKey: "openQuestions",
      count: oq,
    });
  } else if (a > 0 || d > 0) {
    lines.push({
      id: "questions_clear",
      tone: "ok",
      text: "No unanswered questions marked",
      detailKey: "openQuestions",
      count: 0,
    });
  }

  return lines;
}

function assemblePack(evidence, completenessPts) {
  const rubric = {
    decisions: {
      points: pointsDecisions(evidence.decisions.length),
      max: RUBRIC.decisions,
    },
    actionItems: {
      points: pointsActionItems(evidence.actions.length),
      max: RUBRIC.actionItems,
    },
    ownership: {
      points: pointsOwnership(
        evidence.actions.length,
        evidence.withOwners.length,
        (evidence.uncertainOwners || []).length
      ),
      max: RUBRIC.ownership,
    },
    deadlines: {
      points: pointsDeadlines(evidence.actions.length, evidence.withDeadlines.length),
      max: RUBRIC.deadlines,
    },
    questionsResolved: {
      points: pointsQuestionsResolved(evidence.openQuestions.length),
      max: RUBRIC.questionsResolved,
    },
    completeness: {
      points: clamp(completenessPts, 0, RUBRIC.completeness),
      max: RUBRIC.completeness,
    },
  };

  const score = clamp(
    rubric.decisions.points +
      rubric.actionItems.points +
      rubric.ownership.points +
      rubric.deadlines.points +
      rubric.questionsResolved.points +
      rubric.completeness.points,
    0,
    100
  );

  return {
    score,
    max: 100,
    unavailable: false,
    rubric,
    lines: buildDisplayLines(evidence),
    details: {
      decisions: evidence.decisions,
      actions: evidence.actions,
      withOwners: evidence.withOwners,
      missingOwners: evidence.missingOwners,
      uncertainOwners: evidence.uncertainOwners || [],
      withDeadlines: evidence.withDeadlines,
      missingDeadlines: evidence.missingDeadlines,
      openQuestions: evidence.openQuestions,
    },
    factors: {
      decisions: evidence.decisions.length,
      actionCount: evidence.actions.length,
      withOwner: evidence.withOwners.length,
      withDeadline: evidence.withDeadlines.length,
      missingOwners: evidence.missingOwners.length,
      uncertainOwners: (evidence.uncertainOwners || []).length,
      missingDeadlines: evidence.missingDeadlines.length,
      questions: evidence.openQuestions.length,
    },
    computedAt: new Date().toISOString(),
    version: SCORE_VERSION,
  };
}

/**
 * Generate and return a Meeting Score pack. Uses AI for completeness only;
 * all counts/evidence come from stored meeting data.
 */
export async function generateMeetingScore(meeting) {
  const evidence = collectScoreEvidence(meeting);
  let completeness = fallbackCompleteness(evidence);
  try {
    completeness = await aiCompletenessScore(meeting, evidence);
  } catch (_) {
    completeness = fallbackCompleteness(evidence);
  }
  return assemblePack(evidence, completeness);
}

/** Sync path for callers that cannot await AI (uses heuristic completeness). */
export function computeMeetingScore(meeting) {
  const evidence = collectScoreEvidence(meeting);
  return assemblePack(evidence, fallbackCompleteness(evidence));
}

/** @deprecated use generateMeetingScore — kept for older imports */
export async function scoreMeetingWithSummaries(meeting) {
  return generateMeetingScore(meeting);
}

export default {
  SCORE_VERSION,
  RUBRIC,
  collectScoreEvidence,
  computeMeetingScore,
  generateMeetingScore,
  scoreMeetingWithSummaries,
  resolveActionOwnership,
};
