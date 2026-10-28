"""Mesure les formations dans les vignettes du PDF et génère js/formations.js.

Pour chaque vignette : position et orientation de chaque parachutiste (couleur) et flèches de
rotation. Le corps est identique pour tous (js/designs.js) : aucune pose propre à un parachutiste.

Usage : python tools/extract_formations.py [--debug DOSSIER] [noms de vignettes...]
Nécessite : python -m pip install --user Pillow numpy scipy
Traitements vectorisés (numpy / scipy), vignettes analysées en parallèle (threads).
"""
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cutout import CONN8, FRAMES, SIZE, channels, cutout_rgba, frame_image, per_label, vivid  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
COLORS = ("blue", "green", "yellow", "red")


def suit_codes(r, g, b):
    """Couleur de combinaison par pixel : 0 = aucune, 1..4 = COLORS.
    Dominance de canal (les pages 2-4, plus petites, ont des couleurs plus sombres)."""
    return np.select([
        (b > 80) & (b > 1.8 * np.maximum(r, g) + 20),
        (g > 90) & (g > 1.4 * np.maximum(r, b) + 20),
        (r > 140) & (g > 130) & (b < 0.6 * np.minimum(r, g)),
        (r > 80) & (r > 1.8 * np.maximum(g, b) + 20),
    ], [1, 2, 3, 4], 0)


def is_grey(r, g, b):
    mean = (r + g + b) / 3
    return (np.abs(r - g) < 20) & (np.abs(g - b) < 20) & (np.abs(r - b) < 24) & (mean >= 140) & (mean <= 240)


def stats(xs, ys):
    xs, ys = xs.astype(np.float64), ys.astype(np.float64)
    cx, cy = float(xs.mean()), float(ys.mean())
    sxx = float(((xs - cx) ** 2).mean())
    syy = float(((ys - cy) ** 2).mean())
    sxy = float(((xs - cx) * (ys - cy)).mean())
    tr, det = sxx + syy, sxx * syy - sxy * sxy
    l1 = tr / 2 + math.sqrt(max(tr * tr / 4 - det, 0))
    l2 = tr - l1
    ax = (l1 - syy, sxy) if abs(sxy) > 1e-9 else ((1, 0) if sxx >= syy else (0, 1))
    norm = math.hypot(*ax)
    return (cx, cy), (ax[0] / norm, ax[1] / norm), math.sqrt(12 * l1), math.sqrt(12 * max(l2, 0))


def to_local(p, c, theta):
    vx, vy = p[0] - c[0], p[1] - c[1]
    ct, st = math.cos(theta), math.sin(theta)
    return vx * ct + vy * st, -vx * st + vy * ct


def to_frame(q, c, theta):
    ct, st = math.cos(theta), math.sin(theta)
    return c[0] + q[0] * ct - q[1] * st, c[1] + q[0] * st + q[1] * ct


# disque de rayon 7 (test de présence du casque)
_DY, _DX = np.mgrid[-7:8, -7:8]
_DISK = _DX ** 2 + _DY ** 2 <= 49
DISK_DX, DISK_DY = _DX[_DISK], _DY[_DISK]


def count_disk(mask, x, y):
    xs, ys = x + DISK_DX, y + DISK_DY
    ok = (xs >= 0) & (xs < mask.shape[1]) & (ys >= 0) & (ys < mask.shape[0])
    return int(mask[ys[ok], xs[ok]].sum())


def analyse(im):
    r, g, b = channels(im)
    alpha = np.asarray(cutout_rgba(im).getchannel("A"))
    fg = alpha > 128
    code = np.where(fg, suit_codes(r, g, b), 0)

    # chaque pixel gris (corps / container) est attribué à la couleur de combinaison la plus
    # proche (distance de Tchebychev <= 12 px) ; à égalité entre deux couleurs : ambigu
    dist = np.full((len(COLORS),) + code.shape, 10 ** 6, dtype=np.int64)
    for k in range(len(COLORS)):
        if (code == k + 1).any():
            dist[k] = ndimage.distance_transform_cdt(code != k + 1, metric="chessboard")
    dmin = dist.min(0)
    unique = (dist == dmin).sum(0) == 1
    owner = np.where(fg & is_grey(r, g, b) & (dmin <= 12) & unique, dist.argmin(0), -1)

    jumpers = []
    for k, col in enumerate(COLORS):
        ys, xs = np.nonzero(owner == k)
        if len(xs) < 60:
            continue
        c, axis, L, W = stats(xs, ys)
        colored = code == k + 1
        best = None
        reach = min(max(L, 36), 52) / 2 + 9
        for s in (1, -1):
            hx, hy = c[0] + s * axis[0] * reach, c[1] + s * axis[1] * reach
            n = count_disk(colored, round(hx), round(hy))
            if best is None or n > best[0]:
                best = (n, s)
        hvec = (best[1] * axis[0], best[1] * axis[1])
        theta = math.atan2(hvec[0], -hvec[1])
        jumpers.append(dict(color=col, c=c, theta=theta, L=L, W=W, fit=fit_jumper(colored, c, theta)))
    return jumpers, (r, g, b), alpha


# ---- Recalage sur l'image de référence ----
# Corps commun (modèle 1 "Classique" de js/designs.js, pose POSE.box) : partie colorée seulement.
FIT_POSE = dict(sh=(14, -20), el=(40, -24), ha=(44, -50), hip=(8, 26), kn=(30, 50), ft=(38, 76))


def _seg_dist(px, py, a, b):
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


def body_template(step=2):
    """Points (x, y) en repère local de la partie colorée du corps commun, et leur poids."""
    ys, xs = np.mgrid[-60:95:step, -64:65:step].astype(np.float64)
    p = FIT_POSE
    limb = np.zeros(xs.shape, bool)
    for s in (1, -1):  # côté droit puis miroir
        m = lambda q: (s * q[0], q[1])  # noqa: E731
        limb |= _seg_dist(xs, ys, m(p["hip"]), m(p["kn"])) <= 6.5
        limb |= _seg_dist(xs, ys, m(p["kn"]), m(p["ft"])) <= 6.5
        limb |= _seg_dist(xs, ys, m(p["sh"]), m(p["el"])) <= 5.5
        limb |= _seg_dist(xs, ys, m(p["el"]), m(p["ha"])) <= 5.5
    torso = (np.abs(xs) <= 17) & (np.abs(ys) <= 29)
    head = np.hypot(xs, ys + 40) <= 12
    black = np.zeros(xs.shape, bool)
    for s in (1, -1):
        black |= np.hypot(xs - s * p["ha"][0], ys - p["ha"][1]) <= 6.5
        black |= np.hypot(xs - s * p["ft"][0], ys - p["ft"][1]) <= 8
    container = (np.abs(xs) <= 12) & (ys >= -22) & (ys <= 20)
    colored = (limb | torso | head) & ~black & ~container
    weight = np.where(torso | head, 2.0, 1.0)  # le torse et la tête comptent double
    return np.stack([xs[colored], ys[colored]], axis=1), weight[colored]


TEMPLATE, TEMPLATE_W = body_template()
FIT_RADIUS = 40     # recherche de position : ±40 px autour de la mesure initiale
ROT_SWITCH = 0.8    # on ne change de cap que si l'ajustement est nettement meilleur (-20 %)


def _fit_score(dt, ang, offsets):
    """Distance moyenne (pondérée) entre le corps posé et la combinaison de référence."""
    c, s = math.cos(ang), math.sin(ang)
    px = TEMPLATE[:, 0] * c - TEMPLATE[:, 1] * s
    py = TEMPLATE[:, 0] * s + TEMPLATE[:, 1] * c
    X = np.rint(offsets[:, :1] + px[None]).astype(np.int64)
    Y = np.rint(offsets[:, 1:] + py[None]).astype(np.int64)
    h, w = dt.shape
    inside = (X >= 0) & (X < w) & (Y >= 0) & (Y < h)
    d = np.where(inside, dt[np.clip(Y, 0, h - 1), np.clip(X, 0, w - 1)], 60.0)
    return (d * TEMPLATE_W).sum(1) / TEMPLATE_W.sum()


def fit_jumper(colored, c, theta):
    """Meilleure position (et cap, par pas de 45°) du corps commun sur la combinaison de référence."""
    dt = ndimage.distance_transform_edt(~colored)
    start = snap_angle(math.degrees(theta))

    def search(rdeg, center, radius, step):
        g = np.arange(-radius, radius + 1, step, dtype=np.float64)
        gx, gy = np.meshgrid(g + center[0], g + center[1])
        offs = np.stack([gx.ravel(), gy.ravel()], axis=1)
        sc = _fit_score(dt, math.radians(rdeg), offs)
        i = int(sc.argmin())
        return float(sc[i]), (float(offs[i, 0]), float(offs[i, 1]))

    # recherche grossière (pas de 4 px) pour les 8 caps, puis fine (1 px) pour les 2 meilleurs
    coarse = {rdeg: search(rdeg, c, FIT_RADIUS, 4) for rdeg in range(-135, 181, 45)}
    finalists = sorted(coarse, key=lambda k: coarse[k][0])[:2]
    if start not in finalists:
        finalists.append(start)
    results = {rdeg: search(rdeg, coarse[rdeg][1], 4, 1) for rdeg in finalists}
    best_r = min(results, key=lambda k: results[k][0])
    if results[best_r][0] > ROT_SWITCH * results[start][0]:
        best_r = start
    score, (x, y) = results[best_r]
    return dict(x=x, y=y, r=best_r, score=score, r_measured=start)


# ---- Prises jointives (même algorithme que js/snap.js) ----
GRIP_THRESHOLD = 55        # prises : mains à < 55 px d'une prise (mains libres : > 65 px)
INTER_GRIP_THRESHOLD = 28  # inters (flèches de rotation) : séparations volontaires
MIN_BODY_GAP = 44          # distance minimale entre deux centres de torse
MAX_SNAP_MOVE = 12         # déplacement max par rapport à la position recalée sur le PDF


def _mirror(p):
    return [(p[0], p[1]), (-p[0], p[1])]


def _to_frame(j, q):
    a = math.radians(j["r"])
    c, s = math.cos(a), math.sin(a)
    return j["x"] + q[0] * c - q[1] * s, j["y"] + q[0] * s + q[1] * c


def snap_grips(jumpers, inter, iterations=80):
    """Déplace les parachutistes (translation seule) pour que chaque main touche sa prise."""
    p = FIT_POSE
    hands = _mirror(p["ha"])
    targets = _mirror(p["ha"]) + _mirror(p["ft"]) + _mirror(p["kn"]) + _mirror(p["el"])
    threshold = INTER_GRIP_THRESHOLD if inter else GRIP_THRESHOLD
    js = [dict(j) for j in jumpers]
    pairs = []
    for ia, a in enumerate(js):
        for h in hands:
            ph = _to_frame(a, h)
            best = None
            for ib, b in enumerate(js):
                if ib == ia:
                    continue
                for t in targets:
                    d = math.dist(ph, _to_frame(b, t))
                    if d < threshold and (best is None or d < best[0]):
                        best = (d, ib, t)
            if best:
                pairs.append((ia, h, best[1], best[2]))
    for _ in range(iterations):
        for ia, h, ib, t in pairs:
            A, B = js[ia], js[ib]
            pa, pb = _to_frame(A, h), _to_frame(B, t)
            dx, dy = (pb[0] - pa[0]) / 2, (pb[1] - pa[1]) / 2
            A["x"] += dx; A["y"] += dy
            B["x"] -= dx; B["y"] -= dy
        for a in range(len(js)):
            for b in range(a + 1, len(js)):
                A, B = js[a], js[b]
                d = math.hypot(B["x"] - A["x"], B["y"] - A["y"]) or 1e-6
                if d < MIN_BODY_GAP:
                    push = (MIN_BODY_GAP - d) / 2
                    ux, uy = (B["x"] - A["x"]) / d, (B["y"] - A["y"]) / d
                    A["x"] -= ux * push; A["y"] -= uy * push
                    B["x"] += ux * push; B["y"] += uy * push
        # reste proche de la position recalée sur l'image de référence
        for j, j0 in zip(js, jumpers):
            dx, dy = j["x"] - j0["x"], j["y"] - j0["y"]
            d = math.hypot(dx, dy)
            if d > MAX_SNAP_MOVE:
                j["x"], j["y"] = j0["x"] + dx * MAX_SNAP_MOVE / d, j0["y"] + dy * MAX_SNAP_MOVE / d
    return js


# ---- Géométrie du parachutiste (repère local, tête vers le haut ; identique à js/skydiver.js) ----
BODY = dict(torso_w=34, torso_h=58, head_y=-40, head_r=12, arm_w=11, leg_w=13)
ATTACH = {"la": (-14, -22), "ra": (14, -22), "ll": (-8, 26), "rl": (8, 26)}
SEG = {"la": (28, 26), "ra": (28, 26), "ll": (31, 30), "rl": (31, 30)}
DEFAULT = {"la": (-34, -46), "ra": (34, -46), "ll": (-27, 68), "rl": (27, 68)}


def ik(a, t, l1, l2, outward):
    """Position du coude / genou. Les membres s'étirent (max 1.35x) si la cible est trop loin."""
    dx, dy = t[0] - a[0], t[1] - a[1]
    d = math.hypot(dx, dy) or 1e-6
    k = min(max(d / (l1 + l2), 1), 1.35)
    l1, l2 = l1 * k, l2 * k
    d = min(max(d, abs(l1 - l2) + 1), l1 + l2 - 1e-3)
    phi = math.atan2(dy, dx)
    alpha = math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))
    cands = [(a[0] + l1 * math.cos(phi + s * alpha), a[1] + l1 * math.sin(phi + s * alpha)) for s in (1, -1)]
    return max(cands, key=lambda e: e[0] * outward), k


SUIT = {"blue": (25, 45, 225), "green": (30, 190, 40), "yellow": (240, 220, 20), "red": (220, 30, 30)}


def render_preview(frame, size=SIZE):
    """Rendu Pillow des données (même géométrie que le rendu SVG) pour vérification."""
    s = 2  # suréchantillonnage
    im = Image.new("RGB", (size * s, size * s), (232, 238, 246))
    d = ImageDraw.Draw(im)

    def P(j, q):
        x, y = to_frame(q, (j["x"], j["y"]), math.radians(j["r"]))
        return x * s, y * s

    def seg(points, width, fill):
        d.line(points, fill=fill, width=round(width * s))
        for p in points:
            r = width * s / 2
            d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=fill)

    for j in frame["jumpers"]:
        col = SUIT[j["c"]]
        chains = []
        for k in ("ll", "rl", "la", "ra"):
            a = ATTACH[k]
            t = DEFAULT[k]  # pose fixe et symétrique, identique pour tous
            e, _ = ik(a, t, *SEG[k], -1 if k[1] == "l" else 1)
            chains.append((k, [P(j, a), P(j, e), P(j, t)]))
        width = lambda k: BODY["leg_w"] if k[0] == "l" else BODY["arm_w"]  # noqa: E731
        for k, pts in chains:  # contours
            seg(pts, width(k) + 5, (0, 0, 0))
        for k, pts in chains:
            seg(pts, width(k), col)
            r = 6.5 * s
            p = pts[-1]
            d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=(0, 0, 0))
        tw, th = BODY["torso_w"], BODY["torso_h"]
        corners = [P(j, q) for q in ((-tw / 2, -th / 2), (tw / 2, -th / 2), (tw / 2, th / 2), (-tw / 2, th / 2))]
        d.polygon(corners, fill=col, outline=(0, 0, 0), width=3 * s)
        inner = [P(j, q) for q in ((-13, -23), (13, -23), (13, 23), (-13, 23))]
        d.polygon(inner, fill=(200, 200, 200), outline=(0, 0, 0), width=2 * s)
        hc = P(j, (0, BODY["head_y"]))
        r = BODY["head_r"] * s
        d.ellipse([hc[0] - r, hc[1] - r, hc[0] + r, hc[1] + r], fill=col, outline=(0, 0, 0), width=3 * s)
    navy = (30, 42, 92)
    try:
        font = ImageFont.truetype("arial.ttf", 17 * s)
    except OSError:
        font = ImageFont.load_default()
    for a in frame.get("arrows", []):
        x1, y1, cx, cy, x2, y2 = (v * s for v in a["d"])
        curve = [((1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * x2,
                  (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * y2) for t in (i / 30 for i in range(31))]
        d.line(curve, fill=navy, width=4 * s)
        ang = math.atan2(y2 - cy, x2 - cx)
        tip = (x2 + math.cos(ang) * 10 * s, y2 + math.sin(ang) * 10 * s)
        wing = lambda da: (x2 + math.cos(ang + da) * 6 * s, y2 + math.sin(ang + da) * 6 * s)  # noqa: E731
        d.polygon([tip, wing(math.pi / 2), wing(-math.pi / 2)], fill=navy)
        d.text((a["l"][0] * s, a["l"][1] * s), a["t"], fill=navy, font=font, anchor="mm")
    return im.resize((size, size), Image.LANCZOS)


# ---- Flèches de rotation ----

# valeur des rotations (lues sur le PDF) : identique pour toutes les flèches d'une vignette,
# ou (clé de tri des flèches, valeurs dans cet ordre) quand elles diffèrent
ROTATIONS = {
    "1-2": 360, "2-2": 360, "4-2": 360, "6-2": 360, "7-2": 360, "8-2": 360, "11-2": 360,
    "13-2": 360, "14-2": 540, "15-2": 360, "16-2": 270, "18-2": 360, "20-2": 360, "21-2": 360,
    "3-2": ("y", [180, 540]), "10-2": ("y", [180, 360]), "12-2": ("y", [540, 360]),
    "19-2": ("y", [270, 360]), "22-2": ("x", [360, 270, 270]),
}


# flèches collées à leur texte, mal détectées : saisies à la main (remplacent la détection proche)
MANUAL_ARROWS = {
    "3-2": [{"d": [32, 212, 45, 258, 108, 248], "t": "540°", "l": [52, 277]}],
    "13-2": [{"d": [218, 322, 212, 382, 172, 383], "t": "360°", "l": [234, 378]}],
}


def arrows(name, rgb, alpha):
    if name not in ROTATIONS:
        return []
    out = detect_arrows(name, rgb, alpha)
    for man in MANUAL_ARROWS.get(name, []):
        mid = lambda a: ((a["d"][0] + a["d"][4]) / 2, (a["d"][1] + a["d"][5]) / 2)  # noqa: E731
        out = [a for a in out if math.dist(mid(a), mid(man)) > 70]
        out.append(man)
    return out


def detect_arrows(name, rgb, alpha):
    labels, n = ndimage.label(alpha > 60, structure=CONN8)
    size = per_label(labels, n, np.ones(labels.shape))
    viv = per_label(labels, n, vivid(*rgb))
    arcs, glyphs = [], []
    for k, sl in enumerate(ndimage.find_objects(labels), 1):
        if viv[k] >= 0.03 * size[k]:
            continue  # parachutiste
        ys, xs = np.nonzero(labels[sl] == k)
        xs, ys = xs + sl[1].start, ys + sl[0].start
        box = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
        bw, bh = box[2] - box[0], box[3] - box[1]
        if bh > 31 or bw > 80:  # le texte ("360°") ne dépasse pas ~30 px de haut
            arcs.append(np.stack([xs, ys], axis=1).astype(np.float64))
        elif size[k] > 60:
            glyphs.append(box)

    # regroupe les chiffres en étiquettes
    labels = []
    for b in sorted(glyphs):
        for lab in labels:
            if b[0] - lab[2] < 10 and b[1] < lab[3] and b[3] > lab[1]:
                lab[:] = [min(lab[0], b[0]), min(lab[1], b[1]), max(lab[2], b[2]), max(lab[3], b[3])]
                break
        else:
            labels.append(list(b))

    out = []
    for pts in arcs:
        sq = lambda q: ((pts - q) ** 2).sum(axis=1)  # noqa: E731
        p1 = tuple(pts[sq(pts[0]).argmax()])
        p2 = tuple(pts[sq(p1).argmax()])
        mass = lambda q: int((sq(q) < 144).sum())  # noqa: E731
        tail, head = (p1, p2) if mass(p2) >= mass(p1) else (p2, p1)
        cx, cy, L = (tail[0] + head[0]) / 2, (tail[1] + head[1]) / 2, math.dist(tail, head)
        nx, ny = -(head[1] - tail[1]) / L, (head[0] - tail[0]) / L
        offs = (pts[:, 0] - cx) * nx + (pts[:, 1] - cy) * ny
        off = float(offs[np.abs(offs).argmax()])
        m = (cx + nx * off, cy + ny * off)
        ctrl = (2 * m[0] - cx, 2 * m[1] - cy)
        # recule un peu la pointe : la tête de flèche SVG est dessinée au bout du trait
        ux, uy = head[0] - ctrl[0], head[1] - ctrl[1]
        ul = math.hypot(ux, uy) or 1
        head = (head[0] - ux / ul * 6, head[1] - uy / ul * 6)
        out.append({"d": [round(float(v)) for v in (*tail, *ctrl, *head)], "_m": m,
                    "_n": (nx * math.copysign(1, off), ny * math.copysign(1, off))})

    spec = ROTATIONS[name]
    if isinstance(spec, int):
        values = [spec] * len(out)
    else:
        key, vals = spec
        idx = 0 if key == "x" else 1
        out.sort(key=lambda a: (a["d"][idx] + a["d"][idx + 4]) / 2)
        values = vals + [vals[-1]] * (len(out) - len(vals))

    free = labels[:]
    for a, v in zip(out, values):
        a["t"] = f"{v}°"
        m = a.pop("_m")
        n = a.pop("_n")
        near = min(free, key=lambda b: math.dist(m, ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)), default=None)
        if near and math.dist(m, ((near[0] + near[2]) / 2, (near[1] + near[3]) / 2)) < 75:
            free.remove(near)
            a["l"] = [round((near[0] + near[2]) / 2), round((near[1] + near[3]) / 2)]
        else:  # étiquette collée à la flèche : placée à l'extérieur de la courbe
            a["l"] = [round(m[0] + n[0] * 24), round(m[1] + n[1] * 24)]
    return out


ANGLE_STEP = 45  # les caps sont arrondis au multiple de 45° le plus proche


def snap_angle(deg):
    """Arrondi au multiple de ANGLE_STEP le plus proche, ramené dans ]-180, 180]."""
    a = round(deg / ANGLE_STEP) * ANGLE_STEP % 360
    return a - 360 if a > 180 else a


def to_data(jumpers, arrow_list=()):
    # corps identique pour tous : seuls couleur, position et rotation sont propres à chaque parachutiste
    # position et cap recalés sur l'image de référence (fit_jumper), puis prises rendues jointives
    placed = snap_grips([{"x": j["fit"]["x"], "y": j["fit"]["y"], "r": j["fit"]["r"]} for j in jumpers],
                        inter=bool(arrow_list))
    data = {"jumpers": [
        {"c": j["color"], "x": round(p["x"]), "y": round(p["y"]), "r": p["r"]}
        for j, p in zip(jumpers, placed)
    ]}
    if arrow_list:
        data["arrows"] = list(arrow_list)
    return data


def debug_draw(im, jumpers):
    d = ImageDraw.Draw(im)
    for j in jumpers:
        c, th, L = j["c"], j["theta"], j["L"]
        head = to_frame((0, -40), c, th)
        d.line([c, head], fill="magenta", width=5)
        d.ellipse([head[0] - 7, head[1] - 7, head[0] + 7, head[1] + 7], fill="magenta")
        d.ellipse([c[0] - 4, c[1] - 4, c[0] + 4, c[1] + 4], fill="black")
        for k in ("la", "ra", "ll", "rl"):
            if k in j:
                p = to_frame(j[k], c, th)
                d.ellipse([p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5], outline="magenta", width=2)
    return im


def process(name, debug=None):
    """Analyse une vignette (exécuté dans un processus de travail)."""
    im = frame_image(name)
    jumpers, rgb, alpha = analyse(im)
    data = to_data(jumpers, arrows(name, rgb, alpha))
    if debug:
        pair = Image.new("RGB", (SIZE * 2, SIZE), "white")
        pair.paste(debug_draw(im.copy(), jumpers), (0, 0))
        pair.paste(render_preview(data), (SIZE, 0))
        pair.save(Path(debug) / f"{name}.png")
    return name, data


def main():
    args = sys.argv[1:]
    debug = None
    if args[:1] == ["--debug"]:
        debug, args = Path(args[1]), args[2:]
        debug.mkdir(parents=True, exist_ok=True)
    names = [n for n in FRAMES if not args or n in args]
    result = {}
    # threads plutôt que processus : numpy / scipy / Pillow libèrent le GIL, et lancer des
    # processus sous Windows (réimport de numpy/scipy) coûte plus cher que le calcul lui-même
    with ThreadPoolExecutor(max_workers=os.cpu_count()) as pool:
        for name, data in pool.map(partial(process, debug=debug), names):
            result[name] = data
            print(name, end=" ", flush=True)
    print()
    if not args:  # extraction complète : (ré)écrit le fichier de données
        write_js(result)


def write_js(result):
    figs = {}
    for name, data in result.items():
        fid, _, n = name.partition("-")
        figs.setdefault(fid, []).append(data)
    lines = [
        "// Formations VR4 : généré par tools/extract_formations.py, puis modifiable à la main.",
        "// Repère : vignette 480x480. Tous les parachutistes ont exactement le même corps (js/designs.js) ;",
        "// chacun n'a que : couleur c, centre du torse x/y, cap r (degrés, 0 = tête vers le haut, sens horaire).",
        "// Flèches : courbe d = [départ, contrôle, pointe], texte t à la position l.",
        "export const FORMATIONS = {",
    ]
    for fid, frames_ in figs.items():
        lines.append(f"  {json.dumps(fid)}: [")
        for data in frames_:
            lines.append("    {")
            lines.append("      jumpers: [")
            for j in data["jumpers"]:
                lines.append(f"        {json.dumps(j, separators=(', ', ': '))},")
            lines.append("      ],")
            if "arrows" in data:
                lines.append("      arrows: [")
                for a in data["arrows"]:
                    lines.append(f"        {json.dumps(a, separators=(', ', ': '), ensure_ascii=False)},")
                lines.append("      ],")
            lines.append("    },")
        lines.append("  ],")
    lines.append("};")
    (ROOT / "js" / "formations.js").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("->", ROOT / "js" / "formations.js")


if __name__ == "__main__":
    main()
