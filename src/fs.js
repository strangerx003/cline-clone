// File System Access API wrapper: folder picking, permissions, tree listing,
// and file read/write/delete for the selected workspace.

import { handleStore } from './store.js';

export function supportsFileSystemAccess() {
  return typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
}

export function supportsReadOnlyFallback() {
  return 'webkitdirectory' in document.createElement('input');
}

/** Opens the OS directory picker (must be called from a user gesture). */
export async function pickDirectory({ mode = 'readwrite', startIn = 'documents' } = {}) {
  if (!supportsFileSystemAccess()) {
    const err = new Error('unsupported');
    err.code = 'fsa_unsupported';
    throw err;
  }
  try {
    return await window.showDirectoryPicker({ id: 'cline-web-workspace', mode, startIn });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      const err = new Error('cancelled');
      err.code = 'cancelled';
      throw err;
    }
    throw e;
  }
}

export async function saveRootHandle(handle) {
  try { await handleStore.save(handle); } catch { /* non-fatal */ }
}

export async function loadRootHandle() {
  try { return await handleStore.load(); } catch { return null; }
}

export async function forgetRootHandle() {
  try { await handleStore.clear(); } catch { /* non-fatal */ }
}

/**
 * Ensures we still hold the requested permission. When `interactive` is true the
 * browser may show the (3-way) permission prompt; otherwise it only queries.
 */
export async function verifyPermission(handle, mode = 'readwrite', interactive = false) {
  if (!handle || !handle.queryPermission) return false;
  const opts = { mode };
  let state = await handle.queryPermission(opts);
  if (state === 'granted') return true;
  if (!interactive) return false;
  state = await handle.requestPermission(opts);
  return state === 'granted';
}

// --------------------------------------------------------------- path utils

export function normalizePath(p) {
  return String(p == null ? '' : p)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim();
}

export function splitPath(p) {
  return normalizePath(p).split('/').filter(Boolean);
}

export function dirname(p) {
  const parts = splitPath(p);
  parts.pop();
  return parts.join('/');
}

export function basename(p) {
  const parts = splitPath(p);
  return parts.length ? parts[parts.length - 1] : '';
}

export function extname(p) {
  const base = basename(p);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function joinPath(...parts) {
  return normalizePath(parts.filter(Boolean).join('/'));
}

/**
 * Turns a prompt into a safe folder name, e.g.
 * "Why is the sky blue?" -> "why-sky-blue"
 */
export function slugifyPrompt(text, maxWords = 4, maxLen = 40) {
  const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on',
    'for', 'and', 'or', 'with', 'that', 'this', 'it', 'as', 'at', 'by', 'from', 'me', 'my', 'you',
    'your', 'can', 'could', 'would', 'should', 'please', 'make', 'create', 'write', 'build', 'add',
    'using', 'use', 'how', 'what', 'why', 'when', 'where', 'do', 'does', 'i', 'we', 'us', 'about']);

  const words = String(text || '')
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const meaningful = words.filter((w) => !STOP.has(w) && w.length > 1);
  const picked = (meaningful.length ? meaningful : words).slice(0, maxWords);

  let slug = picked.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, maxLen).replace(/-$/, '');
  return slug || 'new-project';
}

/** "why-sky-blue" -> "why-sky-blue-2" when already taken. */
export function uniqueName(base, taken = []) {
  const set = new Set(taken.map((t) => String(t).toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  let n = 2;
  while (set.has(`${base}-${n}`.toLowerCase())) n++;
  return `${base}-${n}`;
}

export function timestampSlug(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}
// ------------------------------------------------------- file system access

/** Resolves a nested directory handle, optionally creating missing folders. */
export async function getDirectoryHandle(root, path, { create = false } = {}) {
  let dir = root;
  for (const part of splitPath(path)) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

/** Resolves a file handle at `path` (optionally creating it). */
export async function getFileHandle(root, path, { create = false } = {}) {
  const parts = splitPath(path);
  const name = parts.pop();
  if (!name) throw new Error(`Invalid file path: "${path}"`);
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir.getFileHandle(name, { create });
}

export async function fileExists(root, path) {
  try {
    const parts = splitPath(path);
    const name = parts.pop();
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

export async function dirExists(root, path) {
  try {
    await getDirectoryHandle(root, path);
    return true;
  } catch {
    return false;
  }
}

export async function readFileText(root, path) {
  const fh = await getFileHandle(root, path);
  const file = await fh.getFile();
  return await file.text();
}

export async function readFileBinary(root, path) {
  const fh = await getFileHandle(root, path);
  const file = await fh.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

export async function writeFileText(root, path, content) {
  const fh = await getFileHandle(root, path, { create: true });
  const writable = await fh.createWritable();
  await writable.write(String(content == null ? '' : content));
  await writable.close();
}

export async function writeFileBinary(root, path, bytes) {
  const fh = await getFileHandle(root, path, { create: true });
  const writable = await fh.createWritable();
  await writable.write(bytes);
  await writable.close();
}

export async function createFolder(root, path) {
  await getDirectoryHandle(root, path, { create: true });
}

export async function deleteEntry(root, path, { recursive = true } = {}) {
  const parts = splitPath(path);
  const name = parts.pop();
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  await dir.removeEntry(name, { recursive });
}

/** Lists direct children of a directory. */
export async function listChildren(dirHandle) {
  const dirs = [];
  const files = [];
  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind === 'directory') dirs.push({ name, kind: 'directory', handle: entry });
    else files.push({ name, kind: 'file', handle: entry });
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  return [...dirs.sort(byName), ...files.sort(byName)];
}

export function globToRegex(glob) {
  const escaped = glob.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export function parseIgnoreGlobs(csv) {
  return String(csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(globToRegex);
}

export function isIgnored(name, patterns) {
  return patterns.some((re) => re.test(name));
}

/**
 * Builds a recursive, lazily-expandable tree (depth-limited, ignores heavy dirs).
 * Returns { name, kind, path, children } nodes.
 */
export async function buildTree(root, { patterns = [], maxDepth = 4, maxEntries = 1500, depth = 0, prefix = '' } = {}) {
  const nodes = [];
  let count = 0;

  let children;
  try {
    children = await listChildren(root);
  } catch {
    return nodes;
  }

  for (const child of children) {
    if (isIgnored(child.name, patterns)) continue;
    if (count++ > maxEntries) break;
    const path = joinPath(prefix, child.name);
    if (child.kind === 'directory') {
      nodes.push({
        name: child.name,
        kind: 'directory',
        path,
        children: depth + 1 >= maxDepth ? null : await buildTree(child.handle, { patterns, maxDepth, maxEntries, depth: depth + 1, prefix: path })
      });
    } else {
      nodes.push({ name: child.name, kind: 'file', path });
    }
  }
  return nodes;
}

/** Flattens read-only files chosen through <input webkitdirectory>. */
export async function readFromFileList(fileList, { patterns = [] } = {}) {
  const out = [];
  for (const file of fileList) {
    const rel = normalizePath(file.webkitRelativePath || file.name);
    const parts = splitPath(rel);
    if (parts.some((p) => isIgnored(p, patterns))) continue;
    if (file.size > 1024 * 1024) continue; // skip files > 1 MB in read-only mode
    const path = parts.slice(1).join('/') || file.name; // strip the picked root folder name
    if (!path) continue;
    try {
      out.push({ path, text: await file.text(), size: file.size });
    } catch { /* skip unreadable/binary */ }
  }
  return out;
}

/** Rough language id from a file extension (for the preview + highlighting). */
export function langFromPath(path) {
  const ext = extname(path);
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', go: 'go',
    rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
    cs: 'csharp', php: 'php', swift: 'swift', sh: 'bash', ps1: 'powershell',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini',
    md: 'markdown', markdown: 'markdown', sql: 'sql', xml: 'xml', svg: 'xml',
    txt: 'text', env: 'bash', gitignore: 'text', lock: 'text'
  };
  return map[ext] || 'text';
}