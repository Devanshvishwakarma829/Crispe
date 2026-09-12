# CRISPÉ — Scroll Site

A cinematic scroll-driven brand site for CRISPÉ potato chips: a 6-chapter
AI-generated film (potato → sliced → fried → seasoned → crunch → packet
reveal) scrubbed by scroll position, flowing into a full brand homepage
(story, craft, flavours & pricing, specs, gallery, CTA, footer).

## Run locally
No build step. From this folder:

    python3 -m http.server 4173

Then open http://localhost:4173 in a browser.

## Structure
- `index.html` — all markup, styles, and captions (film + brand page)
- `main.js` — the scroll-scrubber engine (rarely needs edits)
- `frames/` — 697 WebP frames of the master film + `frames.json` manifest
- `images/` — flavour packet cards (Classic Sea Salt, Smoky BBQ, Masala
  Heat, Cream & Herb)

## Editing
- Chapter captions & their scroll-position windows (`data-in/hold/out`)
  live directly on each `.caption` div in `index.html`.
- Chapter start fractions in the current film: reveal 0.000, slice 0.166,
  fry 0.331, season 0.497, crunch 0.662, packet 0.828 (of the ~700vh track).
- Flavour prices are demo prices (₹99) — edit the `.flavour-card .price`
  blocks directly.

## Deploy
Any static host works (GitHub Pages, Netlify, Vercel, S3). Just upload
this whole folder as-is.

Designed & developed by Devansh Vishwakarma.
