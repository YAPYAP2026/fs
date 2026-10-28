import { FIGURES, FIG_BY_ID, BLOCK_FRAME_LABELS, figureLabel, figureVisual } from "./figures.js";
import { load, save, uid } from "./storage.js";
import { createStage } from "./animate.js";

let store = load();
let activeSeriesId = null;
let drag = null; // { kind: "fig", figId, from: seriesId | null, index } | { kind: "series", seriesId }
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

const newSeries = () => ({ id: uid(), note: "", figures: [] });
const current = () => store;
const points = (figs) => figs.reduce((n, id) => n + (FIG_BY_ID[id]?.points ?? 0), 0);

function ensureSeries() {
  if (!store.series.length) store.series.push(newSeries());
}

function commit() {
  save(store);
  render();
}

// ---------- Rendu ----------

function render() {
  ensureSeries();
  renderSession();
  renderPaletteTarget();
}

function renderSession() {
  const s = current();
  if (!s.series.some((se) => se.id === activeSeriesId)) activeSeriesId = s.series[0]?.id ?? null;
  const nFigs = s.series.reduce((n, se) => n + se.figures.length, 0);
  $("#stats").textContent = `${s.series.length} saut${s.series.length > 1 ? "s" : ""} · ${nFigs} figure${nFigs > 1 ? "s" : ""}`;

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
    }, "+ Ajouter un saut"),
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
    se.figures.length ? null : h("p", { class: "empty no-print" }, "Cliquez ou glissez des figures depuis la liste pour composer ce saut."),
  );

  const card = h("section", {
    class: `series${se.id === activeSeriesId ? " active" : ""}`,
    dataset: { id: se.id },
    onclick: () => setActive(se.id),
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
        title: "Glisser pour réordonner les sauts",
        onmousedown: () => (card.draggable = true),
        onmouseup: () => (card.draggable = false),
      }, "⠿"),
      h("h2", {}, `Saut ${i + 1}`),
      h("span", { class: "meta" }, `${se.figures.length} figure${se.figures.length > 1 ? "s" : ""} · ${points(se.figures)} pts`),
      h("div", { class: "actions no-print" },
        btn("▶ Revoir", () => openViewer(s, i), { disabled: !se.figures.length, cls: "primary" }),
        btn("↑", () => move(i - 1), { title: "Monter", disabled: i === 0 }),
        btn("↓", () => move(i + 1), { title: "Descendre", disabled: i === last }),
        btn("⧉", () => {
          const copy = { ...structuredClone(se), id: uid() };
          s.series.splice(i + 1, 0, copy);
          activeSeriesId = copy.id;
          commit();
        }, { title: "Dupliquer le saut" }),
        btn("🗑", () => {
          if (se.figures.length && !confirm(`Supprimer le saut ${i + 1} ?`)) return;
          s.series.splice(i, 1);
          if (!s.series.length) s.series.push(newSeries());
          commit();
        }, { title: "Supprimer le saut" }),
      ),
    ),
    row,
    h("textarea", {
      class: "note",
      rows: 1,
      placeholder: "Notes (objectifs, points de travail…)",
      value: se.note,
      oninput: (e) => {
        se.note = e.target.value;
        save(store);
      },
    }),
  );
  if (!se.note) card.querySelector(".note").classList.add("no-print");
  return card;
}

function figTile(se, fid, j) {
  const f = FIG_BY_ID[fid];
  if (!f) return null;
  const swap = (to) => {
    se.figures.splice(to, 0, se.figures.splice(j, 1)[0]);
    commit();
  };
  return h("div", {
    class: `fig ${f.type}`,
    draggable: "true",
    ondragstart: (e) => {
      e.stopPropagation();
      startDrag(e, { kind: "fig", figId: fid, from: se.id, index: j });
    },
    ondragend: endDrag,
  },
    h("span", { class: "order" }, j + 1),
    figureVisual(f),
    h("div", { class: "fig-label" }, figureLabel(f)),
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

function setActive(id) {
  if (activeSeriesId === id) return;
  activeSeriesId = id;
  document.querySelectorAll(".series").forEach((c) => c.classList.toggle("active", c.dataset.id === id));
  renderPaletteTarget();
}

// ---------- Palette ----------

function renderPaletteTarget() {
  const s = current();
  const i = s.series.findIndex((se) => se.id === activeSeriesId);
  $("#palette-target").textContent = i >= 0 ? `Cliquer ajoute au Saut ${i + 1}` : "";
}

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
            h("div", { class: "fig-label" }, f.id, f.levels.includes("N2") ? null : h("span", { class: "badge" }, "N1")),
          ),
        ),
      ),
    );
  };

  $("#palette-list").replaceChildren(
    group("Randoms", "random") ?? "",
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
  clearIndicators();
  if (drag.kind === "fig") {
    e.dataTransfer.dropEffect = drag.from === null ? "copy" : "move";
    const idx = figInsertIndex(e, row);
    const tiles = row.querySelectorAll(".fig");
    if (idx < tiles.length) tiles[idx].classList.add("drop-before");
    else row.classList.add("drop-end");
  } else {
    const r = card.getBoundingClientRect();
    card.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
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
const itemLabel = (it) => {
  const f = itemFigure(it);
  return f.type === "block" ? `${figureLabel(f)} · ${BLOCK_FRAME_LABELS[it.k]}` : figureLabel(f);
};

function renderViewer(animate) {
  const { session, items, pos, stage } = viewer;
  const it = items[pos];
  const se = session.series[it.si];
  const f = itemFigure(it);
  const next = items[(pos + 1) % items.length];

  // petite frise des vignettes du bloc, l'étape en cours en surbrillance
  const strip = f.type === "block"
    ? h("div", { class: "viewer-strip" }, f.frames.map((_, k) => h("span", { class: k === it.k ? "on" : "" }, BLOCK_FRAME_LABELS[k])))
    : null;

  $("#viewer").replaceChildren(
    h("div", { class: "viewer-top" },
      h("span", {}, `Saut ${it.si + 1} · figure ${it.fi + 1}/${se.figures.length}`),
      btn("✕", closeViewer, { title: "Fermer (Échap)", cls: "close" }),
    ),
    h("div", { class: "viewer-main" },
      h("h2", {}, figureLabel(f)),
      strip,
      h("div", { class: "frame stage-frame" }, stage.svg),
    ),
    h("div", { class: "viewer-bottom" },
      btn("← Précédente", () => stepViewer(-1)),
      h("span", { class: "viewer-next" },
        next.si !== it.si ? `Ensuite : Saut ${next.si + 1} – ` : pos === items.length - 1 ? "↻ " : "Ensuite : ",
        itemLabel(next),
      ),
      btn("Suivante →", () => stepViewer(1), { cls: "primary" }),
    ),
  );
  stage.show(f.frames[it.k], { animate });
}

document.addEventListener("keydown", (e) => {
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

$("#btn-print").addEventListener("click", () => window.print());

$("#btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ format: "vr4-training", version: 2, series: store.series }, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: "entrainement.vr4.json" });
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#btn-import").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    // accepte aussi les fichiers exportés par l'ancienne version (liste d'entraînements)
    const series = Array.isArray(data.series) ? data.series : data.sessions?.[0]?.series;
    if (!Array.isArray(series)) throw new Error("aucun saut trouvé");
    const hasContent = store.series.some((se) => se.figures.length);
    if (hasContent && !confirm("Remplacer l'entraînement actuel par celui du fichier ?")) return;
    store.series = series.map((se) => ({
      id: uid(),
      note: String(se.note ?? ""),
      figures: (se.figures ?? []).map(String).filter((id) => FIG_BY_ID[id]),
    }));
    activeSeriesId = null;
    commit();
  } catch (err) {
    alert(`Import impossible : ${err.message}`);
  }
});

$("#btn-palette").addEventListener("click", () => document.body.classList.toggle("palette-open"));
$("#search").addEventListener("input", renderPalette);

// ---------- Démarrage ----------

ensureSeries();
save(store);
renderPalette();
render();
