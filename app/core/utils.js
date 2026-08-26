import { dom, icon } from "./runtime.js";

export function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < (str || "").length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ["#c1642a", "#3f6f56", "#8a5a44", "#c98a2e", "#6b5b3a", "#b0563c", "#2f7d6f", "#a0523d"];
  return colors[Math.abs(hash) % colors.length];
}

export function formatDate(dateStr) {
  if (!dateStr) return "Unknown";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000 && d.getDate() === now.getDate()) return "Today";
  if (diff < 172800000 && d.getDate() === now.getDate() - 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttr(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function autoGrowTextarea(el) {
  if (!el) return;
  const grow = () => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 130) + "px";
  };
  el.addEventListener("input", grow);
  grow();
}

export function renderMarkdown(md) {
  if (!md) return "";
  let html = escapeHtml(md);

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  html = html.replace(/^\|(.+)\|$/gm, (match) => {
    const cells = match.split("|").filter((c) => c.trim());
    if (cells.every((c) => /^[-: ]+$/.test(c.trim()))) return "";
    const isHeader = match.includes("---");
    return `<tr>${cells.map((c) => `<${isHeader ? "th" : "td"}>${c.trim()}</${isHeader ? "th" : "td"}>`).join("")}</tr>`;
  });
  html = html.replace(/((?:<tr>.*?<\/tr>\s*)+)/g, "<table>$1</table>");

  html = html.replace(/^[\-*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, "<ul>$1</ul>");

  const lines = html.split("\n");
  html = lines
    .map((line) => {
      const t = line.trim();
      if (!t) return "";
      if (
        t.startsWith("<h") ||
        t.startsWith("<ul") ||
        t.startsWith("</ul") ||
        t.startsWith("<li") ||
        t.startsWith("</li") ||
        t.startsWith("<table") ||
        t.startsWith("</table") ||
        t.startsWith("<tr") ||
        t.startsWith("</tr") ||
        t.startsWith("<td") ||
        t.startsWith("<th") ||
        t.startsWith("<pre") ||
        t.startsWith("</pre")
      ) {
        return t;
      }
      return `<p>${t}</p>`;
    })
    .join("\n");

  return html;
}

export function showToast(msg) {
  if (!dom.toast) return;
  dom.toast.innerHTML = `${icon("check", 14)} ${escapeHtml(msg)}`;
  dom.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => dom.toast.classList.remove("show"), 2500);
}

export function platformIcon(platform) {
  return platform === "zoom" ? icon("fileText", 12) : icon("meet", 12);
}

export function meetingListAvatar(platform, size = 22) {
  return platform === "zoom" ? icon("fileText", size) : icon("meet", size);
}

const SELF_SPEAKER_ALIASES = /^(you|me)$/i;

/** Real display name for the local recorder — not the provisional "You" label. */
export function resolveSelfSpeakerName(meeting) {
  if (!meeting) return "You";
  const recordedBy = String(meeting.recordedBy || "").trim();
  if (recordedBy && !SELF_SPEAKER_ALIASES.test(recordedBy)) return recordedBy;

  const rosterNames = (meeting.participants || [])
    .map((p) => String(p || "").trim())
    .filter((p) => p && !SELF_SPEAKER_ALIASES.test(p));

  if (rosterNames.length === 1) return rosterNames[0];

  const spoke = new Set();
  for (const e of meeting.transcript || []) {
    const n = String(e.speaker || "").trim();
    if (n && !SELF_SPEAKER_ALIASES.test(n)) spoke.add(n);
  }
  if (spoke.size === 1) return [...spoke][0];

  return recordedBy || "You";
}

export function normalizeSpeakerName(name, meeting) {
  const n = String(name || "Unknown").trim() || "Unknown";
  if (SELF_SPEAKER_ALIASES.test(n)) return resolveSelfSpeakerName(meeting);
  return n;
}

export function dedupeSpeakerNames(names, meeting) {
  const seen = new Set();
  const out = [];
  for (const raw of names || []) {
    const name = normalizeSpeakerName(raw, meeting);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function getIstHour() {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date());
    return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  } catch (_) {
    return new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();
  }
}

export function formatTime(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (_) {
    return "";
  }
}

export function formatWhenDetailed(dateStr) {
  if (!dateStr) return "Unknown";
  const d = new Date(dateStr);
  const day = formatDate(dateStr);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

export function parseDurationMinutes(str) {
  if (!str) return 0;
  const m = String(str).match(/(\d+)\s*min/i);
  if (m) return parseInt(m[1], 10);
  const h = String(str).match(/(\d+)\s*h/i);
  if (h) return parseInt(h[1], 10) * 60;
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : 0;
}

export function initialsFrom(name) {
  const parts = String(name || "YN").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "YN";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatMeetingStamp(dateStr) {
  if (!dateStr) return "Unknown";
  try {
    return new Date(dateStr).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch (_) {
    return formatDate(dateStr);
  }
}
