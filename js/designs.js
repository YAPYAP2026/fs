// 10 modèles de parachutiste au choix. Chaque modèle dessine UN corps identique pour tous
// (seuls couleur, position et rotation changent) dans un <g>, repère local : origine au
// centre du torse, tête vers le haut. Les membres ne sont dessinés que pour le côté droit,
// puis recopiés en miroir : mains et pieds sont donc parfaitement symétriques.

const SVG_NS = "http://www.w3.org/2000/svg";
const INK = "#111";

export function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

// ---------- couleurs ----------

function mix(hex, other, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex), b = p(other);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
const shades = (c) => ({ base: c, dark: mix(c, "#000000", 0.35), light: mix(c, "#ffffff", 0.45) });

// ---------- primitives ----------

const pts = (list) => list.map((p) => p.join(",")).join(" ");

function stroke(g, list, width, color, cap = "round") {
  return el("polyline", { points: pts(list), fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": cap, "stroke-linejoin": "round" }, g);
}

// membre avec contour : trait noir épais puis trait coloré
function limb(g, list, width, color, outline = 4) {
  if (outline) stroke(g, list, width + outline, INK);
  stroke(g, list, width, color);
}

// segment effilé (largeur w1 -> w2), pour des membres plus "anatomiques"
function taper(g, [ax, ay], [bx, by], w1, w2, attrs) {
  const L = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / L, ny = (bx - ax) / L;
  const p = [
    [ax + nx * w1 / 2, ay + ny * w1 / 2], [bx + nx * w2 / 2, by + ny * w2 / 2],
    [bx - nx * w2 / 2, by - ny * w2 / 2], [ax - nx * w1 / 2, ay - ny * w1 / 2],
  ];
  el("polygon", { points: pts(p), ...attrs }, g);
  // bout arrondi (sans le liseré blanc du style pictogramme, qui ferait un point blanc)
  const capStroke = attrs.stroke && attrs.stroke !== "#fff" ? attrs.stroke : "none";
  el("circle", { cx: bx, cy: by, r: w2 / 2, fill: attrs.fill, stroke: capStroke, "stroke-width": attrs["stroke-width"] ?? 0 }, g);
}

function ellipseAlong(g, [ax, ay], [bx, by], rx, ry, attrs) {
  const ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  return el("ellipse", { cx: bx, cy: by, rx, ry, transform: `rotate(${ang} ${bx} ${by})`, ...attrs }, g);
}

// dessine les membres du côté droit, puis la copie miroir pour le côté gauche
function symmetric(g, drawRight) {
  const right = el("g", {}, g);
  drawRight(right);
  const left = right.cloneNode(true);
  left.setAttribute("transform", "scale(-1 1)");
  g.insertBefore(left, right);
}

// ---------- poses (côté droit uniquement) ----------

const POSE = {
  // position "box" classique : bras en W, jambes en M
  box: { sh: [14, -20], el: [40, -24], ha: [44, -50], hip: [8, 26], kn: [30, 50], ft: [38, 76] },
  // bras plus en avant (position de prise)
  grip: { sh: [14, -20], el: [38, -32], ha: [30, -58], hip: [8, 26], kn: [28, 52], ft: [34, 78] },
  // compacte
  tight: { sh: [12, -16], el: [32, -20], ha: [34, -42], hip: [7, 22], kn: [24, 42], ft: [30, 62] },
  // jambes en grenouille
  frog: { sh: [14, -20], el: [40, -26], ha: [40, -52], hip: [8, 26], kn: [38, 46], ft: [22, 72] },
};

// ---------- les 10 modèles ----------

export const DESIGNS = [
  {
    name: "Classique",
    desc: "Position box, contours noirs, container gris, mains et chaussons noirs.",
    draw(g, color) {
      const c = shades(color), p = POSE.box;
      symmetric(g, (r) => {
        limb(r, [p.hip, p.kn, p.ft], 13, c.base);
        ellipseAlong(r, p.kn, p.ft, 8, 6, { fill: INK });
        limb(r, [p.sh, p.el, p.ha], 11, c.base);
        el("circle", { cx: p.ha[0], cy: p.ha[1], r: 6.5, fill: INK }, r);
      });
      el("rect", { x: -17, y: -29, width: 34, height: 58, rx: 10, fill: c.base, stroke: INK, "stroke-width": 3 }, g);
      el("rect", { x: -12, y: -22, width: 24, height: 42, rx: 5, fill: "#c8c8c8", stroke: INK, "stroke-width": 2 }, g);
      el("circle", { cx: 0, cy: -40, r: 12, fill: c.base, stroke: INK, "stroke-width": 3 }, g);
    },
  },
  {
    name: "Prise",
    desc: "Même style, bras plus en avant comme pour saisir une prise.",
    draw(g, color) {
      const c = shades(color), p = POSE.grip;
      symmetric(g, (r) => {
        limb(r, [p.hip, p.kn, p.ft], 13, c.base);
        ellipseAlong(r, p.kn, p.ft, 8, 6, { fill: INK });
        limb(r, [p.sh, p.el, p.ha], 11, c.base);
        el("circle", { cx: p.ha[0], cy: p.ha[1], r: 6.5, fill: INK }, r);
      });
      el("rect", { x: -17, y: -29, width: 34, height: 58, rx: 10, fill: c.base, stroke: INK, "stroke-width": 3 }, g);
      el("rect", { x: -12, y: -22, width: 24, height: 42, rx: 5, fill: "#c8c8c8", stroke: INK, "stroke-width": 2 }, g);
      el("circle", { cx: 0, cy: -40, r: 12, fill: c.base, stroke: INK, "stroke-width": 3 }, g);
    },
  },
  {
    name: "Détaillé",
    desc: "Grippers foncés, harnais et sangles, visière de casque, gants et chaussons.",
    draw(g, color) {
      const c = shades(color), p = POSE.box;
      symmetric(g, (r) => {
        limb(r, [p.hip, p.kn, p.ft], 13, c.base);
        stroke(r, [[(p.hip[0] + p.kn[0]) / 2, (p.hip[1] + p.kn[1]) / 2], p.kn], 13, c.dark, "butt");
        ellipseAlong(r, p.kn, p.ft, 9, 6.5, { fill: INK });
        limb(r, [p.sh, p.el, p.ha], 11, c.base);
        stroke(r, [p.sh, [(p.sh[0] + p.el[0]) / 2, (p.sh[1] + p.el[1]) / 2]], 11, c.dark, "butt");
        el("circle", { cx: p.ha[0], cy: p.ha[1], r: 6.5, fill: INK }, r);
        // sangle de cuisse
        stroke(r, [[4, 22], [16, 34]], 3, "#333");
      });
      el("rect", { x: -17, y: -29, width: 34, height: 58, rx: 10, fill: c.base, stroke: INK, "stroke-width": 3 }, g);
      el("rect", { x: -12, y: -23, width: 24, height: 44, rx: 6, fill: "#bdbdbd", stroke: INK, "stroke-width": 2 }, g);
      el("rect", { x: -9, y: -19, width: 18, height: 10, rx: 3, fill: "#9a9a9a" }, g); // rabat secours
      stroke(g, [[-12, 6], [12, 6]], 2, "#555");
      el("circle", { cx: 0, cy: -40, r: 12.5, fill: c.base, stroke: INK, "stroke-width": 3 }, g);
      el("path", { d: "M -9 -44 Q 0 -54 9 -44", fill: "none", stroke: "#222", "stroke-width": 4, "stroke-linecap": "round" }, g);
    },
  },
  {
    name: "Plat",
    desc: "Design plat, sans contour, formes arrondies et container clair.",
    draw(g, color) {
      const c = shades(color), p = POSE.box;
      symmetric(g, (r) => {
        stroke(r, [p.hip, p.kn, p.ft], 14, c.base);
        stroke(r, [p.sh, p.el, p.ha], 12, c.base);
        el("circle", { cx: p.ha[0], cy: p.ha[1], r: 6, fill: c.dark }, r);
        el("circle", { cx: p.ft[0], cy: p.ft[1], r: 7, fill: c.dark }, r);
      });
      el("rect", { x: -17, y: -29, width: 34, height: 58, rx: 14, fill: c.base }, g);
      el("rect", { x: -11, y: -21, width: 22, height: 40, rx: 8, fill: c.light }, g);
      el("circle", { cx: 0, cy: -41, r: 12, fill: c.dark }, g);
    },
  },
  {
    name: "Ligne",
    desc: "Bonhomme bâton épais, très lisible même en petit.",
    draw(g, color) {
      const c = shades(color), p = POSE.box;
      symmetric(g, (r) => {
        stroke(r, [[0, 22], p.kn, p.ft], 9, c.base);
        stroke(r, [[0, -18], p.el, p.ha], 9, c.base);
      });
      stroke(g, [[0, -22], [0, 24]], 14, c.base);
      el("circle", { cx: 0, cy: -40, r: 12, fill: c.base }, g);
    },
  },
  {
    name: "Pictogramme",
    desc: "Style pictogramme sportif : pièces séparées par de fins espaces.",
    draw(g, color) {
      const c = shades(color), p = POSE.box;
      const gap = { stroke: "#fff", "stroke-width": 3, "paint-order": "stroke" };
      symmetric(g, (r) => {
        taper(r, p.hip, p.kn, 15, 12, { fill: c.base, ...gap });
        taper(r, p.kn, p.ft, 12, 9, { fill: c.base, ...gap });
        taper(r, p.sh, p.el, 12, 10, { fill: c.base, ...gap });
        taper(r, p.el, p.ha, 10, 8, { fill: c.base, ...gap });
      });
      el("rect", { x: -16, y: -28, width: 32, height: 56, rx: 12, fill: c.base, ...gap }, g);
      el("circle", { cx: 0, cy: -44, r: 12, fill: c.base, ...gap }, g);
    },
  },
  {
    name: "Grosse tête",
    desc: "Style cartoon : gros casque avec lunettes, membres courts.",
    draw(g, color) {
      const c = shades(color), p = POSE.tight;
      symmetric(g, (r) => {
        limb(r, [p.hip, p.kn, p.ft], 12, c.base);
        el("circle", { cx: p.ft[0], cy: p.ft[1], r: 7, fill: INK }, r);
        limb(r, [p.sh, p.el, p.ha], 10, c.base);
        el("circle", { cx: p.ha[0], cy: p.ha[1], r: 6.5, fill: INK }, r);
      });
      el("rect", { x: -15, y: -24, width: 30, height: 48, rx: 12, fill: c.base, stroke: INK, "stroke-width": 3 }, g);
      el("rect", { x: -10, y: -17, width: 20, height: 32, rx: 6, fill: "#c8c8c8", stroke: INK, "stroke-width": 2 }, g);
      el("circle", { cx: 0, cy: -40, r: 18, fill: c.base, stroke: INK, "stroke-width": 3 }, g);
      el("rect", { x: -13, y: -50, width: 26, height: 9, rx: 4.5, fill: "#2b2b2b" }, g);
    },
  },
  {
    name: "Élancé",
    desc: "Proportions fines, membres effilés, aspect plus réaliste.",
    draw(g, color) {
      const c = shades(color), p = POSE.box;
      const o = { stroke: INK, "stroke-width": 2.5 };
      symmetric(g, (r) => {
        taper(r, p.hip, p.kn, 14, 10, { fill: c.base, ...o });
        taper(r, p.kn, p.ft, 10, 7, { fill: c.base, ...o });
        ellipseAlong(r, p.kn, p.ft, 7, 4.5, { fill: INK });
        taper(r, p.sh, p.el, 11, 8, { fill: c.base, ...o });
        taper(r, p.el, p.ha, 8, 6, { fill: c.base, ...o });
        el("circle", { cx: p.ha[0], cy: p.ha[1], r: 5, fill: INK }, r);
      });
      el("path", { d: "M -16 -26 Q 0 -32 16 -26 L 12 26 Q 0 30 -12 26 Z", fill: c.base, ...o }, g);
      el("rect", { x: -10, y: -21, width: 20, height: 40, rx: 5, fill: "#c4c4c4", stroke: INK, "stroke-width": 1.5 }, g);
      el("ellipse", { cx: 0, cy: -39, rx: 10, ry: 11.5, fill: c.base, ...o }, g);
    },
  },
  {
    name: "Géométrique",
    desc: "Formes anguleuses : torse trapèze, membres polygonaux, casque hexagonal.",
    draw(g, color) {
      const c = shades(color), p = POSE.box;
      const o = { stroke: INK, "stroke-width": 2.5, "stroke-linejoin": "round" };
      symmetric(g, (r) => {
        stroke(r, [p.hip, p.kn, p.ft], 15, INK, "square");
        stroke(r, [p.hip, p.kn, p.ft], 11, c.base, "square");
        stroke(r, [p.sh, p.el, p.ha], 13, INK, "square");
        stroke(r, [p.sh, p.el, p.ha], 9, c.base, "square");
        el("rect", { x: p.ha[0] - 5, y: p.ha[1] - 5, width: 10, height: 10, fill: INK, transform: `rotate(45 ${p.ha[0]} ${p.ha[1]})` }, r);
      });
      el("polygon", { points: "-18,-28 18,-28 13,28 -13,28", fill: c.base, ...o }, g);
      el("polygon", { points: "-11,-21 11,-21 8,20 -8,20", fill: "#c8c8c8", ...o }, g);
      el("polygon", { points: "0,-54 12,-47 12,-33 0,-26 -12,-33 -12,-47", fill: c.base, ...o }, g);
    },
  },
  {
    name: "Relief",
    desc: "Classique avec ombre portée et reflets, pour un effet 3D léger.",
    draw(g, color) {
      const c = shades(color), p = POSE.box;
      const body = el("g", {}, g);
      const drawBody = (t, fill, outline, details) => {
        symmetric(t, (r) => {
          limb(r, [p.hip, p.kn, p.ft], 13, fill, outline);
          if (details) stroke(r, [p.hip, p.kn], 4, c.light);
          ellipseAlong(r, p.kn, p.ft, 8, 6, { fill: details ? INK : fill });
          limb(r, [p.sh, p.el, p.ha], 11, fill, outline);
          if (details) stroke(r, [p.sh, p.el], 3.5, c.light);
          el("circle", { cx: p.ha[0], cy: p.ha[1], r: 6.5, fill: details ? INK : fill }, r);
        });
        el("rect", { x: -17, y: -29, width: 34, height: 58, rx: 10, fill, stroke: outline ? INK : "none", "stroke-width": 3 }, t);
        if (details) {
          el("rect", { x: -12, y: -22, width: 24, height: 42, rx: 5, fill: "#cfcfcf", stroke: INK, "stroke-width": 2 }, t);
          el("rect", { x: -9, y: -19, width: 6, height: 34, rx: 3, fill: "#ececec" }, t);
        }
        el("circle", { cx: 0, cy: -40, r: 12, fill, stroke: outline ? INK : "none", "stroke-width": 3 }, t);
        if (details) el("circle", { cx: -4, cy: -44, r: 4, fill: c.light }, t);
      };
      const shadow = el("g", { transform: "translate(5 6)", opacity: 0.25 }, body);
      drawBody(shadow, "#000000", 0, false);
      drawBody(el("g", {}, body), c.base, 4, true);
    },
  },
];

// pose (position des mains / pieds) de chaque modèle, utilisée pour faire se toucher les prises
const DESIGN_POSES = { "Prise": POSE.grip, "Grosse tête": POSE.tight };
for (const d of DESIGNS) d.pose = DESIGN_POSES[d.name] ?? POSE.box;

export const SUITS = { blue: "#192de1", green: "#1ebe28", yellow: "#f0dc14", red: "#dc1e1e" };

export function drawJumperWith(design, parent, j) {
  const g = el("g", { transform: `translate(${j.x} ${j.y}) rotate(${j.r})` }, parent);
  design.draw(g, SUITS[j.c] ?? j.c);
  return g;
}
