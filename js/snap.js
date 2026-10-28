// Fait se toucher les prises : le corps étant identique pour tous, les positions mesurées sur le
// PDF laissent parfois un écart entre une main et la prise visée. On repère, pour chaque main, la
// prise la plus proche d'un autre parachutiste (main, pied, genou ou coude) si elle est assez près,
// puis on déplace les parachutistes (translation seulement : rotations et corps inchangés) jusqu'à
// ce que chaque main touche sa prise.

const mirror = ([x, y]) => [[x, y], [-x, y]];

function gripPoints(pose) {
  return {
    hands: mirror(pose.ha),
    targets: [...mirror(pose.ha), ...mirror(pose.ft), ...mirror(pose.kn), ...mirror(pose.el)],
  };
}

function toFrame(j, [x, y]) {
  const a = (j.r * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [j.x + x * c - y * s, j.y + x * s + y * c];
}

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// seuil (unités de la vignette 480x480) au-delà duquel une main n'est pas considérée comme une prise
// (mesuré sur les 82 vignettes : les prises sont à < 50, les mains libres et les parachutistes
// séparés des inters à > 65)
export const GRIP_THRESHOLD = 55;
// vignettes avec flèches de rotation (inters) : les parachutistes se séparent volontairement,
// seules les prises quasi jointives sont gardées
export const INTER_GRIP_THRESHOLD = 28;
// distance minimale entre deux centres de torse (évite les corps empilés ; permet le sidebody)
export const MIN_BODY_GAP = 44;

export function snapFormation(frame, pose, {
  threshold = frame.arrows?.length ? INTER_GRIP_THRESHOLD : GRIP_THRESHOLD,
  iterations = 80,
} = {}) {
  const jumpers = frame.jumpers.map((j) => ({ ...j }));
  const { hands, targets } = gripPoints(pose);

  const pairs = [];
  jumpers.forEach((a, ia) => {
    for (const h of hands) {
      const ph = toFrame(a, h);
      let best = null;
      jumpers.forEach((b, ib) => {
        if (ib === ia) return;
        for (const t of targets) {
          const d = dist(ph, toFrame(b, t));
          if (d < threshold && (!best || d < best.d)) best = { ib, t, d };
        }
      });
      if (best) pairs.push({ ia, h, ib: best.ib, t: best.t });
    }
  });

  // relaxation : chaque paire rapproche ses deux parachutistes à parts égales
  for (let k = 0; k < iterations; k++) {
    for (const p of pairs) {
      const A = jumpers[p.ia], B = jumpers[p.ib];
      const pa = toFrame(A, p.h), pb = toFrame(B, p.t);
      const dx = (pb[0] - pa[0]) / 2, dy = (pb[1] - pa[1]) / 2;
      A.x += dx; A.y += dy;
      B.x -= dx; B.y -= dy;
    }
    // les torses se repoussent s'ils se chevauchent
    for (let a = 0; a < jumpers.length; a++) {
      for (let b = a + 1; b < jumpers.length; b++) {
        const A = jumpers[a], B = jumpers[b];
        const d = Math.hypot(B.x - A.x, B.y - A.y) || 1e-6;
        if (d < MIN_BODY_GAP) {
          const push = (MIN_BODY_GAP - d) / 2;
          const ux = (B.x - A.x) / d, uy = (B.y - A.y) / d;
          A.x -= ux * push; A.y -= uy * push;
          B.x += ux * push; B.y += uy * push;
        }
      }
    }
  }
  return { ...frame, jumpers };
}
