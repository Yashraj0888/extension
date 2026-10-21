/* Restore theme before first paint (no flash, no animation).
   Kept as an external classic script: Manifest V3 extension pages forbid
   inline <script> blocks (default CSP: script-src 'self'). */
(function () {
  try {
    var p = localStorage.getItem("amn_theme") || "system";
    var d = p === "dark" || (p === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    var root = document.documentElement;
    root.setAttribute("data-theme", d ? "dark" : "light");
    root.setAttribute("data-theme-pref", p);
    root.style.colorScheme = d ? "dark" : "light";
    root.classList.toggle("dark", !!d);
  } catch (e) {}
})();
