# Pokémon Card Inventory Site

A fast, mobile-first, dark-themed static site for browsing your Pokémon card
inventory (customers browse here; purchases happen on Whatnot).

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure |
| `styles.css` | Dark Pokémon theme, responsive layout |
| `script.js` | Search / filter / sort / modal / share (vanilla JS) |
| `inventory.json` | Your inventory data (generated) |
| `images/` | Card photos, named by inventory ID (generated) |
| `generate_inventory.py` | Rebuilds `inventory.json` + `images/` from your Whatnot sheet |

## View it locally

Open `index.html` in a browser. If your browser blocks `fetch()` on `file://`,
run a tiny local server instead:

```
python -m http.server 8000
```

then visit http://localhost:8000

## Refresh the inventory

After you update your Whatnot listings, regenerate the data:

```
python generate_inventory.py
```

This reads your live Whatnot Shop sheet + copies matching card images.
Then commit and push the changed `inventory.json` and `images/`.

## Publish to GitHub Pages

1. Create a new GitHub repo and upload this whole folder (or `git push`).
2. Repo **Settings → Pages → Source: `main` branch, `/root`**.
3. Your site goes live at `https://<username>.github.io/<repo>/`.

No build step, no dependencies — it's pure HTML/CSS/JS.

## Notes on data

- **Quantity** defaults to `1` (Whatnot Buy It Now singles).
- **Condition** isn't stored per-card in the sheet, so every card shows the
  default set at the top of `generate_inventory.py` (`DEFAULT_CONDITION`).
  Change it there if you want a different default.
- **Newest** sort and **Last Updated** use `wn_first_seen.json` (when each card
  was first listed).

## Features

Instant partial search (name, set, card #, inventory ID) · filters (set,
condition, in-stock-only) · sorting · lazy-loaded images · infinite scroll ·
click-to-open detail modal · copy card info · shareable per-card links
(`?card=<id>`).
