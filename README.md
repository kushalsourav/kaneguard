# KaneGuard ⚡
**Your agent writes it. Kane checks it. KaneGuard makes it right.**

KaneGuard is a local-first autonomous browser-verification and source-repair engine for the Kane CLI Online Hackathon 2026. It hosts two **fully functional target applications**, runs natural-language acceptance objectives against the **real Chrome browser** with Kane CLI, routes failing verdicts to Google Antigravity for **actual source edits**, and re-verifies the complete browser suite. The maximum is three agent repairs; infrastructure failures, unauthorized edits, and missing evidence never count as a pass.

> **Current delivery:** A runnable app server, both target apps, live control center, Kane+Antigravity adapters, state machine, bounded repair policy, local history and unit tests are implemented. **Authentic Kane browser verdicts and a live Antigravity repair have not been generated in the build environment**, because `kane-cli` and `agy` are not installed/authenticated there. The first local live run is still required for hackathon eligibility. The UI never displays fictitious successful verification results.

## Quick start — one command

Requirements: **Node.js 20+**. No npm dependencies are necessary for this initial build (intentionally, so the judging demo can launch offline).

```bash
npm start
```

| Interface | URL |
| --- | --- |
| KaneGuard control center | http://127.0.0.1:4173/ |
| CartLab shopping cart | http://127.0.0.1:4173/cartlab/ |
| CoinPulse portfolio | http://127.0.0.1:4173/coinpulse/ |
| CoinPulse malformed market data | http://127.0.0.1:4173/coinpulse/?fixture=malformed |

## Set up REAL Kane and agent verification (required for hackathon)

In a separate terminal on **your own development computer**, install and authenticate the two external CLIs:

```bash
npm install -g @testmuai/kane-cli
kane-cli login
# Install Google Antigravity CLI per its official instructions.
agy                    # sign in interactively; close after authentication
npm run doctor          # display installed versions / missing tools
```

Kane CLI also requires **Google Chrome**. Antigravity must have filesystem edit permission for the workspace. Its headless invocation is `agy -p "..." --output-format json --print-timeout 5m --sandbox`. The sandbox option is deliberate; test its edit permissions on the local machine before a demo. Do **not** use blanket `--dangerously-skip-permissions` unless you independently evaluate the risks.

With `npm start` already running, click **Verify** on the control center or run:

```bash
npm run verify:cartlab
npm run verify:coinpulse
npm run watch:cartlab
npm run history
node engine/cli.mjs replay <existing-run-id> # a fresh verification, never fabricated playback
npm test
```

The CLI `run` and `watch` commands launch the app server automatically when no server is running. Port **4173** is the app's default; the target configs refer to this port, so change both URLs if moving the port. Only launch from a workspace that you're comfortable allowing an AI agent to edit; the engine protects tracked files but an agent process is not an operating-system security boundary.

## What is real, and what is not

- **Real applications:** CartLab supports product addition, quantity adjustment, item removal, SAVE10 and invalid coupons, shipping and tax totals, and a guest order confirmation. No real payment is made. CoinPulse supports a deterministic portfolio, editable quantities, sort, search and missing-price fallback. No external price data is required.
- **Real verification when connected:** `kane-cli run "<objective>" --url <local app URL> --agent --headless --timeout 120 --final-validation on`; stdout saved as NDJSON, stderr saved separately, and last `run_end` interpreted with process exit status.
- **Real agent invocation when connected:** `agy -p <generated repair ticket> --output-format json --print-timeout 5m --sandbox` (noninteractive, authenticated separately). The agent is asked to modify **application source only**, never tests or logs.
- **No simulated passes:** If the CLI is missing, authentication fails, Chrome fails, an NDJSON `run_end` is absent, or a run times out, KaneGuard stops in `infrastructure_error` and saves diagnostics. An agent's claim to have fixed something without changed files is rejected.
- **Safety:** Before an agent attempt, a snapshot is made. Unexpected edits to monitored protected files are reverted and flagged. Read the `runs/<id>/checkpoint/` archive to recover earlier sources. This guard is best-effort, not an OS-level sandbox; do not give it secrets or elevated privileges.

## How the loop works

```text
Developer starts one run / watcher notices app edit
       ↓
Snapshot + JS precheck + HTTP health check
       ↓
Kane CLI (real browser, structured NDJSON)
       ↓
  PASS? ─── Yes ──→ Save green evidence and exit
       │
       No, assertion failed
       ↓
Failure ticket: objective + Kane summary + final event + recent diff
       ↓
Antigravity edits application source (allowlist only)
       ↓
File-integrity guard + JS precheck + re-run all Kane flows
       ↓
PASS → save evidence    |   FAIL → retry up to 3 total repairs
       ↓
Record terminal state, diagnostics and changed files
```

Two sets of objectives are held in `configs/cartlab.json` and `configs/coinpulse.json`. Both are run via the same `engine/orchestrator.mjs`. Config and acceptance flows are *not* editable by the repair agent.

## Demonstrate meaningful failures

1. Run a clean CartLab verification **with authenticated Kane** and capture a real green browser baseline.
2. **Clearly label the action as an intentional seeded regression** and run `npm run demo:seed-cart-bug` before starting the watcher or verification loop. This introduces an actual 20%-instead-of-10% pricing defect in application source (never in tests). KaneGuard should generate a real failure ticket, let Antigravity repair the code, and rerun the unchanged suite. Report the true outcome, not a presumed green result. Use `npm run demo:restore-cart` if a demo is interrupted.
3. Independently, run `npm run demo:seed-coin-bug` to introduce a missing-price aggregation defect in CoinPulse and invoke the same engine. Use `npm run demo:restore-coin` if needed. Keep this intentionally seeded test case clearly identified in your video.
4. Open the control center to show the run history, exact browser verdicts, raw NDJSON, error logs and source diffs. Capture your genuine run in your video.

## Repository

```text
kaneguard/
  engine/             Node ESM loop, Kane adapter, agent, snapshots, CLI, storage
  server/             Local HTTP app server + control API
  public/control/     Live run history + evidence inspector
  public/cartlab/     Shopping cart application + pricing module
  public/coinpulse/   Portfolio application + resilient valuation module
  public/assets/      Shared responsive styles
  configs/            App-specific settings and immutable Kane objectives
  kane/               Documentation of browser acceptance behavior
  runs/               Generated local evidence, raw logs, checkpoints (ignored by Git)
  tests/              Unit + HTTP integration checks
```

## Limits and next development goals

This dependency-free implementation uses browser-native ES modules and Node.js rather than the proposed Vite/React stack to allow the first prototype to run with **zero package downloads**. The independent core modules can migrate to TypeScript/React later without changing Kane CLI objectives. External CLI install and login, real Chrome browser verification, a **genuine observed fail→agent fix→pass chain**, and a recorded demonstration remain necessary. The watcher ignores engine output directories, but if the agent changes a watched file while a run is active, the change is intentionally not queued as a second concurrent run. Avoid simultaneous runs from multiple terminal processes in the same repo (a per-process mutex is implemented, not a distributed lock).

## Official references

- [Kane CLI install](https://www.testmuai.com/docs/kane-cli-installation)
- [Kane CLI command reference](https://www.testmuai.com/docs/kane-cli-cli-reference)
- [Kane agent-mode NDJSON](https://www.testmuai.com/docs/kane-cli-agent-mode)
- [Antigravity CLI headless usage](https://antigravity.google/docs/cli/headless/)

Built during the November 2026 Kane CLI Online Hackathon window. Store your own genuine evidence and submit with your eligible Git history.
