# KaneGuard — Build. Verify. Repair.

**Local-first app creation with independent Kane CLI browser verification.** Give KaneGuard one natural-language request, select a coding agent, and watch it create a working browser app through sequential, evidence-backed tasks. When Kane CLI reports a functional failure, KaneGuard passes the genuine browser evidence to the coding agent for diagnosis and bounded source repair, then reruns the same check. It never creates a fake PASS.

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

### What to do in the Studio

1. Enter a request, such as *“Build a todo app with adding, completion, filtering and localStorage.”*
2. Choose **Cursor, Antigravity, Claude Code, or Codex** and click **Create app**.
3. Follow the **Activity**, **Kane checks**, and **Live logs** panes. The local preview reloads when app source changes.
4. Expand **Verification journey** to see the original Kane failure, agent diagnosis, source repair and retest. All genuine failed attempts remain visible even if a later run passes.
5. In **Projects**, open an app, delete **one run and its evidence**, or delete a **generated project including every run, code file and config**. Deletion is irreversible and disabled during active workflows. Built-in CartLab and CoinPulse are protected from project deletion.

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
