/** Kane-native assurance *source* handoff. This never invokes Kane's agent,
 * design, review, or coverage lifecycle and never marks nodes as trusted.
 * The developer must review the source before explicitly ingesting it. */
const clean=(s)=>String(s??'').replaceAll('\0','').replace(/\r\n?/g,'\n');
const quote=(s)=>clean(s).split('\n').map(l=>`> ${l}`).join('\n');
export function kaneRequirementSource(run){
  const rows=(run.requirements||[]).map((r,i)=>`${i+1}. **${clean(r.id)}**: ${clean(r.text).replace(/\n/g,' ')}\n   - Agent-suggested task links: ${(r.taskIds||[]).join(', ')||'unmapped'}\n   - Agent-suggested check links: ${(r.acceptanceIds||[]).join(', ')||'unmapped'}`).join('\n');
  return `# KaneGuard candidate requirements source — review required\n\n`+
    `Run: ${clean(run.id)}\nProject: ${clean(run.appLabel||run.appId||'Unknown')}\n`+
    `Source status: **UNREVIEWED. NOT a Kane-trusted requirement graph.**\n\n`+
    `## Original developer request (verbatim)\n\n${quote(run.request||'')}\n\n`+
    `## Candidate requirement decomposition (agent-authored, not independently validated)\n\n`+
    `${rows||'No first-class requirement inventory was saved. Review the original request manually.'}\n\n`+
    `## Interpretation policy\n\n`+
    `The original developer request is authoritative. Agent-generated requirement rows, links, and browser checks are suggestions only.\n`+
    `Independently review and approve acceptance criteria in Kane CLI before using its native assurance coverage commands.\n`+
    `KaneGuard's legacy acceptance checks do not automatically become trusted Kane-native assurance tests.\n`;
}
