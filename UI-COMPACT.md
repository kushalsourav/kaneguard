# KaneGuard Compact Control Center

This UI update affects **only** `/control/`. CartLab and CoinPulse are unchanged.

- White/light-gray desktop workspace with a narrow header and restrained indigo accents.
- Compact statistics and one-click actions for the two browser targets.
- Recent runs, activity timeline, and evidence inspector in three equal-height columns.
- Desktop dashboard occupies `100vh` at widths >= 900px and heights >= 620px. Each data panel scrolls internally; a mobile/tablet viewport uses natural vertical scrolling instead of squeezing content.
- Uses the existing local SVG icon module and the existing real `/api/verify`, `/api/runs`, `/api/health`, and evidence endpoints.
- Kane verification and automatic source repair still depend on properly installed/authenticated Kane CLI and agent CLI; this update changes visual presentation, **not** verification authenticity.

For existing v2 installs: unzip the patch into the folder containing `package.json`, then run `npm test && npm start`. Refresh `/control/` with Ctrl+Shift+R.
