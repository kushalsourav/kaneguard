/**
 * Resolve an explicitly supplied local project folder for the host running KaneGuard.
 * The frontend needs no OS selector. A path is usable only when the host can open it.
 * These transformations do NOT fetch remote projects or bypass filesystem permissions.
 */
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

function withoutSurroundingQuotes(value) {
  let result = value.trim();
  if (result.length >= 2 && ((result[0] === '"' && result.at(-1) === '"') ||
      (result[0] === "'" && result.at(-1) === "'"))) result = result.slice(1,-1).trim();
  return result;
}

export function resolveProjectFolderInput(input, {
  home = os.homedir(),
  platform = process.platform,
  windowsMountRoot = '/mnt',
  wslDistro = process.env.WSL_DISTRO_NAME || '',
} = {}) {
  if (typeof input !== 'string' || !input.trim() || input.length > 1000 || input.includes('\0'))
    throw new Error('Provide a local project folder path');
  let value = withoutSurroundingQuotes(input);
  if (!value || value.includes('\0')) throw new Error('Provide a local project folder path');

  // Copy-as-URL from a local file manager or IDE; never accept remote file hosts.
  if (/^file:\/\//i.test(value)) {
    let file;
    try { file = new URL(value); } catch { throw new Error('Invalid local folder URL'); }
    if (file.protocol !== 'file:' || (file.hostname && file.hostname !== 'localhost'))
      throw new Error('Only folders available on this computer can be connected');
    if (platform === 'win32') value = fileURLToPath(file);
    else {
      const pathname = decodeURIComponent(file.pathname);
      value = /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
    }
  }

  const hostPath = platform === 'win32' ? path.win32 : path.posix;
  if (value === '~' || /^~[\\/]/.test(value)) {
    value = value === '~' ? home : hostPath.join(home,value.slice(2).replace(/[\\/]/g,hostPath.sep));
  }

  // A path copied from Windows Explorer can be used directly by a WSL-hosted
  // KaneGuard when that drive is mounted, without exposing this to the UI.
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(value);
  if (drive && platform !== 'win32') {
    if (platform !== 'linux') throw new Error('This folder is not available to the local KaneGuard process');
    // Normalize with Windows drive-root rules first: repeated separators and
    // `..` must never turn a drive-relative mount path into a Unix absolute path.
    const normalizedWindows = path.win32.normalize(value.replaceAll('/','\\'));
    const normalizedDrive = /^([A-Za-z]):\\(.*)$/.exec(normalizedWindows);
    return path.posix.resolve(windowsMountRoot,normalizedDrive[1].toLowerCase(),normalizedDrive[2].replaceAll('\\','/'));
  }
  if (/^[A-Za-z]:(?![\\/])/.test(value))
    throw new Error('Provide an absolute folder path, not a drive-relative path');

  // Windows Explorer's WSL network path: only the *current* distro is local
  // to a Linux process. On Windows, let the OS resolve its UNC path directly.
  if (platform !== 'win32' && /^\\\\/.test(value)) {
    const unc = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)\\(.+)$/i.exec(value);
    if (platform !== 'linux' || !unc || !wslDistro || unc[1].toLowerCase() !== wslDistro.toLowerCase())
      throw new Error('This folder is not available to the local KaneGuard process');
    return path.posix.resolve('/',unc[2].replaceAll('\\','/'));
  }

  // Windows-hosted KaneGuard can also accept the standard WSL mounted-drive
  // notation when the folder is actually on that Windows drive.
  if (platform === 'win32') {
    const mounted = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/.exec(value);
    if (mounted) value = `${mounted[1].toUpperCase()}:\\${(mounted[2] || '').replaceAll('/','\\')}`;
    if (value.startsWith('/')) throw new Error('This folder is not available to the local KaneGuard process');
  }
  return hostPath.resolve(value);
}

/** Only for displaying paths; the server always uses the original canonical path. */
export function projectPathDisplay(value, home = os.homedir()) {
  if (typeof value !== 'string') return '';
  const normalized = value.replaceAll('\\','/');
  const normalizedHome = String(home).replaceAll('\\','/').replace(/\/$/,'');
  const lower = process.platform === 'win32';
  const equal = (a,b) => lower ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (normalizedHome && (equal(normalized,normalizedHome) || equal(normalized.slice(0,normalizedHome.length),normalizedHome) && normalized[normalizedHome.length] === '/'))
    return '~' + normalized.slice(normalizedHome.length);
  // Cover Windows-mounted paths in WSL and macOS/user homes for old config data.
  return normalized.replace(/^\/home\/[^/]+(?=\/|$)/,'~').replace(/^\/Users\/[^/]+(?=\/|$)/,'~')
    .replace(/^\/mnt\/[a-z]\/Users\/[^/]+(?=\/|$)/i,'~')
    .replace(/^[A-Za-z]:\/Users\/[^/]+(?=\/|$)/,'~');
}
