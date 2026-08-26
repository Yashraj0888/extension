/** Parse action items from summary / chat markdown so My Tasks can use them. */

function cleanOwner(name) {
  return String(name || "")
    .replace(/[*_#[\]:]/g, "")
    .replace(/^\s*(owner|assignee)\s*/i, "")
    .trim();
}

function cleanTaskText(text) {
  return String(text || "")
    .replace(/^[-*•]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^\[[^\]]+\]\s*\|?\s*/, "")
    .trim();
}

function fingerprint(text) {
  return cleanTaskText(text).toLowerCase().replace(/\s+/g, " ");
}

export function isAddToMyTasksIntent(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  if (/\b(don'?t|do not|never)\b.{0,24}\b(add|save|put|create)\b/.test(t)) return false;
  return (
    /\badd\b[\s\S]{0,80}\b(to |into |on |in )?(my |the )?(tasks?|to-?dos?|action items?|task list)\b/.test(t) ||
    /\b(save|put|create|move|send)\b[\s\S]{0,80}\b(to |into |on |in )?(my )?(tasks?|to-?dos?|action items?|task list)\b/.test(t) ||
    /\b(track|capture)\b[\s\S]{0,40}\b(as )?(my )?(tasks?|action items?)\b/.test(t)
  );
}

function looksLikePerson(name) {
  const n = cleanOwner(name);
  if (!n || n.length < 2 || n.length > 48) return false;
  if (
    /^(action items?|tasks?|tasks by person|central theme|meeting title|priority|deadline|context|high|medium|low|tbd|decisions?|key topics?|next steps?|summary|overview|outcomes?|participants?)$/i.test(
      n
    )
  ) {
    return false;
  }
  const words = n.split(/\s+/);
  return words.length >= 1 && words.length <= 4;
}

function makeItem(text, owner, extra = {}) {
  const t = cleanTaskText(text);
  if (!t || t.length < 6) return null;
  if (/^(action items?|tasks?|none|n\/a|tbd|no action items)$/i.test(t)) return null;
  if (/^\*?\[.+\]\s*\|/.test(t) || /\|\s*\*?\*?priority:/i.test(t)) return null;
  if (isAddToMyTasksIntent(t)) return null;
  return {
    id: extra.id || `parsed-${Math.abs(hashCode(fingerprint(t)))}`,
    text: t,
    owner: cleanOwner(owner),
    deadline: String(extra.deadline || "").trim(),
    priority: String(extra.priority || "")
      .toLowerCase()
      .replace(/[^a-z]/g, ""),
    context: String(extra.context || "").trim(),
    done: false,
    source: extra.source || "notes",
  };
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h | 0;
}

function headingText(line) {
  return String(line || "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*/g, "")
    .trim()
    .replace(/:$/, "")
    .trim();
}

function isActionSectionHeading(line) {
  return /^(action items?|tasks by person|tasks)$/i.test(headingText(line));
}

function isOtherSectionHeading(line) {
  return /^(central theme|meeting title|decisions?|key topics?|next steps?|summary|overview|outcomes?|participants?|follow-?up)$/i.test(
    headingText(line)
  );
}

function matchPersonHeading(line) {
  const patterns = [
    /^#{2,3}\s+(.+)$/,
    /^\*\*(.+?)\*\*\s*:?\s*$/,
    /^\*\*(.+?):\*\*\s*$/,
    /^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s*:?\s*$/,
  ];
  for (const re of patterns) {
    const m = line.match(re);
    if (m && looksLikePerson(m[1])) return cleanOwner(m[1]);
  }
  const plain = headingText(line);
  if (looksLikePerson(plain) && /^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}$/.test(plain)) {
    return cleanOwner(plain);
  }
  return "";
}

function splitTableRow(line) {
  const s = String(line || "").trim();
  if (!s.includes("|")) return null;
  if (/^\s*\|?\s*:?-{2,}/.test(s)) return null;
  const cells = s
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
  return cells.length >= 2 ? cells : null;
}

function parseMarkdownTables(src, add) {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const header = splitTableRow(lines[i]);
    if (!header) continue;
    const divider = lines[i + 1] || "";
    if (!/^\s*\|?\s*:?-{2,}/.test(divider)) continue;
    const lower = header.map((h) => h.toLowerCase().replace(/[*_`]/g, "").trim());
    const taskIdx = lower.findIndex((h) => /task|action|item|to-?do/i.test(h));
    const ownerIdx = lower.findIndex((h) => /owner|assignee|person|who/i.test(h));
    const priIdx = lower.findIndex((h) => /priority/i.test(h));
    const dueIdx = lower.findIndex((h) => /deadline|due/i.test(h));
    if (taskIdx < 0) continue;
    i += 2;
    while (i < lines.length) {
      const cells = splitTableRow(lines[i]);
      if (!cells) break;
      add(
        makeItem(cells[taskIdx] || "", ownerIdx >= 0 ? cells[ownerIdx] : "", {
          priority: priIdx >= 0 ? cells[priIdx] : "",
          deadline: dueIdx >= 0 ? cells[dueIdx] : "",
        })
      );
      i += 1;
    }
    i -= 1;
  }
}

export function parseActionItemsFromMarkdown(markdown, { loose = false } = {}) {
  const src = String(markdown || "").replace(/\r/g, "");
  if (!src.trim()) return [];
  const items = [];
  const seen = new Set();

  const add = (item) => {
    if (!item) return;
    const key = fingerprint(item.text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  const tagged =
    /^\s*[-*•]\s*\*\*\[?([^\]]+?)\]?\*\*\s*\|\s*\*\*\[?(.+?)\]?\*\*(?:\s*\|(.*))?$/gim;
  let m;
  while ((m = tagged.exec(src))) {
    const rest = m[3] || "";
    add(
      makeItem(m[2], m[1], {
        priority: (rest.match(/Priority:\s*([^|*]+)/i) || [])[1],
        deadline: (rest.match(/Deadline:\s*([^|*]+)/i) || [])[1],
        context: (rest.match(/Context:\s*([^|*]+)/i) || [])[1],
      })
    );
  }

  parseMarkdownTables(src, add);

  const lines = src.split("\n");
  let currentOwner = "";
  let inActionSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isActionSectionHeading(line)) {
      inActionSection = true;
      currentOwner = "";
      continue;
    }

    if (isOtherSectionHeading(line)) {
      inActionSection = false;
      currentOwner = "";
      continue;
    }

    const person = matchPersonHeading(line);
    if (person && (inActionSection || currentOwner || /^#{1,3}\s+/.test(line))) {
      if (inActionSection || currentOwner || /^#{2,3}\s+/.test(line)) {
        currentOwner = person;
        if (inActionSection || /^#{2,3}\s+/.test(line)) inActionSection = true;
        continue;
      }
    }

    if (/^#{1,3}\s+/.test(line) && !/action|task|person/i.test(line) && !person) {
      inActionSection = false;
      currentOwner = "";
      continue;
    }

    if (inActionSection && person) {
      currentOwner = person;
      continue;
    }

    // Already captured by the tagged **[Owner]** | **[task]** parser.
    if (/^\s*[-*•]\s*\*\*.+\|\s*\*\*/.test(line)) continue;

    const inlineOwner = line.match(
      /^\s*[-*•]\s*\*?\*?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\*?\*?\s*[:—-]\s+(.+)/
    );
    if (inlineOwner && looksLikePerson(inlineOwner[1]) && (inActionSection || currentOwner || loose)) {
      add(makeItem(inlineOwner[2], inlineOwner[1]));
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)/) || line.match(/^\d+[.)]\s+(.+)/);
    if (bullet && (inActionSection || currentOwner || loose)) {
      add(makeItem(bullet[1], currentOwner));
    }
  }

  return items;
}

export function mergeActionItemLists(existing, incoming) {
  const out = [...(existing || [])];
  const keys = new Set(out.map((it) => fingerprint(it.text || "")));
  for (const it of incoming || []) {
    const key = fingerprint(it.text || "");
    if (!key || keys.has(key)) continue;
    keys.add(key);
    out.push(it);
  }
  return out;
}

function ownerLooksLikeUser(owner, userName) {
  const o = String(owner || "").trim().toLowerCase();
  const u = String(userName || "").trim().toLowerCase();
  if (!o || /^(you|me)$/i.test(o)) return true;
  if (!u) return false;
  if (o === u) return true;
  const uFirst = u.split(/\s+/).filter(Boolean)[0] || "";
  const oFirst = o.split(/\s+/).filter(Boolean)[0] || "";
  if (uFirst.length >= 3 && (o === uFirst || oFirst === uFirst)) return true;
  if (o.startsWith(u + " ") || u.startsWith(o + " ")) return true;
  return false;
}

/** Prefer the user's / unowned items; if none, take the listed items as theirs. */
export function pickTasksForMyList(items, userName) {
  const list = items || [];
  const user = String(userName || "").trim();
  const mine = list.filter((it) => ownerLooksLikeUser(it.owner, user));
  const forceMine = !mine.length;
  const chosen = forceMine ? list : mine;
  return chosen.map((it) => ({
    ...it,
    owner: forceMine || ownerLooksLikeUser(it.owner, user) ? user || it.owner || "Me" : it.owner,
    source: "chat",
  }));
}

export function collectTasksFromChatSources({ userText = "", previousAssistant = "", newAssistant = "" } = {}) {
  const fromUser = parseActionItemsFromMarkdown(userText, { loose: true });
  let fromPrev = parseActionItemsFromMarkdown(previousAssistant);
  if (!fromPrev.length) fromPrev = parseActionItemsFromMarkdown(previousAssistant, { loose: true });
  const fromNew = parseActionItemsFromMarkdown(newAssistant);
  if (fromUser.length) return mergeActionItemLists(fromUser, fromNew);
  return mergeActionItemLists(fromPrev, fromNew);
}
