/**
 * Lightswind Toggle Theme — vanilla port for Chrome extension (no React/Tailwind).
 * Source algorithm: https://lightswind.com/components/toggle-theme.md
 *
 * Runs View Transition animations from the toggle element's center.
 * Does not own theme state; callers paint the DOM, then invoke runThemeAnimation.
 */

export const THEME_ANIMATION_TYPES = [
  "none",
  "circle-spread",
  "round-morph",
  "swipe-left",
  "swipe-up",
  "diag-down-right",
  "fade-in-out",
  "shrink-grow",
  "flip-x-in",
  "split-vertical",
  "swipe-right",
  "swipe-down",
  "wave-ripple",
];

/** Disable default VT cross-fade so custom clip-path animations are visible. */
export function ensureViewTransitionResetStyles(animationType = "circle-spread") {
  if (animationType === "flip-x-in") return;
  let styleElement = document.getElementById("toggle-theme-vt-override");
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = "toggle-theme-vt-override";
    styleElement.textContent = `
      ::view-transition-old(root),
      ::view-transition-new(root) {
        animation: none;
        mix-blend-mode: normal;
      }
    `;
    document.head.appendChild(styleElement);
  }
}

/**
 * Play Lightswind animation after startViewTransition().ready.
 * @param {{ animationType?: string, duration?: number, fromEl?: Element | null }} opts
 */
export function runThemeAnimation({
  animationType = "circle-spread",
  duration = 400,
  fromEl = null,
} = {}) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let x = viewportWidth / 2;
  let y = viewportHeight / 2;
  if (fromEl && typeof fromEl.getBoundingClientRect === "function") {
    const { top, left, width, height } = fromEl.getBoundingClientRect();
    x = left + width / 2;
    y = top + height / 2;
  }

  const maxRadius = Math.hypot(
    Math.max(x, viewportWidth - x),
    Math.max(y, viewportHeight - y)
  );

  switch (animationType) {
    case "circle-spread":
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${maxRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      break;

    case "round-morph":
      document.documentElement.animate(
        [
          { opacity: 0, transform: "scale(0.8) rotate(5deg)" },
          { opacity: 1, transform: "scale(1) rotate(0deg)" },
        ],
        {
          duration: duration * 1.2,
          easing: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      break;

    case "swipe-left":
      document.documentElement.animate(
        {
          clipPath: [`inset(0 0 0 ${viewportWidth}px)`, `inset(0 0 0 0)`],
        },
        {
          duration,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      break;

    case "swipe-up":
      document.documentElement.animate(
        {
          clipPath: [`inset(${viewportHeight}px 0 0 0)`, `inset(0 0 0 0)`],
        },
        {
          duration,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      break;

    case "diag-down-right":
      document.documentElement.animate(
        {
          clipPath: [
            `polygon(0 0, 0 0, 0 0, 0 0)`,
            `polygon(0 0, 100% 0, 100% 100%, 0 100%)`,
          ],
        },
        {
          duration: duration * 1.5,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      break;

    case "fade-in-out":
      document.documentElement.animate(
        { opacity: [0, 1] },
        {
          duration: duration * 0.5,
          easing: "ease-in-out",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      break;

    case "shrink-grow":
      document.documentElement.animate(
        [
          { transform: "scale(0.9)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ],
        {
          duration: duration * 1.2,
          easing: "cubic-bezier(0.19, 1, 0.22, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      document.documentElement.animate(
        [
          { transform: "scale(1)", opacity: 1 },
          { transform: "scale(1.05)", opacity: 0 },
        ],
        {
          duration: duration * 1.2,
          easing: "cubic-bezier(0.19, 1, 0.22, 1)",
          pseudoElement: "::view-transition-old(root)",
        }
      );
      break;

    case "flip-x-in": {
      let styleElement = document.getElementById("toggle-theme-flip-x");
      if (!styleElement) {
        styleElement = document.createElement("style");
        styleElement.id = "toggle-theme-flip-x";
        styleElement.textContent = `
          ::view-transition-group(root) { perspective: 1000px; }
          ::view-transition-old(root) { transform-origin: center; animation: amn-flip-out 400ms forwards; }
          ::view-transition-new(root) { transform-origin: center; animation: amn-flip-in 400ms forwards; }
          @keyframes amn-flip-out { from { transform: rotateY(0deg); opacity: 1; } to { transform: rotateY(-90deg); opacity: 0; } }
          @keyframes amn-flip-in { from { transform: rotateY(90deg); opacity: 0; } to { transform: rotateY(0deg); opacity: 1; } }
        `;
        document.head.appendChild(styleElement);
      }
      break;
    }

    case "split-vertical":
      document.documentElement.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: duration * 0.75,
          easing: "ease-in",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      document.documentElement.animate(
        [
          { clipPath: "inset(0 0 0 0)", transform: "none" },
          { clipPath: "inset(0 40% 0 40%)", transform: "scale(1.2)" },
          { clipPath: "inset(0 50% 0 50%)", transform: "scale(1)" },
        ],
        {
          duration: duration * 1.5,
          easing: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
          pseudoElement: "::view-transition-old(root)",
        }
      );
      break;

    case "swipe-right":
      document.documentElement.animate(
        {
          clipPath: [`inset(0 ${viewportWidth}px 0 0)`, `inset(0 0 0 0)`],
        },
        {
          duration,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      break;

    case "swipe-down":
      document.documentElement.animate(
        {
          clipPath: [`inset(0 0 ${viewportHeight}px 0)`, `inset(0 0 0 0)`],
        },
        {
          duration,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      break;

    case "wave-ripple":
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0% at 50% 50%)`,
            `circle(${maxRadius}px at 50% 50%)`,
          ],
        },
        {
          duration: duration * 1.5,
          easing: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      break;

    case "none":
    default:
      break;
  }
}
