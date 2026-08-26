// System-level theme manager for the Chrome extension.
// Persistence: localStorage (FOUC-safe) + chrome.storage.sync.
// Animation: Lightswind circle-spread View Transition (vanilla port).

import {
  ensureViewTransitionResetStyles,
  runThemeAnimation,
} from "./components/toggle-theme.js";

const STORAGE_KEY = "amn_theme";
const PREFS = ["light", "dark", "system"];

/** Lightswind default — circle expands from the toggle control. */
const DEFAULT_ANIMATION = "circle-spread";
const DEFAULT_DURATION = 560;

let currentPref = "system";
let mediaQuery = null;
let listeners = new Set();
let animationType = DEFAULT_ANIMATION;
let animationDuration = DEFAULT_DURATION;

function readLocalPref() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (PREFS.includes(v)) return v;
  } catch (_) {}
  return "system";
}

function writeLocalPref(pref) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch (_) {}
}

export function resolveTheme(pref = currentPref) {
  if (pref === "light" || pref === "dark") return pref;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function getThemePref() {
  return currentPref;
}

export function getResolvedTheme() {
  return resolveTheme(currentPref);
}

export function setThemeAnimation(type = DEFAULT_ANIMATION, duration = DEFAULT_DURATION) {
  animationType = type || DEFAULT_ANIMATION;
  animationDuration = typeof duration === "number" ? duration : DEFAULT_DURATION;
}

function notify() {
  const resolved = resolveTheme(currentPref);
  listeners.forEach((fn) => {
    try {
      fn({ pref: currentPref, resolved });
    } catch (_) {}
  });
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function syncChrome(pref) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      chrome.storage.sync.set({ theme: pref });
    }
  } catch (_) {}
}

function paintDom(pref, resolved) {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-pref", pref);
  root.style.colorScheme = resolved;
  // Lightswind-compatible class alongside our CSS-variable data-theme system
  root.classList.toggle("dark", resolved === "dark");
  updateToggleUi();
  notify();
}

function updateToggleUi(root = document) {
  const resolved = resolveTheme(currentPref);
  const nextLabel =
    resolved === "dark" ? "Switch to light mode" : "Switch to dark mode";
  root.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.setAttribute("aria-pressed", resolved === "dark" ? "true" : "false");
    btn.setAttribute("aria-label", nextLabel);
    btn.title = nextLabel;
    const label = btn.querySelector("[data-theme-label]");
    if (label) {
      label.innerHTML =
        currentPref === "system"
          ? `System · <strong>${resolved}</strong>`
          : `<strong>${resolved === "dark" ? "Dark" : "Light"}</strong>`;
    }
  });
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Lightswind-style View Transition; bubble originates at fromEl (the toggle).
 * Falls back to an instant paint when VT is unavailable or motion is reduced.
 */
async function runViewTransition(fromEl, apply) {
  if (prefersReducedMotion() || typeof document.startViewTransition !== "function") {
    apply();
    return;
  }

  ensureViewTransitionResetStyles(animationType);

  try {
    const transition = document.startViewTransition(() => {
      apply();
    });
    await transition.ready;
    runThemeAnimation({
      animationType,
      duration: animationDuration,
      fromEl,
    });
    // Avoid unhandled rejection if the transition is skipped mid-flight
    transition.finished?.catch?.(() => {});
  } catch (_) {
    apply();
  }
}

export function applyTheme(pref, { animate = false, fromEl = null, persist = true } = {}) {
  if (!PREFS.includes(pref)) pref = "system";
  currentPref = pref;
  const resolved = resolveTheme(pref);

  // Animation is click-only (needs originating control). Never animate on restore/sync/OS.
  const shouldAnimate = !!(animate && fromEl);

  const paint = () => paintDom(pref, resolved);

  if (persist) {
    writeLocalPref(pref);
    syncChrome(pref);
  }

  if (shouldAnimate) {
    document.documentElement.classList.add("theme-animating");
    Promise.resolve(runViewTransition(fromEl, paint)).finally(() => {
      setTimeout(
        () => document.documentElement.classList.remove("theme-animating"),
        animationDuration + 120
      );
    });
  } else {
    paint();
  }

  return resolved;
}

/** Toggle light ↔ dark (locks preference away from system). */
export function toggleTheme(fromEl) {
  const next = resolveTheme(currentPref) === "dark" ? "light" : "dark";
  return applyTheme(next, { animate: true, fromEl });
}

/** Cycle light → dark → system. */
export function cycleTheme(fromEl) {
  const i = PREFS.indexOf(currentPref);
  const next = PREFS[(i + 1) % PREFS.length];
  return applyTheme(next, { animate: true, fromEl });
}

export function themeToggleHtml() {
  return `
    <button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch to dark mode" title="Switch to dark mode">
      <span class="theme-toggle-thumb" aria-hidden="true">
        <span class="theme-toggle-icon sun" data-theme-icon="sun"></span>
        <span class="theme-toggle-icon moon" data-theme-icon="moon"></span>
      </span>
    </button>`;
}

export function themeToggleRowHtml() {
  return `
    <div class="theme-toggle-row">
      <span class="theme-label" data-theme-label>Theme</span>
      ${themeToggleHtml()}
    </div>`;
}

export function hydrateThemeToggleIcons(iconFn) {
  document.querySelectorAll('[data-theme-icon="sun"]').forEach((el) => {
    el.innerHTML = iconFn("sun", 13);
  });
  document.querySelectorAll('[data-theme-icon="moon"]').forEach((el) => {
    el.innerHTML = iconFn("moon", 13);
  });
}

export function bindThemeToggles(root = document, { cycle = false } = {}) {
  root.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    if (btn.dataset.themeBound === "1") return;
    btn.dataset.themeBound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (cycle || e.altKey || e.shiftKey) cycleTheme(btn);
      else toggleTheme(btn);
    });
  });
  updateToggleUi(root);
}

export async function initTheme() {
  currentPref = readLocalPref();
  setThemeAnimation(DEFAULT_ANIMATION, DEFAULT_DURATION);
  ensureViewTransitionResetStyles(animationType);

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      const data = await new Promise((resolve) => chrome.storage.sync.get(["theme"], resolve));
      if (PREFS.includes(data.theme)) {
        currentPref = data.theme;
        writeLocalPref(currentPref);
      }
    }
  } catch (_) {}

  applyTheme(currentPref, { animate: false, persist: true });

  if (typeof window !== "undefined" && window.matchMedia) {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      // Never animate on OS preference / mount — only user toggle clicks animate.
      if (currentPref === "system") applyTheme("system", { animate: false, persist: false });
    };
    if (mediaQuery.addEventListener) mediaQuery.addEventListener("change", onChange);
    else mediaQuery.addListener?.(onChange);
  }

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync" || !changes.theme) return;
        const v = changes.theme.newValue;
        if (PREFS.includes(v) && v !== currentPref) {
          applyTheme(v, { animate: false, persist: false });
          writeLocalPref(v);
        }
      });
    }
  } catch (_) {}

  return resolveTheme(currentPref);
}

/** Boot snippet for &lt;head&gt; to avoid FOUC — keep in sync with STORAGE_KEY. */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${STORAGE_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");document.documentElement.setAttribute("data-theme-pref",p);document.documentElement.style.colorScheme=d?"dark":"light";document.documentElement.classList.toggle("dark",!!d);}catch(e){}})();`;
