# KaneGuard changelog

Version notes merged from the former root-level V*.md files (oldest first).

---

<!-- from UI-COMPACT.md -->
# KaneGuard Compact Control Center

This UI update affects **only** `/control/`. CartLab and CoinPulse are unchanged.

- White/light-gray desktop workspace with a narrow header and restrained indigo accents.
- Compact statistics and one-click actions for the two browser targets.
- Recent runs, activity timeline, and evidence inspector in three equal-height columns.
- Desktop dashboard occupies `100vh` at widths >= 900px and heights >= 620px. Each data panel scrolls internally; a mobile/tablet viewport uses natural vertical scrolling instead of squeezing content.
- Uses the existing local SVG icon module and the existing real `/api/verify`, `/api/runs`, `/api/health`, and evidence endpoints.
- Kane verification and automatic source repair still depend on properly installed/authenticated Kane CLI and agent CLI; this update changes visual presentation, **not** verification authenticity.

For existing v2 installs: unzip the patch into the folder containing `package.json`, then run `npm test && npm start`. Refresh `/control/` with Ctrl+Shift+R.

---

<!-- from UI-V2.md -->
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

---

<!-- from LIVE-LOGS.md -->
# KaneGuard live terminal logging (v4 patch)

This patch does **not** change the CartLab or CoinPulse UI or acceptance flows. It adds observable verification and repair diagnostics to the engine and a small link area within the existing white Control Center Evidence panel.

## Installation (from your actual WSL project root)

```bash
cd ~/hackathons/kaneguard/kaneguard
# Stop npm start with Ctrl+C first. Ensure you have a clean Git working tree.
unzip -o /mnt/d/kanecli/KaneGuard-Live-Logs-v4.zip
npm test
npm start
```

Open http://127.0.0.1:4173/control/ and click Verify. The `npm start` terminal now prints timestamped run-stage messages plus Kane event updates, agent prompts, Antigravity steps, stderr diagnostics, retry messages, and final verdicts. Normal passive GET polling stays silent.

In another WSL terminal:

```bash
cd ~/hackathons/kaneguard/kaneguard
npm run logs
```

Or inspect the latest run files (this does not require the patch):

```bash
ls -td runs/*/ | head
ls -lt runs/<run-id>/
cat runs/<run-id>/repair-ticket-1.txt
cat runs/<run-id>/agent-1.ndjson
```

Once a failing verification triggers a repair, the Evidence panel will link the exact repair prompt and raw agent response. The browser itself is **not** the Antigravity CLI chat. The integration uses an independent `agy -p` noninteractive process; CLI steps may not show up in the Antigravity editor conversation UI.

## What the logs mean

- `ENGINE`: checkpoint/precheck, flow and retry transitions.
- `KANE`: live selected browser JSON events; stdout and stderr remain saved in the per-run evidence files.
- `AGENT PROMPT`: the repair ticket sent as `-p`, with common credential patterns redacted in console/live.log.
- `AGENT`: `agy --output-format stream-json` progress events, tool/action summaries when emitted, terminal status.
- `VERDICT`: the engine's validated final status, not merely an agent's self-report.

`runs/` is ignored by Git. **Do not publish your console transcripts, prompt files, NDJSON, or run logs without checking them for private information**. Automatic masking is best-effort. Do not put secrets in source files or repair tickets.

## Compatibility and limitations

- Requires recent Antigravity CLI supporting `--output-format stream-json` (official documented option). Verify your installed `agy --help` includes it. The old adapter used one completion-only `json` response.
- No CLI authentication or repair run was performed in the build container. You have already confirmed real CartLab Kane passes on your computer; a real failure-to-agent-edit-to-Kane-pass run still needs to be exercised there.
- If Antigravity cannot edit files inside `--sandbox` or requires approval, the run should fail clearly. Do not use blanket bypass flags merely to make the demo appear autonomous.
- Logs only start appearing once a verification starts (or a verification-related API request is made); an idle `npm start` process should stay mostly quiet.

## Performance comparison

Measure both agents on the **same intentionally seeded regression**, with the same Kane objectives, model/effort tier, repair limit and source snapshot. Compare total time through a Kane-confirmed green result (and cost), not just how quickly each writes a patch.

---

<!-- from AGENTIC-V5.md -->
# KaneGuard v5 — agent-authored diagnosis and repair plans

This patch upgrades the old predefined failure-ticket workflow to an actual **two-stage, agent-driven repair loop**. It preserves the compact dashboard, CartLab, CoinPulse, existing Kane objectives, and the three-attempt safety limit.

## Difference from v4

| Previous version | v5 |
| --- | --- |
| Engine creates a fixed repair ticket from failure text | Engine supplies raw Kane evidence and a read-only investigation task |
| Antigravity is invoked only to execute the predefined ticket | Antigravity independently investigates the code and **authors its own JSON plan plus concrete repair instruction** |
| Engine runs agent once per repair attempt | Engine runs Antigravity once to investigate, then again to apply the model-authored plan |
| Prompt is saved | Investigation input, agent trace, **agent-authored plan**, execution prompt, agent trace, and source diff are saved |

This is an *agentic* planning step, not a claim that a model was trained or that Kane itself writes code. The engine still handles deterministic validation and safety. It deliberately does not prescribe the fix.

## Execution flow

1. Kane runs the unchanged real-browser acceptance flows and emits NDJSON.
2. A failure triggers `planRepair()`. Antigravity reads the failure objective, final Kane event, trace location, prior diff and relevant source files. It returns **its own** structured diagnosis, confidence, affected files and repair instruction.
3. KaneGuard writes `runs/<run-id>/diagnosis-1-plan.json`. The planner is **read-only**: if it changed monitored source files, they are rolled back and execution halts.
4. If the agent is confident enough and proposes only allowlisted files, the execution agent receives **that agent-authored instruction** plus hard safety boundaries. It edits real application code.
5. KaneGuard rejects unauthorized edits, syntax-checks, reruns the *unchanged* Kane browser scenarios, and retries with the newest failure evidence (maximum three code repair attempts).
6. Every step appears in the Control Center activity and evidence links. Outcomes are never fabricated or counted as passing when the agent claims success.

## New evidence files

- `diagnosis-<n>-input.txt`: investigation request and Kane evidence context (engine-generated wrapper, *not* a repair solution)
- `diagnosis-<n>-agent.ndjson`: full headless Antigravity investigation events
- `diagnosis-<n>-agent.stderr.log`: investigation diagnostics
- `diagnosis-<n>-plan.json`: **repair prompt, diagnosis, confidence, and files written by Antigravity**
- `repair-ticket-<n>.txt`: final execution request that embeds the agent-authored repair prompt
- `agent-<n>.ndjson`, `agent-<n>.stderr.log`: execution trace
- `source-diff-<n>.txt`: modifications discovered after the executing agent runs
- `live.log`: timestamped real-time events (redacted for common credential patterns)

These outputs can include application data, browser evidence, or private prompts. Review them before sharing your repository/demo. The `runs/` directory remains `.gitignore`d.

## Apply to existing WSL project

Place `KaneGuard-Agentic-Loop-v5.zip` in `D:\kanecli`, then:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-Agentic-Loop-v5.zip
npm test
npm start
```

You should have the previous **Live Logs v4** update installed first. It is required because this update uses `engine/live-logger.mjs`.

Open `http://127.0.0.1:4173/control/`, choose a meaningful verification run and read the new **AI diagnosis** and **Planner trace** links. Passing Kane tests correctly do **not** trigger Antigravity; a real assertion failure is required.

### One controlled demo (after backup / commit)

**Do this only in a disposable branch or copy** of the workspace. A seeded regression is a valid, transparently labelled demonstration, not a claim of an accidental bug.

```bash
# Terminal A: run the local dashboard / application server
npm start

# Terminal B: after Kane and agy are authenticated
npm run demo:seed-cart-bug
npm run verify:cartlab
```

A genuine run should show `KANE FAILED` → `AGENT PLAN` generated a diagnosis → `AGENT` edited source → Kane rechecked → final verdict (PASS or truthful failure). Follow `npm run logs` from another terminal.

To clean up a seeded bug after a failed demo:

```bash
npm run demo:restore-cart
```

**Important limitations:** We ran local unit/integration tests with a simulated agent process to validate the planning protocol and file artifacts. We could not run the real authenticated `agy` or Kane CLI binaries in the packaging environment. Authentication, prompt permissions, sandbox support, response JSON quality, and an actual fail→fix→pass cycle must be proven in your WSL installation. Two agent calls per repair make this more explainable and demonstrably agent-authored, but also add latency. Do not enable global permission bypass for a hackathon demo.

---

<!-- from LIVE-STREAM-V8.md -->
# KaneGuard v8 — Live browser event stream and safer agent planning

## What changed

- `GET /api/runs/:id/events` is a local Server-Sent Events (SSE) stream that replays recent `live.log` entries and forwards fresh lines as soon as the running engine emits them. It needs no external websocket service or client dependency.
- The **Activity** column contains a compact, auto-scrolling **Live trace**, separate from the persisted task/timeline summary. Selecting a previous run replays its saved log. Refreshing the page reconnects automatically.
- The engine streams `[PLAN]`, `[BUILD]`, `[KANE]`, `[WORKFLOW]`, and other redacted log lines without waiting for the 1.5-second summary polling loop.
- Feature planning now includes current allowlisted app source files inline, instructing Antigravity to write the feature plan without running shell commands just to inspect files.
- If Antigravity still encounters an auto-denied command, KaneGuard reports a concrete permission error instead of confusing it with a bad JSON plan. The planner prompt, stdout, and stderr artifacts remain linked even on failed planning.
- Original browser checks, protected tests, code-edit restrictions, retries, CartLab and CoinPulse remain unchanged.

## Apply the update in WSL

Stop `npm start`, then from **the inner directory containing package.json**:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-Live-Stream-v8-update.zip
npm test
npm start
```

Open `http://127.0.0.1:4173/control/`, hard-refresh, and select the latest build run. The Activity panel shows **Live trace** as events arrive.

## About Antigravity headless command permission

The original log reported an Antigravity CLI command tool being auto-denied in headless mode. This is not a Kane CLI failure. Sending the source inline avoids needing read-only shell inspection during planning, but it cannot guarantee the coding agent never requests a command.

If the agent still requests a command and gets denied, inspect the saved `feature-plan-agent.stderr.log` and `feature-plan-agent.ndjson` and grant only the appropriate, specific safe command in:

`~/.gemini/antigravity-cli/settings.json` → `permissions.allow`

For example, the official documentation shows `command(regex:npm run (build|lint|test))` as a scoped allow-rule. Do not use `--dangerously-skip-permissions` or `command(*)` on an autonomous repository-editing workflow. A permitted command is not a guarantee that its effects will be safe; review the command target. The existing Git checkpoint and source allowlist are defense in depth, not a sandbox for arbitrary code execution.

## Evidence and limitations

- SSE is for local UI feedback, and the `runs/<id>/live.log` file remains the durable artifact.
- The text feed uses the existing logger's best-effort secret redaction and displays concise agent *events*, not a claim to expose private model reasoning. Full machine-readable traces and actual prompt inputs are linked in the Evidence panel.
- Browser SSE replay and live log publish were integration-tested with synthetic log data; no authenticated Antigravity/Kane build was executed inside the packaging environment. Run a fresh wishlist build on your WSL machine to validate real end-to-end behavior.

---

<!-- from AGENT-INSPECTOR-V9.md -->
# KaneGuard v9 — Agent plan validation and in-dashboard inspection

## Why this patch exists

The November 15 CartLab feature request reached Antigravity successfully and produced a genuine wishlist plan. KaneGuard's prior validator required words such as `verify` or `assert`, rejecting ordinary Kane-compatible browser instructions like "observe that the item remains after a reload." This was a validation defect, not a missing plan.

## Changes

- Agent-authored browser objectives now require **actual browser actions** and **observable outcomes**, while accepting equivalent natural language like `observe`, `remains`, `displays`, and `visible`. Empty/vague checks and unsafe commands remain rejected.
- The planner is explicitly told that **each Kane flow runs in a fresh browser session** and must set up its own required state; a test cannot rely on a product saved in a previous flow.
- Every parseable agent plan is saved in `runs/<id>/feature-plan-candidate.json` **before** verification and schema validation. Rejected plans remain inspectable as rejected drafts; they are not treated as successful builds.
- The compact Control Center's Evidence panel has four tabs: **Results**, **Plan & tests**, **Agent prompts**, **Changes**.
- Plan & tests shows the generated task breakdown, its linked acceptance checks, and full browser objectives, not only their names.
- Agent prompts displays the exact saved planning request, agent-authored plan JSON, implementation prompt, and, **when a real Kane failure occurs**, the generated repair diagnosis and repair execution prompt. The raw original files are available via a link.
- For older v8 runs that saved only a planner NDJSON transcript, the browser can recover the agent's plan from the genuine result event, label it as **not approved**, and show the rejection reason.
- v8 Server-Sent Events (live trace) remain unchanged. This patch does not generate fake evidence or repair results.

## Install on an existing v8 project

Place the ZIP in `D:\kanecli`, stop the running node server (`Ctrl+C`), then:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-Agent-Inspector-v9-update.zip
npm test
npm start
```

Open `http://localhost:4173/control/`, then hard refresh with Ctrl+Shift+R. Click a build run and use the four Evidence tabs. For a failed older plan run, **Plan & tests** will try to recover the agent's original JSON from the saved planning transcript.

**Authenticity:** A repair prompt exists only after an actual failure produces agent investigation/repair files. If the build is still planning, the prompt tabs display whichever real files have been written at that point. Successful tests should not cause fabricated repairs.

## Limits / tests

The Node test suite covers structural validation, pre-validation artifact preservation, old NDJSON recovery, and repair artifact listing. These are local tests; a real Antigravity + Kane feature-build cycle still needs validation on the authenticated WSL workstation. A full Chromium visual render was blocked by this container's browser networking policy.

---

<!-- from AGENT-FIRST-V10.md -->
# KaneGuard v10 — direct agent execution, authentic provenance, and timeout recovery

## What changed

KaneGuard supplies the chosen app, the user's request, real source context, and hard safety/verification constraints. **Antigravity** generates the feature title, implementation summary, tasks, and independent Kane browser objectives. KaneGuard now hands those exact tasks to Antigravity for execution. It no longer asks for a separate `implementationPrompt` in the agent's JSON plan or injects wishlist-specific instructions into the generic planner.

An initial instruction envelope is still necessary to invoke any coding agent in a predictable and safe way. In **Prompts & traces**, the provenance is explicit: **KaneGuard → Antigravity** indicates scaffolding/handoffs; **Antigravity →** indicates model output; the real browser result is exclusively from **Kane CLI**. A repair's `repairPrompt` remains authored by Antigravity after seeing actual Kane failure evidence.

The headless `agy` implementation stage no longer cuts off at the hardcoded 8-minute `--print-timeout`. `--print-timeout 0s` waits for the agent turn to finish, with a separate 20-minute host watchdog to avoid hanging indefinitely. Repair execution similarly waits for the agent, with a 15-minute watchdog. Timeouts and partial outputs never count as PASS. If permissible source changes were produced before a timeout, KaneGuard captures the diff, labels them unverified, and can attempt independent Kane verification and bounded repairs. The full model and browser evidence is preserved.

To keep the Activity panel useful, token-by-token planning output is coalesced into progress updates; the complete original NDJSON remains saved. The Changes panel now displays context-aware unified diffs instead of treating the whole file as changed after a single line insertion.

## Continue the wishlist run from November 15

The v9 run `20261115074212-otnph` ended with `AGENT_ERROR` because Antigravity hit the eight-minute print timeout. Its diff already contains `wishlist-store.mjs`, `wishlist.html`, `wishlist.mjs`, and changes to the CartLab store. You **do not need to generate the feature a second time** merely to verify those existing edits.

1. Back up your workspace or create a Git checkpoint. Do not discard the existing wishlist source.
2. Stop KaneGuard; extract the **v10 update ZIP only** over your v9 project. The update contains no `public/cartlab/` or `public/coinpulse/` app-source files.
3. `npm test` then `npm start`.
4. Open `http://127.0.0.1:4173/control/`, hard-refresh, select the old run `20261115074212-otnph` in Recent runs, and click **Resume Kane verification of saved code**.
5. The new run records `resumedFrom` and copies the **same validated agent-authored checks**, then invokes Kane and the existing protected regressions. If an app defect is found, the Antigravity diagnosis/repair loop can fix it. Only real PASS results mark the tasks verified.

The resume action will not appear if the old run has no saved plan/source changes or if a different workflow is active. It does not claim that the old interrupted agent turn finished successfully, nor does it regenerate or relax Kane tests.

## Installation (WSL)

```bash
cd ~/hackathons/kaneguard/kaneguard
# After copying the update archive to D:\kanecli on Windows:
unzip -o /mnt/d/kanecli/KaneGuard-Agent-Direct-V10-update.zip
npm test
npm start
```

Use the **update archive**, not a full project archive, to preserve the agent's local edits and the `runs/` evidence directory.

## Verification limits

Local Node tests exercise parsing, artifact provenance, timing classification, endpoint basics, UI source, and source-diff behavior. Authentic Antigravity implementation and live Kane browser verification must be performed in your WSL environment, with your authenticated CLIs and available Kane credits. The test suite alone does **not** establish a verified wishlist feature or successful automatic repair.

---

<!-- from FEATURE-BUILD-V6.md -->
# KaneGuard v6 — Agent-first feature builder

## What changed

Select CartLab or CoinPulse, type a feature request, and click **Build & verify**.
This is an agent-first workflow, separate from the existing **Verify** buttons.
The new backend endpoint `POST /api/build` accepts `{ "appId": "cartlab", "prompt": "Add a wishlist page with add/remove and saved items" }`.

1. **Plan:** Headless Antigravity inspects the selected app and returns original structured implementation tasks and 2–4 natural-language browser acceptance objectives. This call is read-only. The planner prompt, NDJSON, and JSON output are saved. Weak or off-site tests are rejected.
2. **Build:** Another Antigravity run receives that agent-authored plan and modifies real source files under `public/<selected-app>/`. A checkpoint and source diff are saved. Tests, configs, engine, and unrelated applications are protected. Agent-reported success alone does not imply a working feature.
3. **Verify:** Kane CLI runs every agent-authored feature check **in a real browser**, followed by the existing three protected regression checks. Both suites must pass.
4. **Repair:** If a check fails, KaneGuard sends the actual Kane failure evidence to the v5 agent diagnosis + repair loop. New verification runs follow each edit. The loop is capped at three repair attempts.
5. **Proof:** The activity panel displays source-derived tasks, agent decisions, running checks and results; Evidence contains original agent prompts and outputs, generated feature plan, source diffs, Kane NDJSON, and browser evidence.

**Important:** Generated tasks show `planned` → `candidate` (code edited, not verified) → `verified` only after all Kane tests pass. Failure states remain visible. The source is never marked verified based only on Antigravity's word.

## Run it in WSL

Apply the patch in your **inner** project folder:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-Agent-First-Feature-Builder-v6.zip
npm test
npm start
```

Open `http://127.0.0.1:4173/control/`, select CartLab, and try:

> Add a wishlist page. Each product should have an Add to wishlist button. Users can open the wishlist, remove items, and keep saved items after refreshing the page. Do not break the shopping cart or checkout.

Or run from another terminal while the server is running:

```bash
cd ~/hackathons/kaneguard/kaneguard
npm run build:cartlab -- "Add a wishlist page with add and remove buttons and local persistence"
```

Follow the live agent and Kane output in your `npm start` terminal or with `npm run logs`.
All generated run evidence is under `runs/<run-id>/`, excluded from Git by `.gitignore`.

## Limitations and safety

- Do **not** run unattended coding agents against uncommitted work you cannot lose. Commit clean source first, then use a disposable Git branch. A checkpoint is saved, but allowlisted edits are not automatically rolled back on failure.
- Both `agy` and `kane-cli` must already be installed and authenticated separately. In unattended mode Antigravity must have the required permissions to edit the app, preferably via its documented sandbox; this project does not bypass permissions automatically. If the headless session is blocked or returns no successful terminal result, the run stops honestly.
- Generated acceptance tests are checked for structure and off-site navigation, and immutable in memory during the run, but the model still chooses their specifics. The protected baseline regression suite is an independent safeguard.
- Agent-generated changes can only be inspected and exercised end-to-end on your development computer with authenticated Antigravity and Kane CLI. The local automated suite validates code paths and mocks CLI envelopes, **not** a real fully autonomous feature build.
- Headless Kane browser tests take time; a full build with regression checks can take considerably longer than the existing 5-minute CartLab verification.
- Use only a trusted local development workspace. File allowlists, source guards, and the Antigravity sandbox reduce risk but are not a security boundary against arbitrary malicious shell actions by an external coding agent.

---

<!-- from AGENT-MILESTONES-V11.md -->
# KaneGuard v11 — agent-authored tasks, Kane milestone gates, evidence-driven repair

## Feature build protocol

KaneGuard is the **orchestrator**, Google Antigravity CLI (`agy`) is the **planning and coding agent**, and Kane CLI (`kane-cli`) is the **independent browser verifier**. The app-specific tasks and Kane acceptance objectives are **generated by Antigravity**, not prewritten for a particular feature. KaneGuard supplies a generic JSON schema, actual application source, and non-negotiable safety boundaries.

1. **Plan:** Antigravity reads the real application source embedded in a read-only prompt. It generates 2–5 tasks, optional `dependsOn` task IDs, and 2–4 detailed, self-contained browser acceptance checks. Checks are immutable for that run. Every task must link to one or more checks through `acceptanceIds`; every check must be linked to a task.
2. **Order:** KaneGuard topologically orders the agent-authored tasks. It rejects missing dependencies, self-dependencies and cycles. Without `dependsOn`, original task order is preserved.
3. **Implement one task:** A separate `agy` invocation receives only the current task, its dependencies, prior implemented tasks, and the locked relevant checks. No separate agent-written `implementationPrompt` is required. Each task has its own command output, stderr, prompt handoff and real source diff. A successful agent response is **not a verified pass**.
4. **Run eligible Kane checks:** A browser check becomes eligible only after **every** task referencing it has been implemented. If none is eligible yet, KaneGuard performs a syntax/availability precheck and records that actual browser verification is deferred. It never reports a browser pass from syntax alone. When eligible, the exact AI-authored objective is submitted to Kane CLI and its raw `run_end` determines the verdict.
5. **Repair failed milestone:** On an actual Kane failure, KaneGuard supplies the original objective, failed summary, final Kane event, bounded raw evidence excerpt, current source, and source diff to Antigravity's read-only diagnosis call. Antigravity writes its own diagnosis and repair prompt. The coding-agent call edits allowlisted application files. Kane **re-runs all checks in that gate** after a repair, not just the most recent failure. The configured repair budget (three by default) applies to the **entire feature run**, not separately per gate. An infrastructure/authentication issue never counts as a failed feature and never triggers an invented pass.
6. **Final protection:** Regardless of intermediate milestone passes, KaneGuard re-runs **all feature checks and all original app regressions** against the final source. After a final-suite repair, the **entire final suite runs again**. Only all-green genuine Kane results produce `PASSED`.
7. **Resume:** The v10 **Resume Kane verification of saved code** action remains available for a stopped build with a saved plan and source edits. Resume creates a new run and uses the original locked checks, without invoking the planner or initial coding steps again.

## Key design choice: defer checks until browser-testable

A task that only introduces storage helpers cannot be usefully verified by Kane until controls or a page make its behavior visible. The scheduler uses `acceptanceIds` as the cross-task readiness rule: if task A and task C both link to check-2, **check-2 waits for both**. On a purely backend/internal task, KaneGuard checks JavaScript syntax but leaves task status as `candidate` until a relevant real browser check passes.

## Dashboard

The Control Center continues to show **Build with AI**, **Recent runs**, **Activity**, and **Evidence**. Activity now includes individual task states and small per-task gate rows. Evidence shows the generated plan, task dependencies, actual Kane check results annotated with their gate, real source changes, per-task coding prompts and tool traces, and—when a test genuinely fails—the diagnosis and repair artifacts. Live logs continue via server-sent events.

Prompt provenance is intentionally explicit: **KaneGuard → Antigravity** is the orchestration envelope; **Antigravity →** is authored task/diagnosis/implementation output; **Kane** alone establishes the browser verdict.

## WSL update (does NOT overwrite your agent-edited apps)

1. Copy `KaneGuard-Task-Milestones-v11-update.zip` to `D:\kanecli`.
2. Stop `npm start` with Ctrl+C.
3. In your project directory:

```bash
cd ~/hackathons/kaneguard/kaneguard
cp -a public/cartlab "../cartlab-backup-$(date +%Y%m%d-%H%M%S)"
unzip -o /mnt/d/kanecli/KaneGuard-Task-Milestones-v11-update.zip
npm test
npm start
```

4. Hard-refresh `http://127.0.0.1:4173/control/`. Submit a **new feature request** to exercise the task-by-task workflow. Previous v10 runs and genuine Kane evidence remain in `runs/`. The v10 wishlist feature does not need to be rebuilt just to install v11.

### Time and safety

A task-scoped Antigravity CLI call uses `--print-timeout 0s` plus an independent **8-minute** default host watchdog (`KANEGUARD_TASK_TIMEOUT_MS` can configure 30 seconds through 20 minutes). A timeout never creates a pass. Only safely changed, source-guarded files can move forward as candidates for Kane. The source-integrity guard is a monitored-file safety measure, not a full OS sandbox; avoid granting broad tool permissions or running in repositories with secrets.

## Automated tests versus authentic tools

The Node test suite includes dependency ordering, deferred browser checks, CLI argument and provenance tests, and a **clearly isolated integration test using temporary CLI test doubles** to validate: task-1 build → Kane gate → task-2 build → failure → agent-authored repair → retest → final suite. These tests validate the orchestration *logic only*. They do **not** claim the v11 task-by-task workflow has been exercised with a real authenticated Antigravity and Kane session on the user's WSL machine. The previous genuine v10 wishlist Kane evidence is separate and must never be relabeled as v11 proof.

The full project ZIP is meant only for fresh installation. When updating a working repo with generated wishlist code and saved runs, use the **update-only ZIP**.

---

<!-- from UI-FEATURE-ONLY-V7.md -->
# KaneGuard v7 — Focused AI feature builder

Removed the redundant **Run checks** toolbar (CartLab/CoinPulse Verify cards) from the Control Center. **Build with AI** is now the sole main UI action. Run history, Activity, Evidence, engine statistics, app links, and full browser-verification backend remain available.

## Apply to existing repository (run from the directory containing package.json)

```bash
unzip -o /mnt/d/kanecli/KaneGuard-Feature-Only-UI-v7.zip
npm test
npm start
```

Open http://localhost:4173/control/ and force refresh. Existing `npm run verify:cartlab` and `npm run verify:coinpulse` commands remain available; automated Kane verification after an AI feature build is untouched.

---

<!-- from LOOP-AND-RETRY-V12.md -->
# KaneGuard v12 — one-loop dashboard and truthful infrastructure retries

## What happened in the user's November 15 search/filter run

Run `20261115092911-3jtih` completed its first two coding tasks and passed the two corresponding Kane browser gates. Antigravity then implemented Task 3. Kane's third browser invocation emitted a `run_end` indicating `passed` and an apparently successful interaction summary, but the KaneGuard wrapper classified it as `INFRASTRUCTURE_ERROR` after the process watchdog elapsed or a nonzero process exit. That is **not** a verified pass. The old wrapper budget was `120 seconds + 15 seconds`, although the third real browser invocation took about 170 seconds. A watchdog/exit issue, not an observed application assertion failure, is the leading explanation based on the transcript; the attached log alone does not expose the exact exit signal.

## Changes

- **More realistic process watchdog:** Kane's `--timeout` remains 120 seconds for each browser check, while the *outer process limit* now permits at least five minutes for browser startup, session closing and evidence upload. CLI exit status and terminal `run_end` still must both indicate success.
- **Honest classification:** A `run_end: passed` followed by a killed, timed-out or nonzero-exit process remains `INFRASTRUCTURE_ERROR`; the result explicitly explains why the report does not count as verified. True `run_end: failed` outcomes still invoke the code-repair path.
- **One infrastructure retry:** For an interrupted check with evidence of a timeout or `run_end: passed` and abnormal process exit, KaneGuard retries the **identical locked browser objective once** before stopping. Every attempt has its own NDJSON/stderr files. No Antigravity repair runs for infrastructure trouble. Missing executable and authentication failures do not trigger futile retries.
- **One meaningful loop UI:** The central dashboard shows the agent plan, each task's coding status, the Kane checks that gate the next task, repair evidence if an assertion fails, and final verification. All names are derived from saved Antigravity tasks and Kane objectives. Each task links its coding handoff, agent transcript, source diff, Kane evidence, and Kane transcript.
- **No duplicate plan / transcript stream:** Removed the prominent live terminal stream and repeated generated-plan/check listing. Detailed agent output remains available through the Raw artifacts tab; full terminal log is linked as evidence. Task rows are rendered only when their meaningful data changes. The optional Plan view contains collapsible task/check detail, rather than another live milestone status list.
- **Existing runs stay accessible:** The old stopped run can still be selected. If it contains saved plan and source changes, click **Retry verification of saved code** to create a fresh verification run without repeating planning and coding. Historical evidence is never altered.

## Installation in existing WSL workspace

Stop the server first, preserve the workspace and copy the update ZIP into your Windows D:\\kanecli directory.

```sh
cd ~/hackathons/kaneguard/kaneguard
cp -a public/cartlab "../cartlab-backup-$(date +%Y%m%d-%H%M%S)"
unzip -o /mnt/d/kanecli/KaneGuard-Loop-Evidence-v12-update.zip
npm test
npm start
```

Refresh `http://127.0.0.1:4173/control/` with Ctrl+Shift+R. The update touches only orchestration, dashboard code, automated tests, and docs. It does not overwrite agent-generated CartLab/CoinPulse files or saved runs.

## Verification limits

Automated tests, including an isolated CLI test-double integration path, validate timeout policy, retry behavior, phase ordering, rendering and proof links. They do **not** substitute for executing the user's authenticated Antigravity and Kane CLIs under WSL. The graphical Chromium screenshot was unavailable in this container; verify layout on your machine.

---

<!-- from V17-UI-UPDATE.md -->
# KaneGuard v17 — Compact Split Studio UI

## What changed

The previous long landing page and stacked workbench have been replaced with a single, viewport-height split studio inspired by a minimal editor layout:

- Fixed top bar; main application fills the remaining screen without page scrolling.
- Left: compact project prompt, four real coding agent selections (Cursor, Antigravity, Claude Code and Codex), and useful one-click starter ideas.
- Right: persistent, large app preview with address strip, refresh action and a real link to open the app.
- During builds, left panel switches to three internal tabs: Activity (task and evidence links), Kane checks (browser results), and Live logs (real streamed events).
- Projects list appears in the left panel, rather than navigating to a giant separate page.
- On narrow screens, the left and preview sections stack and each stays within the visible viewport.
- No pretend editor, save, publish, or deployment controls.

## What was not changed

No changes to engine tasks, coding adapters, real Kane verification, app generation, authentication requirements, saved run records, sample apps, or locally generated applications. Public cloud deployment is not implemented; generated apps still have local preview URLs.

## Install

Stop your server, copy this ZIP to D:\\kanecli, then in WSL:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-Split-Studio-v17-update.zip
npm test
npm start
```

Hard-refresh `http://127.0.0.1:4173/control/` (Ctrl+Shift+R).

## Testing

- Node.js automated suite: 73/73 tests passed (includes viewport / UI ID integrity tests).
- HTTP smoke test: control HTML, CSS, JavaScript, health, agent, projects and runs API returned success.
- A local screenshot through headless Chromium did not finish in the remote environment; don't claim the UI was visually verified in a real browser.
- Vendor CLI credentials and authenticated end-to-end Kane browser checks are not available in this remote environment; they remain to be verified on the user's WSL setup.

---

<!-- from V18-LIVE-PREVIEW-AND-VERIFICATION-HISTORY.md -->
# KaneGuard v18 — Live preview updates + permanent Kane attempt history

## What was wrong

The previous studio reloaded the iframe only when an agent task reached a terminal status. An agent could write `index.html`, `style.css` or `app.js` while coding, but the main live preview would stay on an old revision for minutes. Also, task cards displayed only the latest Kane result for each acceptance check. When a failed check was repaired and then passed, the earlier FAIL and detailed root cause disappeared from the task card, despite the original evidence still being saved on disk.

## What changed

- **Continuous local preview:** The studio polls a read-only source-version API every ~1.6 seconds while a generated app is selected. The API computes a SHA-256-derived version from actual eligible project files. A changed version reloads the isolated iframe, including mid-task edits. Unchanged files do not reload the preview on every status poll. The refresh control still works manually. The server refuses unregistered or invalid project IDs and does not follow symlinks.
- **Evidence remains visible:** Every Kane invocation, including initial failures and recovery attempts, appears in an expandable verification journey with the full recorded reason and its original Kane transcript. Where the run saved an agent diagnosis and repair, those become distinct stages with diagnosis transcript, patch and repair transcript links. `FAIL → agent diagnosis → agent repair → independent Kane PASS` stays visible even after the task becomes “Kane verified”.
- **Historical runs:** Existing v17 saved run records are compatible. New Kane results also include explicit start/end timestamps for clearer timings. Earlier records use saved timeline events when a timestamp is available.
- **Clearer live status:** The current action distinguishes investigating, repairing, and retesting. “Kane checks” no longer drops older invocations after the twelfth row. Original failed evidence is never overwritten by a later verdict.

## Evidence integrity

A coding agent success or diagnosis does **not** count as a Kane PASS. The original, immutable `run.verification` result objects and NDJSON transcripts are not deleted or rewritten. The dashboard reads those saved artifacts and shows the latest verdict alongside earlier failures. Reused PASSes remain explicitly labeled as earlier authentic evidence on identical source, not a new browser execution.

## Install (on top of v17)

Copy `KaneGuard-Live-Preview-History-v18-update.zip` into `D:\kanecli`, stop the running server, and run:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-Live-Preview-History-v18-update.zip
npm test
npm start
```

Hard-refresh `http://127.0.0.1:4173/control/` and open the saved Coffee Shop build to inspect its Task 2 history. This update doesn't contain or overwrite the current project sources or `runs` data.

## Checks

- Local automated tests cover unchanged and edited source fingerprints, initial failure/diagnosis/repair/success journeys, preserved transcript links, historical and reused evidence, and studio wiring.
- HTTP smoke checks cover `/api/projects/<id>/source-version` changing immediately after a source edit, and serving the studio and history module.
- Authenticated production Kane/Cursor/Claude/Codex/Antigravity browser runs are **not** performed here; the user should verify the upgraded interface in their WSL environment.

---

<!-- from V20-SUBMISSION-CLEANUP.md -->
# v20 — Submission cleanup

## What changed

- Project deletion: DELETE `/api/projects/:id` removes **only a generated** project folder, its config, and every associated run/evidence directory. The Studio requires a destructive-action confirmation. Built-in apps are protected.
- Build-history deletion: DELETE `/api/runs/:id` deletes a saved run plus evidence but leaves the app source intact. The Studio requires confirmation.
- Deletes return HTTP 409 while a workflow is active. No delete happens behind a running coding agent or Kane check.
- Server-restart recovery: after the server successfully owns the listening port, unfinished saved `running` records are marked `interrupted`, not failed/passed. Their authentic source changes, run IDs, Kane results, transcripts, and historical evidence remain unchanged. This prevents the UI from showing yesterday's build as if its agent were still coding.
- Updated compact Projects UI with Delete project and per-run trash actions.
- Rewritten judge-facing README and `bash scripts/start.sh` one-command launcher. Includes four supported coding-agent installation references and evidence handling.
- Added `docs/DEMO-VIDEO.md` and `docs/VOICEOVER.md` with a truthful ~3-minute AI voiceover plan.
- New automated tests cover orphan recovery, full generated-project deletion, one-run deletion, endpoint behavior and protected built-in app rejection.

## Validation

Run `npm test`. All new integration tests are **test fixtures**, not claims of an authenticated Kane browser run. The project deletion endpoint was also exercised over HTTP against a temporary server and test project. Real WSL system uses separate authentication to the selected provider CLIs and Kane CLI.

## Install over v19

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-Submission-Cleanup-v20-update.zip
npm test
bash scripts/start.sh
```

Copy the patch ZIP to `D:\\kanecli` before running the commands. The patch does not include or delete any user's generated application folders or saved evidence. Deletion is only performed after the user explicitly presses a destructive action in Studio.

---

<!-- from V21-LIVE-REPAIR-UI.md -->
# KaneGuard v21 — Live repair status and clear verification journey

This update keeps the existing v20 engine and submission cleanup and fixes the real-time workbench display observed during TaskFlow's second task.

## What changed

- Persist the `repairing` stage **before** launching a long-running coding-agent repair. Previously, the run could remain saved as `diagnosing` until the repair finished.
- Show `Agent coding task`, `Agent investigating Kane failure`, `Agent coding repair`, and `Kane retesting after repair` directly inside the relevant task card. The current engine stage overrides a stale milestone label such as `Kane testing`.
- Show explicitly pending diagnosis, repair, and retest steps under the saved failed Kane check. A saved FAIL remains FAIL until an independent, authentic new Kane PASS is recorded.
- Refresh the selected run from its existing run-details API after new SSE log lines, with a 350ms debounce. The existing 1.6s polling and project source-based iframe live reload remain as fallbacks.
- Avoid duplicate single-attempt transcript links and render journey entries as clear accessible list items without phantom numbered markers.
- Preserve historical failure, diagnosis, repair, and pass records after refreshing the page.

## Install

Requires KaneGuard v19 or later. This update ZIP also includes the v20 submission-cleanup files for users upgrading straight from v19. Stop the local server, overlay the ZIP at the KaneGuard repository root, and run:

```bash
npm test
npm start
```

Reload `http://127.0.0.1:4173/control/` with a hard refresh. The patch does not contain existing generated projects or run evidence.

## Verification

91/91 automated tests passed, including new TaskFlow-inspired state tests and the existing simulated end-to-end Kane/agent workflow. Local HTTP routes for the updated UI and APIs responded successfully. A Chromium visual snapshot timed out in this environment; this does not establish browser-visual validation on the user's WSL instance. No new authenticated Kane CLI session was run by the patch build.

---

<!-- from V19-KANE-CAPABILITY-AWARE-VERIFICATION.md -->
# KaneGuard v19 — Capability-aware Kane browser verification

## Why this update exists

On 2026-11-17, the FitPulse agent generated three real Kane browser objectives. The first two passed; the third required the desktop browser window to be resized to 375 px during the test. Kane twice returned `run_end: failed` because its automation tools could not change the viewport. Antigravity correctly found no application defect, and KaneGuard correctly kept the overall verdict `verification_inconclusive`, but it wasted an additional browser run on an impossible action.

Kane CLI documents a desktop Chrome window configuration with minimum width 800 px. Setting that config to 375 px is **not** a supported fix. This patch does not claim any mobile behavior is verified without a real browser/device that can test it.

## What changed

- Planning prompt explicitly tells every supported coding agent (Cursor, Antigravity, Claude Code, Codex) not to author in-run viewport resize/device-emulation objectives for the current desktop Kane runner. Responsive layout implementation requirements remain intact.
- Validated plans containing such steps are rejected **before coding**. The same selected agent gets one bounded revision turn to correct its own browser objective, and both the original and revised plans/prompts/transcripts are saved. KaneGuard refuses a correction that drops or alters implementation tasks, task dependencies, or check IDs.
- If an old plan somehow reaches Kane with a viewport-resize objective, KaneGuard preserves Kane's **real failed** result and checks whether the failure reason explicitly identifies missing browser automation capability. If so, the run ends `verification_inconclusive` immediately, without performing an identical retry or asking the coding agent to repair working code.
- A functional layout failure, such as real horizontal overflow, remains an application test failure and is eligible for diagnosis/repair. No failure is marked PASS without an authentic Kane `run_end:passed` and successful process exit.
- The activity panel labels that task **Verification incomplete** (rather than merely Blocked). The verification history shows the original Kane FAIL, its reason, browser-capability annotation, and evidence links.

## Testing

- Five new tests in `tests/browser-capability-v19.test.mjs`: planner guard; agent-owned bounded correction preserving tasks; rejection of a correction that drops responsive work; differentiating missing capability from real app defects; an isolated test-double integration of task gates and a single unsupported Kane failure.
- Full `npm test` suite verifies existing task gates, genuine evidence requirements, repair paths, and UI behavior.

**Limitations**: This does NOT add browser device emulation or independent 375 px testing. Mobile responsiveness is still a source implementation requirement but cannot be claimed verified by Kane until a suitable browser/device runner becomes available. Existing FitPulse run `20261117093708-ubikq` remains inconclusive; this update does not retroactively change evidence or verdict. New runs receive the planning guard.

Installation from Windows D:\\kanecli, after stopping the existing server:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-Capability-Aware-Kane-v19-update.zip
npm test
npm start
```

---

<!-- from V22-CONNECT-EXISTING-APP.md -->
# v22 — Connect Existing App

The 100vh studio now supports **New app** and **Existing app**, keeping the four coding-agent choices in both.

- Inspect a project path under WSL home; detect its package manifest, npm start script, and common framework.
- Confirm the local folder and script before attaching. Reusing an already-running loopback preview is supported.
- Launch a Next.js or Vite dev server with local-only binding and an assigned port; other npm UI scripts use PORT/HOST. Restart an explicitly connected preview after a KaneGuard server restart.
- Reuse the existing multi-task agent → Kane → diagnosis/repair/retest workflow on the connected project's actual source, not a generated app placeholder.
- Track and diff bounded JSX/TSX/Vue/Svelte/Astro, JS, HTML, CSS, and SVG sources; block protected config/test/hidden paths within the source snapshot; keep evidence separate.
- Preserve and reload the connected project's preview when tracked files change. Embedded previews depend on each framework's iframe policy.
- Disconnect never deletes the original source or historical Kane evidence. Deleting a generated KaneGuard playground remains a separate, destructive action.

## Install over v21

Stop the local server, extract the update into your KaneGuard project, run `npm test`, then `npm start`.

## Limits

This connector is for local Node-based browser UI projects, **not arbitrary running services, remote Git repositories or cloud deployments**. An npm script can execute user-defined code; approve only trusted projects and back up existing source before modification. Existing app source is not fully isolated from the selected coding CLI. The automated end-to-end test uses controlled agent and Kane output, not real authenticated browser evidence.

---

<!-- from V24-ASSURANCE-AND-JUDGE-REPLAY.md -->
# v24 — Requirement Assurance & Judge Replay

Overlay on v23. No generated projects, run folders or Kane evidence are replaced.

## Included

1. Installed-agent default selection: first available agent from `/api/agents`; unavailable agents disabled; banner for missing Kane CLI or all agents.
2. Objective seals: per-check SHA-256 stored in `objective-seal.json`, checked before every generated Kane run/retry/reuse, visibly marked `Objective unchanged ✔` in evidence history.
3. Independent examiner: optional second agent selection when >=2 CLIs are present; writes the plan/checks; builder performs implementation.
4. Blind builder: optional, hides detailed original Kane objectives from task handoff; retains check names; does not block failure evidence used for repairs.
5. Experimental clone negative control: opt-in, only generated apps, one objective, clean-clone baseline PASS required before examiner mutation and Kane negative retest; original protected and clone deleted; no fabricated results.
6. Requirement Assurance Matrix: first-class user requirements mapped to task/check IDs. Missing or unverified clauses remain unproven or unmapped, never inferred from successful coding. Legacy plans show coverage gaps.
7. Trust Receipt: `/api/runs/<run-id>/receipt` — safe HTML showing original request, tasks, check results, hashes, failure history, evidence and clone status.
8. Judge replay: `/api/runs/<run-id>/replay`; `node scripts/export-replay.mjs <run-id> ./judge-replay` generates offline `index.html`, `receipt.html`, `record.json` and redacted evidence.

## Testing

`npm test` runs existing genuine-workflow integration tests against controlled CLI doubles and new assurance tests. No authenticated Kane run was conducted in this build environment. Check v24 on your WSL installation before publishing its claims; especially test dual-agent planning and experimental clone mutation with real CLIs.

## Safety / caveats

- KaneGuard still invokes Kane via `kane-cli run` for all browser checks. This release adds provenance and requirement coverage **without claiming extra Kane CLI modes**.
- A user requirement with no feasible browser check stays *unmapped/unproven* even after all planned checks PASS (e.g., mobile-width layout).
- All negative-control evidence is a separate clone experiment. It never upgrades or downgrades genuine original-app PASS status.
- With older v23 runs, existing evidence is retained but objective seals/requirement maps are not forged retroactively.
- Offline replay bundles should be manually inspected for private data before public release; credentials are not required to view the saved evidence.

---

<!-- from V23-CONNECTED-AGENT-TIMEOUT-AND-SCOPE.md -->
# KaneGuard v23 — Connected-agent scope and time-limit clarity

This is an incremental patch on top of v22. Existing app source folders, generated projects, run records, and Kane browser evidence are **not** included or modified by the update.

## What changed

- The coding-agent planning instruction now keeps short requests scoped to the existing component. For example, “improve the navbar” does not authorize inventing new login features, credentials, or unrelated product functionality.
- Connected framework projects now receive 12 minutes per coding task by default; generated static playground apps still receive 8 minutes. Operators can override either via `KANEGUARD_TASK_TIMEOUT_MS`, clamped to 30 seconds–20 minutes.
- When a coding task times out without any permitted application source edits, the saved verdict explicitly states that Kane did **not** run. It distinguishes this from a timeout with actual source changes, which can still reach Kane as an unverified candidate.
- The original request, agent-created plan, stdout/stderr and source diff remain stored as evidence. No fake PASS or silent repair.

## WSL install

Stop KaneGuard and unzip `KaneGuard-Connected-Agent-Fix-v23-update.zip` into the KaneGuard root. Then run:

```bash
npm test
npm start
```

For an operator-controlled maximum (e.g. ten minutes), set `KANEGUARD_TASK_TIMEOUT_MS=600000 npm start`.

## What the attached log demonstrated

Run `20261117133613-me5ty` used Antigravity for the attached `novo` project, requested “improve the navbar,” and stopped after 8 minutes during the first coding task. The planner had broadened scope to unrelated authentication steps. No Kane check started, and the run's `AGENT_ERROR` was appropriate, though the timeout message was ambiguous.

Installing v23 does not change that historical run's verdict. Use a **new** feature run on the same connected app after checking any partial edits in the original source directory.

## Validation

95/95 local automated tests passed (93 prior + 2 new). The tests validate planner guardrails and adapter time-limit settings. They do not prove authenticated Antigravity or Kane execution on your WSL machine.

---

<!-- from V25-LIQUID-STUDIO-AND-VERIFICATION-STATE.md -->
# KaneGuard v25 — Resizable liquid Studio and accurate shared Kane check labels

- A shared acceptance check is displayed in every owning task card, using the real run `currentFlowId` and persisted Kane attempts. This is important when Task 1's browser check cannot run until Task 2's feature exists.
- Task states distinguish waiting for another implementation, Kane actively executing a shared check, real PASS saved and task verification finalized. A coding agent's success or synthetic placeholder never becomes a Kane PASS.
- Saved evidence links in both task cards show the real Kane transcript for a shared check, regardless of which task owned the execution gate. FAIL and repair history remains accessible.
- Drag the separator between the left details panel and live preview to resize the workbench. Keyboard focus: left/right arrows change width by 20px (Shift by 60), Home/End pick minimum/maximum, double-click resets the split. The size is saved as a browser-local preference.
- The header Details / Split / Preview controls maximize either pane without permanently hiding the restore controls. Responsive layouts use available width; requirement cards and task checks flow into columns on wide panels. Mobile remains stacked and unaffected.
- This patch modifies only Studio UI, styles, a pure UI status helper, and tests. It does not alter saved runs, generated apps, Kane commands, verification semantics, or evidence.

Install over v24 using `unzip -o` and then run `npm test && npm start`.

---

<!-- from V26-CREATE-AND-PROJECTS-UX.md -->
# KaneGuard v26 — Create and Projects UX polish

Incremental overlay on v25. No changes to build orchestration, Kane verification, saved projects, or run evidence.

## Changes

- The Create view is **one vertical scroll container**. The ideas, prompt, agent choices, optional verification settings, and submit area no longer compete for fixed-height columns. The submit actions sit at the bottom of the available space and remain sticky as the form scrolls.
- Both Create New App and Connect Existing App hide independent-examiner and blind-builder settings in **Advanced verification (optional)**, closed by default. The generated-app-only negative control remains inside this optional group. All existing form control IDs and server payloads are unchanged.
- At viewport heights up to 940px, all four idea suggestions appear in one compact chip row. The redundant Plan → Code → Kane test → Preview line is hidden there.
- Trust Receipt and Replay saved run links are compact outlined actions with bundled icons.
- The progress bar changes to green **only when the saved run status is `passed`**. No Kane verdict calculation changes.
- The header health indicator checks `/api/health` independently of `/api/runs` and `/api/projects`. When health is reachable but run data fails, it says **Engine online · data unavailable**, instead of incorrectly saying Engine offline.
- Connected project paths are shortened for presentation from `/home/<WSL username>/...` to `~/...`. This affects display only; on-disk project locations and permission boundaries stay unchanged.
- The Projects preview highlights the latest **saved PASS** run with a Watch the journey button that opens its real run. If there are no saved passing runs, the previous empty guidance remains. No synthetic run is ever generated by the feature.

## Validation

- `npm test`: 112/112 passing on the v26 workspace, including 5 new regression tests.
- Browser-rendered static CSS snapshots were inspected at 1440×900, 1280×768, 990×900 and 390×800. All four idea chips fit at the default 358px pane width, and the Create view remains vertically scrollable when Advanced settings are expanded.
- The client-side Projects/featured-run/health interactions were smoke-tested in Chromium with **explicitly mocked browser fixture API data**. This is a UI test only, not genuine Kane evidence.
- KaneGuard server `/api/health` responded with HTTP 200 in this environment. The browser here blocks navigating directly to local addresses, so we could not perform an end-to-end browser navigation against the live local server.

## Install

Stop KaneGuard, extract this ZIP over the existing v25 project folder and restart:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-Create-Projects-UX-v26-update.zip
npm test
npm start
```

Hard refresh `http://127.0.0.1:4173/control/`. Verify that all four idea chips show and that the featured run points at an actual saved PASS in your own WSL data.

---

<!-- from V27-AUTOMATIC-LOCAL-PROJECT-PATHS.md -->
# v27 — Automatic local project-folder paths

This is an incremental update over KaneGuard v26. It **does not replace or remove** project configs, generated apps, connected app files, run records, or Kane evidence.

## User experience

The existing-project form now has one label, **Existing app folder**, and the neutral prompt **Paste a project folder path**. No OS selector or OS-specific instructions appear in Studio. The chosen folder and planned npm command are still shown for approval before any coding agent edits the source.

The server accepts local folder paths in formats appropriate to its host:

- Linux/WSL: `/home/user/projects/app`, `~/projects/app`, `/mnt/d/projects/app`.
- A Windows drive path copied into a WSL-hosted Studio, e.g. `D:\\projects\\app` or `D:/projects/app`, resolves to the mounted drive (`/mnt/d/projects/app`) when available. Repeated separators are normalized with Windows drive-root rules.
- macOS: `/Users/user/projects/app` and `~/projects/app` work when KaneGuard runs on a Mac that can access them.
- A Windows-native KaneGuard process can recognize `C:\\...` and `D:/...` via the host filesystem; common `/mnt/d/...` mounted-drive notation is converted to `D:\\...`.
- A path copied as a local `file://` URL is accepted. A `\\wsl.localhost\\<distro>\\...` path is recognized in the matching running WSL distro.
- Surrounding copy/paste quotation marks are accepted.

**Boundaries:** KaneGuard cannot access an unmounted drive or folders on another computer merely by recognizing the string. The path must exist and be readable by the server host. Only an existing npm-driven frontend app with a valid `package.json` and a `dev` or `start` script is attachable. Successful CLI execution still depends on the coding-agent and Kane executables being installed and working on that host.

## Safety

Canonical `realpath` is checked before connecting. The change removes the old *home-directory-only* limitation but preserves protection against attaching the KaneGuard code tree, its ancestors, home/disk roots, known system directories, secret and dependency directories. Symlink aliases resolve to their real destination before checks.

Connected apps are **edited in place** only after explicit approval. Disconnect never deletes the original source. Tests use temporary fake projects; they do not run or fake real Kane passes.

## Test coverage

The new `cross-platform-project-paths-v27.test.mjs` tests:

1. Native Linux, macOS-style and Windows drive paths, including quoted input, WSL UNC and file URLs.
2. A real connection to a mounted-drive-style fixture outside the home directory, canonical config persistence, and non-destructive disconnect.
3. Rejection of roots, KaneGuard ancestors, secret/dependency folders and symlink aliases.
4. Neutral frontend text and shortened path presentation.

The prior connected-project suite continues to test the development-server preview and the two-task controlled CLI verification path.

---

<!-- from V29-AUTOMATIC-CINEMATIC-REPLAY.md -->
# KaneGuard v29 — Automatic Cinematic Replay

Incremental overlay on **v28**. **No source apps, original runs, or genuine Kane evidence are replaced by this update.**

## User experience

- In **Projects**, click a saved project or **Watch replay** to view **that project's own latest run** in the right-hand panel. In Recent Runs, select any prior run to view its own historical replay. No sample apps or prompt suggestion chips appear in Studio.
- A clean judge clone with a reviewed and explicitly committed replay bundle (even without the original `runs/` directory or generated project config) lists the archived project and plays its saved journey. It cannot restart agents or pretend to provide a runnable original app.
- **App / Replay** preview toggles switch between the actual app and saved evidence, preserving the left-panel build information. The same preview divider and maximize controls still work.
- **Cinematic Replay** provides Play/Pause, previous/next, seek bar, 0.5×/1×/2× speed, chapter navigation, original request, recorded requirement coverage, all saved Kane results, and direct evidence links.
- Playback is **read-only**. It never launches a coding agent or Kane, never synthesizes a browser run, never erases a historical failure, and never awards verification status.
- The existing Trust Receipt remains available next to the replay.

## Automatic export and backfill

- `engine/storage.mjs` persists an immutable run snapshot and then exports the replay to `judge-replays/<run-id>/` with the associated local evidence. No script needs to be run by users.
- On server startup, interrupted runs are reconciled without fabricating a PASS and `backfillSavedReplays()` regenerates offline bundles for **all valid older run records**, not just the most recent 60.
- `judge-replays/<run-id>/index.html`: interactive offline replay.
- `judge-replays/<run-id>/receipt.html`: assurance matrix, objective fingerprints, recorded transcripts.
- `judge-replays/<run-id>/record.json`: redacted run snapshot.
- `judge-replays/<run-id>/evidence/`: plain-text, redacted saved evidence when available.
- `judge-replays/<run-id>/manifest.json`: included/omitted evidence plus archive status and privacy reminder. Individual evidence files above 6 MB or total evidence above 60 MB are skipped with an explicit manifest entry; the original run directory is unchanged.
- Deleting a run or deleting a generated project removes its corresponding replay archive as well, including when only the archived record remains. Disconnecting an existing app **does not** delete original code or saved run evidence.

## Privacy and safety

- `judge-replays/*` is Git-ignored deliberately: automatically exporting private prompts, code paths and logs is **not** permission to publish them. Review and sanitize before explicitly staging a bundle for judges.
- Text and replay data are escaped before insertion into HTML. Only known filenames are linked; source symlinks are not followed. Archives are written under the validated run ID only. Replay rendering does not grant a browser PASS.
- Replaying a **running** workflow shows an explicitly labeled saved snapshot; use Refresh in the Studio to see newer saved events. Refreshes do not reset the player's position during routine project-list polling.

## Install

Stop KaneGuard, unzip the incremental v29 update over your existing v28 project root, and restart:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-Automatic-Cinematic-Replay-v29-update.zip
npm test
npm start
```

Hard refresh `http://127.0.0.1:4173/control/`, open **Projects**, and select a project with a saved run. The initial startup backfill writes archives inside `judge-replays/`.

## Validation

- `npm test`: 123/123 passed on reconstructed v28 + v29 source. Includes offline archive updates, backfill, deletion cleanup, preserving failed attempts, injection escaping, project selector wiring, and HTTP route/CSP/clean-clone archive-only verification using **test fixtures**.
- Browser: Chromium/Playwright executed the standalone cinematic page with a **test fixture**, successfully rendering its chapters and exercising Next and Play/Pause. The container prohibits direct file/localhost browser navigation, so a full authenticated WSL browser workflow was **not** performed here.
- A genuine Kane CLI run must be performed on the user's machine before asserting that a newly produced submission replay contains authentic Kane verification evidence.

---

<!-- from V30-WORKFLOW-WATERFALL.md -->
# v30 — Workflow Waterfall (replaces Cinematic Replay)

## Why
The v29 cinematic view was a slideshow, not an authentic visual recreation of a coding session.
The simpler waterfall gives a clear record of the actual stages without presenting a saved list as a video.

## UI
- Projects → choose any saved project or run → **Workflow** in right pane.
- Switch **App** / **Workflow**; use panel maximization and drag resizing as before.
- Workflow displays a cascading, chronological read-only timeline of plan, code, Kane test, diagnosis, repair, retest, and final outcome.
- Kane results retain both FAIL and later PASS, with their exact transcripts linked. Unknown/active verdicts are never changed to PASS.
- Trust Receipt, objective hashes, requirement assurance and ordinary build evidence are preserved.

## Server
- `/api/runs/:id/workflow`: read-only HTML built from saved `record.json` and evidence metadata; no JavaScript/playback/agents/Kane.
- `/api/projects/:id/workflow`: redirect to newest saved run for that project.
- The old `/replay` UI routes are retired.
- Stopped `queueReplayExport` during `persist`, and stopped `backfillSavedReplays` on startup; saved `runs/` records remain unchanged.
- Existing `judge-replays/` content is NOT silently removed (it may be the only archived copy). Legacy archive read fallback and optional manual exporter are left for compatibility. No new archive is produced by normal workflows.
- The waterfall HTML is escaped, includes a restrictive CSP, and handles historical run records.

## Installing
Apply `KaneGuard-Workflow-Waterfall-v30-update.zip` over v29, stop the server first, then `npm test && npm start`, and hard refresh `/control/`.

## Test validation
Unit and HTTP integration cover historical failures, repairs, no invented passes, HTML injection, project deep links, removed replay route, no startup archive export, and retained evidence. Tests use controlled fixtures rather than authenticated Kane verification.

---

<!-- from V31-AGENT-TRUST-GATEWAY.md -->
# KaneGuard v31 — Agent Trust Gateway (first implementation)

**Base:** The user's full `KaneGuard-Full-Backup-20261122-063532.zip`, which includes v30 workflow waterfall, generated and connected apps, run records and archived replay artifacts. This ZIP overlay contains source/tests/docs only — **not** any user `runs/`, `public/app-*/` or existing `configs/` project data.

## What v31 actually adds

### 1. Independent, evidence-backed Test Court

When a different examiner CLI was explicitly selected, it plans the feature as before and **reviews a real failed Kane objective independently of the builder** before source-changing repair is allowed. The examiner sees read-only copies of the actual failed objective, run_end summary, bounded Kane trace and current application source. Its invocation runs from a separate temporary workspace instead of the app directory.

The examiner returns one of:

- `application_defect`: continue the existing builder-driven diagnosis and bounded repair. Only a later genuine Kane PASS establishes success.
- `test_defect`: save a **dispute** containing original objective/hash, observed failed proof, supporting explanation, and (optionally) a new **unapproved** objective/hash. The run stops as `verification_inconclusive` without changing the original check or code.
- `uncertain` (including low-confidence findings): similarly stop as inconclusive and retain all proof.

The Studio shows examiner reviews and disputes under the requirement matrix. For finished runs, a developer can **Approve candidate** or **Reject proposal**, with a reason. Approval means *approval for future consideration only*: it **does not run the proposed objective, remove the original FAIL, edit the sealed objective or change the run's verdict**. The Trust Receipt and waterfall retain the review history.

**Important limits:** This is not an objective third-party courtroom. The examiner was also the planner and may be biased toward its own authored test; classification is an agent opinion and must not override Kane evidence. With one selected agent the older bounded diagnosis path is preserved. A fully governed approval → new locked objective → fresh Kane run workflow is a later step.

### 2. Regression proofs persisted across successful builds

A v31 build that passes its final suite stores only actually Kane-verified feature objectives, with their SHA-256, origin run, and tested source fingerprint, under:

`regression-baselines/<project-id>.json`

For the **next build of the same project**, KaneGuard loads these entries, validates hashes and app origin, and runs their saved browser objectives in the **final real Kane suite** alongside the new checks. A previously saved PASS is **not reused** for a new source revision. If any old behavior fails, the new build cannot pass. Checks are deduplicated and capped at 48 (overflow is explicitly recorded rather than silently declared covered).

Deleting an individual supporting run retires its unique stored baseline checks; deleting a generated project removes its own baseline. Disconnecting an existing project preserves its source and saved run history. This is a **local, project-scoped regression ledger**, not Kane-native requirement graph maintenance or semantic coverage. v30/older runs are not automatically promoted into baselines without a reliable current-source proof.

### 3. More than four browser checks when necessary

The planner now accepts **2–8** browser objectives (previously 2–4), with 2–5 task milestones, so a multi-behavior request is not mechanically capped at four checks. This does not guarantee semantic requirement coverage; agent-authored mappings are labeled accordingly.

### 4. Reviewable handoff for Kane's native assurance

Each run has a new **Kane source** download in Studio:

`GET /api/runs/<run-id>/assurance-source.md`

The Markdown contains the original developer request and any agent-suggested requirement links. It is explicitly marked **UNREVIEWED** and can be inspected before using Kane CLI's own `context ingest → extract → review → design tests → review → testmd/testrun → cover → maintain` lifecycle. KaneGuard does **not** automatically invoke or claim completion of those Kane-native assurance stages in v31. Those commands have their own approval and credit implications, so pretending our earlier `kane-cli run` evidence has full Kane-native coverage would be misleading.

Official documentation: https://www.testmuai.com/docs/kane-cli-assurance

## Real WSL check (required before a demo claim)

1. Install the overlay onto your v30 project and run `npm test`.
2. Run `npm start`, refresh the Studio. For a **generated** app, create one verifiable change and let Kane truly PASS. Confirm `regression-baselines/app-...json` was written.
3. Modify that *same app* through the Studio with another feature request, retaining old behavior. The final workflow must contain saved `reg-...` objective IDs executed as **new real Kane runs**, not reused passes.
4. Select two actually installed coding agents (for example, Antigravity builder + Cursor examiner) to exercise the independent-review path on a real, genuinely failing browser objective. Do not assume a bug is a bad test. Review the saved examiner transcript and original Kane evidence.
5. If a test is disputed, inspect the saved proposed test; approving it is a review record **only**. Do not say it passed until a separately executed, reviewed replacement exists.
6. Inspect Trust Receipt, Workflow, and Kane source download.

## Test coverage

New unit tests verify objective tamper detection, validated baseline persistence, deletion provenance, examiner classification and unapproved candidates, human review without false PASS, and review-required native assurance source.

New HTTP integration tests with **controlled agent/Kane CLI doubles** verify the separate-examiner/test-defect path, approved-but-unexecuted test candidates, original Kane failure preservation, and receipt/source endpoints.

Existing milestone integration tests now execute two sequential simulated builds in one isolated project and assert prior protected objectives are really re-run during the second build.

**No authenticated WSL or Kane cloud test was possible in this environment.** Treat those as unverified until exercised locally. Real run data from the full backup was not rewritten.

---

<!-- from V31.1-BUGBOARD-RECOVERY.md -->
# KaneGuard v31.1 — examiner validation, Kane browser-misstep retry, and saved BugBoard recovery

This is a **small overlay update** built against `KaneGuard-Full-Backup-20261123-175827.zip`. It does not replace the project or erase runs, saved app source, or configs.

## Changes

1. `engine/test-court.mjs`: An examiner finding of `uncertain` (including a low-confidence `test_defect`) is no longer rejected because an optional `proposedObjective` was supplied. Uncertain/application-defect suggestions are discarded, without changing the finding, original sealed objective, or failed Kane result. Candidate objectives for genuine, sufficiently confident `test_defect` findings remain strictly validated and human-approval-only. The examiner prompt now requests a candidate only for test defects.
2. `engine/kane.mjs`: Exposes a strict structured-verdict predicate. Only an actual failed Kane `run_end` with `verdict.family = automation_bug` and `verdict.category = agent_misstep` is eligible for the browser-misstep retry.
3. `engine/feature.mjs`: Rechecks the exact original sealed objective **once** after such a Kane browser-agent misstep, on unchanged application source, storing distinct browser evidence. A second such misstep returns `verification_inconclusive` and requests review, with no source repair and no fabricated PASS. An actual Kane PASS on retry can advance the gate. Infrastructure or unsupported-capability failures are not treated as application bugs. Other failures still follow the independent examiner path.
4. `engine/feature.mjs`: Stopped generated/connected apps (including the saved BugBoard app) can use existing saved-plan recovery, subject to app/config/source checks and original-origin validation. Resume re-verifies the saved plan and current source; it does **not** claim to re-run the interrupted implementation task.
5. Added/updated regression tests for uncertain examiner suggestions, structured Kane misstep identification, retry success/failure with fake CLI doubles, and generated-app resume/origin checking.

## Installation in WSL (after downloading update ZIP to D:\kanecli)

Stop KaneGuard first (Ctrl+C), then run:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-v31.1-BugBoard-Fix.zip
npm test
npm start
```

No `npm install` is needed solely for this patch. Do not unzip over a different project version; this overlay was built for the November 23 v31 backup.

## Recheck the actual saved BugBoard run

The archived run `20261123105459-1pce8` had Task 1 and Task 2 verified, Task 3 inconclusive, and Task 4 blocked. v31 originally refused resume for generated apps. With v31.1 installed and `npm start` running in one WSL terminal, open a **second WSL terminal** and use:

```bash
curl -fsS -X POST http://127.0.0.1:4173/api/runs/20261123105459-1pce8/resume
```

KaneGuard starts a **new run** using the *saved original plan*. Check the Studio or `/api/runs` for the new run ID, timeline and proof; the old record stays available. Recovery can proceed through all saved acceptance checks; since Task 4 was not implemented, a subsequent check may still fail or require repair. The code patch does not guarantee a PASS, require test rewriting, or substitute for actual Kane CLI and agent authentication.

## Verification of this patch

`npm test` against the supplied backup: **133 tests passed**, 0 failed. The integration tests use explicitly fake Kane and coding-agent binaries; no claim is made that authenticated Kane/Antigravity/Codex was executed in this environment.

## Safety

- The original Kane objective, its SHA-256 seal and failed evidence are preserved.
- Uncertain findings never trigger source repair merely because of a proposed test edit.
- Retry uses an unchanged objective and no code edits; two missteps stop INCONCLUSIVE.
- A real independent Kane browser PASS is the only basis for reporting an actually verified check.
- Existing run history and user-generated app files are not bundled with or overwritten by this overlay.

---

<!-- from V31.2-STATUS-AND-RECOVERY-NOTES.md -->
# KaneGuard v31.2 — evidence-correct statuses after saved-plan resume

## What this fixes

This is a presentation-only overlay for **v31.1**. It does not alter saved objectives, modify application source, rewrite past Kane verdicts, or change full-suite certification rules.

- Shows `3/5 Kane checks with recorded PASS` separately from `0/4 requirements fully certified` when a later objective fails. The exact numbers are derived from the current run; these are an example for saved BugBoard run `20261123170801-p9409`.
- A requirement with all mapped checks passed but an incomplete full suite shows `Kane checks passed · full suite incomplete`, not a generic `Unproven`.
- Task cards no longer show `Kane PASS recorded · updating` after the workflow has stopped.
- A non-shared in-progress check now says `Kane browser testing`, not `Kane testing shared check`.
- When no candidate replacement objective exists, the dispute UI says so instead of showing a disabled `Approve candidate` button.

The Trust Receipt's strict full-run certification remains unchanged: a failed or inconclusive suite is never marked PASS.

## Why BugBoard stopped

The resume endpoint re-runs the *saved five sealed Kane objectives* against current source; it does **not** re-run unfinished Antigravity code tasks. The old BugBoard plan's fourth check is logically inconsistent: from three initial Open issues, creating one issue and changing only that new issue to Resolved should yield Total 4 / Open 3 / Resolved 1. The check demands Total 4 / Open 2 / Resolved 2, which cannot follow from that action sequence. The fifth check (deletion) assumes a fresh state with three Open issues. Both checks need reproducible preconditions, and no old check should be silently altered or awarded a PASS.

The original backup's BugBoard app source had in-memory issues and no persistence code in `public/app-mwt5ft1z-c8400c7c/app.js`; resuming doesn't implement localStorage. The fifth check was queued and therefore unverified. Keep the old run and its evidence for audit purposes.

## Install overlay (WSL)

Stop KaneGuard (Ctrl+C) and copy `KaneGuard-v31.2-Status-Fix.zip` to `D:\kanecli`.

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-v31.2-Status-Fix.zip
node --test --test-concurrency=4 tests/*.test.mjs
npm start
```

Refresh the Control Center at `http://127.0.0.1:4173` (Ctrl+Shift+R). Historical records remain unchanged; only the UI presentation updates.

## Continue implementation (new build on the SAME BugBoard project)

A new *feature build* on the existing app is needed if you want Antigravity to actually implement the unfinished persistence/deletion requirement and independently generate new, correct verification objectives. **Do not create a new project and do not re-resume the mathematically invalid old plan.** With the server running, from a second WSL terminal:

```bash
curl -fsS -X POST http://127.0.0.1:4173/api/build \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "appId": "app-mwt5ft1z-c8400c7c",
  "agentId": "antigravity",
  "examinerAgentId": "codex",
  "prompt": "Continue the EXISTING BugBoard source without replacing the completed dashboard, issue creation, counters, filters, or search. Implement durable localStorage persistence for issue creation, status changes, and deletion; load persisted issues on refresh, and seed the original three Open issues only when no stored state exists. Ensure accessible per-issue Delete controls and updated counters. Design independent Kane browser objectives with explicit fresh-state preconditions and correct counters. From three Open issues, adding one and resolving it must show Total 4, Open 3, Resolved 1; deleting one of the original three from a fresh state must show Total 2, Open 2, Resolved 0. Verify both behaviors across a page reload. Do not rewrite existing evidence or pretend old failed tests passed."
}
JSON
```

This creates a NEW run on the SAME project, preserving historical evidence; a fresh agent-generated plan is sealed and tested. The `20261123170801-p9409` run remains `VERIFICATION_INCONCLUSIVE`. The new source still needs actual authenticated Kane/Antigravity execution; this overlay itself does not certify it.

## Automated checks

`node --test --test-concurrency=4 tests/*.test.mjs` passed against the Nov 23 backup with v31.1 and v31.2 overlays, using mocked external CLIs where appropriate. No live browser verification was performed here.

---

<!-- from V31.3-EXTENDED-CODING-TIMEOUT.md -->
# KaneGuard v31.3 — extended coding task timeout

This targeted overlay installs over v31.2 and keeps all existing runs and evidence intact.

## What changed

- `implementFeatureTask` now allows **30 minutes per coding task** by default for both new generated apps and connected projects (previously 8/12 minutes).
- Optional `KANEGUARD_TASK_TIMEOUT_MS` overrides the default and remains bounded to **30 seconds–60 minutes** (previous cap: 20 minutes). For example, 45 minutes = `2700000` milliseconds.
- The live workflow log prints the budget for each coding task before invoking the coding agent.
- Kane browser tests, examiner checks, source-edit protections, verdicts, evidence history, and repair attempt policies are unchanged.
- Tests verify defaults, override, maximum clamp, and fallback on malformed input.

## Installation from WSL

Place `KaneGuard-v31.3-Extended-Task-Timeout.zip` in `D:\kanecli` and stop the running server (Ctrl+C). Then:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-v31.3-Extended-Task-Timeout.zip
node --test --test-concurrency=4 tests/*.test.mjs
npm start
```

Optional: request a 45-minute task time limit instead:

```bash
KANEGUARD_TASK_TIMEOUT_MS=2700000 npm start
```

**Note:** An already interrupted run does not restart its failed coding task merely because the server timeout changed. Existing run `20261124030849-s53c8` preserved two authentic Kane passes but Task 3 ended with `AGENT_ERROR`. Resume in v31.2 is a **verification-only** operation; to implement the remaining deletion feature, start a narrowly scoped new feature build against the existing BugBoard app, rather than deleting/recreating the project.

---

<!-- from V31.4-INCREMENTAL-VERIFICATION.md -->
# KaneGuard v31.4 — Conservative Incremental Verification

Install this **overlay** on top of v31.3; it does not include the whole application, generated projects, credentials, or saved run history.

## Changes

1. **Earlier browser gates.** The independent planner is now explicitly instructed to produce the earliest possible task-owned, runnable Kane browser checks. Tasks requiring functionality that has not yet been built must wait; the engine does not fabricate test objectives or count JavaScript syntax as a browser PASS.
2. **Deferred-task evidence.** Each task milestone records `pendingChecks` and `deferredReason` when no browser check is ready. The UI shows a blocker rather than implying a task passed.
3. **Final-gate deduplication.** The engine stores authentic PASS evidence indexed by SHA-256 of the **exact natural-language objective** and the **complete editable application source fingerprint**. At the final gate, it can reuse an earlier real PASS only when both match and the source is rechecked immediately before reuse.
4. **Protected regressions remain protected.** If an existing protected regression is identical to a feature objective already executed against the current exact source, the final gate records a `reusedVerification` reference to that authentic transcript rather than a redundant second Kane CLI execution. Distinct objectives (or different source bytes) still run in Kane.
5. **UI transparency.** The final Workflow Waterfall distinguishes newly executed feature checks, reused feature passes, newly executed protected regressions, and reused protected regressions. Saved evidence lists the original transcript and clarifies that reuse is not a new browser run.

## Safety and known limitations

- This is deliberately **conservative**: a later change to any permitted application source file, including style files, requires re-verification of prior objectives. KaneGuard does **not** trust agent guesses about which files are irrelevant. It also never treats AI testimony, missing Kane results, a syntax pass, or an unapproved replacement objective as a browser PASS.
- The planner prompt requests early independent checks, but the agent may legitimately produce shared checks when a task cannot be observed in a browser on its own. Those tasks remain unverified until the shared check runs.
- The previous `run_end` PASS, original failure evidence, human-review rules, repair budget and objective seals are unchanged.
- This version does not yet add interrupted-agent source continuation, deterministic localStorage/browser state resets, Test Court approved-objective execution, CI/CD or native Kane assurance ingestion.
- Automated tests exercise mocked Kane/agent integrations, not your authenticated WSL Kane CLI account.

## Install in WSL

1. Copy `KaneGuard-v31.4-Incremental-Verification.zip` into `D:\kanecli`.
2. Stop KaneGuard (Ctrl+C), then run:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-v31.4-Incremental-Verification.zip
node --test --test-concurrency=2 tests/*.test.mjs
npm start
```

The patch is meant for **new** KaneGuard runs. Existing saved runs are not mutated or re-certified by installing it.

## Validation

The reconstructed Nov 23 backup with v31.1, v31.2, and v31.3 overlays passed **141 tests, 0 failed** using `node --test --test-concurrency=2 tests/*.test.mjs` in this environment. The changed full-pipeline integration test demonstrates that an identical protected regression is recorded as covered by a current-source Kane test-double PASS, without running the identical objective twice. Its separate source-change test confirms earlier proofs are invalidated by relevant source modifications.

---

<!-- from V31.5-TRUST-ATELIER-UI.md -->
# KaneGuard v31.5 — Trust Atelier (UI-only update)

This patch installs over the v31.4 Incremental Verification update. It preserves all run data, objectives, source and Kane evidence.

## What changed

- New **Atelier** view beside **App** and **Workflow** in Studio's preview toolbar. Existing App and Workflow modes remain available.
- Default to the Atelier evidence overview when opening an existing run's **Build details**. Creating a new app still opens its actual live preview as before.
- Four Renaissance geometry-inspired role symbols: Builder, Examiner, Kane, Gatekeeper. These are visual metaphors for existing responsibilities, **not synthetic AI actors**.
- Shows the configured builder/examiner name. The viewer explicitly flags when no distinct independent examiner is configured.
- Shows the live workflow phase, recorded check statuses, actual examiner finding (if any), real transcript links, and Trust Receipt.
- Strictly separates recorded check PASSes from fully certified mapped requirements. Inconclusive, interrupted, and failed runs never display an acceptance verdict.
- No character animation, no decorative simulated events, no remote fonts or illustration downloads. Responsive panel supports reduced motion.

## WSL install

Copy `KaneGuard-v31.5-Trust-Atelier-UI.zip` into `D:\kanecli`, stop KaneGuard, then:

```bash
cd ~/hackathons/kaneguard/kaneguard
unzip -o /mnt/d/kanecli/KaneGuard-v31.5-Trust-Atelier-UI.zip
node --test --test-concurrency=2 tests/*.test.mjs
npm start
```

Open `http://127.0.0.1:4173/control/`. From **Projects**, choose a saved run and select **Build details**, or select **Atelier** in the preview toolbar when working on a run.

## Honest limitations

- This is a presentation-layer release, not the planned interrupted-agent recovery or Kane-native requirements lifecycle.
- Saved review events drive the visible examiner findings; an absent reviewer is not silently called independent.
- Local automated tests use fixtures for the UI and existing mock integration suites. Authenticated Kane CLI is not run by this update; test it on your WSL machine with actual saved evidence.

## v32.19 — Stop button & requirements coverage

- **Stop run** button in the run panel and the Live loop header. It terminates the coding agent and Kane CLI (whole process group, including the browser Kane launched), refuses new agent/Kane processes, and saves the run as "Stopped by you". Files already changed and earlier Kane results are kept. `POST /api/stop` is local-page only.
- Kane gates are now fail-closed: only an explicit Kane PASS passes a gate; stopped or unrecognised verdicts never count as verified.
- "Assurance details" became **Requirements coverage**: each requirement, the Kane checks that cover it, and a plain status; SHA-256 seals explained as "Locked Kane checks".

## v32.21 — Continue a stopped run

- **Continue run** button on stopped (or agent-error) builds that already have a plan. Same plan, same locked Kane checks, no re-planning.
- Tasks Kane already verified are not rebuilt; they are labelled "Kept from stopped run" and their checks run again in the final suite before anything is shown as verified. A task that was coded but not yet tested goes straight to its Kane check; the rest are built by the agent.
- Stopped runs show STOPPED on project cards and run lists. The run panel no longer repeats the checks (requirements/locks panels removed; 🔒 on Live loop checks instead).

## v32.27 — Runs finish the whole build and tell the full story

- Every Kane FAIL goes to diagnosis (Codex diagnoses, Antigravity repairs), including ones the examiner calls a test defect.
- If the app is already correct, Kane re-runs the same locked check once.
- If Kane, the examiner and the diagnosis all agree the check itself is wrong, KaneGuard fixes the check once: re-sealed as v2, v1 FAILs kept, and only a real Kane PASS on v2 counts.
- A check that still can't be proven no longer stops the run. It is marked unproven with all its evidence, the remaining tasks are still built and Kane-tested, and the run ends with "Built all N tasks. Kane proved X/Y checks…". It is never reported as passed. Only Stop, an agent crash, a safety violation or Kane being unavailable end a run early.

## v32.28 — Submission build

- FAIL loop is consistent end to end: an examiner error still goes to diagnosis; a broken diagnosis is treated as "no fix found" (Kane re-runs the check once); a repair that changes nothing leaves the check unproven and the build carries on. Only Stop, an agent crash, a safety violation or Kane being unavailable end a run early.
- Honest pass labels: "PASS after repair" only when code was repaired, otherwise "PASS on retest" or "PASS on fixed test (v2)".
- Blind builder labelled experimental (off by default).
- `scripts/start.sh` prints the real Studio URL.
- README rewritten for judges: 30-second start, the loop, the CartLedger evidence, existing projects.

