# KaneGuard — ~3-minute narration (AI voice)

Welcome to KaneGuard: an autonomous development and browser-verification workflow built for the Kane CLI hackathon. Its premise is simple. Writing code is not the same as proving the application works. Coding agents can create polished pages, but a missing click handler, a broken form, or an incorrect calculation may still escape notice. KaneGuard closes that gap with independent browser testing.

Start by describing an app in plain English. KaneGuard creates an isolated local project and lets you choose your coding assistant: Cursor, Google Antigravity, Claude Code, or Codex. The selected agent generates implementation milestones and testable browser objectives. It then implements one milestone at a time, while the live preview shows actual source changes as they happen.

After each eligible task, Kane CLI opens the application in a real browser and executes the specified user journey. Code completion does not earn a green badge. Only a genuine browser PASS, recorded with its underlying evidence, can verify the behavior. If Kane finds a problem, KaneGuard forwards the failure to the coding agent for an evidence-based diagnosis and an actual source repair. Then Kane runs the relevant test again.

Here is an example from a recorded Coffee Shop project. The featured-drinks page had category buttons, but Kane found that selecting a category left All active and kept every drink visible. That is precisely the kind of problem visual screenshots can miss. The agent inspected the evidence, identified missing event handlers, and edited the JavaScript. KaneGuard preserves both the original failure and the repair journey. If the subsequent genuine retest passes, the page displays that PASS without erasing the earlier failure.

Not every browser attempt should pass. In another recorded project, FitPulse, Kane successfully checked the dark theme and the monthly-versus-yearly pricing toggle. But its desktop automation environment could not resize the viewport to the requested mobile width. KaneGuard recorded verification as inconclusive. It did not pretend mobile responsiveness had been independently verified. That distinction is essential for trustworthy automation.

For the developer, the entire workflow is inspectable. The Studio shows task progress, live logs, saved agent transcripts, source diffs, browser results, and proof links. Generated apps have their own local preview URLs. You can retain builds for review, remove individual history records, or permanently delete a generated project and its evidence.

KaneGuard runs locally on Node.js with a single launch command. Install Kane CLI and one coding agent, authenticate both, and open the Studio in your browser. The result is a reusable, transparent loop: plan, code, verify, diagnose, repair, and verify again. That's KaneGuard: your agent writes it, Kane checks it, and the evidence tells the truth.
