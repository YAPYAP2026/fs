// Rendu SVG des vignettes : chaque parachutiste est dessiné avec le MÊME corps (modèle choisi
// dans js/designs.js), seuls sa couleur, sa position et sa rotation changent.

import { DESIGNS, drawJumperWith, el } from "./designs.js";
import { snapFormation } from "./snap.js";

// Modèle utilisé dans l'application (numéro affiché sur designs.html, moins 1).
export const DESIGN = DESIGNS[0];

// snap : rapproche les mains de leurs prises au moment du rendu (voir js/snap.js). Désactivé :
// les positions de js/formations.js sont déjà recalées sur le PDF avec les prises jointives.
export const options = { snap: false };

const ARROW = "#eef2f8"; // clair : lisible sur le fond sombre des vignettes

export function drawArrow(parent, a) {
  const [x1, y1, cx, cy, x2, y2] = a.d;
  const g = el("g", { class: "arrow" }, parent);
  el("path", { d: `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`, fill: "none", stroke: ARROW, "stroke-width": 4, "stroke-linecap": "round" }, g);
  const ang = Math.atan2(y2 - cy, x2 - cx);
  const p = (da, r) => `${x2 + Math.cos(ang + da) * r},${y2 + Math.sin(ang + da) * r}`;
  el("polygon", { points: `${p(0, 10)} ${p(Math.PI / 2, 6)} ${p(-Math.PI / 2, 6)}`, fill: ARROW }, g);
  if (a.t) {
    const t = el("text", { x: a.l[0], y: a.l[1], fill: ARROW, "font-size": 17, "font-family": "system-ui, sans-serif", "text-anchor": "middle", "dominant-baseline": "central" }, g);
    t.textContent = a.t;
  }
  return g;
}

// Une vignette complète (formation + flèches) dans un SVG 480x480.
// label : nom de la figure, écrit en grand derrière les parachutistes (hauteur de la carte).
export function formationSvg(frame, label) {
  const svg = el("svg", { viewBox: "0 0 480 480", class: "formation" });
  if (label) {
    // 560px ≈ 400px de capitales ; baseline à 440 pour la centrer verticalement
    const attrs = { class: "frame-name", x: 240, y: 440, "font-size": 560, "text-anchor": "middle" };
    // deux caractères (ex. « 12 ») : on resserre pour rester dans la carte
    if (label.length > 1) Object.assign(attrs, { textLength: 440, lengthAdjust: "spacingAndGlyphs" });
    el("text", attrs, svg).textContent = label;
  }
  // positions ajustées pour que les mains touchent leurs prises (corps et rotations inchangés)
  const placed = options.snap ? snapFormation(frame, DESIGN.pose) : frame;
  for (const j of placed.jumpers) drawJumperWith(DESIGN, svg, j);
  for (const a of frame.arrows ?? []) drawArrow(svg, a);
  return svg;
}
