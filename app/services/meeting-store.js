import Storage from "./storage.js";
import { parseActionItemsFromMarkdown, mergeActionItemLists } from "./action-item-parse.js";
import { collapseGrowingCaptions } from "./transcript-dedupe.js";

const META_KEY = "meetings_meta";

function generateId() {
  return "meet-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

async function getMetaList() {
  const result = await Storage.get(META_KEY);
  return result[META_KEY] || [];
}

async function setMetaList(list) {
  await Storage.set({ [META_KEY]: list });
}

function buildMeta(meeting) {
  return {
    id: meeting.id,
    title: meeting.title || "Untitled Meeting",
    date: meeting.date || new Date().toISOString(),
    duration: meeting.duration || "0 mins",
    participantCount: (meeting.participants || []).length,
    status: meeting.status || "completed",
    isFavorite: meeting.isFavorite || false,
    isPinned: meeting.isPinned || false,
    tags: meeting.tags || [],
    platform: meeting.platform || "meet",
    isPrivate: !!meeting.isPrivate,
    spaceIds: meeting.spaceIds || [],
    recordingUrl: meeting.recordingUrl || "",
    summaryPreview: meeting.summaryPreview || "",
    actionItemCount: (meeting.actionItems || []).length,
  };
}

const MeetingStore = {
  async saveMeeting(meeting) {
    if (!meeting.id) meeting.id = generateId();
    if (!meeting.date) meeting.date = new Date().toISOString();
    if (!meeting.status) meeting.status = "completed";

    await Storage.set({ [`meeting_${meeting.id}`]: meeting });

    const meta = buildMeta(meeting);
    const list = await getMetaList();
    const idx = list.findIndex((m) => m.id === meeting.id);
    if (idx >= 0) {
      list[idx] = meta;
    } else {
      list.unshift(meta);
    }
    await setMetaList(list);

    // Durable folder backup (no-op when user chose local-only / not granted)
    try {
      const { writeMeetingFile } = await import("./folder-backup.js");
      writeMeetingFile(meeting).catch(() => {});
    } catch (_) {}

    return meeting.id;
  },

  async getMeeting(id) {
    const result = await Storage.get(`meeting_${id}`);
    const meeting = result[`meeting_${id}`] || null;
    if (!meeting?.transcript?.length) return meeting;
    const { entries, indexMap, changed } = collapseGrowingCaptions(meeting.transcript);
    if (!changed) return meeting;
    meeting.transcript = entries;
    const pack = meeting.transcriptIntelligence;
    if (pack?.annotations?.length) {
      pack.annotations = pack.annotations
        .map((a) => ({
          ...a,
          entryIndex: Number.isInteger(a.entryIndex) ? (indexMap[a.entryIndex] ?? a.entryIndex) : a.entryIndex,
        }))
        .filter((a) => !Number.isInteger(a.entryIndex) || a.entryIndex >= 0);
    }
    Storage.set({ [`meeting_${id}`]: meeting }).catch(() => {});
    return meeting;
  },

  async listMeetings(filter) {
    const list = await getMetaList();
    if (!filter) return list;

    const q = filter.toLowerCase();
    return list.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
    );
  },

  async deleteMeeting(id) {
    const list = await getMetaList();
    const newList = list.filter((m) => m.id !== id);
    await setMetaList(newList);

    const keys = [
      `meeting_${id}`,
      `ai_conv_${id}`,
      `ai_summaries_${id}`,
    ];
    await Storage.remove(keys);

    try {
      const { removeMeetingFile } = await import("./folder-backup.js");
      removeMeetingFile(id).catch(() => {});
    } catch (_) {}
  },

  async updateMeetingMeta(id, updates) {
    const meeting = await MeetingStore.getMeeting(id);
    if (!meeting) return;
    Object.assign(meeting, updates);
    await MeetingStore.saveMeeting(meeting);
  },

  async toggleFavorite(id) {
    const meeting = await MeetingStore.getMeeting(id);
    if (!meeting) return;
    meeting.isFavorite = !meeting.isFavorite;
    await MeetingStore.saveMeeting(meeting);
    return meeting.isFavorite;
  },

  async togglePin(id) {
    const meeting = await MeetingStore.getMeeting(id);
    if (!meeting) return;
    meeting.isPinned = !meeting.isPinned;
    await MeetingStore.saveMeeting(meeting);
    return meeting.isPinned;
  },

  async getFavorites() {
    const list = await getMetaList();
    return list.filter((m) => m.isFavorite);
  },

  async getPinned() {
    const list = await getMetaList();
    return list.filter((m) => m.isPinned);
  },

  async getTodaysMeetings() {
    const list = await getMetaList();
    const today = new Date().toDateString();
    return list.filter((m) => new Date(m.date).toDateString() === today);
  },

  // Tags
  async setTags(id, tags) {
    await MeetingStore.updateMeetingMeta(id, { tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))] });
  },

  async getAllTags() {
    const list = await getMetaList();
    const set = new Set();
    list.forEach((m) => (m.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  },

  // Speaker rename — rewrites every transcript entry + the participants list
  // so a mis-detected name gets fixed everywhere at once.
  async renameSpeaker(id, oldName, newName) {
    const meeting = await MeetingStore.getMeeting(id);
    if (!meeting || !newName || oldName === newName) return meeting;
    meeting.transcript = (meeting.transcript || []).map((e) =>
      e.speaker === oldName ? { ...e, speaker: newName } : e
    );
    meeting.participants = [...new Set((meeting.participants || []).map((p) => (p === oldName ? newName : p)))];
    await MeetingStore.saveMeeting(meeting);
    return meeting;
  },

  // Bookmarks / highlighted moments captured during recording (or added later).
  async addBookmark(id, bookmark) {
    const meeting = await MeetingStore.getMeeting(id);
    if (!meeting) return;
    meeting.bookmarks = meeting.bookmarks || [];
    meeting.bookmarks.push({
      id: "bm-" + Date.now(),
      label: bookmark.label || "Highlight",
      timestamp: bookmark.timestamp || "",
      _ts: bookmark._ts || Date.now(),
      entryIndex: typeof bookmark.entryIndex === "number" ? bookmark.entryIndex : -1,
    });
    await MeetingStore.saveMeeting(meeting);
    return meeting.bookmarks;
  },

  async removeBookmark(id, bookmarkId) {
    const meeting = await MeetingStore.getMeeting(id);
    if (!meeting) return;
    meeting.bookmarks = (meeting.bookmarks || []).filter((b) => b.id !== bookmarkId);
    await MeetingStore.saveMeeting(meeting);
    return meeting.bookmarks;
  },

  // Action items — an editable, checkable list distinct from the free-form
  // AI summary text, so ticking one off persists across sessions.
  async setActionItems(id, items) {
    await MeetingStore.updateMeetingMeta(id, { actionItems: items });
  },

  async collectNotesMarkdown(meetingId) {
    const parts = [];
    const summaries = await MeetingStore.getSummaries(meetingId);
    for (const entry of Object.values(summaries || {})) {
      if (entry?.content) parts.push(String(entry.content));
    }
    const conv = await MeetingStore.getAIConversation(meetingId);
    for (const msg of conv || []) {
      if (msg?.role === "assistant" && msg.content) parts.push(String(msg.content));
    }
    return parts.join("\n\n");
  },

  async mergeParsedActionItems(meetingId, markdown, existingItems) {
    const parsed = parseActionItemsFromMarkdown(markdown);
    if (!parsed.length) return existingItems || [];
    const meeting = existingItems ? { actionItems: existingItems } : await MeetingStore.getMeeting(meetingId);
    if (!meeting && !existingItems) return [];
    const merged = mergeActionItemLists(meeting.actionItems || existingItems || [], parsed);
    const before = (meeting.actionItems || existingItems || []).length;
    if (merged.length > before) {
      await MeetingStore.setActionItems(meetingId, merged);
    }
    return merged;
  },

  async addActionItems(meetingId, incoming) {
    const meeting = await MeetingStore.getMeeting(meetingId);
    if (!meeting) return { addedCount: 0, items: [] };
    const before = meeting.actionItems || [];
    const merged = mergeActionItemLists(before, incoming);
    const addedCount = merged.length - before.length;
    if (addedCount > 0) {
      await MeetingStore.setActionItems(meetingId, merged);
    }
    return { addedCount, items: merged };
  },

  async hydrateActionItemsFromStoredNotes(meeting) {
    if (!meeting?.id) return meeting?.actionItems || [];
    const markdown = await MeetingStore.collectNotesMarkdown(meeting.id);
    if (!markdown.trim()) return meeting.actionItems || [];
    const merged = mergeActionItemLists(
      meeting.actionItems || [],
      parseActionItemsFromMarkdown(markdown)
    );
    if (merged.length > (meeting.actionItems || []).length) {
      await MeetingStore.setActionItems(meeting.id, merged);
      meeting.actionItems = merged;
    }
    return merged;
  },

  async updateActionItem(meetingId, itemId, updates) {
    const meeting = await MeetingStore.getMeeting(meetingId);
    if (!meeting) return null;
    let found = false;
    meeting.actionItems = (meeting.actionItems || []).map((it) => {
      if (it.id !== itemId) return it;
      found = true;
      return { ...it, ...updates };
    });
    if (!found) return null;
    await MeetingStore.saveMeeting(meeting);
    return meeting.actionItems;
  },

  async deleteActionItem(meetingId, itemId) {
    const meeting = await MeetingStore.getMeeting(meetingId);
    if (!meeting) return null;
    meeting.actionItems = (meeting.actionItems || []).filter((it) => it.id !== itemId);
    await MeetingStore.saveMeeting(meeting);
    return meeting.actionItems;
  },

  /**
   * Aggregate action items from every stored meeting (same underlying data).
   * Each row includes meeting source + best-effort transcript entry index.
   */
  async listAllActionItems() {
    const list = await getMetaList();
    const rows = [];
    for (const meta of list) {
      const meeting = await MeetingStore.getMeeting(meta.id);
      if (!meeting) continue;
      if (!(meeting.actionItems || []).length) {
        await MeetingStore.hydrateActionItemsFromStoredNotes(meeting);
      }
      const anns = meeting.transcriptIntelligence?.annotations || [];
      for (const it of meeting.actionItems || []) {
        if (!(it.text || "").trim()) continue;
        let sourceEntryIndex =
          typeof it.sourceEntryIndex === "number" ? it.sourceEntryIndex : -1;
        if (sourceEntryIndex < 0) {
          const linked = anns.find(
            (a) => !a.dismissed && a.linkedActionItemId === it.id && typeof a.entryIndex === "number"
          );
          if (linked) sourceEntryIndex = linked.entryIndex;
        }
        rows.push({
          ...it,
          meetingId: meeting.id,
          meetingTitle: meeting.title || meta.title || "Untitled Meeting",
          meetingDate: meeting.date || meta.date || "",
          meetingPlatform: meeting.platform || meta.platform || "meet",
          meetingRecordedBy: meeting.recordedBy || "",
          sourceEntryIndex,
        });
      }
    }
    // Newest meetings / items first
    rows.sort((a, b) => {
      const da = new Date(b.meetingDate).getTime() - new Date(a.meetingDate).getTime();
      if (da !== 0) return da;
      return String(b.id).localeCompare(String(a.id));
    });
    return rows;
  },

  async setTranscriptIntelligence(id, pack) {
    await MeetingStore.updateMeetingMeta(id, { transcriptIntelligence: pack });
    return pack;
  },

  async dismissTranscriptAnnotation(id, annotationId) {
    const meeting = await MeetingStore.getMeeting(id);
    if (!meeting) return null;
    const pack = meeting.transcriptIntelligence || { annotations: [] };
    pack.annotations = (pack.annotations || []).map((a) =>
      a.id === annotationId ? { ...a, dismissed: true } : a
    );
    meeting.transcriptIntelligence = pack;
    await MeetingStore.saveMeeting(meeting);
    return meeting;
  },

  async setMeetingScore(id, scorePack) {
    await MeetingStore.updateMeetingMeta(id, { meetingScore: scorePack });
    return scorePack;
  },

  async setTopicNavigation(id, pack) {
    await MeetingStore.updateMeetingMeta(id, { topicNavigation: pack });
    return pack;
  },

  async setCommitmentDetection(id, pack) {
    await MeetingStore.updateMeetingMeta(id, { commitmentDetection: pack });
    return pack;
  },

  async toggleActionItem(id, itemId) {
    const meeting = await MeetingStore.getMeeting(id);
    if (!meeting) return;
    meeting.actionItems = (meeting.actionItems || []).map((it) =>
      it.id === itemId ? { ...it, done: !it.done } : it
    );
    await MeetingStore.saveMeeting(meeting);
    return meeting.actionItems;
  },

  // Full-text search across every stored transcript, not just titles.
  async searchTranscripts(query) {
    if (!query || !query.trim()) return [];
    const q = query.toLowerCase();
    const list = await getMetaList();
    const results = [];
    for (const metaEntry of list) {
      const meeting = await MeetingStore.getMeeting(metaEntry.id);
      if (!meeting) continue;
      const matches = (meeting.transcript || []).filter((e) => (e.text || "").toLowerCase().includes(q));
      if (matches.length > 0 || (meeting.title || "").toLowerCase().includes(q)) {
        results.push({ meeting: metaEntry, matches: matches.slice(0, 3), matchCount: matches.length });
      }
    }
    return results;
  },

  // Used by the "Ask across all meetings" feature to build AI context
  // without loading every single meeting ever recorded.
  async getRecentFull(limit = 20) {
    const list = await getMetaList();
    const sorted = [...list].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limit);
    const full = [];
    for (const m of sorted) {
      const meeting = await MeetingStore.getMeeting(m.id);
      if (meeting) full.push(meeting);
    }
    return full;
  },

  // AI Conversation
  async addAIMessage(meetingId, message) {
    const key = `ai_conv_${meetingId}`;
    const result = await Storage.get(key);
    const conv = result[key] || [];
    conv.push({
      ...message,
      timestamp: new Date().toISOString(),
    });
    await Storage.set({ [key]: conv });
    if (message?.role === "assistant" && message.content) {
      try {
        await MeetingStore.mergeParsedActionItems(meetingId, message.content);
      } catch (_) {}
    }
    return conv;
  },

  async getAIConversation(meetingId) {
    const key = `ai_conv_${meetingId}`;
    const result = await Storage.get(key);
    return result[key] || [];
  },

  async clearAIConversation(meetingId) {
    await Storage.remove(`ai_conv_${meetingId}`);
  },

  // Summaries
  async saveSummary(meetingId, type, content, extra = {}) {
    const key = `ai_summaries_${meetingId}`;
    const result = await Storage.get(key);
    const summaries = result[key] || {};
    summaries[type] = {
      content,
      generated: new Date().toISOString(),
      ...extra,
    };
    await Storage.set({ [key]: summaries });
    if (content && type !== "chatIndex") {
      try {
        await MeetingStore.mergeParsedActionItems(meetingId, content);
      } catch (_) {}
    }
  },

  async getSummaries(meetingId) {
    const key = `ai_summaries_${meetingId}`;
    const result = await Storage.get(key);
    return result[key] || {};
  },

  // Cross-meeting "Ask AI" conversation (not tied to a single meeting id).
  async addGlobalMessage(message) {
    const key = "ai_conv_global";
    const result = await Storage.get(key);
    const conv = result[key] || [];
    conv.push({ ...message, timestamp: new Date().toISOString() });
    await Storage.set({ [key]: conv });
    return conv;
  },

  async getGlobalConversation() {
    const result = await Storage.get("ai_conv_global");
    return result.ai_conv_global || [];
  },

  async clearGlobalConversation() {
    await Storage.remove("ai_conv_global");
  },

  async togglePrivate(id) {
    const meeting = await MeetingStore.getMeeting(id);
    if (!meeting) return;
    meeting.isPrivate = !meeting.isPrivate;
    await MeetingStore.saveMeeting(meeting);
    return meeting.isPrivate;
  },

  async setRecordingUrl(id, url) {
    await MeetingStore.updateMeetingMeta(id, { recordingUrl: (url || "").trim() });
  },

  async setMeetingSpaces(id, spaceIds) {
    await MeetingStore.updateMeetingMeta(id, {
      spaceIds: [...new Set((spaceIds || []).filter(Boolean))],
    });
  },

  async listSpaces() {
    const result = await Storage.get("meeting_spaces");
    return result.meeting_spaces || [];
  },

  async saveSpaces(spaces) {
    await Storage.set({ meeting_spaces: spaces || [] });
  },

  async createSpace(name) {
    const spaces = await MeetingStore.listSpaces();
    const space = {
      id: "space-" + Date.now().toString(36),
      name: (name || "").trim() || "Untitled space",
      createdAt: new Date().toISOString(),
    };
    spaces.push(space);
    await MeetingStore.saveSpaces(spaces);
    return space;
  },

  async deleteSpace(spaceId) {
    const spaces = (await MeetingStore.listSpaces()).filter((s) => s.id !== spaceId);
    await MeetingStore.saveSpaces(spaces);
    const list = await getMetaList();
    for (const meta of list) {
      if ((meta.spaceIds || []).includes(spaceId)) {
        const meeting = await MeetingStore.getMeeting(meta.id);
        if (!meeting) continue;
        meeting.spaceIds = (meeting.spaceIds || []).filter((id) => id !== spaceId);
        await MeetingStore.saveMeeting(meeting);
      }
    }
  },

  async addMeetingToSpace(meetingId, spaceId) {
    const meeting = await MeetingStore.getMeeting(meetingId);
    if (!meeting || !spaceId) return;
    const set = new Set(meeting.spaceIds || []);
    set.add(spaceId);
    meeting.spaceIds = [...set];
    await MeetingStore.saveMeeting(meeting);
    return meeting.spaceIds;
  },

  async removeMeetingFromSpace(meetingId, spaceId) {
    const meeting = await MeetingStore.getMeeting(meetingId);
    if (!meeting) return;
    meeting.spaceIds = (meeting.spaceIds || []).filter((id) => id !== spaceId);
    await MeetingStore.saveMeeting(meeting);
    return meeting.spaceIds;
  },

  async listBySpace(spaceId) {
    const list = await getMetaList();
    return list.filter((m) => (m.spaceIds || []).includes(spaceId));
  },

  generateId,
};

export default MeetingStore;
