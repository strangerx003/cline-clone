// Persistence layer: settings + connections (localStorage/sessionStorage)
// and IndexedDB stores for the directory handle, snapshots and the undo journal.

import { APP_CONFIG } from './config.js';
import { detectProvider } from './providers.js';

const SETTINGS_KEY = 'cline-web.settings.v1';
const CONNECTIONS_KEY = 'cline-web.connections.v1';
const RECENTS_KEY = 'cline-web.recents.v1';
const DB_NAME = 'cline-web';
const DB_VERSION = 1;

/** 'local' = remember on device (default), 'session' = forget when the tab closes. */
let storageMode = 'local';

export function setStorageMode(mode) {
  storageMode = mode === 'session' ? 'session' : 'local';
}

export function getStorageMode() {
  return storageMode;
}

function backend() {
  return storageMode === 'session' ? window.sessionStorage : window.localStorage;
}

function readJSON(store, key, fallback) {
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeJSON(store, key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- settings

export const DEFAULT_SETTINGS = {
  activeConnectionId: APP_CONFIG.defaultConnections[0].id,
  temperature: 0.2,
  maxTokens: 4096,
  stream: true,
  maxSteps: APP_CONFIG.maxAgentSteps,
  autoApprove: { ...APP_CONFIG.defaultAutoApprove },
  systemPrompt: APP_CONFIG.systemPrompt,
  theme: 'dark',
  ignoreGlobs: 'node_modules, .git, dist, build, out, .next, .nuxt, target, __pycache__, venv, .venv, coverage, .cache, *.min.js, *.map, package-lock.json, *.png, *.jpg, *.jpeg, *.gif, *.ico, *.woff, *.woff2, *.ttf, *.zip, *.pdf',
  autoCreateFolder: true
};

export function getSettings() {
  const stored = readJSON(backend(), SETTINGS_KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    autoApprove: { ...DEFAULT_SETTINGS.autoApprove, ...(stored.autoApprove || {}) }
  };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJSON(backend(), SETTINGS_KEY, next);
  return next;
}

// ------------------------------------------------------------- connections

/** Seeds the default connections the first time the app runs. */
export function getConnections() {
  const stored = readJSON(backend(), CONNECTIONS_KEY, null);
  if (Array.isArray(stored) && stored.length) return stored;
  return APP_CONFIG.defaultConnections.map((c) => ({ ...c }));
}

export function saveConnections(list) {
  writeJSON(backend(), CONNECTIONS_KEY, list);
  return list;
}

export function upsertConnection(conn) {
  const list = getConnections();
  const idx = list.findIndex((c) => c.id === conn.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...conn };
  else list.push(conn);
  return saveConnections(list);
}

export function deleteConnection(id) {
  const list = getConnections().filter((c) => c.id !== id);
  return saveConnections(list);
}

export function getActiveConnection() {
  const list = getConnections();
  const settings = getSettings();
  return list.find((c) => c.id === settings.activeConnectionId) || list[0] || null;
}

export function newConnectionId() {
  return `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Builds a new connection, auto-detecting the provider from the key/base URL. */
export function makeConnection({ name = '', apiKey = '', baseUrl = '', apiStyle = 'auto', defaultModel = '' } = {}) {
  const preset = detectProvider(apiKey, baseUrl);
  const style = apiStyle === 'auto' || !apiStyle ? preset.apiStyle : apiStyle;
  return {
    id: newConnectionId(),
    name: name || preset.name,
    provider: preset.id,
    baseUrl: baseUrl || preset.baseUrl,
    apiKey,
    apiStyle: style,
    defaultModel,
    headers: {}
  };
}

// --------------------------------------------------------------- IndexedDB

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      if (!db.objectStoreNames.contains('undo')) db.createObjectStore('undo', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbPut(storeName, value, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = key === undefined ? tx.objectStore(storeName).put(value) : tx.objectStore(storeName).put(value, key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/** The picked workspace directory handle (re-permissioned on reload). */
export const handleStore = {
  save: (handle) => idbPut('handles', handle, 'root'),
  load: () => idbGet('handles', 'root'),
  clear: () => idbDelete('handles', 'root')
};

/** Undo journal: a snapshot of a file's previous bytes before it was changed. */
export const undoStore = {
  async push(entry) {
    const id = await idbPut('undo', { ...entry, at: Date.now() });
    const all = await idbAll('undo');
    const sorted = all.sort((a, b) => a.at - b.at);
    for (const row of sorted.slice(0, Math.max(0, sorted.length - 100))) {
      await idbDelete('undo', row.id);
    }
    return id;
  },
  all: () => idbAll('undo'),
  remove: (id) => idbDelete('undo', id),
  clear: async () => {
    const all = await idbAll('undo');
    for (const row of all) await idbDelete('undo', row.id);
  }
};

/** Read-only mode storage: files captured from an <input webkitdirectory> pick. */
export const zipModeStore = {
  save: (path, text) => idbPut('files', { path, text, at: Date.now() }, path),
  load: (path) => idbGet('files', path),
  all: () => idbAll('files'),
  clear: async () => {
    const all = await idbAll('files');
    for (const row of all) await idbDelete('files', row.path);
  }
};

// ------------------------------------------------------------------ recents

export function getRecents() {
  return readJSON(backend(), RECENTS_KEY, { models: [], prompts: [] });
}

export function pushRecentModel(modelId) {
  const r = getRecents();
  r.models = [modelId, ...r.models.filter((m) => m !== modelId)].slice(0, 6);
  writeJSON(backend(), RECENTS_KEY, r);
  return r;
}

export function pushRecentPrompt(prompt) {
  const r = getRecents();
  r.prompts = [prompt, ...r.prompts.filter((p) => p !== prompt)].slice(0, 8);
  writeJSON(backend(), RECENTS_KEY, r);
  return r;
}