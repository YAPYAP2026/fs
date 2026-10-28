"""Découpe chaque vignette des pages extraites et supprime le fond (garde les parachutistes).

Usage : python tools/cutout.py
Nécessite : python -m pip install --user Pillow numpy scipy
Entrée : assets/pages/page-N.jpg (voir extract_pages.py)
Sortie : assets/figures/<id>.png pour les randoms, <id>-1.png / -2.png / -3.png pour les blocs.

Les traitements sont vectorisés (numpy / scipy) et les vignettes traitées en parallèle (threads).
"""
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "assets" / "pages"
OUT = ROOT / "assets" / "figures"
SIZE = 480  # taille de sortie (px) de chaque vignette

# Grilles en % de page.
P1 = dict(cols=[4.81, 28.57, 52.33, 76.17], rows=[3.4, 20.25, 37.1, 53.9], w=18.95, h=13.4)
PB = dict(cols=[4.84, 28.66, 52.48, 76.18], groups=[[3.42, 16.94, 30.45], [47.22, 60.74, 74.25]], w=18.86, h=13.26)

CONN4 = ndimage.generate_binary_structure(2, 1)
CONN8 = ndimage.generate_binary_structure(2, 2)


def frames():
    """(nom de fichier, page, x, y, w, h) pour chaque vignette."""
    for i, rid in enumerate("ABCDEFGHJKLMNOPQ"):
        yield rid, 1, P1["cols"][i % 4], P1["rows"][i // 4], P1["w"], P1["h"]
    for k in range(22):
        j = k % 8
        for n, y in enumerate(PB["groups"][j // 4], 1):
            yield f"{k + 1}-{n}", 2 + k // 8, PB["cols"][j % 4], y, PB["w"], PB["h"]


FRAMES = {f[0]: f[1:] for f in frames()}


_page_lock = threading.Lock()


@lru_cache(maxsize=None)
def _load_page(page):
    return Image.open(PAGES / f"page-{page}.jpg").convert("RGB")


def page_image(page):
    with _page_lock:  # une seule lecture par page, même avec plusieurs threads
        return _load_page(page)


def frame_image(name):
    """Vignette `name` recadrée et mise à SIZExSIZE (RGB)."""
    page, x, y, fw, fh = FRAMES[name]
    src = page_image(page)
    W, H = src.size
    box = (round(x / 100 * W), round(y / 100 * H), round((x + fw) / 100 * W), round((y + fh) / 100 * H))
    return src.crop(box).resize((SIZE, SIZE), Image.LANCZOS)


def frame_images():
    """(nom, image RGB SIZExSIZE) pour chaque vignette."""
    for name in FRAMES:
        yield name, frame_image(name)


def channels(im):
    a = np.asarray(im, dtype=np.int32)
    return a[..., 0], a[..., 1], a[..., 2]


def is_navy(r, g, b):
    # flèches de rotation et texte "360°" (bleu marine, y compris leurs bords anti-aliasés)
    return (b - r >= 8) & (b >= g - 4) & (r + g + b <= 560)


def is_ink(r, g, b):
    # combinaisons colorées (bleu, vert, jaune, rouge), contours noirs, flèches/texte bleu marine
    spread = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    return (spread >= 70) | (r + g + b <= 450) | is_navy(r, g, b)


def is_bg(r, g, b):
    # fond de vignette teinté (bleuté ou rosé) ou filigrane blanc ; les corps sont gris neutre
    return (np.abs(b - r) >= 10) | (r + g + b >= 3 * 232)


def vivid(r, g, b):
    return np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b) >= 150


def per_label(labels, n, values):
    """Somme de `values` (bool / nombre) par étiquette 0..n."""
    return np.bincount(labels.ravel(), weights=values.ravel().astype(np.float64), minlength=n + 1)


def cutout(im):
    return cutout_rgba(im).quantize(128, method=Image.Quantize.FASTOCTREE)


def cutout_alpha(im):
    """Masque binaire (h, w) des pixels gardés, avant adoucissement."""
    r, g, b = channels(im)
    h, w = r.shape
    ink = is_ink(r, g, b)
    bg = is_bg(r, g, b)
    # dilatation d'1 px pour refermer les contours abîmés par la compression JPEG
    ink_d = ndimage.binary_dilation(ink, structure=CONN8)

    keep = np.ones((h, w), bool)
    labels, n = ndimage.label(~ink_d, structure=CONN4)
    size = per_label(labels, n, np.ones_like(bg))
    edge = np.zeros(n + 1, bool)
    edge[np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))] = True
    remove = edge | (per_label(labels, n, bg) > size / 2)
    remove[0] = False  # étiquette 0 = pixels d'encre
    keep &= ~remove[labels]
    # liseré ajouté par la dilatation : on retire ce qui ressemble au fond
    keep &= ~(ink_d & ~ink & bg)

    # garde les parachutistes (couleurs vives) et les flèches de rotation (bleu marine) ;
    # retire la lettre / le numéro en haut à gauche et les petits parasites
    labels, n = ndimage.label(keep, structure=CONN8)
    size = per_label(labels, n, np.ones_like(bg))
    is_vivid = per_label(labels, n, vivid(r, g, b)) >= 0.03 * size
    is_mark = per_label(labels, n, ink) >= 0.3 * size
    in_label = np.zeros(n + 1, bool)
    for k, sl in enumerate(ndimage.find_objects(labels), 1):
        in_label[k] = sl[1].stop - 1 < 0.22 * w and sl[0].stop - 1 < 0.19 * h
    good = (is_vivid | (is_mark & ~in_label)) & (size >= 0.00005 * w * h)
    good[0] = False
    return good[labels]


def cutout_rgba(im):
    mask = cutout_alpha(im)
    a = Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(0.6))
    # pixels transparents mis à zéro : fichiers bien plus légers
    rgb = np.asarray(im).copy()
    rgb[np.asarray(a) == 0] = 0
    out = Image.fromarray(rgb).convert("RGBA")
    out.putalpha(a)
    return out


def _save(name):
    cutout(frame_image(name)).save(OUT / f"{name}.png", optimize=True)
    return name


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=os.cpu_count()) as pool:  # numpy / scipy / Pillow libèrent le GIL
        for name in pool.map(_save, FRAMES):
            print(name, end=" ", flush=True)
    print(f"\n-> {OUT}")


if __name__ == "__main__":
    main()
