/** Desktop Kane CLI controls a Chrome browser at its configured starting size.
 * It does not expose a dependable in-run viewport resize / device-emulation
 * action in the headless workflow KaneGuard currently invokes. In particular,
 * the published CLI config's desktop window width minimum is 800px.
 *
 * Keep this deliberately narrow: it must NOT confuse an actual responsive
 * layout bug (e.g. horizontal overflow) with a missing automation capability.
 */
export function unsupportedDesktopBrowserAction(objective = '') {
  const words = String(objective);
  const changesViewport =
    /\b(?:resize|resizing|change|adjust|set|switch|emulate|simulate|configure)\b[^.!?\n]{0,110}\b(?:viewport|browser\s+window|window\s+size|screen\s+size|mobile\s+(?:view|width|viewport)|device\s+(?:width|viewport|size))\b/i.test(words) ||
    /\b(?:viewport|browser\s+window|window\s+size|screen\s+size)\b[^.!?\n]{0,70}\b(?:resize|change|adjust|set|switch|emulate|simulate)\b/i.test(words);
  const explicitlyMobileWidth =
    /\b(?:mobile|viewport|browser\s+width|window\s+width|screen\s+width)\b[^.!?\n]{0,90}\b[1-7]\d{2}\s*(?:px|pixels)\b/i.test(words) ||
    /\b[1-7]\d{2}\s*(?:px|pixels)\b[^.!?\n]{0,90}\b(?:mobile|viewport|browser\s+width|window\s+width|screen\s+width)\b/i.test(words);
  return changesViewport || explicitlyMobileWidth ? {
    code: 'desktop_viewport_resize',
    explanation: 'This KaneGuard desktop Kane CLI runner cannot change the browser viewport or emulate a 375px mobile screen during an objective. Mobile layout must not be claimed verified by that check.'
  } : null;
}

/** Only classify an observed real Kane failure as a capability block when the
 * objective required viewport adjustment AND Kane explicitly says the action
 * could not be performed. An overflow/misalignment finding is an app failure.
 */
export function detectKaneCapabilityBlock(objective, failureSummary = '') {
  if (!unsupportedDesktopBrowserAction(objective)) return null;
  const text = String(failureSummary);
  const incapability =
    /\b(?:cannot|can't|could\s+not|unable|no\s+way|not\s+able|not\s+supported|unsupported|unavailable|lacks?\s+(?:the\s+)?(?:capability|ability))\b[^.!?\n]{0,155}\b(?:resize|change\s+(?:the\s+)?(?:window|viewport)|set\s+(?:the\s+)?(?:window|viewport)|window\s+size|viewport|mobile\s+(?:layout|width)|device\s+emulation)\b/i.test(text) ||
    /\b(?:viewport|window\s+size|browser\s+tools|resize|device\s+emulation)\b[^.!?\n]{0,120}\b(?:not\s+available|not\s+supported|not\s+possible|could\s+not|cannot|no\s+way|lacks?|missing|unavailable)\b/i.test(text) ||
    (/\bstep_not_achievable\b/i.test(text) && /\b(?:resize|viewport|window\s+size)\b/i.test(text));
  if (!incapability) return null;
  return {
    code: 'desktop_viewport_resize',
    explanation: 'Kane could not set the requested browser viewport. The mobile layout was NOT verified; the application is not proven faulty.'
  };
}
