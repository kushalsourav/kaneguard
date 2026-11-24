# KaneGuard — Build. Verify. Repair.

**Local-first app creation with independent Kane CLI browser verification.** Give KaneGuard one natural-language request, select a coding agent, and watch it create a working browser app through sequential, evidence-backed tasks. When Kane CLI reports a functional failure, KaneGuard passes the genuine browser evidence to the coding agent for diagnosis and bounded source repair, then reruns the same check. It never creates a fake PASS.

## What judges will see

- **Live loop** (default view during a build): the active loop stage (Plan → Build → Kane test → Diagnose → Repair → Verdict), the coding agent's file edits and commands, and every browser action Kane reports, streamed live.
- **Saved runs** open in the same Live loop: the agent's actual tool calls, Kane's reported browser steps (failing step highlighted), and a *Caught & fixed* strip (Kane FAIL → diagnosis → repair diff → retest).
- Full version history: [docs/CHANGELOG.md](docs/CHANGELOG.md).


Built for the **Kane CLI Online Hackathon, November 2026**.

## Run locally (judges and developers)

**Prerequisites:** Node.js **20+**; Linux/macOS or Windows with WSL2. For **real autonomous builds**, also install and authenticate [Kane CLI](https://www.testmuai.com/docs/kane-cli-installation), Google Chrome, and **at least one supported coding agent**.

From the repository root:

```bash
bash scripts/start.sh
```

Open **http://127.0.0.1:4173/control/**. Node's built-in APIs power the app: **no `npm install` is needed for KaneGuard itself**. Alternative: `npm start`. Run automated tests using `npm test` (these are unit/integration tests, **not** real browser results).

### Install the real CLI tools in the same WSL shell

```bash
# Independent browser verification (required)
npm install -g @testmuai/kane-cli
kane-cli login

# Agent option A: Cursor (install script from Cursor)
curl -fsSL https://cursor.com/install | bash
agent login

# Agent option B: Codex
npm install -g @openai/codex
codex

# Agent option C: Claude Code — follow its official native install guide
# https://code.claude.com/docs/en/setup
# Then run: claude

# Agent option D: Google Antigravity CLI — follow its official instructions
# https://antigravity.google/docs/cli/headless/
# Then run: agy
```

Select **whichever agent you installed** in the Studio. You do **not** need to install all four. Sign-in is interactive and managed by each vendor. For Cursor, Codex and Kane CLI, the install/auth commands above are documented by their respective vendors; always review remote shell installers before executing them. Run `npm run doctor` for a supplementary environment check. The Studio reports which agent binaries are detected, but binary detection does not prove authentication.

**Recording a demo?** Start with `KANEGUARD_KANE_HEADED=1 bash scripts/start.sh` so Kane drives a visible Chrome window instead of headless Chrome.

### What to do in the Studio

1. Enter a request, such as *“Build a todo app with adding, completion, filtering and localStorage.”*
2. Choose **Cursor, Antigravity, Claude Code, or Codex** and click **Create app**.
3. Follow the **Activity**, **Kane checks**, and **Live logs** panes. The local preview reloads when app source changes.
4. Expand **Verification journey** to see the original Kane failure, agent diagnosis, source repair and retest. All genuine failed attempts remain visible even if a later run passes.
5. In **Projects**, click a project to inspect its **Live loop** (agent actions, Kane browser steps, caught & fixed) directly in the right panel. Choose **Build details** for the live workbench. You can also delete **one run and its evidence** or delete a **generated project including every run, code file and config**. Deletion is irreversible and disabled during active workflows. Internal CartLab and CoinPulse regression fixtures are kept but no longer advertised as example apps in Studio.

**Restart behavior:** a build left with status `running` when the previous server stopped is shown as **Interrupted** on next startup. Previously saved Kane verdicts, source files and evidence remain intact; the interruption is not treated as a failed browser test or a PASS.

## How the closed loop works

```text
Prompt → Agent-authored plan and browser objectives
       → Task 1 code → Kane CLI browser verdict ──┐
       → Task 2 code → Kane CLI browser verdict    │
                                                  ├─ failure → agent diagnosis
                                                  │          → bounded source repair
                                                  │          → authentic Kane retest
                                                  └─ pass → next task
       → Final checks → saved verdict + full evidence history
```

- **Real browser gate:** Kane CLI is a separate executable. Each check records raw NDJSON, stderr and references to browser evidence; code completion and syntax checks alone cannot mark a task verified.
- **Four real adapters:** Cursor (`agent`/`cursor-agent`), Antigravity (`agy`), Claude Code (`claude`), Codex (`codex`). Each has its own CLI invocation and terminal-result validation.
- **Isolated local apps:** generated projects are served from `public/app-…/` and configured in `configs/app-….json`; preview links are local, not public deployments.
- **Truthful outcomes:** `passed`, `failed`, `interrupted`, `infrastructure_error`, and `verification_inconclusive` remain distinct. If Kane cannot perform a requested browser action (such as 375px viewport resizing in the desktop runner), mobile functionality is **not** claimed as verified.
- **Safety:** coding edits are scoped; user-created apps are limited to static client-side HTML/CSS/JS; evidence and core engine files are protected. This is a local development sandbox, **not** a secure multi-tenant hosting service. Do not expose the server to the public internet.

## Genuine example evidence

- **CoinPulse / Price Alerts:** real WSL logs reported the feature checks and protected regressions passed.
- **Coffee Shop / Featured Drinks:** Kane found category filtering left “All” selected. The agent diagnosed missing event handling and repaired source; KaneGuard preserved the first failure and the later verification journey.
- **FitPulse:** theme and pricing checks passed, but a 375px viewport check could not be executed by the available desktop browser runner. The correct overall outcome was `VERIFICATION_INCONCLUSIVE`, **not** a fabricated pass. This limitation motivated capability-aware v19.

Real run records live under `runs/` on the machine where the workflow executed; **they are not bundled in source releases**. Do not treat included test doubles as real browser evidence. The demonstration must show authentic evidence URLs/screenshots and identify any illustrative reconstruction.

## Repository map

```text
engine/            agent adapters, task planner, Kane CLI integration, repairs, safety
server/main.mjs    local web server, project and evidence APIs
public/control/    single-screen Studio interface and verification timeline
public/app-*/      generated client-side projects (local-only)
public/cartlab/    stable ecommerce example
public/coinpulse/  portfolio example
configs/           example and generated project settings
runs/              local logs and original browser evidence (Git-ignored)
judge-replays/     legacy offline bundles, if any (not automatically generated; Git-ignored)
scripts/start.sh   one-command launch, prerequisite diagnostics
tests/             automated unit + stubbed HTTP integration tests
```

## Demo and submission

See [`docs/DEMO-VIDEO.md`](docs/DEMO-VIDEO.md) for a ~3-minute narrated demo outline and exact evidence to show. For a publishable hackathon demo, use a recording of actual KaneGuard UI and genuine browser evidence. **Do not generate a fake successful Kane session or imply unverified code passed.**

**Maintenance:** `npm test` · `npm run doctor` · `npm start`. Stop the server with Ctrl+C. The server binds to `127.0.0.1` by default; project preview URLs assume the same local port. Auto-source-reload works on generated client-side project files.

## Official docs

- [Kane CLI installation](https://www.testmuai.com/docs/kane-cli-installation)
- [Kane CLI quickstart and login](https://www.testmuai.com/docs/kane-cli-quickstart)
- [Cursor CLI](https://prod.cursor.com/docs/cli/installation)
- [Codex CLI](https://github.com/openai/codex)
- [Claude Code setup](https://code.claude.com/docs/en/setup)

## Connect an existing web app (v22)

KaneGuard now has two entry points in **Create**: **New app** and **Existing app**.

For an existing local Next.js, Vite, React, Vue, Nuxt, Astro, or other npm-driven browser UI project:

1. Choose any local project folder accessible to the KaneGuard server, e.g. `~/projects/my-next-app`, `/Users/me/projects/my-next-app`, `C:\Users\me\projects\my-next-app`, or `/mnt/d/projects/my-next-app`. The project needs a valid `package.json` and `dev` or `start` script; its regular dependencies should already be installed.
2. In **Existing app**, paste its project folder path (the server automatically recognizes native paths, and Windows drive paths when those drives are mounted in WSL), a concrete change request (such as “Add product search and filters”), and one of the four installed coding agents.
3. Optionally enter a **running local preview URL** (e.g. `http://127.0.0.1:3000/`). Otherwise KaneGuard starts its existing npm dev/start script, bound to localhost on its own assigned port. KaneGuard does not run `npm install` or alter your npm scripts.
4. Review the detected path, framework, and startup command in the confirmation dialog. After approval, the selected coding agent works in the original project folder; Kane opens the real local app at its dev-server URL. Tasks, failed results, repairs, and transcripts appear in the same workbench.
5. **Disconnect** removes the KaneGuard connection and stops the preview process it started; the original app source is **never deleted** by disconnecting. Historical Kane runs remain available until you explicitly remove them.

**Path note:** No operating-system selector is required. Windows drive-letter paths are translated to mounted drives for a WSL-hosted KaneGuard; native macOS and Linux paths are used unchanged. Folders must be accessible to the computer running KaneGuard. This does not provide remote access to other machines or unmounted disks.

**Scope:** This release targets local, npm-driven frontend apps with a reachable HTTP preview. It does not import GitHub repositories, provision backends/databases, execute installers, or deploy publicly. If your framework does not honor `PORT`/`HOST`, start it yourself and provide its loopback URL. Some apps disallow iframe embedding; use **Open app** for those. Existing-app modifications are made **in place**; make a Git commit or backup first. The selected coding CLI runs with your local user permissions, so attach only projects you trust. KaneGuard performs bounded source-change checks but is **not** an operating-system security sandbox. Desktop Kane evidence does not independently prove mobile-width layouts.

To verify the new connector without real paid CLI calls:

```bash
npm test
```

The integration tests employ controlled coding/Kane CLI doubles; real authenticated Kane results remain separate from those tests.

## v24+ · Requirement assurance and Trust Receipts

KaneGuard now saves a SHA-256 seal for every agent-authored feature objective **before implementation**. It checks this seal against the original objective and disk evidence before each Kane browser execution, retry, and evidence reuse. If it changes, verification stops; a coding agent cannot grant itself a PASS. Prior failed checks remain in history.

New planner responses can include first-class `requirements` with stable IDs, text, implementation `taskIds`, and Kane `acceptanceIds`. The UI shows *N tasks → M checks → X requirements proven, Y repaired, Z unproven*; legacy runs and omitted request bullets are explicitly **unmapped**, never treated as automatically proven. A requirement is proven only after the final protected Kane suite completes successfully with real, saved browser PASS evidence. Desktop Kane passes do not imply mobile viewport testing.

The **Examiner** dropdown appears when at least two coding agents are installed. The examiner drafts the feature plan and browser objectives; the chosen builder makes source changes. Optional **Blind builder** hides the exact Kane objective wording from implementation handoffs while leaving task details and objective names visible. The examiner can still inspect real Kane failure evidence during repairs.

Every saved run exposes a **Trust Receipt** at `/api/runs/<id>/receipt` and structured Kane step / diff traces at `/api/runs/<id>/trace`. In **Projects**, selecting a project opens its **Live loop**; switch to **App** for the running application.

**v30 removed automatic cinematic exports and startup backfills.** Saved run records and Kane evidence remain in `runs/<run-id>/`; the Live loop reads them directly and requires no export command. Existing `judge-replays/` bundles from v29 are left untouched for safety, but no new bundles are written. Archive-only legacy records remain readable where possible. If you want to reclaim disk space after checking your backup, you may remove the old `judge-replays` directory manually; this never affects saved `runs/` evidence. Manual legacy export utilities remain for backward compatibility but are not linked from the Studio.

**Privacy:** Run records and saved Kane/agent evidence can contain developer requests, project paths and transcripts; review them before publishing a repository. The Live loop cannot generate proof that was never saved, and does not change any stored verdict.

**Experimental clone negative control:** For newly generated apps only, an opt-in examiner can introduce a single defect into a disposable clone *after* the original protected suite passes. Kane first checks the unmodified clone as a baseline, then checks the examiner-mutated clone against a URL-adjusted objective. A real failure after an original clone PASS is labeled `proven` *sensitivity to that mutation*, not proof of general app correctness. If the clone baseline fails, mutation is unsafe, or Kane cannot give a verdict, the status is `unproven`; a mutated clone that still passes is `weak`. The clone is deleted afterwards; the original app is never the test target. Objective URL adaptation is separately hashed and disclosed. This feature is **experimental** and should be used in a genuine authenticated WSL trial before making submission claims.
