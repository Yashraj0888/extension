/** Collapse Meet caption history dumps and in-place revisions. */

function normCaption(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameSpeaker(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

/**
 * Meet's caption panel innerText concatenates the whole scrollback:
 * "Milan … You Hello! Milan Dasgupta Yeah … Rajat Bhapri …"
 * Those blobs repeat as they grow. A real utterance does not.
 */
export function isCaptionHistoryDump(text, speaker = "") {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length < 700) return false;
  const youHits = (t.match(/\bYou\b/g) || []).length;
  const nameLabels = t.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  const uniqueNames = new Set(nameLabels.map((n) => n.toLowerCase()));
  if (speaker) {
    const re = new RegExp(String(speaker).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const selfHits = (t.match(re) || []).length;
    if (selfHits >= 4 && t.length > 800) return true;
  }
  if (t.length > 2000 && (youHits >= 2 || uniqueNames.size >= 2)) return true;
  if (youHits >= 3 && uniqueNames.size >= 2) return true;
  if (uniqueNames.size >= 3 && nameLabels.length >= 6 && t.length > 800) return true;
  if (t.length > 3200) return true;
  return false;
}

export function isCaptionRevision(prev, next) {
  const x = normCaption(prev);
  const y = normCaption(next);
  if (!x || !y) return false;
  if (x === y) return true;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  if (long.startsWith(short) || long.includes(short)) return true;
  const prefixLen = Math.min(72, short.length, long.length);
  if (prefixLen >= 48 && short.slice(0, prefixLen) === long.slice(0, prefixLen)) return true;
  if (short.length >= 48) {
    const head = short.slice(0, Math.min(160, Math.floor(short.length * 0.45)));
    if (head.length >= 40 && long.includes(head)) return true;
  }
  const st = short.split(" ").filter(Boolean);
  const lt = new Set(long.split(" ").filter(Boolean));
  if (st.length < 8) return false;
  const hit = st.filter((t) => lt.has(t)).length / st.length;
  return hit >= 0.86 && short.length / long.length >= 0.45;
}

function shareDumpPrefix(a, b) {
  const x = normCaption(a);
  const y = normCaption(b);
  const n = 56;
  if (x.length < n || y.length < n) return false;
  return x.slice(0, n) === y.slice(0, n);
}

export function collapseGrowingCaptions(entries) {
  const src = Array.isArray(entries) ? entries : [];
  if (!src.length) return { entries: [], indexMap: [], changed: false };

  const dumpFlags = src.map((e) => isCaptionHistoryDump(e.text, e.speaker));
  const realCount = dumpFlags.filter((d) => !d).length;
  const dropDumps = realCount >= 5;

  const out = [];
  const indexMap = [];

  for (let i = 0; i < src.length; i++) {
    const e = src[i];
    if (dumpFlags[i] && dropDumps) {
      indexMap[i] = -1;
      continue;
    }

    let into = -1;
    if (out.length && sameSpeaker(out[out.length - 1].speaker, e.speaker)) {
      const prev = out[out.length - 1];
      const px = normCaption(prev.text);
      const py = normCaption(e.text);
      const n = Math.min(12, px.length, py.length);
      if (n >= 12 && px.slice(0, n) === py.slice(0, n) && py.length >= px.length) {
        into = out.length - 1;
      } else if (isCaptionRevision(prev.text, e.text)) {
        into = out.length - 1;
      }
    }
    if (into < 0) {
      const start = dumpFlags[i] ? 0 : Math.max(0, out.length - 12);
      for (let j = out.length - 1; j >= start; j--) {
        if (!sameSpeaker(out[j].speaker, e.speaker) && !dumpFlags[i]) continue;
        const related = dumpFlags[i]
          ? shareDumpPrefix(out[j].text, e.text) || isCaptionRevision(out[j].text, e.text)
          : isCaptionRevision(out[j].text, e.text);
        if (related) {
          into = j;
          break;
        }
      }
    }

    if (into >= 0) {
      const keepLonger = String(e.text || "").length >= String(out[into].text || "").length;
      if (keepLonger) {
        out[into] = {
          ...out[into],
          text: e.text,
          timestamp: e.timestamp || out[into].timestamp,
          _ts: e._ts || out[into]._ts,
        };
      }
      indexMap[i] = into;
    } else {
      indexMap[i] = out.length;
      out.push({ ...e });
    }
  }

  // If we kept dumps (not enough real lines), keep only the longest dump family.
  if (!dropDumps) {
    const dumpIdx = out
      .map((e, i) => (isCaptionHistoryDump(e.text, e.speaker) ? i : -1))
      .filter((i) => i >= 0);
    if (dumpIdx.length > 1) {
      let best = dumpIdx[0];
      for (const i of dumpIdx) {
        if (String(out[i].text || "").length > String(out[best].text || "").length) best = i;
      }
      const keep = new Set([best]);
      const compacted = [];
      const remap = [];
      for (let i = 0; i < out.length; i++) {
        if (dumpIdx.includes(i) && !keep.has(i)) {
          remap[i] = best;
          continue;
        }
        remap[i] = compacted.length;
        compacted.push(out[i]);
      }
      for (let i = 0; i < indexMap.length; i++) {
        if (indexMap[i] >= 0) indexMap[i] = remap[indexMap[i]] ?? -1;
      }
      return { entries: compacted, indexMap, changed: true };
    }
  }

  return { entries: out, indexMap, changed: out.length !== src.length };
}
