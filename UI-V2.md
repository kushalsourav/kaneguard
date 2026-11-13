# KaneGuard UI v2 — control center + CoinPulse

Two redesigned apps with a cohesive, responsive visual system. **CartLab remains unchanged.**

## What changed

- **KaneGuard control center:** spectral-graphite dark theme, locally bundled Lucide-style line icons, improved sidebar and mobile navigation, four-stage verification diagram, clearer health statistics, run launcher cards, live timeline, history, and evidence inspector.
- **CoinPulse:** bright editorial fintech theme, indigo valuation card, dynamic holding-value bars, allocation donut and legend, asset mix statistics, accessible quantity input, search, gainers/losers filters, sorting, reset, and CSV export.
- **No new npm packages or CDN dependency for icons.** The `public/assets/icons.mjs` module provides inline SVG symbols and fills `data-icon` placeholders at runtime. The existing vanilla JS architecture and one-command Node server remain intact.
- **Data authenticity preserved:** no fake Kane runs or external crypto feeds. The dashboard reads the existing `/api/runs` and `/api/health` endpoints. CoinPulse uses deterministic fixtures, including `?fixture=malformed` to test missing prices.
- Responsive layouts reviewed at 1440px and 390px; keyboard focus-visible states and reduced-motion support added.

## Screenshots

- `docs/previews/control-center.png`
- `docs/previews/coinpulse.png`
- `docs/previews/control-mobile.png`
- `docs/previews/coinpulse-mobile.png`
- `docs/previews/cartlab.png` (unchanged)

## Install update into an existing KaneGuard checkout

In WSL, navigate into the `kaneguard` repository first, then extract the **UI update ZIP** (contains `public/`, `docs/`, and this document relative to the repo root):

```bash
cd ~/hackathons/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-UI-v2-update.zip
npm test
npm start
```

If the original ZIP created an extra nested `kaneguard` folder, run the `cd` command from that inner project root (the folder containing `package.json`). To see changes if `npm start` is already running, refresh the browser with **Ctrl+Shift+R**. This update does not modify engine behavior or test objectives.

## Quick checks

- Control center: http://localhost:4173/control/
- CoinPulse: http://localhost:4173/coinpulse/
- Bad-price fixture: http://localhost:4173/coinpulse/?fixture=malformed
- CartLab: http://localhost:4173/cartlab/

Before the hackathon demonstration, run real Kane CLI checks and capture authentic evidence; these UI screenshots only demonstrate appearance.
