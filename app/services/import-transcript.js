/**
 * Parse imported meeting notes / transcripts in every format we export:
 * .md, .txt, .json, .html, .rtf, .doc (WordML), .pdf
 */

/**
 * Classic speaker turn:
 *   [00:00] Speaker: text
 *   Speaker: text
 *   Speaker:          ← label alone; body on following lines
 * Timestamp is optional (group 1).
 */
const TRANSCRIPT_LINE =
  /^(?:\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*)?([A-Za-z][\w.'’\-]*(?:\s+[A-Za-z][\w.'’\-]*){0,3}):\s*(.*)$/;

/** Timestamp header line: 00:00 — Yash   /  00:00 - Yash */
const TIMESTAMP_SPEAKER =
  /^(\d{1,2}:\d{2}(?::\d{2})?)\s*[\u2014\u2013\u2212\u0096\u0097\-]\s*(.+)$/;

/** Meta labels that appear in exported notes, not spoken turns */
const META_LABEL_LINE =
  /^(participants?|topic|date|duration|title|meeting|platform|language)\s*:?\s*(.*)$/i;

/** Reject document titles / section headers mistaken for speakers ("Demo Meeting: …") */
function looksLikePersonName(name) {
  const n = String(name || "").trim();
  if (!n || n.length > 40) return false;
  if (
    /\b(meeting|summary|topic|title|notes|agenda|overview|transcript|participants?|action items?)\b/i.test(
      n
    )
  ) {
    return false;
  }
  const parts = n.split(/\s+/);
  if (parts.length > 3) return false;
  // Prefer names that start with a letter (already enforced by TRANSCRIPT_LINE)
  return true;
}

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripHtml(html) {
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|br)\s*>/gi, "\n");
  s = s.replace(/<(br|hr)\s*\/?>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeXmlEntities(s);
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripRtf(rtf) {
  let s = String(rtf || "");
  s = s.replace(/\\'[0-9a-fA-F]{2}/g, (m) => {
    try {
      return String.fromCharCode(parseInt(m.slice(2), 16));
    } catch (_) {
      return " ";
    }
  });
  s = s.replace(/\\u(-?\d+)\??/g, (_, n) => {
    const code = Number(n);
    if (!Number.isFinite(code)) return " ";
    try {
      return String.fromCharCode(code < 0 ? 65536 + code : code);
    } catch (_) {
      return " ";
    }
  });
  s = s.replace(/\\par[d]?/gi, "\n");
  s = s.replace(/\\line/gi, "\n");
  s = s.replace(/\\tab/gi, "\t");
  s = s.replace(/\{\\.*?\}/g, " ");
  s = s.replace(/\\[a-z]+\d* ?/gi, "");
  s = s.replace(/[{}]/g, "");
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractWordMlText(xml) {
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi;
  let m;
  while ((m = re.exec(xml))) {
    parts.push(decodeXmlEntities(m[1]));
  }
  if (!parts.length) return stripHtml(xml);
  const withBreaks = String(xml || "")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi, (_, t) => decodeXmlEntities(t))
    .replace(/<[^>]+>/g, "");
  return withBreaks.replace(/\n{3,}/g, "\n\n").trim() || parts.join(" ");
}

function bytesToLatin1(view) {
  let raw = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    raw += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
  }
  return raw;
}

function ascii85Decode(bytes) {
  const out = [];
  let i = 0;
  const len = bytes.length;
  // Trim trailing ~> and whitespace
  let end = len;
  while (end > 0 && (bytes[end - 1] <= 32 || bytes[end - 1] === 0)) end -= 1;
  if (end >= 2 && bytes[end - 2] === 126 && bytes[end - 1] === 62) end -= 2; // ~>

  while (i < end) {
    const c = bytes[i];
    if (c <= 32) {
      i += 1;
      continue;
    }
    if (c === 122) {
      // z → 4 zero bytes
      out.push(0, 0, 0, 0);
      i += 1;
      continue;
    }
    let take = 0;
    const chunk = [];
    while (i < end && take < 5) {
      const ch = bytes[i];
      i += 1;
      if (ch <= 32) continue;
      if (ch < 33 || ch > 117) throw new Error("Invalid ASCII85 data");
      chunk.push(ch);
      take += 1;
    }
    if (!chunk.length) break;
    const pad = 5 - chunk.length;
    while (chunk.length < 5) chunk.push(117); // 'u'
    let n = 0;
    for (const ch of chunk) n = n * 85 + (ch - 33);
    const b0 = (n >>> 24) & 0xff;
    const b1 = (n >>> 16) & 0xff;
    const b2 = (n >>> 8) & 0xff;
    const b3 = n & 0xff;
    const full = [b0, b1, b2, b3];
    out.push(...full.slice(0, 4 - pad));
  }
  return new Uint8Array(out);
}

async function flateDecode(bytes) {
  // PDF FlateDecode is zlib-wrapped deflate (often starts with 0x78).
  const tryFormats = ["deflate", "deflate-raw"];
  let lastErr;
  for (const format of tryFormats) {
    try {
      const ds = new DecompressionStream(format);
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      const ab = await new Response(stream).arrayBuffer();
      return new Uint8Array(ab);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("FlateDecode failed");
}

/** WinAnsiEncoding extras commonly used in ReportLab / Word-ish PDFs */
const WINANSI_MAP = {
  0x80: "\u20ac",
  0x82: "\u201a",
  0x83: "\u0192",
  0x84: "\u201e",
  0x85: "\u2026",
  0x86: "\u2020",
  0x87: "\u2021",
  0x88: "\u02c6",
  0x89: "\u2030",
  0x8a: "\u0160",
  0x8b: "\u2039",
  0x8c: "\u0152",
  0x8e: "\u017d",
  0x91: "\u2018",
  0x92: "\u2019",
  0x93: "\u201c",
  0x94: "\u201d",
  0x95: "\u2022",
  0x96: "\u2013",
  0x97: "\u2014",
  0x98: "\u02dc",
  0x99: "\u2122",
  0x9a: "\u0161",
  0x9b: "\u203a",
  0x9c: "\u0153",
  0x9e: "\u017e",
  0x9f: "\u0178",
};

function winAnsiChar(code) {
  if (WINANSI_MAP[code]) return WINANSI_MAP[code];
  if (code === 0x7f) return "•"; // ReportLab sometimes emits \177 as a bullet
  if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return "";
  return String.fromCharCode(code);
}

function unescapePdfString(s) {
  return String(s || "")
    .replace(/\\([0-7]{1,3})/g, (_, oct) => winAnsiChar(parseInt(oct, 8)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    // Literal high bytes that slipped through without octal escaping
    .replace(/[\u0080-\u009f]/g, (ch) => WINANSI_MAP[ch.charCodeAt(0)] || ch);
}

function extractTjLines(content) {
  const lines = [];
  const re = /\((?:\\.|[^\\)])*\)\s*Tj|\[(?:\s*\((?:\\.|[^\\)])*\)\s*-?\d*\.?\d*\s*)+\]\s*TJ/g;
  let m;
  while ((m = re.exec(content))) {
    const token = m[0];
    if (/Tj\s*$/.test(token)) {
      const inner = token.match(/^\(([\s\S]*)\)\s*Tj\s*$/)?.[1];
      if (inner != null) lines.push(unescapePdfString(inner));
    } else {
      const parts = [];
      const partRe = /\((?:\\.|[^\\)])*\)/g;
      let p;
      while ((p = partRe.exec(token))) {
        parts.push(unescapePdfString(p[0].slice(1, -1)));
      }
      if (parts.length) lines.push(parts.join(""));
    }
  }
  return lines;
}

function parsePdfFilters(dictText) {
  const filters = [];
  const arr = dictText.match(/\/Filter\s*\[([^\]]*)\]/);
  if (arr) {
    const names = arr[1].match(/\/[A-Za-z0-9]+/g) || [];
    for (const n of names) filters.push(n.slice(1));
    return filters;
  }
  const single = dictText.match(/\/Filter\s*\/([A-Za-z0-9]+)/);
  if (single) filters.push(single[1]);
  return filters;
}

async function decodePdfStream(bytes, filters) {
  let data = bytes;
  for (const filter of filters) {
    if (filter === "ASCII85Decode" || filter === "A85") {
      data = ascii85Decode(data);
    } else if (filter === "FlateDecode" || filter === "Fl") {
      data = await flateDecode(data);
    } else if (filter === "ASCIIHexDecode" || filter === "AHx") {
      const hex = bytesToLatin1(data).replace(/[^0-9a-fA-F]/g, "");
      const out = new Uint8Array(Math.floor(hex.length / 2));
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      data = out;
    }
    // Other filters ignored (DCTDecode images, etc.)
  }
  return data;
}

function looksLikePdfJunk(text) {
  const t = String(text || "");
  if (!t.trim()) return true;
  const junkHits = (
    (t.match(/%PDF-/g) || []).length +
    (t.match(/\bendobj\b/g) || []).length +
    (t.match(/\bendstream\b/g) || []).length +
    (t.match(/\/Type\s*\/Pages/g) || []).length +
    (t.match(/c2pa\./g) || []).length
  );
  return junkHits >= 3;
}

async function extractPdfText(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const raw = bytesToLatin1(view);
  const collected = [];

  // Walk every stream…endstream; decode when filters are present.
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = streamRe.exec(raw))) {
    const streamStart = m.index;
    const dictStart = raw.lastIndexOf("<<", streamStart);
    const dictText = dictStart >= 0 ? raw.slice(dictStart, streamStart) : "";
    // Skip embedded file / C2PA / image-only streams
    if (/\/Subtype\s*\(application\/c2pa\)/i.test(dictText)) continue;
    if (/\/Subtype\s*\/Image\b/.test(dictText)) continue;

    let bodyLatin = m[1];
    if (bodyLatin.endsWith("\r\n")) bodyLatin = bodyLatin.slice(0, -2);
    else if (bodyLatin.endsWith("\n") || bodyLatin.endsWith("\r")) bodyLatin = bodyLatin.slice(0, -1);

    const lengthMatch = dictText.match(/\/Length\s+(\d+)/);
    if (lengthMatch) {
      const declared = Number(lengthMatch[1]);
      if (Number.isFinite(declared) && declared > 0 && declared <= bodyLatin.length) {
        bodyLatin = bodyLatin.slice(0, declared);
      }
    }

    const bodyBytes = new Uint8Array(bodyLatin.length);
    for (let i = 0; i < bodyLatin.length; i++) bodyBytes[i] = bodyLatin.charCodeAt(i) & 0xff;

    const filters = parsePdfFilters(dictText);
    try {
      let contentBytes = bodyBytes;
      if (filters.length) contentBytes = await decodePdfStream(bodyBytes, filters);
      const content = bytesToLatin1(contentBytes);
      const lines = extractTjLines(content);
      if (lines.length) collected.push(...lines);
    } catch (_) {
      // Ignore undecodable streams (images, fonts, etc.)
    }
  }

  let text = collected.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // Fallback for uncompressed content streams already in the raw file
  if (!text || looksLikePdfJunk(text)) {
    const direct = extractTjLines(raw).join("\n").trim();
    if (direct && !looksLikePdfJunk(direct)) text = direct;
  }

  if (!text || looksLikePdfJunk(text)) {
    throw new Error(
      "Could not extract readable text from this PDF (it may be image-only or use an unsupported encoding)."
    );
  }
  return text;
}

function isSkippableMetaLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(t)) return true;
  if (/^action items$/i.test(t)) return true;
  if (/^(date|duration|participants)$/i.test(t)) return true;
  // "Participants:", "Topic: …", "Date: …" (label alone or with value)
  const meta = t.match(META_LABEL_LINE);
  if (meta) return true;
  // Action-item bullets: "• Yash — Update …"
  if (/^[•\u2022\u00b7]\s*.+[\u2014\u2013\-].+/.test(t)) return true;
  return false;
}

function dropPreambleIfNeeded(seenSpeaker, current, flush) {
  if (!seenSpeaker && current && current.speaker === "Speaker" && !current.headerStyle) {
    return null;
  }
  flush();
  return null;
}

/**
 * Build transcript entries from free text.
 * Supports:
 *  - "00:00 — Yash" header + following body lines
 *  - "[00:00] Yash: hello" / "Yash: hello"
 *  - "Yash:" on its own line with dialogue on the next lines
 */
function linesToTranscript(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const entries = [];
  let current = null;
  let seenSpeaker = false;

  const flush = () => {
    if (current && (current.text || "").trim()) {
      entries.push({
        speaker: current.speaker,
        text: current.text.trim().replace(/\s+/g, " "),
        timestamp: current.timestamp || "",
      });
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current?.headerStyle) flush();
      continue;
    }
    if (isSkippableMetaLine(line)) continue;

    const header = line.match(TIMESTAMP_SPEAKER);
    if (header) {
      current = dropPreambleIfNeeded(seenSpeaker, current, flush);
      seenSpeaker = true;
      current = {
        speaker: header[2].trim(),
        timestamp: header[1],
        text: "",
        headerStyle: true,
      };
      continue;
    }

    // Skip bare date / duration / participant-list values in the preamble
    if (!seenSpeaker) {
      if (/^\d{1,2}\s+\w+\s+\d{4}$/.test(line)) continue;
      if (/^\d+\s*(minutes?|mins?|hours?|hrs?)$/i.test(line)) continue;
      if (/^[\w.\-]+(?:\s*,\s*[\w.\-]+)+$/.test(line) && line.split(",").length >= 2) continue;
    }

    const classic = line.match(TRANSCRIPT_LINE);
    // Don't treat "http://…" or title lines ("Demo Meeting: …") as speakers
    if (
      classic &&
      !current?.headerStyle &&
      !/^https?$/i.test(classic[2]) &&
      looksLikePersonName(classic[2])
    ) {
      current = dropPreambleIfNeeded(seenSpeaker, current, flush);
      seenSpeaker = true;
      current = {
        speaker: classic[2].trim(),
        timestamp: classic[1] || "",
        text: (classic[3] || "").trim(),
        headerStyle: false,
      };
      continue;
    }

    if (current) {
      current.text = current.text ? `${current.text} ${line}` : line;
    } else if (seenSpeaker) {
      current = { speaker: "Speaker", timestamp: "", text: line, headerStyle: false };
    } else {
      // Hold preamble in case the file has no speaker labels at all.
      current = { speaker: "Speaker", timestamp: "", text: line, headerStyle: false };
    }
  }
  flush();

  return entries.filter((row) => (row.text || "").trim());
}

function looksLikeTranscript(entries) {
  if (!entries?.length) return false;
  const named = entries.filter((e) => e.speaker && e.speaker !== "Speaker").length;
  return named >= Math.max(2, Math.floor(entries.length * 0.25));
}

function titleFromFilename(name) {
  return String(name || "Imported notes").replace(/\.[^.]+$/, "") || "Imported notes";
}

function titleFromText(text, fallback) {
  const first = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !TIMESTAMP_SPEAKER.test(l) && !/^date\b/i.test(l));
  if (first && first.length <= 120 && !/^%PDF/i.test(first)) return first;
  return fallback;
}

function normalizeMeetingPayload(obj, fallbackTitle) {
  if (!obj || typeof obj !== "object") return null;

  if (obj.local && typeof obj.local === "object") {
    return { kind: "backup", backup: obj };
  }

  if (Array.isArray(obj.transcript) || obj.title || obj.id) {
    return {
      kind: "meeting",
      meeting: {
        title: obj.title || fallbackTitle,
        date: obj.date || new Date().toISOString(),
        duration: obj.duration || "Imported",
        participants: Array.isArray(obj.participants) ? obj.participants : [],
        transcript: Array.isArray(obj.transcript) ? obj.transcript : [],
        bookmarks: Array.isArray(obj.bookmarks) ? obj.bookmarks : [],
        actionItems: Array.isArray(obj.actionItems) ? obj.actionItems : [],
        tags: Array.isArray(obj.tags) ? obj.tags : [],
        status: obj.status || "completed",
        isFavorite: !!obj.isFavorite,
        isPinned: !!obj.isPinned,
        language: obj.language || "en",
        platform: obj.platform || "import",
        transcriptConfidence: obj.transcriptConfidence ?? 1,
        summaryPreview: obj.summaryPreview || "",
        spaceIds: Array.isArray(obj.spaceIds) ? obj.spaceIds : [],
      },
      summaryContent: typeof obj.summary === "string" ? obj.summary : null,
    };
  }

  if (Array.isArray(obj)) {
    const asEntries = obj.every(
      (row) => row && typeof row === "object" && ("text" in row || "speaker" in row)
    );
    if (asEntries) {
      return {
        kind: "meeting",
        meeting: {
          title: fallbackTitle,
          date: new Date().toISOString(),
          duration: "Imported",
          participants: [...new Set(obj.map((r) => r.speaker).filter(Boolean))],
          transcript: obj.map((r) => ({
            speaker: r.speaker || "Speaker",
            text: r.text || "",
            timestamp: r.timestamp || "",
          })),
          bookmarks: [],
          status: "completed",
          isFavorite: false,
          isPinned: false,
          language: "en",
          platform: "import",
          transcriptConfidence: 1,
        },
      };
    }
  }

  if (typeof obj.text === "string" || typeof obj.content === "string") {
    return {
      kind: "text",
      title: obj.title || fallbackTitle,
      text: obj.text || obj.content,
    };
  }

  return null;
}

async function readFileAsText(file) {
  return file.text();
}

async function readFileAsBytes(file) {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * @returns {Promise<{
 *   title: string,
 *   text: string,
 *   transcript: Array,
 *   meeting?: object,
 *   summaryMarkdown?: string,
 *   backup?: object,
 *   format: string
 * }>}
 */
export async function parseImportFile(file) {
  const ext = extOf(file.name);
  const fallbackTitle = titleFromFilename(file.name);
  let format = ext || "txt";
  let text = "";
  let meeting = null;
  let summaryMarkdown = null;
  let backup = null;
  let title = fallbackTitle;

  if (ext === "json") {
    const raw = await readFileAsText(file);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      throw new Error("Invalid JSON file");
    }
    const normalized = normalizeMeetingPayload(parsed, fallbackTitle);
    if (normalized?.kind === "backup") {
      return { title, text: "", transcript: [], backup: normalized.backup, format: "json" };
    }
    if (normalized?.kind === "meeting") {
      meeting = normalized.meeting;
      text = (meeting.transcript || [])
        .map((r) => `${r.timestamp ? `[${r.timestamp}] ` : ""}${r.speaker}: ${r.text}`)
        .join("\n");
      summaryMarkdown = normalized.summaryContent || null;
      return {
        title: meeting.title || title,
        text,
        transcript: meeting.transcript || [],
        meeting,
        summaryMarkdown,
        format: "json",
      };
    }
    if (normalized?.kind === "text") {
      text = normalized.text;
      format = "json";
    } else {
      text = raw;
    }
  } else if (ext === "html" || ext === "htm") {
    text = stripHtml(await readFileAsText(file));
  } else if (ext === "rtf") {
    text = stripRtf(await readFileAsText(file));
  } else if (ext === "doc" || ext === "docx") {
    const raw = await readFileAsText(file);
    if (raw.startsWith("PK")) {
      throw new Error(
        "This looks like a .docx (Office Open XML). Save/export as .doc, .md, .txt, .html, .rtf, or .pdf and try again."
      );
    }
    text = extractWordMlText(raw);
  } else if (ext === "pdf") {
    text = await extractPdfText(await readFileAsBytes(file));
  } else {
    text = await readFileAsText(file);
    if (ext === "md" || ext === "markdown") format = "md";
    else if (ext === "txt") format = "txt";
  }

  text = String(text || "").trim();
  if (!text) throw new Error("No readable text found in this file");
  if (ext === "pdf" && looksLikePdfJunk(text)) {
    throw new Error("Could not extract readable text from this PDF");
  }

  title = titleFromText(text, fallbackTitle);
  const transcript = linesToTranscript(text);
  const summaryLike =
    /^meeting summary:/i.test(text) ||
    (/^#{1,3}\s+/m.test(text) && !looksLikeTranscript(transcript));

  if (summaryLike) summaryMarkdown = text;

  // Pull participants from a "Participants …" line when present
  const participants = [];
  const partLine = text.match(/participants?\s*[:\-]?\s*([^\n]+)/i);
  if (partLine) {
    for (const name of partLine[1].split(/[,&]/).map((s) => s.trim()).filter(Boolean)) {
      // Ignore leftover label text / empty captures from "Participants:\nNames"
      if (name && name.length < 40 && !/^(topic|date|duration)$/i.test(name)) {
        participants.push(name);
      }
    }
  }
  // If the names sat on the line after "Participants:", pick them up
  if (!participants.length) {
    const block = text.match(/participants?\s*:?\s*\n\s*([^\n]+)/i);
    if (block) {
      for (const name of block[1].split(/[,&]/).map((s) => s.trim()).filter(Boolean)) {
        if (name && name.length < 40) participants.push(name);
      }
    }
  }
  for (const e of transcript) {
    if (e.speaker && e.speaker !== "Speaker" && !participants.includes(e.speaker)) {
      participants.push(e.speaker);
    }
  }

  if (participants.length || transcript.length) {
    meeting = {
      title,
      date: new Date().toISOString(),
      duration: "Imported",
      participants,
      transcript,
      bookmarks: [],
      status: "completed",
      isFavorite: false,
      isPinned: false,
      language: "en",
      platform: "import",
      transcriptConfidence: 1,
    };
    const dur = text.match(/duration\s*[:\-]?\s*([^\n]+)/i);
    if (dur) meeting.duration = dur[1].trim().slice(0, 40);
  }

  return { title, text, transcript, meeting, summaryMarkdown, backup, format };
}

export const IMPORT_ACCEPT =
  ".txt,.md,.markdown,.json,.html,.htm,.rtf,.doc,.pdf,text/plain,text/markdown,application/json,text/html,application/rtf,application/msword,application/pdf";

export default { parseImportFile, IMPORT_ACCEPT };
