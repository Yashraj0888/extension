// Google Meet Auto Note-Taker v7
// Saves meetings to chrome.storage.local for the AI Notes app

(function () {
  if (window.__aiNoteTakerInjected) return;
  window.__aiNoteTakerInjected = true;

  // State
  const transcriptEntries = [];
  const bookmarks = [];
  const nodeLastText = new WeakMap();
  const participants = new Set();
  // Per caption-block DOM node: the full raw text last captured from it. Blocks
  // accumulate sentences as the person keeps talking, so on every poll we diff
  // against this to emit only the NEW words, never the whole growing block.
  const blockLastText = new WeakMap();
  let isRecording = true;
  let meetingStartTime = new Date();
  let widgetEl = null;
  let isGenerating = false;
  let exportDispatched = false;
  let pollInterval = null;
  let captionObserver = null;
  let harvestTimer = null;
  let ccInitialized = false;
  let meetingId = null;
  let saveInterval = null;
  let capturePromptShown = false;
  let bootStarted = false;
  let promptInFlight = false;
  let localUserName = '';
  let participantCountHint = 0;
  const MAX_LINES_PER_ENTRY = 10;
  /** Widget chrome mode: expanded | minimized | mini */
  let widgetMode = "mini";
  let recordingStartedAt = Date.now();
  let accumulatedMs = 0;
  let durationTimer = null;
  let liveSpeakerName = "";
  let settleTimer = null;
  const CAPTION_SETTLE_MS = 2000;

  const ICON = {
    minus: `<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>`,
    expand: `<svg viewBox="0 0 24 24"><path d="M8 5H5v3"/><path d="M16 19h3v-3"/><path d="M5 8l4-4"/><path d="m19 16-4 4"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="M17 7 7 17"/><path d="m7 7 10 10"/></svg>`,
    wave: `<svg viewBox="0 0 24 24"><path d="M2 12h2"/><path d="M6 8v8"/><path d="M10 5v14"/><path d="M14 8v8"/><path d="M18 10v4"/><path d="M22 12h-2"/></svg>`,
    spark: `<svg viewBox="0 0 24 24"><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.6 5.6 2.1 2.1"/><path d="m16.3 16.3 2.1 2.1"/><path d="m16.3 5.6-2.1 2.1"/><path d="m5.6 18.4 2.1-2.1"/></svg>`,
    external: `<svg viewBox="0 0 24 24"><path d="M14 5h5v5"/><path d="m19 5-8 8"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
    pause: `<svg viewBox="0 0 24 24"><path d="M9 7v10"/><path d="M15 7v10"/></svg>`,
    play: `<svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5z"/></svg>`,
    check: `<svg viewBox="0 0 24 24"><path d="m7 12 3 3 7-7"/></svg>`,
    file: `<svg viewBox="0 0 24 24"><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/></svg>`,
    users: `<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  };

  function getElapsedMs() {
    if (isRecording) return accumulatedMs + (Date.now() - recordingStartedAt);
    return accumulatedMs;
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function avatarColor(name) {
    let h = 0;
    const str = String(name || "?");
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    const hue = Math.abs(h) % 360;
    return `hsl(${hue} 42% 42%)`;
  }

  function initialsOf(name) {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function escapeWidgetHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function generateMeetingId() {
    return 'meet-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  function saveMeetingToStorage() {
    if (transcriptEntries.length === 0) return;
    finalizeSpeakersBeforeSave();
    collapseLiveTranscript();
    const meeting = {
      id: meetingId,
      title: getMeetingTitle(),
      date: meetingStartTime.toISOString(),
      duration: Math.round((Date.now() - meetingStartTime.getTime()) / 60000) + ' mins',
      participants: Array.from(participants),
      participantCount: Math.max(participants.size, participantCountHint),
      transcript: transcriptEntries.map(e => ({
        speaker: e.speaker,
        text: e.text,
        timestamp: e.timestamp,
        _ts: e._ts
      })),
      bookmarks: bookmarks.slice(),
      status: 'recording',
      isFavorite: false,
      isPinned: false,
      language: 'en',
      platform: 'meet',
      transcriptConfidence: 0.9,
      recordedBy: getRecordedByName()
    };
    chrome.storage.local.get(['meetings_meta'], (result) => {
      const meta = result.meetings_meta || [];
      const idx = meta.findIndex(m => m.id === meetingId);
      const metaEntry = {
        id: meeting.id,
        title: meeting.title,
        date: meeting.date,
        duration: meeting.duration,
        participantCount: meeting.participantCount,
        status: 'recording',
        isFavorite: false,
        isPinned: false,
        platform: 'meet'
      };
      if (idx >= 0) meta[idx] = metaEntry;
      else meta.unshift(metaEntry);
      chrome.storage.local.set({
        ['meeting_' + meetingId]: meeting,
        meetings_meta: meta
      });
    });
  }

  // Marks the most recently captured line as a highlight the user can jump
  // back to later in the app's Highlights tab (also triggered by Ctrl/Cmd+B).
  function addHighlight() {
    if (transcriptEntries.length === 0) {
      setPreview("Nothing to highlight yet — wait for some speech to be captured.");
      return;
    }
    const idx = transcriptEntries.length - 1;
    const entry = transcriptEntries[idx];
    bookmarks.push({
      id: 'bm-' + Date.now(),
      label: entry.text.slice(0, 70),
      timestamp: entry.timestamp,
      _ts: Date.now(),
      entryIndex: idx
    });
    setPreview('Highlighted — "' + entry.text.slice(0, 60) + '"');
    saveMeetingToStorage();
    ["ai-btn-highlight-moment"].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.add("flash");
      setTimeout(() => btn.classList.remove("flash"), 500);
    });
  }

  function openApp() {
    chrome.storage.local.set({ lastMeetingId: meetingId, openMeetingTab: "summary" }, () => {
      chrome.runtime.sendMessage({ type: "OPEN_APP" });
    });
  }

  function filterTranscriptForScope(scope, focusSpeaker) {
    const formatted = transcriptEntries
      .map((entry) => `[${entry.timestamp}] ${entry.speaker}: ${entry.text}`)
      .join("\n");
    if (scope !== "personal" || !focusSpeaker) return formatted;
    const key = focusSpeaker.toLowerCase();
    const filtered = transcriptEntries.filter((e) => (e.speaker || "").toLowerCase().includes(key) || key.includes((e.speaker || "").toLowerCase()));
    if (!filtered.length) return formatted;
    return filtered.map((entry) => `[${entry.timestamp}] ${entry.speaker}: ${entry.text}`).join("\n");
  }

  async function finishMeetingWithPrefs(isAutoTriggered) {
    freezeDraft();
    if (transcriptEntries.length === 0) {
      if (!isAutoTriggered) {
        uiAlert("No meeting speech captured yet. Make sure captions are ON and people are speaking.", "Nothing to save");
      }
      return;
    }
    if (isGenerating || exportDispatched) return;
    removeWidget();
    isGenerating = true;
    exportDispatched = true;
    if (saveInterval) clearInterval(saveInterval);

    finalizeSpeakersBeforeSave();
    const prefs = await askExportPreferencesForm(Array.from(participants));
    const meetingTitle = getMeetingTitle();
    const duration = Math.round((Date.now() - meetingStartTime.getTime()) / 60000) + " mins";
    const meeting = {
      id: meetingId,
      title: meetingTitle,
      date: meetingStartTime.toISOString(),
      duration,
      participants: Array.from(participants),
      participantCount: Math.max(participants.size, participantCountHint),
      transcript: transcriptEntries.map((e) => ({
        speaker: e.speaker, text: e.text, timestamp: e.timestamp, _ts: e._ts
      })),
      bookmarks: bookmarks.slice(),
      status: "completed",
      isFavorite: false,
      isPinned: false,
      language: "en",
      platform: "meet",
      transcriptConfidence: 0.9,
      recordedBy: getRecordedByName()
    };

    chrome.storage.local.get(["meetings_meta"], (result) => {
      const meta = result.meetings_meta || [];
      const idx = meta.findIndex((m) => m.id === meetingId);
      const metaEntry = {
        id: meeting.id, title: meeting.title, date: meeting.date,
        duration: meeting.duration, participantCount: meeting.participantCount,
        status: "completed", isFavorite: false, isPinned: false, platform: "meet"
      };
      if (idx >= 0) meta[idx] = metaEntry; else meta.unshift(metaEntry);
      chrome.storage.local.set({
        ["meeting_" + meetingId]: meeting,
        meetings_meta: meta,
        lastMeetingId: meetingId,
        openMeetingTab: "summary"
      });
    });

    setPreview("Generating summary…");
    const transcript = filterTranscriptForScope(prefs.scope, prefs.focusSpeaker);

    chrome.runtime.sendMessage(
      {
        type: "AUTO_GENERATE_AND_DOWNLOAD",
        data: {
          transcript,
          meetingTitle,
          participants: Array.from(participants),
          startTime: meetingStartTime.toLocaleString(),
          duration,
          meetingId,
          structured: true,
          summaryScope: prefs.scope,
          focusSpeaker: prefs.focusSpeaker,
          download: !!prefs.download,
          format: prefs.format || "pdf",
          openApp: true
        }
      },
      () => {
        isGenerating = false;
        removeWidget();
      }
    );
  }

  console.log("[AI Note-Taker] v6 loaded on", location.href);

  function isMeetingRoom() {
    // Real Meet rooms use a 3-4-3 lowercase-letter code. Paths such as
    // /home, /landing, /new and /lookup are navigation pages, not calls.
    return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i.test(window.location.pathname);
  }

  function isInActiveMeeting() {
    if (!isMeetingRoom()) return false;
    return Array.from(document.querySelectorAll('button')).some((button) => {
      const label = (button.getAttribute('aria-label') || '').toLowerCase();
      return (
        label.includes('turn on captions') ||
        label.includes('turn off captions') ||
        label.includes('leave call') ||
        label.includes('end call')
      );
    });
  }

  function activateForMeetingRoute() {
    // Left the call (or still on pre-join) — allow asking again on the next join.
    if (!isInActiveMeeting()) {
      if (!bootStarted && !promptInFlight) capturePromptShown = false;
      return;
    }
    if (capturePromptShown || bootStarted) return;
    askToTakeNotesThenBoot();
  }

  // Meet uses client-side navigation. Keep the content script dormant on
  // /home and on the pre-join screen, then activate only after the in-call
  // controls exist. Polling also handles joining through SPA navigation.
  setTimeout(activateForMeetingRoute, 500);
  setInterval(activateForMeetingRoute, 750);

  function askToTakeNotesThenBoot() {
    if (!isInActiveMeeting() || capturePromptShown || bootStarted) return;
    capturePromptShown = true;
    promptInFlight = true;
    const run = async () => {
      try {
        if (!isInActiveMeeting()) {
          capturePromptShown = false;
          return;
        }
        const choice = await showAiModal({
          title: "Record this meeting?",
          body: `<p style="margin:0;color:#3d4f48;font-size:13.5px;line-height:1.5">Do you want AfterMeet to capture captions and take notes for this call?</p>`,
          actions: [
            { id: "no", label: "Not now", secondary: true },
            { id: "yes", label: "Yes, record", primary: true },
          ],
        });
        if (choice === "yes" && isInActiveMeeting()) {
          boot();
        }
        // If declined, stay dormant for this call (capturePromptShown remains true).
      } finally {
        promptInFlight = false;
      }
    };
    if (document.body) run();
    else document.addEventListener("DOMContentLoaded", run, { once: true });
  }

  function boot() {
    if (bootStarted || !isInActiveMeeting()) return;
    bootStarted = true;
    try {
      chrome.storage.local.get(["localDisplayName"], (r) => {
        if (r.localDisplayName) {
          localUserName = r.localDisplayName;
          replaceProvisionalSelfName(localUserName);
          trackSpeaker(localUserName);
        }
      });
      meetingId = generateMeetingId();
      saveMeetingToStorage();
      saveInterval = setInterval(saveMeetingToStorage, 30000);
      initWidget();
      restoreWidgetState();
      autoEnableCaptions();
      setTimeout(autoEnableCaptions, 4000);
      startHarvester();
      setupCallEndDetection();
      setTimeout(diagnose, 5000);
    } catch (e) {
      console.error("[AI Note-Taker] Init error:", e);
      setPreview("Init error: " + e.message);
    }
  }

  function showAiModal({ title, body, actions }) {
    return new Promise((resolve) => {
      const existing = document.getElementById("ai-notetaker-modal");
      if (existing) existing.remove();
      const overlay = document.createElement("div");
      overlay.id = "ai-notetaker-modal";
      overlay.innerHTML = `
        <div class="ai-modal-card" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">
          <div class="ai-modal-header">
            <h3 class="ai-modal-title" id="ai-modal-title">${title}</h3>
            <button type="button" class="ai-modal-close" aria-label="Close" title="Close">${ICON.close}</button>
          </div>
          <div class="ai-modal-body">${body}</div>
          <div class="ai-modal-actions"></div>
        </div>`;
      const actionsEl = overlay.querySelector(".ai-modal-actions");
      const cancelId = () => {
        const cancel = (actions || []).find((a) => a.id === "cancel" || a.secondary);
        return cancel ? cancel.id : (actions[0] && actions[0].id);
      };
      const finish = (value) => {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(cancelId());
        }
      };
      document.addEventListener("keydown", onKey);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) finish(cancelId());
      });
      overlay.querySelector(".ai-modal-close").addEventListener("click", () => finish(cancelId()));
      for (const a of actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = a.primary ? "ai-modal-btn primary" : a.secondary ? "ai-modal-btn secondary" : "ai-modal-btn";
        btn.textContent = a.label;
        btn.addEventListener("click", () => finish(a.id));
        actionsEl.appendChild(btn);
      }
      (document.body || document.documentElement).appendChild(overlay);
      const primary = actionsEl.querySelector(".primary") || actionsEl.querySelector("button");
      setTimeout(() => primary?.focus(), 20);
    });
  }

  function uiAlert(message, title = "Notice") {
    return showAiModal({
      title,
      body: `<p style="margin:0;color:#3d4f48;font-size:13.5px;line-height:1.5">${message}</p>`,
      actions: [{ id: "ok", label: "OK", primary: true }],
    });
  }

  function uiConfirm(message, title = "Confirm") {
    return showAiModal({
      title,
      body: `<p style="margin:0;color:#3d4f48;font-size:13.5px;line-height:1.5">${message}</p>`,
      actions: [
        { id: "cancel", label: "Cancel", secondary: true },
        { id: "ok", label: "Confirm", primary: true },
      ],
    }).then((id) => id === "ok");
  }

  function askExportPreferencesForm(participantsList) {
    return new Promise((resolve) => {
      const existing = document.getElementById("ai-notetaker-modal");
      if (existing) existing.remove();
      const people = (participantsList || []).filter(Boolean);
      const opts = people
        .map((p) => `<option value="${String(p).replace(/"/g, "&quot;")}">${String(p).replace(/</g, "")}</option>`)
        .join("");
      const overlay = document.createElement("div");
      overlay.id = "ai-notetaker-modal";
      overlay.innerHTML = `
        <div class="ai-modal-card" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">
          <div class="ai-modal-header">
            <h3 class="ai-modal-title" id="ai-modal-title">Meeting finished</h3>
            <button type="button" class="ai-modal-close" aria-label="Close" title="Close">${ICON.close}</button>
          </div>
          <div class="ai-modal-body">
            <p style="margin:0 0 10px;color:#3d4f48;font-size:13px;line-height:1.45">We’ll open the summary page next. Choose what to include:</p>
            <label class="ai-modal-label">Summary scope</label>
            <div class="ai-modal-radios">
              <label><input type="radio" name="ai-scope" value="full" checked /> Entire meeting</label>
              <label><input type="radio" name="ai-scope" value="personal" /> My parts only</label>
            </div>
            <label class="ai-modal-label" for="ai-focus-speaker">Your display name (for “my parts”)</label>
            <select id="ai-focus-speaker" class="ai-modal-select">
              <option value="">Select your name…</option>
              ${opts}
            </select>
            <input id="ai-focus-custom" class="ai-modal-input" type="text" placeholder="Or type your Meet display name" />
            <label class="ai-modal-check"><input type="checkbox" id="ai-want-download" /> Download a structured summary file</label>
            <label class="ai-modal-label" for="ai-export-format">File format</label>
            <select id="ai-export-format" class="ai-modal-select">
              <option value="pdf" selected>PDF (.pdf)</option>
              <option value="doc">Word (.doc)</option>
              <option value="md">Markdown (.md)</option>
              <option value="txt">Plain text (.txt)</option>
              <option value="rtf">Rich text (.rtf)</option>
              <option value="html">HTML report (.html)</option>
            </select>
            <p style="margin:8px 0 0;font-size:11px;color:#6b7c75;line-height:1.4">Structured doc order: Central Theme → Tasks → Action Items → Tasks by Person.</p>
          </div>
          <div class="ai-modal-actions">
            <button type="button" class="ai-modal-btn skip" data-act="open">Continue without it</button>
            <button type="button" class="ai-modal-btn primary" data-act="go">Generate &amp; continue</button>
          </div>
        </div>`;
      chrome.storage.sync.get(["docFormat", "autoDownloadSummary"], (s) => {
        const sel = overlay.querySelector("#ai-export-format");
        if (sel && s.docFormat) sel.value = s.docFormat;
        const dl = overlay.querySelector("#ai-want-download");
        if (dl && s.autoDownloadSummary !== false) dl.checked = true;
      });
      chrome.storage.local.get(["localDisplayName"], (local) => {
        const preferred = local.localDisplayName || localUserName;
        if (!preferred) return;
        const select = overlay.querySelector("#ai-focus-speaker");
        const custom = overlay.querySelector("#ai-focus-custom");
        if (select) {
          select.value = preferred;
          if (!select.value && custom) custom.value = preferred;
        }
      });
      const finish = (forceNoDownload) => {
        const scope = (overlay.querySelector('input[name="ai-scope"]:checked') || {}).value || "full";
        const focus =
          (overlay.querySelector("#ai-focus-custom").value || "").trim() ||
          (overlay.querySelector("#ai-focus-speaker").value || "").trim();
        const wantDownload = forceNoDownload ? false : !!overlay.querySelector("#ai-want-download").checked;
        const format = overlay.querySelector("#ai-export-format").value || "pdf";
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve({
          scope,
          focusSpeaker: focus,
          download: wantDownload,
          format,
          structured: true,
        });
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(true);
        }
      };
      overlay.querySelector('[data-act="open"]').addEventListener("click", () => finish(true));
      overlay.querySelector('[data-act="go"]').addEventListener("click", () => finish(false));
      // Close = open summary only (no download), so the meeting still saves.
      overlay.querySelector(".ai-modal-close").addEventListener("click", () => finish(true));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) finish(true);
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(overlay);
    });
  }

  // ============ WIDGET ============
  function initWidget() {
    if (document.getElementById("ai-notetaker-widget")) return;

    widgetEl = document.createElement("div");
    widgetEl.id = "ai-notetaker-widget";
    widgetEl.className = "widget-mini";
    widgetEl.innerHTML = `
      <div class="w-expanded">
        <div class="w-header" id="ai-widget-header">
          <div class="w-header-left">
            <span class="status-dot" id="ai-status-dot"></span>
            <span class="w-brand">AfterMeet</span>
          </div>
          <div class="w-header-right">
            <span class="w-duration" id="ai-duration">00:00</span>
            <button type="button" id="ai-btn-minimize" class="btn-window" title="Minimize" aria-label="Minimize">${ICON.minus}</button>
            <button type="button" id="ai-btn-close" class="btn-window btn-close" title="Close & stop recording" aria-label="Close and stop recording">${ICON.close}</button>
          </div>
        </div>
        <div class="w-status-row">
          <span class="w-wave" aria-hidden="true">${ICON.wave}</span>
          <span class="w-status-text" id="ai-status-text">Capturing captions…</span>
          <select id="ai-lang-select" class="w-lang" title="Caption language preference" aria-label="Caption language">
            <option value="en-auto" selected>English (Auto)</option>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
          </select>
        </div>
        <div class="w-transcript" id="ai-preview-box">
          <div class="w-transcript-list" id="ai-transcript-list">
            <div class="w-transcript-empty" id="ai-preview-text">Listening for meeting speech…</div>
          </div>
        </div>
        <button type="button" id="ai-btn-highlight-moment" class="w-highlight-moment" title="Highlight this moment (Ctrl/Cmd+B)">
          ${ICON.spark} Highlight moment
        </button>
        <div class="w-stats" id="ai-stats-row">
          <div class="w-stat">${ICON.file}<span id="ai-stat-lines">0 lines</span></div>
          <div class="w-stat">${ICON.users}<span id="ai-stat-people">0 people</span></div>
          <div class="w-stat">${ICON.clock}<span id="ai-stat-mins">0 min</span></div>
        </div>
        <div class="w-actions">
          <button type="button" id="ai-btn-pause" class="w-btn-pause" title="Pause recording" aria-label="Pause recording">${ICON.pause} Pause</button>
          <button type="button" id="ai-btn-finish" class="w-btn-finish" title="Finish and view notes">${ICON.check} Finish</button>
        </div>
        <div class="w-footer-links">
          <button type="button" id="ai-btn-open" class="w-link-btn" title="Open notes app">${ICON.external} Open notes</button>
          <button type="button" id="ai-btn-clear" class="w-clear" title="Clear transcript">Clear transcript</button>
        </div>
      </div>

      <div class="w-compact" id="ai-compact-bar" title="Double-click to expand">
        <div class="w-compact-main">
          <div class="w-compact-title">
            <span class="status-dot" id="ai-status-dot-compact"></span>
            <span>AfterMeet</span>
          </div>
          <div class="w-compact-sub" id="ai-compact-sub">Capturing captions</div>
        </div>
        <div class="w-compact-right">
          <span class="w-wave" aria-hidden="true">${ICON.wave}</span>
          <span class="w-duration" id="ai-duration-compact">00:00</span>
          <button type="button" class="w-compact-resume" id="ai-btn-resume-compact" title="Resume recording">${ICON.play} Resume</button>
          <button type="button" class="w-compact-finish" id="ai-btn-finish-compact" title="Finish meeting">${ICON.check} Finish</button>
          <button type="button" id="ai-btn-mini" class="btn-window" title="Collapse to pill" aria-label="Collapse to pill">${ICON.minus}</button>
          <button type="button" id="ai-btn-expand" class="btn-window" title="Expand" aria-label="Expand">${ICON.expand}</button>
          <button type="button" id="ai-btn-close-compact" class="btn-window btn-close" title="Close & stop recording" aria-label="Close">${ICON.close}</button>
        </div>
      </div>

      <div class="w-pill" id="ai-pill-bar" title="Double-click to expand">
        <span class="status-dot" id="ai-status-dot-pill"></span>
        <span class="w-wave" aria-hidden="true">${ICON.wave}</span>
        <span class="w-duration" id="ai-duration-pill">00:00</span>
        <button type="button" class="w-pill-btn" id="ai-btn-pause-pill" title="Pause / Resume" aria-label="Pause or resume">${ICON.pause}</button>
        <button type="button" class="w-pill-btn" id="ai-btn-expand-pill" title="Expand" aria-label="Expand">${ICON.expand}</button>
        <div class="w-pill-tip" id="ai-pill-tip">
          <div class="w-pill-tip-status" id="ai-pill-tip-status">Capturing captions</div>
          <div class="w-pill-tip-meta" id="ai-pill-tip-meta">0 lines · 0 people · 0 min</div>
        </div>
      </div>
    `;
    document.body.appendChild(widgetEl);

    startDurationTimer();

    document.getElementById("ai-btn-open").addEventListener("click", openApp);
    document.getElementById("ai-btn-finish").addEventListener("click", () => onFinishAndExport(false));
    document.getElementById("ai-btn-finish-compact").addEventListener("click", (e) => {
      e.stopPropagation();
      onFinishAndExport(false);
    });
    document.getElementById("ai-btn-highlight-moment").addEventListener("click", addHighlight);
    document.getElementById("ai-btn-pause").addEventListener("click", toggleRecording);
    document.getElementById("ai-btn-pause-pill").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleRecording();
    });
    document.getElementById("ai-btn-resume-compact").addEventListener("click", (e) => {
      e.stopPropagation();
      if (!isRecording) toggleRecording();
    });
    document.getElementById("ai-btn-clear").addEventListener("click", clearTranscript);
    document.getElementById("ai-btn-minimize").addEventListener("click", (e) => {
      e.stopPropagation();
      setWidgetMode("minimized");
    });
    document.getElementById("ai-btn-mini").addEventListener("click", (e) => {
      e.stopPropagation();
      setWidgetMode("mini");
    });
    document.getElementById("ai-btn-expand").addEventListener("click", (e) => {
      e.stopPropagation();
      setWidgetMode("expanded");
    });
    document.getElementById("ai-btn-expand-pill").addEventListener("click", (e) => {
      e.stopPropagation();
      setWidgetMode("expanded");
    });
    document.getElementById("ai-btn-close").addEventListener("click", stopAndClose);
    document.getElementById("ai-btn-close-compact").addEventListener("click", (e) => {
      e.stopPropagation();
      stopAndClose();
    });

    document.getElementById("ai-compact-bar")?.addEventListener("dblclick", () => setWidgetMode("expanded"));
    document.getElementById("ai-pill-bar")?.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      widgetEl.classList.toggle("tip-open");
    });
    document.getElementById("ai-pill-bar")?.addEventListener("dblclick", () => setWidgetMode("expanded"));

    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        addHighlight();
      }
    });

    syncWidgetChrome();
    renderTranscriptPreview();
    updateWidgetStats();
  }

  function startDurationTimer() {
    if (durationTimer) clearInterval(durationTimer);
    durationTimer = setInterval(() => {
      const label = formatDuration(getElapsedMs());
      ["ai-duration", "ai-duration-compact", "ai-duration-pill"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = label;
      });
      const minsEl = document.getElementById("ai-stat-mins");
      if (minsEl) {
        const mins = Math.max(0, Math.floor(getElapsedMs() / 60000));
        minsEl.textContent = `${mins} min`;
      }
    }, 1000);
  }

  function setWidgetMode(mode) {
    if (!widgetEl) return;
    widgetMode = mode === "minimized" || mode === "mini" ? mode : "expanded";
    widgetEl.classList.remove("widget-mode-expanded", "widget-minimized", "widget-mini", "widget-ready");
    // Clear any legacy inline size/position from older drag/resize sessions.
    widgetEl.style.width = "";
    widgetEl.style.height = "";
    widgetEl.style.left = "";
    widgetEl.style.top = "";
    const preview = document.getElementById("ai-preview-box");
    if (preview) preview.style.maxHeight = "";
    if (widgetMode === "expanded") {
      widgetEl.classList.add("widget-mode-expanded");
    } else if (widgetMode === "mini") {
      widgetEl.classList.add("widget-mini");
    } else {
      widgetEl.classList.add("widget-minimized");
    }
    syncWidgetChrome();
    chrome.storage.local.set({
      aiWidgetMinimized: widgetMode !== "expanded",
      aiWidgetMode: widgetMode,
    });
  }

  function syncWidgetChrome() {
    if (!widgetEl) return;
    const paused = !isRecording;
    const ready = paused && transcriptEntries.length > 0 && widgetMode !== "expanded";
    widgetEl.classList.toggle("is-paused", paused);
    widgetEl.classList.toggle("widget-ready", ready && widgetMode === "minimized");

    document.querySelectorAll("#ai-status-dot, #ai-status-dot-compact, #ai-status-dot-pill").forEach((dot) => {
      dot.classList.toggle("paused", paused && !ready);
      dot.classList.toggle("ready", ready);
    });

    const liveLabel = paused
      ? (ready ? "Ready to finish" : "Paused")
      : (liveSpeakerName || "Capturing captions…");
    const statusEl = document.getElementById("ai-status-text");
    if (statusEl && (paused || statusEl.dataset.locked !== "1")) {
      statusEl.textContent = liveLabel;
    }
    const compactSub = document.getElementById("ai-compact-sub");
    if (compactSub) compactSub.textContent = paused ? (ready ? "Ready to finish" : "Paused") : (liveSpeakerName || "Capturing captions");
    const tipStatus = document.getElementById("ai-pill-tip-status");
    if (tipStatus) tipStatus.textContent = paused ? (ready ? "Ready to finish" : "Paused") : (liveSpeakerName || "Capturing captions");

    const pauseBtn = document.getElementById("ai-btn-pause");
    if (pauseBtn) {
      pauseBtn.title = isRecording ? "Pause recording" : "Resume recording";
      pauseBtn.setAttribute("aria-label", pauseBtn.title);
      pauseBtn.innerHTML = isRecording ? `${ICON.pause} Pause` : `${ICON.play} Resume`;
    }
    const pillPause = document.getElementById("ai-btn-pause-pill");
    if (pillPause) {
      pillPause.title = isRecording ? "Pause recording" : "Resume recording";
      pillPause.innerHTML = isRecording ? ICON.pause : ICON.play;
    }
  }

  function restoreWidgetState() {
    setWidgetMode("mini");
  }

  function toggleMinimized() {
    setWidgetMode(widgetMode === "expanded" ? "minimized" : "expanded");
  }

  async function stopAndClose() {
    if (exportDispatched) {
      removeWidget();
      return;
    }
    if (transcriptEntries.length === 0) {
      removeWidget();
      return;
    }
    const ok = await uiConfirm("Stop recording and save this meeting?", "Stop recording");
    if (!ok) return;
    dispatchAutoExport();
    removeWidget();
  }

  function toggleRecording() {
    if (isRecording) {
      accumulatedMs += Date.now() - recordingStartedAt;
      isRecording = false;
    } else {
      recordingStartedAt = Date.now();
      isRecording = true;
    }
    syncWidgetChrome();
    setStatusMessage(isRecording ? "Capturing captions…" : "Paused");
  }

  async function clearTranscript() {
    if (transcriptEntries.length === 0) return;
    const ok = await uiConfirm(
      "Clear all captured transcript lines (" + transcriptEntries.length + ")?",
      "Clear transcript"
    );
    if (!ok) return;
    transcriptEntries.length = 0;
    bookmarks.length = 0;
    participants.clear();
    liveSpeakerName = "";
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    updateWidgetStats();
    renderTranscriptPreview();
    setStatusMessage("Transcript cleared.");
    syncWidgetChrome();
  }

  function removeWidget() {
    freezeDraft();
    if (pollInterval) clearInterval(pollInterval);
    if (durationTimer) clearInterval(durationTimer);
    if (harvestTimer) clearTimeout(harvestTimer);
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (captionObserver) {
      captionObserver.disconnect();
      captionObserver = null;
    }
    const existing = document.getElementById("ai-notetaker-widget");
    if (existing) existing.remove();
  }

  function capturingStatusLabel() {
    return liveSpeakerName || "Capturing captions…";
  }

  function setActiveSpeaker(name) {
    const label = previewSpeakerLabel(name);
    if (!label) return;
    liveSpeakerName = label;
    const statusEl = document.getElementById("ai-status-text");
    if (statusEl && statusEl.dataset.locked !== "1") {
      statusEl.textContent = label;
    }
    const compactSub = document.getElementById("ai-compact-sub");
    if (compactSub) compactSub.textContent = label;
    const tipStatus = document.getElementById("ai-pill-tip-status");
    if (tipStatus) tipStatus.textContent = label;
  }

  function setStatusMessage(msg) {
    const statusEl = document.getElementById("ai-status-text");
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.dataset.locked = "1";
      clearTimeout(setStatusMessage._t);
      setStatusMessage._t = setTimeout(() => {
        statusEl.dataset.locked = "0";
        if (isRecording) statusEl.textContent = capturingStatusLabel();
      }, 2200);
    }
  }

  function setPreview(msg) {
    setStatusMessage(msg);
  }

  function renderTranscriptPreview() {
    const list = document.getElementById("ai-transcript-list");
    if (!list) return;
    const slice = transcriptEntries.slice(-5);
    if (!slice.length) {
      list.innerHTML = `<div class="w-transcript-empty" id="ai-preview-text">Listening for meeting speech…</div>`;
      return;
    }
    list.innerHTML = slice
      .map((e) => {
        const name = e.speaker || "Speaker";
        return `<div class="w-line">
          <span class="w-avatar" style="background:${avatarColor(name)}">${escapeWidgetHtml(initialsOf(name))}</span>
          <div class="w-line-main">
            <div class="w-line-name">${escapeWidgetHtml(name)}</div>
            <div class="w-line-text">${escapeWidgetHtml(e.text || "")}</div>
          </div>
          <span class="w-line-ts">${escapeWidgetHtml(e.timestamp || "")}</span>
        </div>`;
      })
      .join("");
    const box = document.getElementById("ai-preview-box");
    if (box) box.scrollTop = box.scrollHeight;
  }

  function updateWidgetStats() {
    const lines = transcriptEntries.length;
    const people = Math.max(participants.size, participantCountHint || 0);
    const mins = Math.max(0, Math.floor(getElapsedMs() / 60000));
    const linesEl = document.getElementById("ai-stat-lines");
    const peopleEl = document.getElementById("ai-stat-people");
    const minsEl = document.getElementById("ai-stat-mins");
    if (linesEl) linesEl.textContent = `${lines} line${lines === 1 ? "" : "s"}`;
    if (peopleEl) peopleEl.textContent = `${people} people`;
    if (minsEl) minsEl.textContent = `${mins} min`;
    const tipMeta = document.getElementById("ai-pill-tip-meta");
    if (tipMeta) tipMeta.textContent = `${lines} lines · ${people} people · ${mins} min`;
    // legacy id used by older code paths
    const statsEl = document.getElementById("ai-stats");
    if (statsEl) statsEl.textContent = `${lines} lines · ${people} ppl`;
    renderTranscriptPreview();
  }

  // ============ AUTO CAPTIONS — target the REAL toggle, never settings ============
  function autoEnableCaptions() {
    if (ccInitialized) return;

    try {
      const buttons = Array.from(document.querySelectorAll('button'));

      // If we're still on the pre-join screen, there's nothing to do yet.
      // Only ~2-3 buttons exist there; in-call UI has 20+.
      if (buttons.length < 6) return;

      // Prefer the actual caption TOGGLE button (label: "Turn on/off captions")
      const toggleBtn = buttons.find(btn => {
        const l = (btn.getAttribute('aria-label') || '').toLowerCase();
        return l.includes('turn on captions') || l.includes('turn off captions');
      });

      const ccBtn = toggleBtn || buttons.find(btn => {
        const jsctl = btn.getAttribute('jscontroller') || '';
        const l = (btn.getAttribute('aria-label') || '').toLowerCase();
        // Must be the toggle handler, NOT settings
        return jsctl === 'so3B2b' && !l.includes('settings') && !l.includes('open');
      });

      if (!ccBtn) return;   // not in call yet, or toggle hidden — retry next tick

      const label = (ccBtn.getAttribute('aria-label') || '').toLowerCase();
      const isPressed = ccBtn.getAttribute('aria-pressed') === 'true';

      if (isPressed || label.includes('turn off captions') || label.includes('hide captions')) {
        console.log("[AI Note-Taker] Captions already enabled. Not touching them.");
        ccInitialized = true;
        return;
      }

      console.log("[AI Note-Taker] Enabling captions once.");
      ccBtn.click();
      ccInitialized = true;
    } catch (e) {}
  }

  // ============ NOISE FILTER ============
  const NOISE_FILTERS = [
    /your meeting.{0,40}ready/i,
    /you have joined the call/i,
    /you are the first one here/i,
    /(your )?camera.{0,20}(on|off)/i,
    /(your )?microphone.{0,20}(on|off)/i,
    /your hand is (lowered|raised)/i,
    /live captions are (on|off)/i,
    /captions are (on|off)/i,
    /person_add add others/i,
    /share this meeting link/i,
    /content_copy copy link/i,
    /joined as /i,
    /meeting link/i,
    /^close$/i,
    /^add others$/i,
    /^you$/i,
    /^(participant|speaker)$/i,
    /people who use this meeting link/i,
    /language english/i,
    /^language/i,
    /format_size/i,
    /font ?size/i,
    /font ?color/i,
    /font ?family/i,
    /font ?style/i,
    /open caption settings/i,
    /caption settings/i,
    /settings subtitles/i,
    /arrow_downward/i,
    /jump to bottom/i,
    /^subtitle language/i,
    /^settings$/i,
    /^circle$/i,
    /^beta$/i,
    /^replay$/i,
    /^pin/i,
    // Language entries from caption settings — only actual language names,
    // not arbitrary capitalized words (those are real participant names).
    /^(english|french|spanish|german|italian|portuguese|dutch|russian|ukrainian|polish|czech|slovak|hungarian|romanian|bulgarian|croatian|serbian|slovenian|greek|turkish|arabic|hebrew|persian|urdu|hindi|bengali|tamil|telugu|kannada|malayalam|marathi|gujarati|punjabi|thai|vietnamese|indonesian|malay|filipino|chinese|japanese|korean|swedish|norwegian|danish|finnish|icelandic|estonian|latvian|lithuanian|afrikaans|swahili|hausa|yoruba|zulu|amharic|kazakh|uzbek|azerbaijani|georgian|armenian|mongolian|nepali|sinhala|khmer|lao|burmese)(\s\([^)]+\))?$/i,
    // Color names from font color picker
    /^(default|white|black|blue|green|red|yellow|cyan|magenta)$/i,
    /^(dark|light|bright|pale)?\s?(blue|green|red|yellow|cyan|magenta|orange|purple|pink|gray|grey|brown)$/i,
    // Font size/style picker entries
    /^(small|medium|large|very small|very large|extra small|extra large)$/i,
    // Toolbar tooltip / hover-tray accessibility copy (mic, camera, hand raise,
    // more-options buttons all share this instruction text).
    /press (down )?arrow to open the hover tray/i,
    /escape to close it/i,
    /hand rais/i,
    /(lower|raise)(ing)? (your |my )?hand/i,
    /continuously framed/i,
    /backgrounds? and effects/i,
    /more options for /i,
    /turn (on|off) (your )?(microphone|camera)/i,
    /\((⌘|cmd|ctrl)\s*\+\s*[a-z0-9]\)/i,
    /^audio settings$/i,
    /^video settings$/i,
    // Material Symbols icon-ligature text (e.g. "mic_off", "frame_person",
    // "visual_effects", "keyboard_arrow_up", "more_vert") leaks into innerText
    // when a generic selector accidentally grabs toolbar/tooltip elements.
    /[a-z]{2,}_[a-z]{2,}/,
  ];

  function isNoise(text) {
    for (const re of NOISE_FILTERS) {
      if (re.test(text)) return true;
    }
    return false;
  }

  // Speaker-token cleanup (Meet prefixes own captions with "You" / "M ")
  function stripSpeakerPrefix(clean) {
    return clean
      .replace(/^(you|me)\s*[:,]?\s*/i, '')
      .replace(/^captions?\s*:/i, '')
      .replace(/^m\s+/i, '')   // Meet's "M " initial prefix for your own captions
      .trim();
  }

  function stripEmbeddedSpeaker(text, speaker) {
    let t = cleanText(stripSpeakerPrefix(text));
    if (speaker) {
      const escaped = String(speaker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      t = t.replace(new RegExp('^' + escaped + '\\s*[:,\\-]?\\s*', 'i'), '');
    }
    return cleanText(t);
  }

  // A name element: 1-3 words, no punctuation, no digit, not a noise token.
  function looksLikeName(text) {
    if (!text) return false;
    const t = text.trim();
    if (!t || t.length < 2 || t.length > 40) return false;
    if (/[.,!?;:()[\]]/.test(t)) return false;
    if (/\d/.test(t)) return false;
    if (/_/.test(t)) return false;        // Material Symbols icon ligatures are snake_case
    if (/^[a-z]/.test(t)) return false;   // real display names are capitalized; UI/caption
                                           // microcopy and icon ligatures start lowercase
    const words = t.split(/\s+/);
    if (words.length < 1 || words.length > 3) return false;
    if (isNoise(t)) return false;
    if (/^m\s+[A-Z]/.test(t)) return false;   // "M Milan Dasgupta" style initial prefix
    return true;
  }

  // Collapse whitespace and trim.
  function cleanText(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  // Reject text that's clearly toolbar/tooltip chrome rather than speech —
  // a generic jsname selector can occasionally latch onto the wrong element
  // (e.g. the mic/camera/hand-raise hover tray instead of the captions panel).
  function looksLikeRealCaptionText(text) {
    if (!text) return false;
    if (/[a-z]{2,}_[a-z]{2,}/.test(text)) return false;
    if (/press (down )?arrow to open the hover tray/i.test(text)) return false;
    if (/more options for /i.test(text)) return false;
    return true;
  }

  // De-uglify a speaker name and strip anything that isn't a real person's name.
  function cleanSpeaker(name) {
    let n = cleanText(name)
      .replace(/^(you|me|speaker|participant|captions?)\s*[:,]?\s*/i, '')
      .replace(/^m\s+/i, '')
      .replace(/\s*:\s*$/, '')
      .trim();
    return n || '';
  }

  function isSelfSpeakerLabel(raw) {
    const t = cleanText(raw);
    if (!t) return false;
    if (/^(you|me)$/i.test(t)) return true;
    if (/^m\s+[A-Z]/.test(t)) return true;
    if (/\(\s*you\s*\)/i.test(t)) return true;
    return false;
  }

  function parseMeetInitialSpeaker(raw) {
    const t = cleanText(raw);
    const m = t.match(/^M\s+(.+)$/);
    if (!m) return '';
    const name = cleanSpeaker(m[1]);
    return name && looksLikeName(name) ? name : '';
  }

  function detectLocalUserName() {
    try {
      const ariaNodes = document.querySelectorAll('[aria-label]');
      for (const el of ariaNodes) {
        const label = (el.getAttribute('aria-label') || '').trim();
        if (!label) continue;
        const patterns = [
          /^(.+?)\s*\(\s*you\s*\)/i,
          /^(.+?)\s*,\s*you$/i,
          /^(.+?)\s*-\s*you$/i,
        ];
        for (const re of patterns) {
          const m = label.match(re);
          if (!m) continue;
          const name = cleanSpeaker(m[1]);
          if (name && looksLikeName(name) && !isNoise(name)) return name;
        }
      }

      const selfAttr = document.querySelector('[data-self-name]');
      if (selfAttr) {
        const name = cleanSpeaker(selfAttr.getAttribute('data-self-name') || '');
        if (name && looksLikeName(name)) return name;
      }

      const tiles = document.querySelectorAll('[data-participant-id], [data-requested-participant-id]');
      for (const tile of tiles) {
        const text = cleanText(tile.innerText || tile.textContent || '');
        const m = text.match(/^(.+?)\s*\(\s*you\s*\)/i);
        if (!m) continue;
        const name = cleanSpeaker(m[1]);
        if (name && looksLikeName(name)) return name;
      }

      const shortNodes = document.querySelectorAll('span, div');
      for (const el of shortNodes) {
        if (el.children.length > 2) continue;
        const text = cleanText(el.innerText || el.textContent || '');
        if (!text || text.length > 48) continue;
        const m = text.match(/^(.+?)\s*\(\s*you\s*\)$/i);
        if (!m) continue;
        const name = cleanSpeaker(m[1]);
        if (name && looksLikeName(name)) return name;
      }

      // Meet's call-information card exposes the signed-in account even when
      // the participant panel is closed (for example: "Joined as name@host").
      // Use the account's local part as a last-resort real label instead of
      // dropping captions emitted under the literal "You" heading.
      const pageText = cleanText(document.body?.innerText || '');
      const joined = pageText.match(/\bjoined as\s+([a-z0-9._+-]+)@[a-z0-9.-]+/i);
      if (joined) {
        const name = joined[1]
          .split(/[._+-]+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');
        if (name && looksLikeName(name)) return name;
      }
    } catch (e) {}
    return '';
  }

  function replaceProvisionalSelfName(realName) {
    if (!realName || realName === 'You') return;
    for (const entry of transcriptEntries) {
      if (entry.speaker === 'You') entry.speaker = realName;
    }
    if (participants.delete('You')) participants.add(realName);
  }

  function resolveSelfNameForSave() {
    if (localUserName && localUserName !== 'You') return localUserName;
    const detected = detectLocalUserName();
    if (detected) return detected;
    const roster = [...participants].filter((p) => p && !/^(you|me)$/i.test(String(p).trim()));
    if (roster.length === 1) return roster[0];
    return localUserName || 'You';
  }

  function finalizeSpeakersBeforeSave() {
    const realName = resolveSelfNameForSave();
    if (realName && realName !== 'You') {
      replaceProvisionalSelfName(realName);
      participants.delete('You');
      participants.delete('Me');
      trackSpeaker(realName);
      if (!localUserName || localUserName === 'You') localUserName = realName;
    }
  }

  function resolveSelfSpeakerName() {
    if (localUserName && localUserName !== 'You') return localUserName;
    const detected = detectLocalUserName();
    if (detected) {
      localUserName = detected;
      replaceProvisionalSelfName(detected);
      trackSpeaker(detected);
      try { chrome.storage.local.set({ localDisplayName: detected }); } catch (e) {}
      return detected;
    }
    // "You" is provisional and is replaced as soon as Meet exposes the real
    // display name. Keeping it temporarily is preferable to losing speech.
    localUserName = 'You';
    participants.add('You');
    return localUserName;
  }

  function getRecordedByName() {
    const name = resolveSelfSpeakerName();
    if (name && !isSelfSpeakerLabel(name)) return name;
    return 'You';
  }

  function isSelfCaptionRow(row) {
    if (!row) return false;
    const spkEl = row.querySelector(MODERN_SPEAKER_SEL);
    if (spkEl && isSelfSpeakerLabel(spkEl.innerText || spkEl.textContent || '')) return true;
    const aria = (row.getAttribute('aria-label') || '').toLowerCase();
    if (aria.startsWith('you ') || aria.includes(' you said') || aria.startsWith('you:')) return true;
    return false;
  }

  function resolveSpeaker(rawSpeaker, options = {}) {
    const raw = cleanText(rawSpeaker || '');
    if (options.isSelf || isSelfSpeakerLabel(raw)) {
      const self = resolveSelfSpeakerName();
      if (self) return self;
    }
    const fromInitial = parseMeetInitialSpeaker(raw);
    if (fromInitial) {
      if (!localUserName) {
        localUserName = fromInitial;
        try { chrome.storage.local.set({ localDisplayName: fromInitial }); } catch (e) {}
      }
      trackSpeaker(fromInitial);
      return fromInitial;
    }
    let speaker = cleanSpeaker(raw);
    if (speaker && looksLikeName(speaker) && !isNoise(speaker)) {
      trackSpeaker(speaker);
      return speaker;
    }
    if (options.isSelf) {
      const self = resolveSelfSpeakerName();
      if (self) return self;
    }
    return '';
  }

  function syncParticipantCountHint() {
    let best = participants.size;
    try {
      const controls = document.querySelectorAll('button, [role="button"], [aria-label]');
      for (const el of controls) {
        const label = cleanText(el.getAttribute?.('aria-label') || '');
        const text = cleanText(el.innerText || el.textContent || '');
        const combined = `${label} ${text}`;
        if (!/(?:participants?|people|everyone)/i.test(combined)) continue;
        const matches = combined.match(/\b(\d{1,3})\b/g) || [];
        for (const value of matches) {
          const count = Number(value);
          if (count > best && count < 1000) best = count;
        }
      }
    } catch (e) {}
    participantCountHint = Math.max(participantCountHint, best);
  }

  function countSpeechLines(text) {
    const t = cleanText(text);
    if (!t) return 0;
    const byNewline = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (byNewline.length > 1) return byNewline.length;
    const sentences = t.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
    return sentences.length || 1;
  }

  function splitAtLineLimit(text, maxLines) {
    const t = cleanText(text);
    let segments = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (segments.length === 1) {
      segments = t.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
    }
    if (segments.length <= maxLines) return { head: t, tail: '' };
    return {
      head: segments.slice(0, maxLines).join(' '),
      tail: segments.slice(maxLines).join(' '),
    };
  }

  function pushTranscriptEntry(speaker, text, nowMs) {
    let remaining = cleanText(text);
    if (!remaining) return;
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    while (remaining) {
      const { head, tail } = splitAtLineLimit(remaining, MAX_LINES_PER_ENTRY);
      if (!head) break;
      transcriptEntries.push({
        speaker,
        text: head,
        timestamp: ts,
        _ts: nowMs,
      });
      remaining = tail;
    }
  }

  function commitEntryText(entry, speaker, full, nowMs) {
    const { head, tail } = splitAtLineLimit(full, MAX_LINES_PER_ENTRY);
    entry.text = head;
    entry._ts = nowMs;
    if (tail) pushTranscriptEntry(speaker, tail, nowMs);
  }

  function previewSpeakerLabel(speaker) {
    return speaker || resolveSelfSpeakerName() || 'Speaker';
  }

  // Best-effort speaker for a caption block element: look for a name inside the
  // block's own subtree (Meet renders the speaker name as a header inside the
  // block). No ancestor walk — that picks up sidebar/participant-panel junk.
  function extractBlockSpeaker(block) {
    const subNodes = Array.from(block.querySelectorAll('div, span'));
    for (const el of [block, ...subNodes]) {
      if (el === block) continue;
      const t = cleanText(el.innerText || el.textContent || '');
      if (!t || t.length > 40) continue;
      if (el.children.length > 0) continue;   // leaf only
      if (isSelfSpeakerLabel(t)) return resolveSelfSpeakerName();
      const cleaned = cleanSpeaker(t);
      if (cleaned && looksLikeName(cleaned) && !isNoise(cleaned)) {
        return cleaned;
      }
    }
    return '';
  }

  // ============ SHARED CAPTURE + MERGE ============
  // Registers a unique speaker name (de-uglified) and keeps the participant list.
  // Dedupes near-identical forms ("Milan" vs "Milan Dasgupta") so one person
  // never inflates the count.
  function trackSpeaker(name) {
    const n = cleanSpeaker(name);
    if (!n || n.length > 40) return;
    if (/^m\s+[A-Z]/.test(n)) return;   // reject "M Milan Dasgupta" style
    if (n.toLowerCase() === 'participant') return;
    if (isNoise(n)) return;

    const key = n.toLowerCase().replace(/\s+/g, '');
    for (const existing of participants) {
      const ek = existing.toLowerCase().replace(/\s+/g, '');
      if (key === ek || key.includes(ek) || ek.includes(key)) {
        return;   // already have this person (or a prefix form of them)
      }
    }
    participants.add(n);
  }

  function captionTokens(text) {
    return cleanText(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter(Boolean);
  }

  function tokenJaccard(a, b) {
    const left = new Set(captionTokens(a));
    const right = new Set(captionTokens(b));
    if (!left.size || !right.size) return 0;
    let shared = 0;
    for (const word of left) if (right.has(word)) shared++;
    return shared / (left.size + right.size - shared);
  }

  // Meet's live CC is a sliding window: old words drop off the start while new
  // words appear at the end. Return the NEW words to append, '' if this caption
  // is already contained, or null if the two strings are unrelated.
  function captionOverlapDelta(previous, current) {
    const oldT = cleanText(previous);
    const newT = cleanText(current);
    if (!newT) return null;
    if (!oldT) return newT;
    if (oldT === newT) return '';
    if (oldT.includes(newT)) return '';
    if (newT.startsWith(oldT) && newT.length > oldT.length) {
      return cleanText(newT.slice(oldT.length));
    }

    const oldTail = oldT.slice(-280);
    const newHead = newT.slice(0, 280);
    const minChars = 24;
    const maxChars = Math.min(oldTail.length, newHead.length);
    for (let n = maxChars; n >= minChars; n--) {
      if (oldTail.slice(-n) === newHead.slice(0, n)) {
        return cleanText(newT.slice(n));
      }
    }

    const oldTok = captionTokens(oldT);
    const newTok = captionTokens(newT);
    const maxK = Math.min(oldTok.length, newTok.length);
    for (let k = maxK; k >= 4; k--) {
      if (oldTok.slice(-k).join(' ') === newTok.slice(0, k).join(' ')) {
        return newTok.slice(k).join(' ');
      }
    }
    return null;
  }

  // Combine two snapshots of the SAME Meet utterance. Return null if they are
  // different turns — never concatenate unrelated paragraphs.
  function mergeCaption(prev, next) {
    const oldT = cleanText(prev);
    const newT = cleanText(next);
    if (!newT) return oldT || null;
    if (!oldT) return newT;
    if (oldT === newT) return oldT;
    if (newT.includes(oldT)) return newT;
    if (oldT.includes(newT)) return oldT;
    if (newT.startsWith(oldT)) return newT;

    const delta = captionOverlapDelta(oldT, newT);
    if (delta === '') return oldT;
    if (delta) return cleanText(`${oldT} ${delta}`);

    if (tokenJaccard(oldT, newT) >= 0.72) {
      return newT.length >= oldT.length ? newT : oldT;
    }
    if (isCaptionRevision(oldT, newT)) {
      return newT.length >= oldT.length ? newT : oldT;
    }
    return null;
  }

  function sameSpeakerName(a, b) {
    return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  }

  function isCaptionRevision(prev, next) {
    const x = cleanText(prev).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    const y = cleanText(next).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
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

  function isCaptionHistoryDump(text, speaker) {
    const t = cleanText(text);
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

  function collapseGrowingCaptions(entries) {
    const src = Array.isArray(entries) ? entries : [];
    const dumpFlags = src.map((e) => isCaptionHistoryDump(e.text, e.speaker));
    const realCount = dumpFlags.filter((d) => !d).length;
    const dropDumps = realCount >= 5;
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const e = src[i];
      if (dumpFlags[i] && dropDumps) continue;
      let into = -1;
      if (out.length && sameSpeakerName(out[out.length - 1].speaker, e.speaker)) {
        const prev = out[out.length - 1];
        const px = cleanText(prev.text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
        const py = cleanText(e.text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
        const n = Math.min(12, px.length, py.length);
        if (n >= 12 && px.slice(0, n) === py.slice(0, n) && py.length >= px.length) {
          into = out.length - 1;
        } else if (isCaptionRevision(prev.text, e.text)) {
          into = out.length - 1;
        }
      }
      if (into < 0) {
        for (let j = out.length - 1; j >= Math.max(0, out.length - 12); j--) {
          if (!sameSpeakerName(out[j].speaker, e.speaker)) continue;
          if (isCaptionRevision(out[j].text, e.text)) {
            into = j;
            break;
          }
        }
      }
      if (into >= 0) {
        if (String(e.text || "").length >= String(out[into].text || "").length) {
          out[into] = { ...out[into], text: e.text, timestamp: e.timestamp || out[into].timestamp, _ts: e._ts || out[into]._ts };
        }
      } else {
        out.push(e);
      }
    }
    return out;
  }

  function collapseLiveTranscript() {
    const next = collapseGrowingCaptions(transcriptEntries);
    if (next.length === transcriptEntries.length) return;
    transcriptEntries.length = 0;
    transcriptEntries.push(...next);
  }

  function currentDraft() {
    for (let i = transcriptEntries.length - 1; i >= 0; i--) {
      if (transcriptEntries[i]._draft) return transcriptEntries[i];
    }
    return null;
  }

  function freezeDraft() {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    const draft = currentDraft();
    if (draft) delete draft._draft;
  }

  function scheduleSettle() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      freezeDraft();
    }, CAPTION_SETTLE_MS);
  }

  function startDraft(speaker, text, nowMs) {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    transcriptEntries.push({
      speaker,
      text,
      timestamp: ts,
      _ts: nowMs,
      _draft: true,
    });
    scheduleSettle();
    trackSpeaker(speaker);
    updateWidgetStats();
    setActiveSpeaker(speaker);
  }

  // Live Meet captions iterate in place. Keep showing the latest draft in the
  // widget, but only ever hold ONE open line for that utterance. Persist that
  // line when Meet stops revising it (settle) or a new speaker/turn starts.
  function ingestLiveCaption(speaker, fullText, options = {}) {
    speaker = resolveSpeaker(speaker, options);
    let full = stripEmbeddedSpeaker(fullText, speaker);

    if (!speaker) {
      const inline = full.match(/^(.{1,40}?)\s*:\s*(.{2,})$/);
      if (inline) {
        const nameGuess = resolveSpeaker(inline[1], options);
        if (nameGuess && !/^(https?|ftp|file|data|mailto|tel|ws|wss|chrome|chrome-extension):?$/i.test(inline[1])) {
          speaker = nameGuess;
          full = stripEmbeddedSpeaker(inline[2], speaker);
        }
      }
    }

    if (full.length < 2) return false;
    if (isNoise(full)) return false;
    if (isCaptionHistoryDump(full, speaker)) return false;
    if (full.length > 16000) return false;

    const nowMs = Date.now();
    const last = transcriptEntries[transcriptEntries.length - 1];
    if (!speaker) {
      if (options.isSelf) speaker = resolveSelfSpeakerName();
      if (!speaker && last && nowMs - last._ts < 8000) speaker = last.speaker;
      if (!speaker) speaker = resolveSelfSpeakerName();
    }
    if (!speaker) return false;

    const adopt = (entry, text) => {
      if (text !== entry.text) {
        entry.text = text;
        entry._ts = nowMs;
        entry._draft = true;
        scheduleSettle();
        updateWidgetStats();
        setActiveSpeaker(speaker);
        return true;
      }
      entry._ts = nowMs;
      entry._draft = true;
      scheduleSettle();
      return false;
    };

    const draft = currentDraft();
    if (draft) {
      if (sameSpeakerName(draft.speaker, speaker)) {
        const merged = mergeCaption(draft.text, full);
        if (merged != null) return adopt(draft, merged);
        if (isCaptionRevision(draft.text, full)) {
          return adopt(draft, full.length >= draft.text.length ? full : draft.text);
        }
        freezeDraft();
      } else {
        freezeDraft();
      }
    }

    const REVISE_MS = 180000;
    if (last && sameSpeakerName(last.speaker, speaker) && nowMs - last._ts < REVISE_MS) {
      const merged = mergeCaption(last.text, full);
      if (merged != null) return adopt(last, merged);
      if (isCaptionRevision(last.text, full)) {
        return adopt(last, full.length >= last.text.length ? full : last.text);
      }
    }

    for (let i = transcriptEntries.length - 1; i >= Math.max(0, transcriptEntries.length - 24); i--) {
      const entry = transcriptEntries[i];
      if (!sameSpeakerName(entry.speaker, speaker)) continue;
      const merged = mergeCaption(entry.text, full);
      if (merged != null || isCaptionRevision(entry.text, full)) {
        const next = merged || (full.length >= entry.text.length ? full : entry.text);
        return adopt(entry, next);
      }
    }

    startDraft(speaker, full, nowMs);
    collapseLiveTranscript();
    return true;
  }

  function finalizeCapture(speaker, fullText, options = {}) {
    return ingestLiveCaption(speaker, fullText, options);
  }

  // ============ HARVESTER ============
  function startHarvester() {
    if (pollInterval) clearInterval(pollInterval);
    if (captionObserver) {
      captionObserver.disconnect();
      captionObserver = null;
    }

    const harvestOnce = () => {
      if (!isRecording) return;
      if (!isMeetingRoom()) {
        removeWidget();
        return;
      }
      if (!ccInitialized) autoEnableCaptions();
      resolveSelfSpeakerName();
      syncParticipantCountHint();

      harvestSelfCaptions();
      harvestModernRows();
      captureFromCaptionPanel();
      harvestLegacy();
      observeCaptionPanel();

      if (transcriptEntries.length === 0 && ccInitialized) {
        const previewEl = document.getElementById("ai-preview-text");
        if (previewEl && /listening for meeting speech/i.test(previewEl.textContent || "")) {
          setPreview("Captions on — waiting for speech…");
        }
      }
    };

    harvestOnce();
    pollInterval = setInterval(harvestOnce, 400);
  }

  function observeCaptionPanel() {
    const panel = findCaptionPanel();
    if (!panel) return;
    if (captionObserver && captionObserver._root === panel) return;
    if (captionObserver) captionObserver.disconnect();
    captionObserver = new MutationObserver(() => {
      if (!isRecording) return;
      if (harvestTimer) return;
      harvestTimer = setTimeout(() => {
        harvestTimer = null;
        harvestSelfCaptions();
        harvestModernRows();
        captureFromCaptionPanel();
      }, 80);
    });
    captionObserver._root = panel;
    captionObserver.observe(panel, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Current Meet caption row / text / speaker selectors (class + jsname rotate often).
  const MODERN_ROW_SELECTORS = [
    'div[jsname="dsyhDe"]',
    'div.nMcdL.bj4p3b',
    'div.nMcdL',
    'div.CNusmb',
    'div.TBMuR',
  ];
  const MODERN_SPEAKER_SEL = '.NWpY1d, .KcIKyf, .zs7s8d, span[jsname="YSxPC"], .zoN5jf';
  const MODERN_TEXT_SEL = '.ygicle, .VbkSUe, .bh44bd, .iTTPOb, span[jsname="tgaKEf"], div[jsname="tgaKEf"]';

  // Meet currently renders the local caption with a literal "You" leaf next
  // to the speech. This path intentionally does not depend on rotating class
  // names: it finds that marker and walks up to the smallest visible container
  // that also contains speech.
  function harvestSelfCaptions() {
    let processed = false;
    const leaves = Array.from(document.querySelectorAll('div, span')).filter((el) => {
      if (el.closest('#ai-notetaker-widget, #ai-notetaker-modal')) return false;
      if (el.children.length > 0) return false;
      return /^(you|me)$/i.test(cleanText(el.innerText || el.textContent || ''));
    });

    for (const marker of leaves) {
      let block = marker.parentElement;
      for (let depth = 0; block && depth < 7; depth++, block = block.parentElement) {
        if (block === document.body) break;
        const raw = cleanText(block.innerText || block.textContent || '');
        if (!raw || raw.length < 5 || raw.length > 8000) continue;
        if (!/^(you|me)\b/i.test(raw)) continue;

        const speech = cleanText(raw.replace(/^(you|me)\s*[:,]?\s*/i, ''));
        if (!speech || speech.length < 2) continue;
        if (isNoise(speech) || !looksLikeRealCaptionText(speech)) continue;

        const rect = block.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 10) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

        if (blockLastText.get(block) === speech) break;
        blockLastText.set(block, speech);
        if (finalizeCapture(resolveSelfSpeakerName(), speech, { isSelf: true })) {
          processed = true;
        }
        break;
      }
    }
    return processed;
  }

  // ----- Strategy 0: modern caption rows (works even when panel heuristics fail) -----
  function harvestModernRows() {
    let processed = false;
    const seen = new Set();

    for (const selector of MODERN_ROW_SELECTORS) {
      let rows;
      try { rows = document.querySelectorAll(selector); } catch (_) { continue; }
      for (const row of rows) {
        if (seen.has(row)) continue;
        seen.add(row);
        if (row.closest('#ai-notetaker-widget')) continue;

        const spkEl = row.querySelector(MODERN_SPEAKER_SEL);
        const txtEl = row.querySelector(MODERN_TEXT_SEL);
        const selfRow = isSelfCaptionRow(row);

        let speaker = resolveSpeaker(
          spkEl ? (spkEl.innerText || spkEl.textContent || '') : '',
          { isSelf: selfRow }
        );
        let text = '';
        if (txtEl) {
          text = cleanText(txtEl.innerText || txtEl.textContent || '');
        } else {
          text = cleanText(row.innerText || row.textContent || '');
          if (speaker && text.toLowerCase().startsWith(speaker.toLowerCase())) {
            text = cleanText(text.slice(speaker.length).replace(/^[:\s]+/, ''));
          }
        }

        if (!text || text.length < 2) continue;
        if (isNoise(text)) continue;
        if (!looksLikeRealCaptionText(text)) continue;

        // Cheap per-node skip when literally unchanged since last poll; the
        // node may still get recreated by Meet, in which case finalizeCapture's
        // content-based matching (against actual transcript entries) takes over.
        if (blockLastText.get(row) === text) continue;
        blockLastText.set(row, text);

        if (finalizeCapture(speaker, text, { isSelf: selfRow })) processed = true;
      }
    }

    // Standalone caption text nodes (Meet often uses jsname=tgaKEf on the speech span)
    let texts;
    try { texts = document.querySelectorAll('[jsname="tgaKEf"]'); } catch (_) { texts = []; }
    for (const el of texts) {
      if (el.closest('#ai-notetaker-widget')) continue;
      // Skip if already handled as part of a modern row
      if (el.closest(MODERN_ROW_SELECTORS.join(','))) continue;

      const text = cleanText(el.innerText || el.textContent || '');
      if (!text || text.length < 2) continue;
      if (isNoise(text)) continue;
      if (!looksLikeRealCaptionText(text)) continue;

      let speaker = '';
      let selfRow = false;
      const row = el.parentElement;
      if (row) {
        selfRow = isSelfCaptionRow(row);
        const spkEl = row.querySelector(MODERN_SPEAKER_SEL);
        if (spkEl) {
          speaker = resolveSpeaker(spkEl.innerText || spkEl.textContent || '', { isSelf: selfRow });
        } else if (selfRow) {
          speaker = resolveSelfSpeakerName();
        }
      }

      if (blockLastText.get(el) === text) continue;
      blockLastText.set(el, text);
      if (finalizeCapture(speaker, text, { isSelf: selfRow })) processed = true;
    }

    return processed;
  }

  // ----- Strategy 1: real caption panel (found via caption buttons / aria) -----
  function findCaptionPanel() {
    // 1) Semantic captions region (localized aria-label)
    try {
      const regions = document.querySelectorAll('[role="region"][aria-label]');
      for (const el of regions) {
        const lbl = (el.getAttribute('aria-label') || '').trim();
        if (/^(captions|subtitles|sous-titres|untertitel|leyendas|字幕|キャプション)$/i.test(lbl)
          || /caption|subtitle|sous-titre|untertitel|leyenda|字幕|キャプション/i.test(lbl)) {
          return el;
        }
      }
    } catch (_) {}

    // 2) Current Meet caption text container — climb to a sensible parent
    const primary = document.querySelector('[jsname="tgaKEf"]');
    if (primary) {
      let el = primary;
      for (let i = 0; i < 8 && el; i++) {
        if (el.querySelector?.('button[aria-label*="Jump to" i], button[aria-label*="caption" i]')) {
          return el;
        }
        if (el.getAttribute?.('aria-live') === 'polite') return el;
        if (el.querySelector?.('[jsname="dsyhDe"], .nMcdL')) return el;
        el = el.parentElement;
      }
      return primary.closest('[aria-live]') || primary.parentElement || primary;
    }

    // 3) Structural climb from "Jump to most recent captions" — works even when empty
    const buttons = Array.from(document.querySelectorAll('button'));
    const jumpBtn = buttons.find(b => {
      const l = (b.getAttribute('aria-label') || '').toLowerCase();
      return l.includes('jump to most recent captions') || l.includes('jump to latest captions');
    });

    if (jumpBtn) {
      let el = jumpBtn.parentElement;
      for (let i = 0; i < 12 && el; i++) {
        if (el.querySelector('[jsname="tgaKEf"], [jsname="dsyhDe"], .nMcdL, .ygicle')) return el;
        if (el.getAttribute('aria-live') === 'polite') return el;
        const textContent = (el.innerText || '').trim();
        if (textContent.length > 20 && /[.,!?]/.test(textContent) && looksLikeRealCaptionText(textContent)) {
          return el;
        }
        el = el.parentElement;
      }
      // Empty captions UI still has chrome — return a mid-level ancestor to observe
      let structural = jumpBtn.parentElement;
      for (let i = 0; i < 4 && structural?.parentElement; i++) structural = structural.parentElement;
      if (structural) return structural;
    }

    // 4) aria-live polite regions that aren't the whole page
    try {
      const lives = document.querySelectorAll('[aria-live="polite"]');
      let best = null;
      let bestScore = 0;
      for (const el of lives) {
        if (el.closest('#ai-notetaker-widget')) continue;
        const text = (el.innerText || '').trim();
        if (text.length > 4000) continue; // likely page chrome
        let score = 0;
        const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
        if (/caption|subtitle/.test(lbl)) score += 5;
        if (el.querySelector('[jsname="tgaKEf"], .nMcdL, .ygicle')) score += 4;
        if (text.length > 10 && looksLikeRealCaptionText(text)) score += 2;
        if (score > bestScore) { bestScore = score; best = el; }
      }
      if (best && bestScore > 0) return best;
    } catch (_) {}

    // 5) Legacy overlay jsname (only when it actually holds speech)
    const overlays = document.querySelectorAll('[jsname="ysP28e"]');
    for (const el of overlays) {
      const text = (el.innerText || '').trim();
      if (text.length > 10 && looksLikeRealCaptionText(text)) return el;
    }

    return null;
  }

  // Walk the caption panel and process each caption BLOCK (the unit that holds
  // a speaker name + their current text). Skips name-only elements and re-feeds
  // only the new delta of each growing block.
  function captureFromCaptionPanel() {
    const panel = findCaptionPanel();
    if (!panel) return false;

    const allNodes = Array.from(panel.querySelectorAll('div, span'));
    // Bail if we latched onto a page-wide container (too many nodes / too much chrome)
    if (allNodes.length > 800) return false;
    const panelText = (panel.innerText || '').trim();
    if (panelText.length > 12000) return false;

    let processed = false;

    // Pass 1: identify caption blocks — CONTAINER elements that hold a speaker
    // name + speech. A valid block has 1-3 children, one of which is a name-like
    // leaf, and its text is real speech. This excludes the big scroll container
    // (many children) and leaf text spans.
    const blocks = new Set();
    for (const t of allNodes) {
      if (t.closest('#ai-notetaker-widget')) continue;
      if (t.children.length < 1 || t.children.length > 6) continue;
      const raw = cleanText(t.innerText || t.textContent || '');
      if (!raw || raw.length < 4) continue;
      if (isNoise(raw)) continue;
      if (!looksLikeRealCaptionText(raw)) continue;
      // Must contain a name-like leaf child (the speaker header)
      const childTexts = Array.from(t.children).map(c => cleanText(c.innerText || c.textContent || ''));
      const descendantTexts = Array.from(t.querySelectorAll('div, span'))
        .filter((el) => el.children.length === 0)
        .map((el) => cleanText(el.innerText || el.textContent || ''));
      const hasNameChild = [...childTexts, ...descendantTexts].some((ct) =>
        ct && ct.length <= 40 && (
          isSelfSpeakerLabel(ct) ||
          (looksLikeName(ct) && !isNoise(ct))
        )
      );
      if (!hasNameChild) continue;
      // Accept short growing captions — Meet often updates mid-sentence without punctuation
      if (/[.!?…]/.test(raw) || raw.length >= 8) {
        blocks.add(t);
      }
    }

    // Pass 2: for each block, find the BEST (deepest) block — the smallest
    // element that still contains the full speech, to avoid double-processing
    // parent + child.
    const bestBlocks = new Set();
    for (const b of blocks) {
      let isNested = false;
      for (const other of blocks) {
        if (other !== b && other.contains(b)) { isNested = true; break; }
      }
      if (!isNested) bestBlocks.add(b);
    }

    // Pass 3: process each best block — extract speaker from within the block
    // subtree, compute the delta since last seen, and emit.
    for (const block of bestBlocks) {
      const blockRaw = cleanText(block.innerText || block.textContent || '');
      if (!blockRaw || blockRaw.length < 20) continue;
      if (isNoise(blockRaw)) continue;

      // Find speaker name inside the block's own subtree (leaf, short, name-like)
      let speaker = '';
      let isSelf = isSelfCaptionRow(block);
      const subNodes = Array.from(block.querySelectorAll('div, span'));
      const candidates = [block, ...subNodes];
      for (const el of candidates) {
        if (el === block) continue;
        const t = cleanText(el.innerText || el.textContent || '');
        if (!t || t.length > 40) continue;
        if (el.children.length > 0) continue;
        if (isSelfSpeakerLabel(t)) {
          isSelf = true;
          speaker = resolveSpeaker(t, { isSelf: true });
          if (speaker) break;
          continue;
        }
        if (!looksLikeName(t) || isNoise(t)) continue;
        speaker = resolveSpeaker(t, { isSelf });
        if (speaker) break;
      }
      if (!speaker) speaker = resolveSpeaker(extractBlockSpeaker(block), { isSelf });

      // Strip any leading speaker-name prefix from the block text itself
      // ("Milan Dasgupta: <speech>", "Milan Dasgupta <speech>", or Meet's
      // own-caption form "M Milan Dasgupta <speech>"). Remove leading "M "
      // first, then the name, repeatedly.
      let speechText = cleanText(blockRaw);
      if (speaker) {
        const sp = speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        for (let i = 0; i < 3; i++) {
          const before = speechText;
          speechText = speechText
            .replace(new RegExp('^M\\s+' + sp + '\\s*[:,]?\\s*', 'i'), '')
            .replace(new RegExp('^' + sp + '\\s*[:,]?\\s*', 'i'), '')
            .replace(new RegExp('^M\\s+', 'i'), '')
            .trim();
          if (speechText === before) break;
        }
        // Also strip a trailing name
        speechText = speechText
          .replace(new RegExp('\\s+' + sp + '\\s*[:,]?\\s*$', 'i'), '')
          .trim();
      }
      speechText = cleanText(stripSpeakerPrefix(speechText));
      if (!speechText || speechText.length < 2) continue;

      // Cheap per-node skip when unchanged since last poll. finalizeCapture
      // handles growth by content, so this is just an optimization, not the
      // source of truth (Meet can recreate this node mid-sentence).
      if (blockLastText.get(block) === speechText) continue;
      blockLastText.set(block, speechText);

      if (finalizeCapture(speaker, speechText, { isSelf })) processed = true;
    }

    return processed;
  }

  // ----- Strategy 2: legacy fallback selectors -----
  const LEGACY_SELECTORS = [
    'div[data-message-id]',
    'div[jsname="ysP28e"]',
    'div[jsname="tgaKEf"]',
    'div[jsname="dsyhDe"]',
    'div[jsname="V6712e"]',
    'div[jscontroller="T3453b"]',
    'div.a4b22',
    'div.nMcdL',
    'span[jsname="YS312"]',
    'span[jsname="tgaKEf"]',
    '[role="region"][aria-label*="aption" i]',
  ];

  function harvestLegacy() {
    for (const selector of LEGACY_SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(selector); } catch (e) { continue; }
      for (const node of nodes) {
        if (node.closest('#ai-notetaker-widget')) continue;
        if (node.children.length > 1000) continue;

        const raw = (node.innerText || node.textContent || '')
          .replace(/\n+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (!raw || raw.length < 2) continue;
        if (isNoise(raw)) continue;
        if (!looksLikeRealCaptionText(raw)) continue;

        if (nodeLastText.get(node) === raw) continue;
        nodeLastText.set(node, raw);

        let speaker = '';
        let isSelf = false;
        if (node.hasAttribute('data-message-id')) {
          const lines = (node.textContent || '').split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length >= 2) {
            if (isSelfSpeakerLabel(lines[0])) {
              isSelf = true;
              speaker = resolveSpeaker(lines[0], { isSelf: true });
            } else if (looksLikeName(lines[0])) {
              speaker = resolveSpeaker(lines[0]);
            }
          }
        } else {
          const s = node.querySelector(MODERN_SPEAKER_SEL + ', [data-sender-name], .zs3M3d, .X43L3b, .zbA8L');
          if (s) {
            const n = (s.getAttribute('data-sender-name') || s.textContent || '').trim();
            isSelf = isSelfSpeakerLabel(n);
            speaker = resolveSpeaker(n, { isSelf });
          }
        }

        finalizeCapture(speaker, raw, { isSelf });
      }
    }
  }

  // ============ DIAGNOSTICS ============
  function diagnose() {
    console.groupCollapsed("%c[AI Note-Taker] Diagnostics", "color:#38bdf8;font-weight:bold");
    console.log("URL:", location.href);
    console.log("Widget present:", !!document.getElementById("ai-notetaker-widget"));
    console.log("ccInitialized:", ccInitialized);
    console.log("localUserName:", localUserName || "(not detected yet)");

    const counts = {};
    for (const sel of [...MODERN_ROW_SELECTORS, ...LEGACY_SELECTORS, MODERN_TEXT_SEL, MODERN_SPEAKER_SEL]) {
      try { counts[sel] = document.querySelectorAll(sel).length; } catch (e) { counts[sel] = "ERR"; }
    }
    console.log("Caption selector counts:", counts);

    console.log("Total <button> elements:", document.querySelectorAll('button').length);
    const capButtons = Array.from(document.querySelectorAll('button')).filter(b => {
      const l = (b.getAttribute('aria-label') || '').toLowerCase();
      return l.includes('caption') || l.includes('subtitle');
    });
    console.log("Caption-related buttons:", capButtons.length);
    capButtons.slice(0, 6).forEach(b => {
      console.log("  button:", JSON.stringify(b.getAttribute('aria-label')), "| jscontroller:", b.getAttribute('jscontroller'));
    });

    const panel = findCaptionPanel();
    console.log("Caption panel found:", !!panel, panel ? (panel.getAttribute('aria-label') || panel.getAttribute('jsname') || panel.className?.slice?.(0, 60)) : '');
    if (panel) {
      console.log("Panel text sample:", (panel.innerText || '').trim().slice(0, 200));
    }

    const lives = document.querySelectorAll('[aria-live="polite"]');
    console.log("aria-live=polite regions:", lives.length);
    lives.forEach((el, i) => {
      if (i > 4) return;
      console.log(`  live[${i}]:`, (el.getAttribute('aria-label') || '').slice(0, 40), '| text:', (el.innerText || '').trim().slice(0, 80));
    });

    console.log("Transcript entries:", transcriptEntries.length);
    console.log("Last 5 entries:", transcriptEntries.slice(-5).map(e => e.text));
    console.groupEnd();
  }

  // ============ MEETING END DETECTION & AUTO-EXPORT ============
  function setupCallEndDetection() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button, a');
      if (btn) {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        const jsname = (btn.getAttribute('jsname') || '');
        if (label.includes('leave call') || label.includes('end call') || jsname === 'CQ3A7e') {
          console.log("[AI Note-Taker] Meeting ended. Auto-exporting...");
          dispatchAutoExport();
        }
      }
    });

    window.addEventListener('pagehide', handlePageExit);
    window.addEventListener('beforeunload', handlePageExit);
  }

  // One-shot export that runs ENTIRELY in the background worker, so the
  // page navigating away cannot kill the generate+download chain.
  function dispatchAutoExport() {
    if (exportDispatched) return;
    if (transcriptEntries.length === 0) return;
    finishMeetingWithPrefs(true);
  }

  function getMeetingTitle() {
    const titleEl = document.querySelector('[data-meeting-title]') || document.querySelector('div[jsname="r42R8"]');
    if (titleEl && titleEl.textContent) {
      return titleEl.textContent.trim();
    }
    return document.title.replace("- Google Meet", "").trim() || "Google Meet";
  }

  // ============ EXPORT ============
  async function onFinishAndExport(isAutoTriggered = false) {
    await finishMeetingWithPrefs(isAutoTriggered);
  }

  function handlePageExit() {
    freezeDraft();
    // Page is unloading — cannot show a modal. Save + open summary without download.
    if (exportDispatched || transcriptEntries.length === 0) {
      removeWidget();
      return;
    }
    exportDispatched = true;
    if (saveInterval) clearInterval(saveInterval);
    finalizeSpeakersBeforeSave();
    collapseLiveTranscript();
    const meetingTitle = getMeetingTitle();
    const duration = Math.round((Date.now() - meetingStartTime.getTime()) / 60000) + " mins";
    const meeting = {
      id: meetingId,
      title: meetingTitle,
      date: meetingStartTime.toISOString(),
      duration,
      participants: Array.from(participants),
      participantCount: Math.max(participants.size, participantCountHint),
      transcript: transcriptEntries.map((e) => ({
        speaker: e.speaker, text: e.text, timestamp: e.timestamp, _ts: e._ts
      })),
      bookmarks: bookmarks.slice(),
      status: "completed",
      isFavorite: false,
      isPinned: false,
      language: "en",
      platform: "meet",
      transcriptConfidence: 0.9,
      recordedBy: getRecordedByName()
    };
    const formattedTranscript = transcriptEntries
      .map((entry) => `[${entry.timestamp}] ${entry.speaker}: ${entry.text}`)
      .join("\n");
    chrome.storage.local.get(["meetings_meta"], (result) => {
      const meta = result.meetings_meta || [];
      const idx = meta.findIndex((m) => m.id === meetingId);
      const metaEntry = {
        id: meeting.id, title: meeting.title, date: meeting.date,
        duration: meeting.duration, participantCount: meeting.participantCount,
        status: "completed", isFavorite: false, isPinned: false, platform: "meet"
      };
      if (idx >= 0) meta[idx] = metaEntry; else meta.unshift(metaEntry);
      chrome.storage.local.set({
        ["meeting_" + meetingId]: meeting,
        meetings_meta: meta,
        lastMeetingId: meetingId,
        openMeetingTab: "summary"
      });
    });
    chrome.runtime.sendMessage({
      type: "AUTO_GENERATE_AND_DOWNLOAD",
      data: {
        transcript: formattedTranscript,
        meetingTitle,
        participants: Array.from(participants),
        startTime: meetingStartTime.toLocaleString(),
        duration,
        meetingId,
        structured: true,
        summaryScope: "full",
        download: false,
        openApp: true
      }
    });
    removeWidget();
  }
})();