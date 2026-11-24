# KaneGuard — ~3-minute AI-narrated demo plan

**Integrity rule:** Only label a screen as a live coding or Kane browser run if it is a real recording. When replaying saved evidence, say **“recorded evidence from a previous local run.”** Never fabricate CLI output or claim a Kane PASS unsupported by raw `run_end` evidence.

| Time | On-screen content | Voiceover focus |
| --- | --- | --- |
| 0:00–0:20 | KaneGuard Studio and headline | Why generated code needs independent browser verification |
| 0:20–0:45 | Create-your-own-app prompt, all four adapter choices | Prompt to isolated app, choose a coding agent |
| 0:45–1:15 | Actual project live preview and task timeline | Sequential implementation and Kane task gates |
| 1:15–1:50 | **Coffee Shop** original failed browser run and reason | Real bug: filter clicks did not change drinks |
| 1:50–2:20 | Agent diagnosis transcript, source diff | Actual diagnosis and edit, no hardcoded fix |
| 2:20–2:40 | Authentic later Kane PASS evidence if accessible | Retest and preserved fail→repair→pass history |
| 2:40–2:52 | **FitPulse** inconclusive evidence, briefly | Honest status when browser viewport action unavailable |
| 2:52–3:00 | README quickstart, GitHub | Reproduce locally, open app, inspect original evidence |

## AI voiceover / video production

Use a speech-synthesis tool to narrate the supplied `docs/VOICEOVER.md` script and combine it with **actual screenshots or recordings** from `/control/` and Kane evidence. It is okay to AI-generate transitions or titles; **do not use synthetic browser screenshots to represent real verification**. Obtain the actual local video or screenshots from WSL/Windows before publishing.

Recommended capture sequence:

1. Open `/control/`, show the Studio and genuine four CLI choices.
2. Select saved **Coffee Shop** project, expand Task 2 **Verification journey**, open the original Kane FAIL transcript and later PASS evidence.
3. Show the generated Coffee Shop preview and functional category filtering.
4. Show FitPulse's preserved inconclusive verdict to demonstrate evidence honesty.
5. Show `npm test`, the README, `bash scripts/start.sh`, and project deletion controls.

The repository intentionally does not include a fake sample-browser session. If a project has been deleted, recover its authentic evidence *before* deleting the run folder; deletion destroys evidence permanently.
