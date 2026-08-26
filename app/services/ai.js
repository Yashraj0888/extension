// Provider-agnostic AI helper used by the app UI: chat about one meeting,
// generate typed summaries, or ask a question across every stored meeting.
import { callAI } from "./providers.js";
import { getSettings, getActiveProviderConfig } from "./settings.js";

async function run(promptText, systemInstruction, signal) {
  const settings = await getSettings();
  const cfg = getActiveProviderConfig(settings);
  if (cfg.provider !== "custom" && !cfg.apiKey) {
    throw new Error(`${cfg.provider} API key is not configured. Open Settings to add it.`);
  }
  return callAI({ ...cfg, promptText, systemInstruction, signal });
}

export function transcriptToText(transcript) {
  return (transcript || []).map((e) => `[${e.timestamp}] ${e.speaker}: ${e.text}`).join("\n");
}

export function isGenericMeetingTitle(title) {
  const t = String(title || "").trim();
  if (!t) return true;
  if (/^untitled/i.test(t)) return true;
  if (/^google meet$/i.test(t)) return true;
  if (/^zoom meeting$/i.test(t)) return true;
  if (/^join from zoom/i.test(t)) return true;
  if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(t)) return true;
  if (/^meet\s*[-–—]?\s*[a-z0-9]{2,}[-–—][a-z0-9]{2,}/i.test(t)) return true;
  return false;
}

export function parseMeetingTitleFromSummary(summary) {
  const text = String(summary || "");
  const section = text.match(/^#\s*Meeting Title\s*\n+([\s\S]*?)(?=\n#\s|\n*$)/im);
  if (!section) return "";
  const line = section[1]
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .find(Boolean);
  return line ? cleanGeneratedTitle(line) : "";
}

function cleanGeneratedTitle(raw) {
  let t = String(raw || "").trim();
  t = t.replace(/^["'`]+|["'`]+$/g, "");
  t = t.replace(/^(meeting title|title)\s*:\s*/i, "");
  t = t.replace(/[.!?]+$/g, "").trim();
  if (t.length > 80) t = t.slice(0, 77).trim() + "…";
  return t;
}

function conversationToText(messages) {
  return (messages || [])
    .map((m) => `${String(m.role || "user").toUpperCase()}: ${m.content}`)
    .join("\n\n");
}

function meetingMetaBlock(meetingContext) {
  return `Title: ${meetingContext?.title || "Meeting"}
Date: ${meetingContext?.date || "Unknown"}
Duration: ${meetingContext?.duration || "Unknown"}
Participants: ${(meetingContext?.participants || []).join(", ") || "Unknown"}`;
}

const CHAT_INDEX_PROMPT = `You are building a DETAILED INDEXED BRIEF of a meeting. This brief replaces the raw transcript for all future Q&A, so omit nothing important. Prefer completeness over brevity.

Use EXACTLY these headings:

# Overview
- What the meeting was about, outcome, and who was in the room.

# Participants
- Each person: role in this meeting, what they owned, stance on key topics.

# Topic index
- Chronological topics with timestamps when available. 1-3 sentences each covering what was actually said.

# Decisions
- Every decision (formal or informal): what, who, why, any dissent.

# Action items
- Every task/commitment: owner, specific deliverable, deadline/timeframe, why it matters.
- Use: **[Owner]** | **[task]** | **Priority:** | **Deadline:** | **Context:**

# Technical details
- APIs, files, repos, architecture, numbers, product names, constraints, commands.

# Important quotes
- Short quotes that change meaning if omitted, with speaker + timestamp.

# Open questions & blockers
- Unresolved items, risks, disagreements, dependencies.

# Follow-ups
- Next meetings, reviews, or check-ins mentioned.

Rules: No preamble. No HTML. Do not invent. If a section has nothing, write "None stated." Keep names, numbers, and file paths exact.`;

function chunkTranscript(transcript, maxChars = 32000) {
  const lines = transcript || [];
  if (!lines.length) return [];
  const chunks = [];
  let current = [];
  let size = 0;
  const lineLen = (e) => `[${e.timestamp}] ${e.speaker}: ${e.text}\n`.length;
  for (const e of lines) {
    const n = lineLen(e);
    if (size + n > maxChars && current.length) {
      chunks.push(current);
      const overlap = current.slice(-2);
      current = overlap;
      size = overlap.reduce((sum, x) => sum + lineLen(x), 0);
    }
    current.push(e);
    size += n;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const AIService = {
  async generateChatIndex(transcript, meetingContext, { focus = "", previous = "", signal } = {}) {
    const chunks = chunkTranscript(transcript);
    if (!chunks.length) return "";

    const focusBlock = focus
      ? `\nThe previous brief missed something. User feedback to cover more thoroughly:\n${focus}\n`
      : "";
    const prevBlock = previous
      ? `\nPrevious brief (fill gaps, do not copy blindly):\n${String(previous).slice(0, 4000)}\n`
      : "";

    const parts = await Promise.all(
      chunks.map((chunk, i) => {
        const partLabel = chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : "";
        return run(
          `Create the indexed brief${partLabel} now.`,
          `${CHAT_INDEX_PROMPT}${i === 0 ? focusBlock + prevBlock : ""}

MEETING CONTEXT:
${meetingMetaBlock(meetingContext)}

TRANSCRIPT${partLabel}:
${transcriptToText(chunk)}`,
          signal
        );
      })
    );

    if (parts.length === 1) return parts[0];

    return run(
      "Merge the partial briefs into one complete indexed brief. Deduplicate. Keep every unique fact, name, number, decision, and action item.",
      `${CHAT_INDEX_PROMPT}

MEETING CONTEXT:
${meetingMetaBlock(meetingContext)}

PARTIAL BRIEFS:
${parts.map((p, i) => `--- PART ${i + 1} ---\n${p}`).join("\n\n")}`,
      signal
    );
  },

  async chat(messages, meetingContext, {
    extraInstruction = "",
    chatIndex = "",
    useFullTranscript = false,
    transcriptExcerpts = "",
    signal,
  } = {}) {
    const extra = extraInstruction ? `\n\n${extraInstruction}` : "";
    const thread = messages || [];
    const hasFollowUp = thread.some((m) => m.role === "assistant");
    const transcript = transcriptToText(meetingContext.transcript);
    const hasIndex = !useFullTranscript && !!String(chatIndex || "").trim();
    const knowledge = hasIndex ? String(chatIndex).trim() : transcript;
    const knowledgeLabel = hasIndex
      ? "DETAILED MEETING INDEX (primary knowledge — do not ask for the raw transcript)"
      : "FULL TRANSCRIPT";

    const followUpRules = hasFollowUp
      ? `This is a FOLLOW-UP in an ongoing chat. Priority order:
1. THIS CONVERSATION — answer from prior replies, lists, owners, and decisions already in the thread. Resolve "this", "that", "these", "the second one", "my tasks", etc. against the last assistant message first.
2. ${hasIndex ? "THE MEETING INDEX" : "THE TRANSCRIPT"} — only if the thread does not already cover the question.
Do not restart from the source when the chat already discussed it. Do not repeat the full previous answer unless asked.`
      : `Answer from the ${hasIndex ? "meeting index" : "transcript"}. This is the first question in the thread.`;

    const systemInstruction = `You are a senior software engineer who attended this meeting.
Answer the user's question directly and ONLY what is asked. Be concise and to the point.
- Never include timestamps unless asked, confidence scores, reasoning summaries, or filler text.
- If the user asks a yes/no question, answer yes or no with a one-line reason.
- For lists, use short bullets. No preamble, no sign-offs, no "Based on the transcript" prefaces.
- If the answer is not in the conversation or the ${hasIndex ? "index" : "transcript"}, say so in one sentence.

${followUpRules}${extra}

MEETING CONTEXT:
${meetingMetaBlock(meetingContext)}`;

    if (!thread.length) {
      return run("Hello, I'm here to help analyze this meeting.", systemInstruction, signal);
    }

    const conversationText = conversationToText(thread);
    const excerptBlock = String(transcriptExcerpts || "").trim()
      ? `\nTRANSCRIPT EXCERPTS (use these to fill gaps the index missed):\n${transcriptExcerpts}\n`
      : "";
    const rescueBlock =
      useFullTranscript && chatIndex
        ? `\nUPDATED MEETING INDEX (also use this):\n${chatIndex}\n`
        : "";
    const promptText = hasFollowUp
      ? `${knowledgeLabel} (secondary if the conversation already answers the question):
${knowledge}
${excerptBlock}${rescueBlock}
THIS CONVERSATION (primary — continue from here):
${conversationText}`
      : `${knowledgeLabel}:
${knowledge}
${excerptBlock}${rescueBlock}
${conversationText}`;

    return run(promptText, systemInstruction, signal);
  },

  async summarize(transcript, summaryType, meetingContext) {
    const typePrompts = {
      executive: "Create a concise executive summary of this meeting. Include: high-level overview, major outcomes, key decisions, and critical next steps. Keep it under 300 words.",
      engineering: "Create a technical engineering summary of this meeting. Focus on: architecture decisions, APIs discussed, files/repos mentioned, commands executed, frameworks/tools discussed, implementation details, and technical blockers.",
      decisions: "Extract every formal and informal decision made in this meeting. For each, note: what was decided, who was involved, and any context that led to the decision.",
      "action-items": 'Extract all action items and tasks from this meeting. Respond ONLY as a markdown table with columns: Task, Owner, Priority, Deadline. One row per task, no extra commentary.',
    };
    const instruction = typePrompts[summaryType] || typePrompts.executive;

    const systemInstruction = `You are a senior software engineer who attended this meeting. ${instruction}
Keep the output concise and structured. No timestamps, no filler, no sign-offs.

MEETING CONTEXT:
Title: ${meetingContext.title || "Meeting"}
Date: ${meetingContext.date || "Unknown"}
Duration: ${meetingContext.duration || "Unknown"}
Participants: ${(meetingContext.participants || []).join(", ") || "Unknown"}

FULL TRANSCRIPT:
${transcriptToText(transcript)}`;

    return run(`Generate the ${summaryType} summary for this meeting.`, systemInstruction);
  },

  // Extracts a clean, checkable action-item list (used by the Action Items
  // tab's "Re-scan with AI" button).
  async extractActionItems(transcript, meetingContext) {
    const systemInstruction = `You extract action items from a meeting transcript. Respond with STRICT JSON ONLY — a JSON array, no markdown fences, no commentary — where each element is:
{"text": "specific actionable task with enough detail to execute without re-reading the transcript (include deliverable, scope, dependency, or acceptance criteria when mentioned)", "owner": "full person name from the transcript, or empty string if unclear", "deadline": "explicit deadline/timeframe from the meeting, or empty string if none stated", "priority": "high, medium, or low based on urgency discussed", "context": "one short sentence on why this task matters or what triggered it"}
If there are no action items, respond with [].

MEETING: ${meetingContext.title || "Meeting"}
TRANSCRIPT:
${transcriptToText(transcript)}`;
    const raw = await run("Extract the action items now as strict JSON.", systemInstruction);
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((it, i) => ({
        id: "ai-" + Date.now() + "-" + i,
        text: it.text || "",
        owner: it.owner || "",
        deadline: it.deadline || "",
        priority: it.priority || "",
        context: it.context || "",
        done: false,
      })).filter((it) => it.text);
    } catch (e) {
      return [];
    }
  },

  async generateMeetingTitle(transcript, summary, meetingContext = {}) {
    const summaryText = String(summary || "").slice(0, 2000);
    const transcriptText = transcriptToText(transcript).slice(0, 2500);
    const systemInstruction = `You name meetings based on what was actually discussed.
Return ONE concise title only (4–10 words). No quotes, no punctuation at the end, no prefix like "Meeting about".
If the topic is unclear, use the most specific subject mentioned.

Participants: ${(meetingContext.participants || []).join(", ") || "Unknown"}

SUMMARY:
${summaryText || "(none yet)"}

TRANSCRIPT EXCERPT:
${transcriptText || "(empty)"}`;

    const raw = await run("Suggest a clear meeting title.", systemInstruction);
    const title = cleanGeneratedTitle(raw.split("\n")[0]);
    return title.length >= 3 ? title : "";
  },

  // Cross-meeting Q&A: builds context from the most relevant recent meetings
  // (title + participants + transcript, trimmed) and lets the user ask one
  // question across their whole meeting history.
  async askAcrossMeetings(messages, meetings, { signal } = {}) {
    const context = meetings
      .map((m) => {
        const text = transcriptToText(m.transcript).slice(0, 6000); // keep prompt size sane
        return `### Meeting: ${m.title} (${new Date(m.date).toLocaleDateString()})\nParticipants: ${(m.participants || []).join(", ")}\n${text}`;
      })
      .join("\n\n");

    const systemInstruction = `You are an assistant with access to the user's recent meeting history below. Answer questions using ONLY this context. If the answer isn't in any meeting, say so briefly. Always mention which meeting(s) your answer comes from.

MEETING HISTORY:
${context}`;

    const conversationText = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
    const promptText = `${conversationText}\n\nUSER: ${messages[messages.length - 1].content}`;
    return run(promptText, systemInstruction, signal);
  },
};

export default AIService;
