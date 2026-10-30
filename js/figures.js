// Catalogue des figures VR4 (pool 2025, source : figures.pdf / media.vivelachute.org/vr4).
// Les formations (position et pose de chaque parachutiste, flèches de rotation) sont dans
// js/formations.js et dessinées en SVG par js/skydiver.js.

import { FORMATIONS } from "./formations.js";
import { formationSvg } from "./skydiver.js";

// Vignettes roses dans le PDF : figures réservées au niveau N1.
const N1_ONLY = new Set(["3", "5", "10", "12", "16", "17"]);

export const BLOCK_FRAME_LABELS = ["Départ", "Inter", "Arrivée"];

export const FIGURES = [
  ..."ABCDEFGHJKLMNOPQ".split("").map((id) => ({
    id,
    type: "random",
    points: 1,
    levels: ["N1", "N2"],
    frames: FORMATIONS[id],
  })),
  ...Array.from({ length: 22 }, (_, k) => {
    const id = String(k + 1);
    return {
      id,
      type: "block",
      points: 2,
      levels: N1_ONLY.has(id) ? ["N1"] : ["N1", "N2"],
      frames: FORMATIONS[id],
    };
  }),
];

export const FIG_BY_ID = Object.fromEntries(FIGURES.map((f) => [f.id, f]));

export const figureLabel = (f) => f.id;

export function frameEl(frame, label) {
  const d = document.createElement("div");
  d.className = "frame";
  d.append(formationSvg(frame, label));
  return d;
}

// Rendu complet d'une figure : 1 vignette pour un random, 3 (départ/inter/arrivée) pour un bloc.
export function figureVisual(f) {
  const v = document.createElement("div");
  v.className = `visual ${f.type}`;
  f.frames.forEach((frame) => v.append(frameEl(frame, figureLabel(f))));
  return v;
}
