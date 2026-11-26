/**
 * Small locally bundled set of Lucide-style SVG glyphs.
 * Based on the Lucide icon language (MIT, https://lucide.dev/license).
 * No CDN, React runtime, or network connection is required.
 */
const paths = {
  'folder': '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'trash-2': '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
  'unlink': '<path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71M8 2v3M2 8h3M16 22v-3M22 16h-3"/>',
  'folder-code': '<path d="M10 10.5 8 13l2 2.5M14 10.5l2 2.5-2 2.5"/><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'eye': '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'plus': '<path d="M12 5v14M5 12h14"/>',
  'monitor': '<rect x="2" y="3" width="20" height="15" rx="2"/><path d="M8 22h8m-4-4v4"/>',
  'list-checks': '<path d="m3 7 2 2 4-4M13 7h8m-8 5h8m-8 5h8m-10-3 2 2 4-4"/>',
  'gamepad-2': '<path d="M6.5 12h4m-2-2v4m7-2h.01M19 13h.01M6 7h12a4 4 0 0 1 3.8 3l1 6a3 3 0 0 1-5 2.7l-2-2H8.2l-2 2A3 3 0 0 1 1.3 16l1-6A4 4 0 0 1 6 7Z"/>',
  'layout-template': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18m-12 0v12"/>',
  'shield-check': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  'activity': '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  'history': '<path d="M3 12a9 9 0 1 0 2.7-6.4L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  'file-search': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7"/><path d="M14 2v6h6"/><path d="M14 2l6 6v6"/><circle cx="16" cy="17" r="3"/><path d="m18.5 19.5 2.5 2.5"/>',
  'shopping-bag': '<path d="M6 7h12l1 14H5L6 7Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  'bitcoin': '<path d="M9 3v18M15 3v18"/><path d="M7 7h8.2a3 3 0 0 1 0 6H7h9a3.5 3.5 0 0 1 0 7H7"/>',
  'arrow-up': '<path d="M12 19V5m-7 7 7-7 7 7"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8m-8 4h8"/>',
  'clock-3': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6h6"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>',
  'arrow-right': '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  'arrow-left': '<path d="M19 12H5m7 7-7-7 7-7"/>',
  'external-link': '<path d="M15 3h6v6m-11 5L21 3"/><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'file-check-2': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6"/><path d="m8 16 3 3 5-6"/>',
  'play-circle': '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4V8Z"/>',
  'check': '<path d="m20 6-11 11-5-5"/>',
  'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'git-branch': '<path d="M6 3v12"/><circle cx="6" cy="3" r="2"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="6" r="2"/><path d="M18 8a6 6 0 0 1-6 6H6"/>',
  'workflow': '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h6a3 3 0 0 1 3 3v6M6 9v9a3 3 0 0 0 3 3h6"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  'refresh-cw': '<path d="M20 11a8 8 0 0 0-14.8-4M4 4v5h5M4 13a8 8 0 0 0 14.8 4M20 20v-5h-5"/>',
  'command': '<path d="M9 7V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V7Z"/>',
  'target': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  'play': '<polygon points="6 3 20 12 6 21 6 3"/>',
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  'sliders-horizontal': '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  'download': '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  'wallet': '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-4 5h.01"/>',
  'trending-up': '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  'trending-down': '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  'layers': '<path d="m12 2 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5"/>',
  'chart-pie': '<path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9v9h9Z"/><path d="M21 9h-6V3a9 9 0 0 1 6 6Z"/>',
  'list-filter': '<path d="M4 7h16M7 12h10m-7 5h4"/>',
  'terminal': '<path d="m4 17 6-6-6-6M12 19h8"/>',
  'lock': '<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  'sparkles': '<path d="m12 3 1.9 5.6L19.5 10l-5.6 1.4L12 17l-1.9-5.6L4.5 10l5.6-1.4L12 3ZM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17Z"/>',
  'circle-dot': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>',
  'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0"/>',
  'radar': '<path d="M12 12 19 5M12 2a10 10 0 1 1-10 10"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  'triangle-alert': '<path d="m10.3 3.9-8.6 15A2 2 0 0 0 3.4 22h17.2a2 2 0 0 0 1.7-3.1l-8.6-15a2 2 0 0 0-3.4 0ZM12 9v5m0 4h.01"/>',
  'menu': '<path d="M4 7h16M4 12h16M4 17h16"/>',
  'x': '<path d="M18 6 6 18M6 6l12 12"/>',
  'square': '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  'info': '<circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/>',
  'code-2': '<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-11-2 14"/>',
  'bolt': '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>',
};
export function icon(name, cls = '') {
  const body = paths[name] || paths['circle-dot'];
  return `<svg class="ui-icon${cls ? ` ${cls}` : ''}" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const shell = document.createElement('span');
    shell.innerHTML = icon(el.dataset.icon, el.dataset.iconClass || '');
    const svg = shell.firstElementChild;
    if (el.className) svg.classList.add(...String(el.className).split(/\s+/).filter(Boolean));
    el.replaceWith(svg);
  });
}
