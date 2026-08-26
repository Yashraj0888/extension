// Custom date-range calendar (no typing). Pick start + end by clicking days.

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const CHEV_LEFT = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`;
const CHEV_RIGHT = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function toYmd(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseYmd(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRangeLabel(fromYmd, toYmd) {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (!from && !to) return "Date: Custom…";
  const a = formatShort(from || to);
  const b = formatShort(to || from);
  if (a === b) return `Date: ${a}`;
  return `Date: ${a} – ${b}`;
}

function formatShort(date) {
  if (!date) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatLong(date) {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function monthTitle(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function cmpYmd(a, b) {
  if (!a || !b) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}

function inRange(ymd, from, to) {
  if (!from || !to) return false;
  const lo = cmpYmd(from, to) <= 0 ? from : to;
  const hi = cmpYmd(from, to) <= 0 ? to : from;
  return ymd >= lo && ymd <= hi;
}

export function pickDateRange({ from = "", to = "" } = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById("dateRangeOverlay");
    existing?.remove();

    let start = from || "";
    let end = to || "";
    const seed = parseYmd(start) || parseYmd(end) || new Date();
    let viewYear = seed.getFullYear();
    let viewMonth = seed.getMonth();
    let settled = false;

    const overlay = document.createElement("div");
    overlay.id = "dateRangeOverlay";
    overlay.className = "date-range-overlay";
    overlay.innerHTML = `
      <div class="date-range-card" role="dialog" aria-modal="true" aria-labelledby="dateRangeTitle">
        <div class="date-range-head">
          <div>
            <h3 id="dateRangeTitle" class="date-range-title">Choose dates</h3>
            <p class="date-range-hint">Click a start day, then an end day. No typing needed.</p>
          </div>
          <button type="button" class="date-range-icon-btn" data-act="close" aria-label="Close">${CLOSE_ICON}</button>
        </div>
        <div class="date-range-picks">
          <div class="date-range-pick" data-pick="start">
            <span>From</span>
            <strong data-from-label>—</strong>
          </div>
          <div class="date-range-pick-arrow" aria-hidden="true">→</div>
          <div class="date-range-pick" data-pick="end">
            <span>To</span>
            <strong data-to-label>—</strong>
          </div>
        </div>
        <div class="date-range-nav">
          <button type="button" class="date-range-icon-btn" data-act="prev" aria-label="Previous month">${CHEV_LEFT}</button>
          <div class="date-range-month" data-month-title></div>
          <button type="button" class="date-range-icon-btn" data-act="next" aria-label="Next month">${CHEV_RIGHT}</button>
        </div>
        <div class="date-range-weekdays">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
        <div class="date-range-grid" data-grid></div>
        <div class="date-range-actions">
          <button type="button" class="date-range-btn ghost" data-act="clear">Clear</button>
          <div class="date-range-actions-right">
            <button type="button" class="date-range-btn ghost" data-act="cancel">Cancel</button>
            <button type="button" class="date-range-btn primary" data-act="apply">Apply</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const grid = overlay.querySelector("[data-grid]");
    const monthEl = overlay.querySelector("[data-month-title]");
    const fromLabel = overlay.querySelector("[data-from-label]");
    const toLabel = overlay.querySelector("[data-to-label]");
    const applyBtn = overlay.querySelector('[data-act="apply"]');

    const finish = (value) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === "Escape") finish(null);
    };
    document.addEventListener("keydown", onKey);

    function syncLabels() {
      const fromDate = parseYmd(start);
      const toDate = parseYmd(end);
      fromLabel.textContent = fromDate ? formatLong(fromDate) : "Pick start";
      toLabel.textContent = toDate ? formatLong(toDate) : start ? "Pick end" : "—";
      overlay.querySelector('[data-pick="start"]').classList.toggle("is-filled", !!start);
      overlay.querySelector('[data-pick="end"]').classList.toggle("is-filled", !!end);
      applyBtn.disabled = !start;
    }

    function renderGrid() {
      monthEl.textContent = monthTitle(viewYear, viewMonth);
      const firstDow = new Date(viewYear, viewMonth, 1).getDay();
      const count = daysInMonth(viewYear, viewMonth);
      const today = toYmd(new Date());
      const lo = start && end && cmpYmd(start, end) > 0 ? end : start;
      const hi = start && end && cmpYmd(start, end) > 0 ? start : end;

      const cells = [];
      for (let i = 0; i < firstDow; i++) cells.push(`<span class="date-range-cell is-empty"></span>`);
      for (let day = 1; day <= count; day++) {
        const ymd = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}`;
        const classes = ["date-range-cell"];
        if (ymd === today) classes.push("is-today");
        if (ymd === lo || ymd === hi) classes.push("is-selected");
        if (lo && hi && inRange(ymd, lo, hi)) classes.push("is-in-range");
        if (ymd === lo && hi && lo !== hi) classes.push("is-range-start");
        if (ymd === hi && lo && lo !== hi) classes.push("is-range-end");
        cells.push(`<button type="button" class="${classes.join(" ")}" data-ymd="${ymd}">${day}</button>`);
      }
      grid.innerHTML = cells.join("");
    }

    function pickDay(ymd) {
      if (!start || (start && end)) {
        start = ymd;
        end = "";
      } else if (ymd === start) {
        end = ymd;
      } else {
        end = ymd;
      }
      if (start && end && cmpYmd(start, end) > 0) {
        const tmp = start;
        start = end;
        end = tmp;
      }
      syncLabels();
      renderGrid();
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null);
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close" || act === "cancel") finish(null);
      if (act === "prev") {
        viewMonth -= 1;
        if (viewMonth < 0) {
          viewMonth = 11;
          viewYear -= 1;
        }
        renderGrid();
      }
      if (act === "next") {
        viewMonth += 1;
        if (viewMonth > 11) {
          viewMonth = 0;
          viewYear += 1;
        }
        renderGrid();
      }
      if (act === "clear") {
        start = "";
        end = "";
        syncLabels();
        renderGrid();
      }
      if (act === "apply") {
        if (!start) return;
        finish({ from: start, to: end || start });
      }
      const dayBtn = e.target.closest("[data-ymd]");
      if (dayBtn) pickDay(dayBtn.dataset.ymd);
    });

    syncLabels();
    renderGrid();
    overlay.querySelector(".date-range-card")?.focus?.();
  });
}

export default { pickDateRange, formatRangeLabel, toYmd, parseYmd };
