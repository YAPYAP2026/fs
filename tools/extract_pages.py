"""Extract the embedded page JPEGs from figures.pdf (stdlib only).

Usage: python -I tools/extract_pages.py [figures.pdf] [assets/pages]
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "figures.pdf"
out = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "assets" / "pages"
out.mkdir(parents=True, exist_ok=True)

data = pdf.read_bytes()
pattern = re.compile(rb"<<(?:(?!>>).)*?/Subtype\s*/Image(?:(?!>>).)*?>>\s*stream\r?\n", re.S)
count = 0
for m in pattern.finditer(data):
    header = m.group(0)
    if b"/DCTDecode" not in header:
        continue
    length = int(re.search(rb"/Length\s+(\d+)", header).group(1))
    start = m.end()
    jpeg = data[start:start + length]
    count += 1
    (out / f"page-{count}.jpg").write_bytes(jpeg)
    print(f"page-{count}.jpg  {len(jpeg)} bytes")

print(f"{count} images extracted to {out}")
