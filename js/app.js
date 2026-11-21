import { FIGURES, FIG_BY_ID, BLOCK_FRAME_LABELS, figureLabel, figureVisual, figureDescription, frameEl } from "./figures.js";
import { load, save, uid } from "./storage.js";
import { createStage } from "./animate.js";

let store = load();
let activeSeriesId = null;
let drag = null; // { kind: "fig", figId, from: seriesId | null, index } | { kind: "series", seriesId }
let indicator = null; // { el, cls } : indicateur de dépôt affiché
let viewer = null; // { session, items: [{ si, fi }], pos }

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

// icônes SVG (trait, couleur du texte)
const svgIcon = (inner) => {
  const t = document.createElement("template");
  t.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  return t.content.firstElementChild;
};
const ICON_PLAY = svgIcon('<polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/>');
const ICON_TRASH = svgIcon('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>');

const btn = (label, onclick, { title, disabled, cls } = {}) =>
  h("button", {
    class: cls,
    title,
    disabled,
    onclick: (e) => {
      e.stopPropagation();
      onclick(e);
    },
  }, label);

// ---------- Données ----------

const newSeries = () => ({ id: uid(), figures: [] });
const current = () => store;

function ensureSeries() {
  if (!store.series.length) store.series.push(newSeries());
}

function commit() {
  persist();
  render();
}

// ---------- Partage (lien) ----------

const TRAINING_PARAM = "share";

// Format du lien, court : une lettre par figure (son rang dans FIGURES), les vols séparés par ",",
// Ex. « AB3,7 » = 2 vols. Un ancien lien peut contenir une note après "|" : elle est ignorée.
const CODE = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FIG_CODE = Object.fromEntries(FIGURES.map((f, i) => [f.id, CODE[i]]));
const FIG_BY_CODE = Object.fromEntries(FIGURES.map((f, i) => [CODE[i], f.id]));

function encodeTraining() {
  return store.series
    .map((se) => se.figures.map((id) => FIG_CODE[id]).join(""))
    .join(",");
}

function decodeTraining(token) {
  return token.split(",").map((part) => {
    const [figs] = part.split("|");
    return {
      id: uid(),
      figures: [...figs].map((c) => FIG_BY_CODE[c]).filter(Boolean),
    };
  });
}

const hasContent = (s) => s.series.some((se) => se.figures.length);

// L'adresse suit l'entraînement courant : le lien partagé est toujours à jour.
function syncUrl() {
  const hash = hasContent(store) ? `#${TRAINING_PARAM}=${encodeTraining()}` : "";
  history.replaceState(null, "", location.pathname + location.search + hash);
}

function persist() {
  save(store);
  syncUrl();
}

// Ouvre un lien partagé : charge son entraînement (après confirmation si le local a du contenu).
function applySharedLink() {
  const token = new URLSearchParams(location.hash.slice(1)).get(TRAINING_PARAM);
  if (!token) return;
  let shared;
  try {
    shared = decodeTraining(token);
  } catch {
    return; // lien invalide : ignoré
  }
  if (token === encodeTraining()) return;
  if (hasContent(store) && !confirm("Remplacer votre entraînement actuel par celui du lien partagé ?")) return;
  store = { series: shared };
}

// ---------- Rendu ----------

function render() {
  ensureSeries();
  renderSession();
}

function renderSession() {
  const s = current();
  if (!s.series.some((se) => se.id === activeSeriesId)) activeSeriesId = s.series[0]?.id ?? null;
  const nFigs = s.series.reduce((n, se) => n + se.figures.length, 0);
  $("#stats").textContent = `${s.series.length} vol${s.series.length > 1 ? "s" : ""} · ${nFigs} figure${nFigs > 1 ? "s" : ""}`;

  $("#session").replaceChildren(
    ...s.series.map((se, i) => seriesCard(s, se, i)),
    h("button", {
      class: "add-series no-print",
      onclick: () => {
        const ns = newSeries();
        s.series.push(ns);
        activeSeriesId = ns.id;
        commit();
      },
    }, "+ Ajouter un vol"),
  );
}

function seriesCard(s, se, i) {
  const last = s.series.length - 1;
  const move = (to) => {
    s.series.splice(to, 0, s.series.splice(i, 1)[0]);
    commit();
  };

  const row = h("div", { class: "fig-row" },
    se.figures.map((fid, j) => figTile(se, fid, j)),
    se.figures.length ? null : h("p", { class: "empty no-print" }, "Cliquez ou glissez des figures depuis la liste pour composer ce vol."),
    // case « + » seulement pour un vol vide (le clic sur le vol ouvre la palette)
    se.figures.length ? null : h("button", { class: "fig-add no-print", title: "Ajouter une figure à ce vol" }, "+"),
  );

  const card = h("section", {
    class: `series${se.id === activeSeriesId ? " active" : ""}`,
    dataset: { id: se.id },
    onclick: (e) => {
      setActive(se.id);
      // sélectionner un vol fait remonter la palette (téléphone)
      document.body.classList.add("palette-open");
    },
    ondragstart: (e) => {
      if (e.target !== card) return;
      startDrag(e, { kind: "series", seriesId: se.id });
    },
    ondragend: (e) => {
      card.draggable = false;
      endDrag(e);
    },
    ondragover: (e) => onDragOver(e, card, row),
    ondragleave: (e) => {
      if (!card.contains(e.relatedTarget)) clearIndicators();
    },
    ondrop: (e) => onDrop(e, s, se, card, row),
  },
    h("header", { class: "series-head" },
      h("span", {
        class: "handle no-print",
        title: "Glisser pour réordonner les vols",
        onmousedown: () => (card.draggable = true),
        onmouseup: () => (card.draggable = false),
      }, "⠿"),
      h("h2", {}, se.figures.length ? se.figures.join(" · ") : `Vol ${i + 1}`),
      h("div", { class: "actions no-print" },
        btn(ICON_PLAY.cloneNode(true), () => openViewer(s, i), { title: "Revoir", disabled: !se.figures.length, cls: "primary" }),
        btn("↑", () => move(i - 1), { title: "Monter", disabled: i === 0 }),
        btn("↓", () => move(i + 1), { title: "Descendre", disabled: i === last }),
        btn(ICON_TRASH.cloneNode(true), () => {
          if (se.figures.length && !confirm(`Supprimer le vol ${i + 1} ?`)) return;
          s.series.splice(i, 1);
          if (!s.series.length) s.series.push(newSeries());
          commit();
        }, { title: "Supprimer le vol" }),
      ),
    ),
    row,
  );
  return card;
}

function figTile(se, fid, j) {
  const f = FIG_BY_ID[fid];
  if (!f) return null;
  const swap = (to) => swapFigures(se, j, to);
  return h("div", {
    class: `fig ${f.type}`,
    draggable: "true",
    title: "Voir la carte de la figure",
    onclick: (e) => {
      e.stopPropagation();
      setActive(se.id);
      openCard(fid);
    },
    ondragstart: (e) => {
      e.stopPropagation();
      startDrag(e, { kind: "fig", figId: fid, from: se.id, index: j });
    },
    ondragend: endDrag,
  },
    h("span", { class: "order" }, j + 1),
    figureVisual(f),
    h("div", { class: "fig-tools no-print" },
      btn("←", () => swap(j - 1), { title: "Avant", disabled: j === 0 }),
      btn("→", () => swap(j + 1), { title: "Après", disabled: j === se.figures.length - 1 }),
      btn("×", () => {
        se.figures.splice(j, 1);
        commit();
      }, { title: "Retirer" }),
    ),
  );
}

// Déplace la figure j en position `to` ; les tuiles glissent (FLIP) vers leur nouvelle place.
function swapFigures(se, j, to) {
  const cardSel = `.series[data-id="${se.id}"] .fig`;
  const before = [...document.querySelectorAll(cardSel)].map((t) => t.getBoundingClientRect());
  // ordre d'origine de chaque tuile, une fois la figure déplacée
  const order = before.map((_, k) => k);
  order.splice(to, 0, order.splice(j, 1)[0]);

  se.figures.splice(to, 0, se.figures.splice(j, 1)[0]);
  commit();

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  [...document.querySelectorAll(cardSel)].forEach((tile, k) => {
    const from = before[order[k]];
    const r = tile.getBoundingClientRect();
    const dx = from.left - r.left;
    const dy = from.top - r.top;
    if (dx || dy) {
      tile.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 250, easing: "ease-out" },
      );
    }
  });
}

function setActive(id) {
  if (activeSeriesId === id) return;
  activeSeriesId = id;
  document.querySelectorAll(".series").forEach((c) => c.classList.toggle("active", c.dataset.id === id));
}

// ---------- Palette ----------

function renderPalette() {
  const q = $("#search").value.trim().toLowerCase();
  const match = (f) => !q || f.id.toLowerCase() === q;

  const group = (title, type) => {
    const figs = FIGURES.filter((f) => f.type === type && match(f));
    if (!figs.length) return null;
    return h("section", { class: `palette-group ${type}` },
      h("h3", {}, `${title} (${figs.length})`),
      h("div", { class: "palette-grid" },
        figs.map((f) =>
          h("div", {
            class: `pal-fig ${f.type}`,
            draggable: "true",
            title: `${figureLabel(f)} – cliquer pour ajouter`,
            onclick: () => addToActive(f.id),
            ondragstart: (e) => startDrag(e, { kind: "fig", figId: f.id, from: null }),
            ondragend: endDrag,
          },
            figureVisual(f),
          ),
        ),
      ),
    );
  };

  $("#palette-list").replaceChildren(
    group("Lettres", "random") ?? "",
    group("Blocs", "block") ?? "",
  );
}

function addToActive(fid) {
  const s = current();
  let se = s.series.find((x) => x.id === activeSeriesId);
  if (!se) {
    se = newSeries();
    s.series.push(se);
    activeSeriesId = se.id;
  }
  se.figures.push(fid);
  commit();
  const card = document.querySelector(`.series[data-id="${se.id}"]`);
  card?.querySelector(".fig:last-of-type")?.classList.add("flash");
}

// ---------- Glisser-déposer ----------

function startDrag(e, data) {
  drag = data;
  e.dataTransfer.effectAllowed = data.from === null ? "copy" : "move";
  e.dataTransfer.setData("text/plain", data.figId ?? data.seriesId);
  document.body.classList.add("dragging");
}

function endDrag() {
  drag = null;
  clearIndicators();
  document.body.classList.remove("dragging");
}

function clearIndicators() {
  document.querySelectorAll(".drop-before, .drop-after, .drop-end").forEach((el) =>
    el.classList.remove("drop-before", "drop-after", "drop-end"),
  );
  indicator = null;
}

// Ne touche au DOM que si la cible du dépôt change (dragover se répète en continu).
function setIndicator(el, cls) {
  if (indicator?.el === el && indicator.cls === cls) return;
  clearIndicators();
  el.classList.add(cls);
  indicator = { el, cls };
}

function figInsertIndex(e, row) {
  const tiles = [...row.querySelectorAll(".fig")];
  const idx = tiles.findIndex((t) => {
    const r = t.getBoundingClientRect();
    return e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2);
  });
  return idx === -1 ? tiles.length : idx;
}

function onDragOver(e, card, row) {
  if (!drag) return;
  e.preventDefault();
  if (drag.kind === "fig") {
    e.dataTransfer.dropEffect = drag.from === null ? "copy" : "move";
    const idx = figInsertIndex(e, row);
    const tiles = row.querySelectorAll(".fig");
    if (idx < tiles.length) setIndicator(tiles[idx], "drop-before");
    else setIndicator(row, "drop-end");
  } else {
    const r = card.getBoundingClientRect();
    setIndicator(card, e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
  }
}

function onDrop(e, s, se, card, row) {
  if (!drag) return;
  e.preventDefault();
  e.stopPropagation();
  if (drag.kind === "fig") {
    let idx = figInsertIndex(e, row);
    if (drag.from !== null) {
      const src = s.series.find((x) => x.id === drag.from);
      src.figures.splice(drag.index, 1);
      if (src === se && drag.index < idx) idx--;
    }
    se.figures.splice(idx, 0, drag.figId);
    activeSeriesId = se.id;
  } else if (drag.seriesId !== se.id) {
    const from = s.series.findIndex((x) => x.id === drag.seriesId);
    const [moved] = s.series.splice(from, 1);
    const r = card.getBoundingClientRect();
    const target = s.series.indexOf(se) + (e.clientY < r.top + r.height / 2 ? 0 : 1);
    s.series.splice(target, 0, moved);
  }
  endDrag();
  commit();
}

// ---------- Carte d'une figure ----------

// Titre, vignettes (pour un bloc : départ → inter → arrivée avec les flèches de rotation) et description.
function openCard(fid) {
  const f = FIG_BY_ID[fid];
  if (!f) return;
  const isBlock = f.type === "block";
  const steps = f.frames.map((frame, k) =>
    h("figure", { class: "card-step" },
      frameEl(frame, figureLabel(f)),
      isBlock ? h("figcaption", {}, BLOCK_FRAME_LABELS[k]) : null,
    ),
  );
  $("#card").replaceChildren(
    h("div", { class: "card-panel", role: "dialog", "aria-label": `Carte ${figureLabel(f)}` },
      h("div", { class: "card-head" },
        h("h2", {}, `${isBlock ? "Bloc" : "Lettre"} ${figureLabel(f)}`),
        btn("✕", closeCard, { title: "Fermer (Échap)" }),
      ),
      h("div", { class: "card-frames" },
        steps.flatMap((step, k) => (k ? [h("span", { class: "card-arrow", "aria-hidden": "true" }, "→"), step] : [step])),
      ),
      h("p", { class: "card-desc" }, figureDescription(f)),
    ),
  );
  $("#card").hidden = false;
  document.body.classList.add("card-open");
}

function closeCard() {
  $("#card").hidden = true;
  document.body.classList.remove("card-open");
}

$("#card").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeCard();
});

// ---------- Revoir (pas à pas plein écran) ----------

// Chaque étape = une vignette : 1 pour un random, 3 pour un bloc (départ, inter, arrivée).
// Les parachutistes passent d'une étape à l'autre en glissant / pivotant (js/animate.js).
function openViewer(s, seriesIndex = null) {
  const items = [];
  s.series.forEach((se, si) => {
    if (seriesIndex !== null && si !== seriesIndex) return;
    se.figures.forEach((id, fi) => {
      const f = FIG_BY_ID[id];
      if (f) f.frames.forEach((_, k) => items.push({ si, fi, k }));
    });
  });
  if (!items.length) return;
  viewer = { session: s, items, pos: 0, stage: createStage() };
  $("#viewer").hidden = false;
  document.body.classList.add("viewer-open");
  renderViewer(false);
}

function closeViewer() {
  viewer?.stage.stop();
  viewer = null;
  $("#viewer").hidden = true;
  document.body.classList.remove("viewer-open");
}

function stepViewer(d) {
  const n = viewer.items.length;
  viewer.pos = (viewer.pos + d + n) % n;
  renderViewer(true);
}

const itemFigure = (it) => FIG_BY_ID[viewer.session.series[it.si].figures[it.fi]];

function renderViewer(animate) {
  const { session, items, pos, stage } = viewer;
  const it = items[pos];
  const se = session.series[it.si];
  const f = itemFigure(it);

  // petite frise des vignettes du bloc, l'étape en cours en surbrillance ; pour une lettre elle
  // reste en place, invisible, pour que la liste des figures ne bouge pas d'une figure à l'autre
  const isBlock = f.type === "block";
  const strip = h("div", { class: `viewer-strip${isBlock ? "" : " ghost"}` },
    BLOCK_FRAME_LABELS.map((label, k) => h("span", { class: isBlock && k === it.k ? "on" : "" }, label)),
  );

  // tout l'enchaînement du vol : la figure en cours en blanc, les autres en gris
  const sequence = h("div", { class: "viewer-seq" },
    se.figures.flatMap((id, j) => [
      j ? h("span", { class: "sep" }, "·") : null,
      h("span", { class: j === it.fi ? "on" : "" }, id),
    ]),
  );

  $("#viewer").replaceChildren(
    h("div", { class: "viewer-top" },
      h("span", {}, `Vol ${it.si + 1} · figure ${it.fi + 1}/${se.figures.length}`),
      btn("✕", closeViewer, { title: "Fermer (Échap)", cls: "close" }),
    ),
    h("div", { class: "viewer-main" },
      sequence,
      strip,
      h("div", { class: "frame stage-frame" }, stage.svg),
    ),
    h("div", { class: "viewer-bottom" },
      btn("← Précédente", () => stepViewer(-1)),
      btn("Suivante →", () => stepViewer(1), { cls: "primary" }),
    ),
  );
  stage.show(f.frames[it.k], { animate, label: figureLabel(f) });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#card").hidden) return closeCard();
  if (!viewer) return;
  if (e.key === "Escape") closeViewer();
  else if (e.key === "ArrowRight" || e.key === " ") {
    e.preventDefault();
    stepViewer(1);
  } else if (e.key === "ArrowLeft") stepViewer(-1);
});

let touchX = null;
$("#viewer").addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
$("#viewer").addEventListener("touchend", (e) => {
  if (touchX === null || !viewer) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1);
  touchX = null;
});

// ---------- Barre du haut ----------

$("#btn-share").addEventListener("click", async () => {
  const label = $("#share-label");
  let text = "Copié ✓";
  try {
    await navigator.clipboard.writeText(location.href);
  } catch {
    window.prompt("Copiez ce lien :", location.href);
    text = "Lien affiché";
  }
  label.textContent = text;
  setTimeout(() => (label.textContent = "Copier"), 1500);
});

$("#btn-palette").addEventListener("click", () => document.body.classList.toggle("palette-open"));

// Tirette de la palette (téléphone) : tirer vers le haut ou le bas pour régler sa hauteur
$("#palette-pull").addEventListener("pointerdown", (e) => {
  const startY = e.clientY;
  const startH = $("#palette").getBoundingClientRect().height;
  const move = (ev) => {
    const h = Math.min(innerHeight * 0.7, Math.max(innerHeight * 0.15, startH + startY - ev.clientY));
    document.documentElement.style.setProperty("--palette-h", `${h}px`);
  };
  const stop = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", stop);
    removeEventListener("pointercancel", stop);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", stop);
  addEventListener("pointercancel", stop);
});
$("#search").addEventListener("input", renderPalette);

// ---------- Démarrage ----------

applySharedLink();
ensureSeries();
persist();
renderPalette();
render();

// Application installable (PWA) : le service worker permet l'utilisation hors ligne.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
