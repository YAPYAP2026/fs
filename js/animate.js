// Scène animée : les 4 parachutistes (un <g> par couleur, même corps pour tous) glissent et
// pivotent d'une formation à la suivante. Utilisée par la vue plein écran "Revoir".

import { drawJumperWith, el } from "./designs.js";
import { DESIGN, drawArrow } from "./skydiver.js";

export const DURATION = 800; // ms

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // easeInOutCubic
const lerp = (a, b, t) => a + (b - a) * t;
// rotation par le chemin le plus court
const turn = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

export function createStage() {
  const svg = el("svg", { viewBox: "0 0 480 480", class: "formation stage" });
  const jumperLayer = el("g", {}, svg);
  const arrowLayer = el("g", { class: "stage-arrows" }, svg);
  const nodes = {}; // couleur -> <g>
  let state = {};   // couleur -> {x, y, r} affiché
  let raf = null;

  const place = (c, p) => nodes[c].setAttribute("transform", `translate(${p.x} ${p.y}) rotate(${p.r})`);

  function show(frame, { animate = true } = {}) {
    cancelAnimationFrame(raf);
    const from = { ...state };
    const to = {};
    for (const j of frame.jumpers) {
      to[j.c] = { x: j.x, y: j.y, r: j.r };
      if (!nodes[j.c]) nodes[j.c] = drawJumperWith(DESIGN, jumperLayer, { ...j });
      if (!from[j.c]) from[j.c] = to[j.c];
    }

    // flèches de rotation : apparaissent une fois les parachutistes en place
    arrowLayer.replaceChildren();
    for (const a of frame.arrows ?? []) drawArrow(arrowLayer, a);
    arrowLayer.style.transition = "none";
    arrowLayer.style.opacity = animate ? 0 : 1;

    if (!animate) {
      for (const c in to) place(c, to[c]);
      state = to;
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min((now - t0) / DURATION, 1);
      const k = ease(t);
      for (const c in to) {
        const a = from[c], b = to[c];
        const p = { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), r: a.r + turn(a.r, b.r) * k };
        place(c, p);
        state[c] = p;
      }
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        state = to;
        arrowLayer.style.transition = "opacity .3s";
        arrowLayer.style.opacity = 1;
      }
    };
    raf = requestAnimationFrame(tick);
  }

  return { svg, show, stop: () => cancelAnimationFrame(raf) };
}
