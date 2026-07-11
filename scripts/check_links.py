#!/usr/bin/env python3
"""CI check: verify index.html's local assets exist and inventory.json's
image paths resolve. Exits non-zero (failing the build) on any broken link."""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
errors = []

# ── 1. Local href/src references in index.html ───────────────────────────────
html = (root / "index.html").read_text(encoding="utf-8")
for ref in re.findall(r'(?:href|src)\s*=\s*"([^"]+)"', html):
    if ref.startswith(("http://", "https://", "data:", "#", "mailto:", "tel:", "//")):
        continue
    target = root / ref.split("?")[0].split("#")[0]
    if not target.exists():
        errors.append(f"index.html references missing file: {ref}")

# ── 2. Card image paths in inventory.json ────────────────────────────────────
inv = json.loads((root / "inventory.json").read_text(encoding="utf-8"))
cards = inv.get("cards", [])
missing = 0
for c in cards:
    img = (c.get("image") or "").strip()
    if img and not (root / img).exists():
        missing += 1
        if missing <= 10:
            errors.append(f"inventory.json image missing: {img} (card #{c.get('id')})")
if missing > 10:
    errors.append(f"...and {missing - 10} more missing card images")

# ── Result ───────────────────────────────────────────────────────────────────
if errors:
    print("Link/asset check FAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)

with_img = sum(1 for c in cards if (c.get("image") or "").strip())
print(f"OK: index.html assets resolve; {with_img}/{len(cards)} card images present.")
