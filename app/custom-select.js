// Lightweight custom dropdown for native <select> elements.
// Keeps the original <select> in sync for existing change listeners.

const CHEVRON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

function optionLabel(opt) {
  return (opt && (opt.label || opt.textContent) || "").trim();
}

function buildList(select, listEl, trigger) {
  listEl.innerHTML = "";
  Array.from(select.options).forEach((opt, idx) => {
    if (opt.hidden) return;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "cselect-option" + (opt.selected ? " is-selected" : "") + (opt.disabled ? " is-disabled" : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", opt.selected ? "true" : "false");
    item.dataset.index = String(idx);
    item.textContent = optionLabel(opt) || "—";
    if (opt.disabled) {
      item.disabled = true;
    } else {
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        select.selectedIndex = idx;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncTrigger(select, trigger);
        closeAll();
      });
    }
    listEl.appendChild(item);
  });
}

function syncTrigger(select, trigger) {
  const opt = select.options[select.selectedIndex];
  const label = trigger.querySelector(".cselect-label");
  if (label) label.textContent = optionLabel(opt) || select.getAttribute("placeholder") || "Select…";
  trigger.classList.toggle("is-empty", !opt || !optionLabel(opt));
}

function closeAll(except) {
  document.querySelectorAll(".cselect.is-open").forEach((wrap) => {
    if (except && wrap === except) return;
    wrap.classList.remove("is-open");
    wrap.classList.remove("opens-up");
    const t = wrap.querySelector(".cselect-trigger");
    if (t) t.setAttribute("aria-expanded", "false");
    const menu = wrap.querySelector(".cselect-menu");
    if (menu) {
      menu.style.maxHeight = "";
      menu.style.top = "";
      menu.style.bottom = "";
    }
  });
}

function positionMenu(wrap, list, trigger) {
  wrap.classList.remove("opens-up");
  list.style.maxHeight = "";
  list.style.top = "";
  list.style.bottom = "";

  // Force layout while open so we can measure
  const rect = trigger.getBoundingClientRect();
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - 8);
  const spaceAbove = Math.max(0, rect.top - 8);
  const preferred = 180;
  const openUp = spaceBelow < Math.min(preferred, 120) && spaceAbove > spaceBelow;
  const available = openUp ? spaceAbove : spaceBelow;
  const maxH = Math.max(96, Math.min(preferred, available));

  list.style.maxHeight = `${maxH}px`;
  if (openUp) {
    wrap.classList.add("opens-up");
    list.style.top = "auto";
    list.style.bottom = "calc(100% + 4px)";
  } else {
    list.style.top = "calc(100% + 4px)";
    list.style.bottom = "auto";
  }
}

export function enhanceSelect(select) {
  if (!select || select.tagName !== "SELECT" || select.dataset.cselect === "1") return null;
  if (select.dataset.noCselect === "1") return null;
  if (select.closest(".cselect")) return select.closest(".cselect");

  select.dataset.cselect = "1";
  select.classList.add("cselect-native");
  select.setAttribute("tabindex", "-1");
  select.setAttribute("aria-hidden", "true");

  const wrap = document.createElement("div");
  wrap.className = "cselect";
  if (select.classList.contains("select-block") || select.classList.contains("speaker-filter") || select.classList.contains("summary-type-select")) {
    wrap.classList.add("cselect-block");
  }
  if (select.classList.contains("home-filter-select")) {
    wrap.classList.add("cselect-compact");
  }
  if (select.disabled) wrap.classList.add("is-disabled");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cselect-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `<span class="cselect-label"></span><span class="cselect-chevron">${CHEVRON}</span>`;

  const list = document.createElement("div");
  list.className = "cselect-menu";
  list.setAttribute("role", "listbox");

  const parent = select.parentNode;
  parent.insertBefore(wrap, select);
  wrap.appendChild(select);
  wrap.appendChild(trigger);
  wrap.appendChild(list);

  syncTrigger(select, trigger);
  buildList(select, list, trigger);

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (select.disabled) return;
    const willOpen = !wrap.classList.contains("is-open");
    closeAll();
    if (willOpen) {
      buildList(select, list, trigger);
      wrap.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      positionMenu(wrap, list, trigger);
      const selected = list.querySelector(".is-selected");
      if (selected) selected.scrollIntoView({ block: "nearest" });
    }
  });

  // Reposition on scroll/resize while open
  const reposition = () => {
    if (wrap.classList.contains("is-open")) positionMenu(wrap, list, trigger);
  };
  window.addEventListener("resize", reposition);
  document.addEventListener(
    "scroll",
    reposition,
    true
  );

  select.addEventListener("change", () => {
    syncTrigger(select, trigger);
    buildList(select, list, trigger);
  });

  // Rebuild when options are swapped via innerHTML.
  const mo = new MutationObserver(() => {
    syncTrigger(select, trigger);
    if (wrap.classList.contains("is-open")) buildList(select, list, trigger);
  });
  mo.observe(select, { childList: true, subtree: true, characterData: true });

  return wrap;
}

export function enhanceSelects(root = document) {
  root.querySelectorAll("select").forEach((sel) => enhanceSelect(sel));
}

let docBound = false;
export function bindCustomSelects(root = document) {
  enhanceSelects(root);
  if (!docBound) {
    docBound = true;
    document.addEventListener("click", () => closeAll());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAll();
    });
  }
}

// Auto for non-module pages that include the script without importing.
if (typeof window !== "undefined") {
  window.CustomSelect = { enhanceSelect, enhanceSelects, bindCustomSelects };
}
