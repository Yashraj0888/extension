import { icon } from "../core/runtime.js";
import { bridge } from "../core/bridge.js";
import {
  escapeHtml,
  escapeAttr,
  formatDate,
  stringToColor,
  initialsFrom,
} from "../core/utils.js";
import { buildPeopleInsights } from "../services/people-insights.js";

let peopleCache = [];
let selectedKey = "";
let searchQuery = "";

function openSource({ meetingId, tab, entryIndex, searchQuery: q }) {
  if (!meetingId) return;
  const params = { meetingId, tab: tab || "summary" };
  if (typeof entryIndex === "number" && entryIndex >= 0) {
    params.tab = "transcript";
    params.entryIndex = entryIndex;
  }
  if (q) params.searchQuery = q;
  bridge.navigate("meeting", params);
}

function filteredPeople() {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return peopleCache;
  return peopleCache.filter((p) => p.name.toLowerCase().includes(q));
}

function selectedPerson() {
  const list = filteredPeople();
  if (!list.length) return null;
  return list.find((p) => p.key === selectedKey) || list[0];
}

function renderLinkRow({ title, meta, meetingId, entryIndex, tab, searchQuery: q }) {
  return `
    <button type="button" class="people-link-row"
      data-meeting-id="${escapeAttr(meetingId || "")}"
      data-entry="${typeof entryIndex === "number" ? entryIndex : -1}"
      data-tab="${escapeAttr(tab || "")}"
      data-search="${escapeAttr(q || "")}"
      title="Open source meeting">
      <span class="people-link-title">${escapeHtml(title)}</span>
      ${meta ? `<span class="people-link-meta">${meta}</span>` : ""}
      <span class="people-link-go">${icon("chevronRight", 14)}</span>
    </button>`;
}

function renderDetail(person) {
  if (!person) {
    return `<div class="people-detail-empty"><p class="empty-state">Select a person to see meeting-derived facts.</p></div>`;
  }

  const meetingRows = person.meetings
    .map((m) =>
      renderLinkRow({
        title: m.title,
        meta: `${escapeHtml(formatDate(m.date))}${
          m.talkSharePct != null ? ` · ${m.talkSharePct}% talk share` : ""
        }`,
        meetingId: m.meetingId,
        entryIndex: -1,
      })
    )
    .join("");

  const actionBlock = (items, emptyLabel) =>
    items.length
      ? items
          .map((a) =>
            renderLinkRow({
              title: a.text,
              meta: `${escapeHtml(a.meetingTitle)} · ${escapeHtml(formatDate(a.meetingDate))}${
                a.deadline ? ` · ${escapeHtml(a.deadline)}` : ""
              }${a.done ? " · Done" : ""}`,
              meetingId: a.meetingId,
              entryIndex: a.sourceEntryIndex,
              tab: "actionitems",
            })
          )
          .join("")
      : `<p class="people-section-empty">${escapeHtml(emptyLabel)}</p>`;

  const annBlock = (items, emptyLabel) =>
    items.length
      ? items
          .map((a) =>
            renderLinkRow({
              title: a.label || a.quote || "Item",
              meta: `${escapeHtml(a.meetingTitle)}${
                a.timestamp ? ` · ${escapeHtml(a.timestamp)}` : ""
              }${a.quote && a.label ? ` · “${escapeHtml(a.quote.slice(0, 80))}”` : ""}`,
              meetingId: a.meetingId,
              entryIndex: a.entryIndex,
            })
          )
          .join("")
      : `<p class="people-section-empty">${escapeHtml(emptyLabel)}</p>`;

  return `
    <div class="people-detail-head">
      <div class="people-avatar lg" style="background:${stringToColor(person.name)}">${escapeHtml(
        initialsFrom(person.name)
      )}</div>
      <div>
        <h2 class="people-detail-name">${escapeHtml(person.name)}</h2>
        <p class="people-detail-sub">
          ${person.meetingCount} meeting${person.meetingCount === 1 ? "" : "s"} ·
          ${person.openCount} open / ${person.completedCount} completed action${
            person.openCount + person.completedCount === 1 ? "" : "s"
          }
        </p>
        <p class="people-detail-note">Facts from your meetings only — no personality or productivity scoring.</p>
      </div>
    </div>

    <section class="people-section">
      <h3 class="people-section-title">${icon("calendar", 14)} Meetings participated</h3>
      <div class="people-link-list">${meetingRows || `<p class="people-section-empty">No meetings</p>`}</div>
    </section>

    <section class="people-section">
      <h3 class="people-section-title">${icon("listChecks", 14)} Open actions (${person.openCount})</h3>
      <div class="people-link-list">${actionBlock(person.openActions, "No open actions assigned to them")}</div>
    </section>

    <section class="people-section">
      <h3 class="people-section-title">${icon("check", 14)} Completed actions (${person.completedCount})</h3>
      <div class="people-link-list">${actionBlock(person.completedActions, "No completed actions")}</div>
    </section>

    <section class="people-section">
      <h3 class="people-section-title">${icon("target", 14)} Decisions involving them (${person.decisions.length})</h3>
      <div class="people-link-list">${annBlock(
        person.decisions,
        "No decision markers yet — run Transcript Intelligence on meetings"
      )}</div>
    </section>

    <section class="people-section">
      <h3 class="people-section-title">${icon("messageSquare", 14)} Questions involving them (${person.questions.length})</h3>
      <div class="people-link-list">${annBlock(
        person.questions,
        "No question markers yet — run Transcript Intelligence on meetings"
      )}</div>
    </section>

    <section class="people-section">
      <h3 class="people-section-title">${icon("eye", 14)} Relevant transcript mentions (${person.mentions.length})</h3>
      <div class="people-link-list">${annBlock(person.mentions, "No name mentions found in transcripts")}</div>
    </section>`;
}

function bindLinkClicks(root) {
  root.querySelectorAll(".people-link-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const meetingId = btn.dataset.meetingId;
      const entryIndex = parseInt(btn.dataset.entry, 10);
      const q = btn.dataset.search || "";
      const tab = btn.dataset.tab || "";
      openSource({
        meetingId,
        tab: tab || undefined,
        entryIndex: Number.isFinite(entryIndex) ? entryIndex : -1,
        searchQuery: q,
      });
    });
  });
}

export async function renderPeopleInsights() {
  const host = document.getElementById("view-people");
  if (!host) return;

  host.innerHTML = `
    <div class="people-page">
      <div class="home-header">
        <div>
          <h1 class="home-title">People Insights</h1>
          <p class="home-subtitle">Participants across your meetings — meetings, actions, and transcript facts only</p>
        </div>
      </div>
      <p class="people-loading"><span class="spinner" style="width:14px;height:14px"></span> Loading people from meetings…</p>
    </div>`;

  try {
    peopleCache = await buildPeopleInsights();
  } catch (err) {
    host.innerHTML = `
      <div class="people-page">
        <div class="home-header">
          <div>
            <h1 class="home-title">People Insights</h1>
            <p class="home-subtitle">Participants across your meetings</p>
          </div>
        </div>
        <p class="empty-state">${escapeHtml(err.message || "Could not load people")}</p>
      </div>`;
    return;
  }

  if (selectedKey && !peopleCache.some((p) => p.key === selectedKey)) {
    selectedKey = peopleCache[0]?.key || "";
  } else if (!selectedKey && peopleCache.length) {
    selectedKey = peopleCache[0].key;
  }

  paintPeoplePage(host);
}

function paintPeoplePage(host) {
  const list = filteredPeople();
  const person = selectedPerson();
  if (person) selectedKey = person.key;

  const navCount = document.getElementById("peopleNavCount");
  if (navCount) navCount.textContent = String(peopleCache.length);

  host.innerHTML = `
    <div class="people-page">
      <div class="home-header">
        <div>
          <h1 class="home-title">People Insights</h1>
          <p class="home-subtitle">Participants across your meetings — meetings, actions, and transcript facts only</p>
        </div>
      </div>

      ${
        !peopleCache.length
          ? `<p class="empty-state">No participants yet. Capture or import meetings with speakers to see people here.</p>`
          : `
      <div class="people-layout">
        <aside class="people-rail">
          <input type="search" class="people-search" id="peopleSearch" placeholder="Filter people…" value="${escapeAttr(
            searchQuery
          )}" autocomplete="off">
          <div class="people-list" id="peopleList">
            ${
              list.length
                ? list
                    .map(
                      (p) => `
              <button type="button" class="people-list-item ${p.key === selectedKey ? "is-active" : ""}" data-person-key="${escapeAttr(
                p.key
              )}">
                <span class="people-avatar" style="background:${stringToColor(p.name)}">${escapeHtml(
                  initialsFrom(p.name)
                )}</span>
                <span class="people-list-main">
                  <span class="people-list-name">${escapeHtml(p.name)}</span>
                  <span class="people-list-meta">${p.meetingCount} meeting${
                    p.meetingCount === 1 ? "" : "s"
                  } · ${p.openCount} open action${p.openCount === 1 ? "" : "s"}</span>
                </span>
              </button>`
                    )
                    .join("")
                : `<p class="people-section-empty">No people match “${escapeHtml(searchQuery)}”</p>`
            }
          </div>
        </aside>
        <div class="people-detail" id="peopleDetail">
          ${renderDetail(person)}
        </div>
      </div>`
      }
    </div>`;

  const searchEl = document.getElementById("peopleSearch");
  searchEl?.addEventListener("input", () => {
    searchQuery = searchEl.value || "";
    paintPeoplePage(host);
    document.getElementById("peopleSearch")?.focus();
    const el = document.getElementById("peopleSearch");
    if (el) {
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  });

  host.querySelectorAll("[data-person-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedKey = btn.dataset.personKey;
      paintPeoplePage(host);
    });
  });

  bindLinkClicks(host);
}
