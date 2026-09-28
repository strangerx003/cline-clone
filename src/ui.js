// Cline Web — application controller.
// Wires the chat, the model picker, connection manager, workspace explorer and
// the file-writing agent loop together.

import { APP_CONFIG } from './config.js';
import { DEFAULT_CATALOG, filterModels, groupModels, priceLabel, formatContext, suggestModel } from './models.js';
import { PROVIDER_PRESETS, detectProvider, normalizeApiKey, maskApiKey } from './providers.js';
import {
  getSettings, saveSettings, getConnections, saveConnections, upsertConnection,
  deleteConnection, getActiveConnection, makeConnection, getRecents, pushRecentModel,
  pushRecentPrompt, setStorageMode, getStorageMode, undoStore, zipModeStore
} from './store.js';
import {
  supportsFileSystemAccess, supportsReadOnlyFallback, pickDirectory, saveRootHandle,
  loadRootHandle, forgetRootHandle, verifyPermission, readFileText, writeFileText,
  createFolder, deleteEntry, buildTree, fileExists, parseIgnoreGlobs,
  readFromFileList, slugifyPrompt, uniqueName, timestampSlug, normalizePath, joinPath, basename, extname
} from './fs.js';
import { listModels, testConnection, ApiError } from './api.js';
import { SimpleZip } from './zip.js';
import { Agent, AgentEvents } from './agent.js';
import { parseOps, OP_META, escapeHtml, renderMarkdown, highlight, toHunks, diffStats } from './tools.js';

/* ------------------------------------------------------------------ helpers */

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function toast(message, kind = 'info', { title = '', timeout = 5200 } = {}) {
  const host = $('toastHost');
  const icons = { info: 'ℹ️', ok: '✅', err: '⚠️', warn: '⚠️' };
  const node = el('div', { class: `toast ${kind}` },
    el('span', { class: 't-icon', text: icons[kind] || 'ℹ️' }),
    el('div', { class: 't-text' }, title ? el('strong', { text: `${title} ` }) : null, el('span', { text: message })),
    el('button', { class: 't-close', type: 'button', text: '✕', onclick: () => node.remove() })
  );
  host.append(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
  return node;
}

const banners = new Map();

function clearBanner(key) {
  const existing = banners.get(key);
  if (existing) { existing.remove(); banners.delete(key); }
}

function banner(key, { kind = 'info', title = '', message = '', hint = '', link = '', linkText = '' } = {}) {
  clearBanner(key);
  const body = el('div', { class: 'banner-body' });
  if (title) body.append(el('strong', { class: 'banner-title', text: title }));
  if (message) body.append(el('span', { text: message }));
  if (hint) body.append(el('div', { class: 'banner-hint', text: hint }));
  if (link) body.append(el('div', {}, el('a', { href: link, target: '_blank', rel: 'noopener noreferrer', text: linkText || link })));
  const node = el('div', { class: `banner ${kind}` }, body,
    el('button', { class: 'mini-btn t-close', type: 'button', text: '✕', onclick: () => { node.remove(); banners.delete(key); } })
  );
  $('bannerHost').append(node);
  banners.set(key, node);
  return node;
}

function openModal({ title, sub = '', size = '', body, footer = [], onClose = null }) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const closeBtn = el('button', { class: 'icon-btn modal-close', type: 'button', text: '✕', title: 'Close' });
  const modal = el('div', { class: `modal ${size}` },
    el('div', { class: 'modal-head' },
      el('div', {}, el('div', { class: 'modal-title', text: title }), sub ? el('div', { class: 'modal-sub', text: sub }) : null),
      closeBtn
    ),
    el('div', { class: 'modal-body' }, body),
    footer.length ? el('div', { class: 'modal-foot' }, footer) : null
  );
  backdrop.append(modal);
  $('modalHost').append(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  return { close, modal, backdrop };
}

function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const dialog = openModal({
      title,
      size: 'narrow',
      body: el('p', { class: 'muted', text: message }),
      footer: [
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => finish(false) }),
        el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: confirmText, onclick: () => finish(true) })
      ],
      onClose: () => { if (!settled) { settled = true; resolve(false); } }
    });
    function finish(v) {
      if (settled) return;
      settled = true;
      dialog.close();
      resolve(v);
    }
  });
}

function switchControl(checked, onChange, label = '', desc = '') {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('div', { class: 'toggle-row' },
    el('div', {}, el('div', { class: 't-label', text: label }), desc ? el('div', { class: 't-desc', text: desc }) : null),
    el('label', { class: 'switch' }, input, el('span'))
  );
}

function kindIcon(path, kind) {
  if (kind === 'directory') return { glyph: '▸', cls: 'k-dir' };
  const ext = extname(path);
  const map = {
    js: ['🟨', 'k-js'], mjs: ['🟨', 'k-js'], cjs: ['🟨', 'k-js'], jsx: ['⚛️', 'k-js'],
    ts: ['🔷', 'k-ts'], tsx: ['🔷', 'k-ts'], py: ['🐍', 'k-py'], html: ['🌐', 'k-html'],
    css: ['🎨', 'k-css'], scss: ['🎨', 'k-css'], json: ['🧩', 'k-json'], md: ['📝', 'k-md'],
    png: ['🖼️', 'k-img'], jpg: ['🖼️', 'k-img'], jpeg: ['🖼️', 'k-img'], gif: ['🖼️', 'k-img'],
    svg: ['🖼️', 'k-img'], sh: ['🐚', 'k-sh'], ps1: ['🐚', 'k-sh'], yml: ['🧾', 'k-json'], yaml: ['🧾', 'k-json']
  };
  const hit = map[ext] || ['📄', ''];
  return { glyph: hit[0], cls: hit[1] };
}

function familyGlyph(family) {
  const map = {
    deepseek: '🐋', xiaomi: '🟠', qwen: '🟣', openai: '⚫', anthropic: '🅰️',
    google: '🔵', 'z-ai': '🟩', xai: '✖️', moonshot: '🌙', meta: '🔷', mistral: '🌬️'
  };
  return map[family] || '✨';
}

function scrollToBottom() {
  const box = $('chatScroll');
  if (box) box.scrollTop = box.scrollHeight;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/* -------------------------------------------------------------------- state */

const state = {
  connections: [],
  activeConnection: null,
  catalog: [],
  catalogByProvider: {},
  catalogLive: false,
  catalogUpdatedAt: 0,
  model: '',
  favourites: [],
  recents: { models: [], prompts: [] },
  attachments: [],
  contextFiles: [],
  usage: { input: 0, output: 0 },
  cacheLayer: '',
  treeExpanded: new Set(),
  currentPreview: null,
  lastUserPrompt: ''
};

const workspace = {
  ready: false,
  name: '',
  root: null,
  mode: 'none',
  overlay: new Map(),
  zipFiles: [],
  get ignorePatterns() { return parseIgnoreGlobs(getSettings().ignoreGlobs); },
  async exists(path) {
    if (this.mode === 'zip') {
      if (this.overlay.has(path)) return this.overlay.get(path) !== null;
      return this.zipFiles.some((f) => f.path === path);
    }
    if (!this.root) return false;
    try { return await fileExists(this.root, path); } catch { return false; }
  },
  async readText(path) {
    if (this.mode === 'zip') {
      if (this.overlay.has(path)) {
        const v = this.overlay.get(path);
        if (v == null) { const e = new Error(`File not found: ${path}`); e.code = 'not_found'; throw e; }
        return v;
      }
      const hit = this.zipFiles.find((f) => f.path === path);
      if (!hit) { const e = new Error(`File not found: ${path}`); e.code = 'not_found'; throw e; }
      return hit.text;
    }
    return readFileText(this.root, path);
  },
  async writeText(path, text) {
    if (this.mode === 'zip') { this.overlay.set(normalizePath(path), String(text)); return; }
    await writeFileText(this.root, path, text);
  },
  async makeFolder(path) {
    if (this.mode === 'zip') return;
    await createFolder(this.root, path);
  },
  async remove(path) {
    if (this.mode === 'zip') { this.overlay.set(normalizePath(path), null); return; }
    await deleteEntry(this.root, path);
  },
  async snapshot(path, reason = 'edit') {
    let previous = null;
    try { previous = await this.readText(path); } catch { previous = null; }
    if (previous != null) {
      await undoStore.push({ path: normalizePath(path), text: previous, reason, mode: this.mode });
      refreshUndoCount();
    }
    return previous;
  },
  async refresh() { await renderTree(); }
};

/* ------------------------------------------------------------------- agent */

const agent = new Agent({
  getConnection: () => state.activeConnection,
  getModel: () => state.model,
  getSettings: () => getSettings(),
  workspace
});

let activeStream = null;

function setRunning(running) {
  $('stepStrip').classList.toggle('hidden', !running);
  $('btn-send').disabled = running;
  $('promptInput').disabled = running;
  if (!running) setStepText('Thinking…');
}

function setStepText(text) { $('stepText').textContent = text; }

agent
  .on(AgentEvents.STEP_START, ({ step, of }) => {
    setStepText(`Step ${step} of ${of} — asking the model…`);
    hideEmptyState();
  })
  .on(AgentEvents.DELTA, (chunk) => {
    if (!activeStream) activeStream = beginAssistantMessage();
    activeStream.text += chunk;
    renderStreamingBody(activeStream);
    setStepText('Writing…');
  })
  .on(AgentEvents.REASONING, (chunk) => {
    if (!activeStream) activeStream = beginAssistantMessage();
    activeStream.reasoning += chunk;
    renderReasoningBody(activeStream);
  })
  .on(AgentEvents.USAGE, ({ usage, replace }) => {
    state.usage.input = replace ? Math.max(state.usage.input, usage.input_tokens) : state.usage.input + usage.input_tokens;
    state.usage.output = usage.output_tokens || state.usage.output;
    updateUsageBar(state.usage);
  })
  .on(AgentEvents.META, ({ cacheLayer }) => {
    state.cacheLayer = cacheLayer || '';
    updateUsageBar(state.usage);
  })
  .on(AgentEvents.ASSISTANT_DONE, ({ prose }) => {
    if (activeStream) {
      if (prose && prose.trim()) activeStream.text = prose;
      finalizeAssistantMessage(activeStream, { usageText: `${state.usage.input.toLocaleString()} in · ${state.usage.output.toLocaleString()} out` });
      activeStream = null;
    }
  })
  .on(AgentEvents.OPS, ({ batch }) => {
    const host = el('div', { class: 'ops-batch' });
    for (const item of batch) {
      const card = renderOpCard(item);
      if (item.status === 'pending') renderOpPending(card, item);
      host.append(card);
    }
    if (host.children.length) { $('messages').append(host); scrollToBottom(); }
  })
  .on(AgentEvents.OP_RESULT, (res) => {
    const card = document.querySelector(`[data-op="${res.id}"]`);
    if (card) renderOpResult(card, res);
    refreshUndoCount();
  })
  .on(AgentEvents.CONTINUE, ({ reason, step }) => {
    setStepText(reason === 'read' ? 'Reading the files I asked for…' : `Retrying after an issue — step ${step + 1}…`);
  })
  .on(AgentEvents.DONE, ({ filesChanged, stopped, maxReached, step }) => {
    setRunning(false);
    if (activeStream) { finalizeAssistantMessage(activeStream, { stopped }); activeStream = null; }
    renderSummaryCard({ filesChanged, stopped, maxReached, step });
    $('stepStrip').classList.add('hidden');
    if (Array.isArray(filesChanged) && filesChanged.length) {
      toast(`${filesChanged.length} file(s) updated in "${workspace.name}".`, 'ok', { title: 'Done —' });
    }
    syncWorkspaceStatus();
  })
  .on(AgentEvents.ERROR, (err) => {
    setRunning(false);
    if (activeStream) { finalizeAssistantMessage(activeStream, { stopped: true }); activeStream = null; }
    $('stepStrip').classList.add('hidden');
    const message = err && err.message ? err.message : String(err);
    const hint = err && err.hint ? `\n\n${err.hint}` : '';
    addSystemMessage(`**Request failed:** ${message}${hint}`, 'error');
    if (err instanceof ApiError) showApiBanner(err);
    else toast(message, 'err', { title: 'Request failed —' });
  });

function syncWorkspaceStatus() {
  const node = $('wsStatus');
  if (!node) return;
  if (workspace.ready) node.textContent = `${workspace.name} · ${workspace.mode === 'zip' ? 'read-only' : 'read/write'}`;
  else node.textContent = 'no folder open';
}

/* ------------------------------------------------------------------ messages */

function chatShell() { return document.querySelector('.chat'); }

function hideEmptyState() {
  $('emptyState').classList.add('hidden');
  const chat = chatShell();
  if (chat) chat.classList.remove('is-empty');
}

function showEmptyState() {
  $('emptyState').classList.remove('hidden');
  const chat = chatShell();
  if (chat) chat.classList.add('is-empty');
}

function closeMobileSidebar() {
  if (!window.matchMedia('(max-width: 900px)').matches) return;
  const layout = document.querySelector('.layout');
  if (layout) layout.classList.remove('sidebar-open');
}

/** Clears the thread and returns to the new-chat state (ChatGPT "New chat"). */
function newChat() {
  if (agent.isRunning) agent.stop();
  $('messages').innerHTML = '';
  agent.reset();
  state.attachments = [];
  state.contextFiles = [];
  state.usage = { input: 0, output: 0 };
  state.lastUserPrompt = '';
  renderAttachments();
  renderContextChips();
  updateUsageBar(state.usage);
  $('promptInput').value = '';
  autosizeInput();
  closePreview();
  $('stepStrip').classList.add('hidden');
  showEmptyState();
  scrollToBottom();
}

function starterPrompts() {
  return [
    'Create a landing page with a hero, features and pricing sections.',
    'Build a todo app with localStorage — HTML, CSS and JS in separate files.',
    'Scaffold a small express server with a health endpoint.'
  ];
}

function renderStarters() {
  const host = $('starterList');
  host.innerHTML = '';
  for (const s of starterPrompts()) {
    host.append(el('button', {
      class: 'starter', type: 'button', text: s,
      onclick: () => { $('promptInput').value = s; autosizeInput(); $('promptInput').focus(); }
    }));
  }
}

function addUserMessage(text, attachments = [], contextFiles = []) {
  hideEmptyState();
  const body = el('div', { class: 'bubble-body' }, el('div', { html: renderMarkdown(text) }));
  if (attachments.length) {
    const imgs = el('div', { class: 'msg-images' });
    for (const a of attachments) imgs.append(el('img', { src: a.dataUrl, alt: a.name || 'attachment' }));
    body.prepend(imgs);
  }
  if (contextFiles.length) {
    body.append(el('div', { class: 'msg-context', text: `context: ${contextFiles.join(', ')}` }));
  }
  $('messages').append(el('div', { class: 'msg user' },
    el('div', { class: 'bubble-wrap' }, el('div', { class: 'bubble' }, body))
  ));
  scrollToBottom();
}

function addSystemMessage(text, kind = 'info') {
  hideEmptyState();
  $('messages').append(el('div', { class: 'msg system' },
    el('div', { class: 'avatar', text: kind === 'error' ? '⚠️' : 'ℹ️' }),
    el('div', { class: 'bubble-wrap' }, el('div', { class: 'bubble' }, el('div', { html: renderMarkdown(text) })))
  ));
  scrollToBottom();
}

function beginAssistantMessage() {
  hideEmptyState();
  const bodyEl = el('div', { class: 'bubble-body' },
    el('div', { class: 'thinking-skeleton' }, el('i'), el('i'), el('i'))
  );
  const reasoningEl = el('details', { class: 'reasoning hidden' },
    el('summary', { text: 'Reasoning' }),
    el('div', { class: 'reasoning-body' })
  );
  const metaEl = el('div', { class: 'msg-meta hidden' });
  const bubble = el('div', { class: 'bubble' }, reasoningEl, bodyEl);
  const wrap = el('div', { class: 'bubble-wrap' }, bubble, metaEl);
  const node = el('div', { class: 'msg assistant' }, el('div', { class: 'avatar', text: '⚡' }), wrap);
  $('messages').append(node);
  scrollToBottom();
  return { node, bodyEl, reasoningEl, reasoningBody: reasoningEl.querySelector('.reasoning-body'), metaEl, text: '', reasoning: '', frame: 0 };
}

function renderStreamingBody(stream) {
  if (stream.frame) return;
  stream.frame = requestAnimationFrame(() => {
    stream.frame = 0;
    const skeleton = stream.bodyEl.querySelector('.thinking-skeleton');
    if (skeleton) skeleton.remove();
    stream.bodyEl.innerHTML = renderMarkdown(stream.text) + '<span class="typing-caret"></span>';
    scrollToBottom();
  });
}

function renderReasoningBody(stream) {
  if (!stream.reasoning) return;
  stream.reasoningEl.classList.remove('hidden');
  stream.reasoningBody.textContent = stream.reasoning;
}

function finalizeAssistantMessage(stream, { stopped = false, usageText = '' } = {}) {
  const skeleton = stream.bodyEl.querySelector('.thinking-skeleton');
  if (skeleton) skeleton.remove();
  const caret = stream.bodyEl.querySelector('.typing-caret');
  if (caret) caret.remove();
  stream.bodyEl.innerHTML = String(stream.text || '').trim()
    ? renderMarkdown(stream.text)
    : '<p class="muted">(no text returned)</p>';
  stream.metaEl.classList.remove('hidden');
  stream.metaEl.innerHTML = '';
  if (stopped) stream.metaEl.append(el('span', { class: 'badge promo tiny', text: 'stopped' }));
  if (usageText) stream.metaEl.append(el('span', { class: 'badge tiny', text: usageText }));
  const actions = el('div', { class: 'op-actions' });
  actions.append(
    el('button', {
      class: 'mini-btn', type: 'button', text: 'Copy',
      onclick: async () => {
        try { await navigator.clipboard.writeText(stream.text); toast('Message copied.', 'ok'); }
        catch { toast('Clipboard access was blocked.', 'err'); }
      }
    }),
    el('button', { class: 'mini-btn', type: 'button', text: 'Delete', onclick: () => stream.node.remove() })
  );
  stream.metaEl.append(actions);
  scrollToBottom();
}

/* --------------------------------------------------------------- op cards */

function diffView(diff) {
  const box = el('div', { class: 'diff' });
  if (!diff || !diff.length) {
    box.append(el('div', { class: 'diff-empty', text: 'No textual changes.' }));
    return box;
  }
  const hunks = toHunks(diff, 3);
  hunks.forEach((hunk, index) => {
    if (index > 0) box.append(el('div', { class: 'diff-hunk-sep', text: '⋯' }));
    for (const row of hunk) {
      const marker = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ';
      box.append(el('div', { class: `diff-row ${row.type}` },
        el('div', { class: 'diff-gutter' },
          el('span', { text: row.oldLine == null ? '' : String(row.oldLine) }),
          el('span', { text: row.newLine == null ? '' : String(row.newLine) })),
        el('div', { class: 'diff-code', html: highlight(marker + row.text) })
      ));
    }
  });
  return box;
}

function filePreviewView(text) {
  const box = el('div', { class: 'diff' });
  const body = el('div', { class: 'diff-code', style: { padding: '10px 12px', display: 'block' } });
  body.innerHTML = String(text || '').split('\n').map((l) => highlight(l)).join('\n');
  box.append(body);
  return box;
}

function renderOpCard(item) {
  const tone = item.tone || (OP_META[item.kind] || {}).tone || 'edit';
  const icon = item.icon || (OP_META[item.kind] || {}).icon || '•';
  const card = el('div', { class: 'op-card', dataset: { op: item.id, tone, kind: item.kind } },
    el('div', { class: 'op-head' },
      el('span', { class: 'op-icon', text: icon }),
      el('span', { class: 'op-kind', text: (OP_META[item.kind] || {}).label || item.kind }),
      el('span', { class: 'op-path mono', text: item.path || '' }),
      el('div', { class: 'spacer' })
    ),
    el('div', { class: 'op-body' }),
    el('div', { class: 'op-foot' }, el('div', { class: 'op-actions' }))
  );
  card._body = card.querySelector('.op-body');
  card._actions = card.querySelector('.op-actions');
  return card;
}

function renderOpPending(card, item) {
  const bodyEl = card._body;
  const actionsEl = card._actions;
  bodyEl.innerHTML = '';
  actionsEl.innerHTML = '';
  if (item.kind === 'read') {
    bodyEl.append(el('div', { class: 'op-message', text: 'The model wants to read this file before editing.' }));
  } else if (item.kind === 'folder') {
    bodyEl.append(el('div', { class: 'op-message', text: 'Create this folder in the workspace.' }));
  } else if (item.kind === 'delete') {
    bodyEl.append(el('div', { class: 'op-message err', text: 'This will delete the file (a snapshot is kept for undo).' }));
  } else {
    bodyEl.append(diffView(item.diff || []));
  }
  actionsEl.append(
    el('button', { class: 'mini-btn ok', type: 'button', text: 'Apply', onclick: () => approveOp(item.id) }),
    el('button', { class: 'mini-btn danger', type: 'button', text: 'Reject', onclick: () => rejectOp(item.id) })
  );
  if (item.autoApproved) bodyEl.prepend(el('div', { class: 'op-message muted', text: 'Auto-approved by your settings.' }));
}

function renderOpResult(card, res) {
  const bodyEl = card._body || card.querySelector('.op-body');
  const actionsEl = card._actions || card.querySelector('.op-actions');
  if (!bodyEl || !actionsEl) return;
  bodyEl.innerHTML = '';
  actionsEl.innerHTML = '';
  const badge = el('span', {
    class: `badge tiny ${res.status === 'applied' ? 'free' : res.status === 'partial' ? 'promo' : ''}`,
    text: res.status || 'done'
  });
  actionsEl.append(badge);
  if (res.kind === 'folder') {
    bodyEl.append(el('div', { class: 'op-message', text: res.message || 'Folder created.' }));
    return;
  }
  if (res.kind === 'read') {
    if (res.fileContent == null) bodyEl.append(el('div', { class: 'op-message err', text: res.message || 'File missing.' }));
    else bodyEl.append(el('div', { class: 'op-message', text: res.message || '' }), filePreviewView(res.fileContent));
    return;
  }
  if (res.status === 'rejected') { bodyEl.append(el('div', { class: 'op-message', text: res.message || 'Skipped.' })); return; }
  if (res.status === 'failed') {
    bodyEl.append(el('div', { class: 'op-message err', text: res.message || 'Operation failed.' }));
    return;
  }
  const holder = el('div', {});
  bodyEl.append(holder);
  holder.append(diffView(res.diff || []));
  const msg = el('div', { class: 'op-message' }, el('span', { text: res.message || '' }));
  if (res.path) {
    msg.append(el('button', { class: 'mini-btn', type: 'button', text: 'Revert', onclick: () => revertPath(res.path) }));
  }
  bodyEl.append(msg);
}

async function approveOp(opId) {
  const res = await agent.approve(opId);
  if (res) await afterOpResult(res);
}

function rejectOp(opId) {
  const res = agent.reject(opId);
  if (res) afterOpResult(res);
}

async function afterOpResult(res) {
  const card = document.querySelector(`[data-op="${res.id}"]`);
  if (card) renderOpResult(card, res);
  refreshUndoCount();
  scrollToBottom();
}

function renderSummaryCard({ filesChanged = [], maxReached, stopped, step }) {
  if (!filesChanged.length && !maxReached && !stopped) return;
  const parts = [];
  if (filesChanged.length) parts.push(`${filesChanged.length} file${filesChanged.length === 1 ? '' : 's'} changed`);
  if (stopped) parts.push('stopped by you');
  if (maxReached) parts.push(`step limit reached (${step})`);
  $('messages').append(el('div', { class: 'op-card', dataset: { tone: 'create' } },
    el('div', { class: 'op-head' },
      el('span', { class: 'op-icon', text: '✅' }),
      el('span', { class: 'op-kind', text: 'Summary' }),
      el('span', { class: 'op-path', text: parts.join(' · ') })
    ),
    el('div', { class: 'op-body' },
      el('div', { class: 'op-message', text: filesChanged.length ? `Changed: ${filesChanged.join(', ')}` : 'No files were changed.' })
    )
  ));
  scrollToBottom();
}

/* -------------------------------------------------------------- run prompt */

async function runPrompt(prompt, { skipHistory = false } = {}) {
  const text = String(prompt || '').trim();
  if (!text) return;
  if (agent.isRunning) return toast('A run is already in progress.', 'warn');
  if (!state.activeConnection || !state.activeConnection.apiKey) {
    openConnectionsModal({ firstRun: true });
    toast('Add an API key to start chatting.', 'warn', { title: 'No key —' });
    return;
  }
  if (!workspace.ready && getSettings().autoCreateFolder) {
    const choice = await askFolderForPrompt(text);
    if (choice === 'cancelled') return;
  }
  state.lastUserPrompt = text;
  pushRecentPrompt(text);
  const contextBlock = state.contextFiles.length
    ? `\n\nFiles currently in context:\n${state.contextFiles.map((p) => `- ${p}`).join('\n')}`
    : '';
  const attachments = state.attachments.slice();
  if (!skipHistory) addUserMessage(text, attachments, state.contextFiles);
  const payloadText = text + contextBlock;
  const content = attachments.length
    ? [{ type: 'text', text: payloadText }, ...attachments.map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl } }))]
    : payloadText;
  state.usage = { input: 0, output: 0 };
  updateUsageBar(state.usage);
  $('promptInput').value = '';
  autosizeInput();
  state.attachments = [];
  renderAttachments();
  setRunning(true);
  await agent.send(content);
  setRunning(false);
  syncWorkspaceStatus();
}

/* --------------------------------------------------- "no folder" prompt flow */

async function askFolderForPrompt(prompt) {
  const baseSlug = slugifyPrompt(prompt);
  const suggested = uniqueName(baseSlug, []);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; dialog.close(); resolve(v); } };
    const nameInput = el('input', { class: 'input', value: suggested, spellcheck: 'false' });
    const slugPreview = el('div', { class: 'hint mono' });
    const updatePreview = () => {
      slugPreview.textContent = `Folder name: ${slugifyPrompt(nameInput.value || prompt)}`;
    };
    nameInput.addEventListener('input', updatePreview);
    updatePreview();
    const canPick = supportsFileSystemAccess();
    const body = el('div', {},
      el('p', { class: 'muted', style: { marginTop: 0 } },
        canPick
          ? 'No folder is open. Pick a parent folder and I will create a subfolder named after your prompt.'
          : 'This browser cannot write files directly. You can still chat, or load a project read-only and download a .zip.'),
      el('div', { class: 'field' },
        el('label', { text: 'New project folder name' }),
        nameInput,
        slugPreview
      )
    );
    const dialog = openModal({
      title: 'Where should I write the files?',
      sub: 'Asked once per workspace.',
      size: 'narrow',
      body,
      footer: [
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Just chat', onclick: () => finish('chat') }),
        canPick
          ? el('button', {
            class: 'btn btn-primary', type: 'button', text: 'Choose parent & create',
            onclick: async () => {
              try {
                const parent = await pickDirectory({ mode: 'readwrite' });
                const folderName = slugifyPrompt(nameInput.value || prompt) || `${baseSlug}-${timestampSlug()}`;
                const child = await parent.getDirectoryHandle(folderName, { create: true });
                workspace.root = child;
                workspace.name = folderName;
                workspace.mode = 'fsa';
                workspace.ready = true;
                await saveRootHandle(child);
                await refreshWorkspaceUI();
                toast(`Created folder "${folderName}".`, 'ok', { title: 'Workspace ready —' });
                finish('ready');
              } catch (e) {
                if (e && (e.code === 'cancelled' || e.name === 'AbortError')) return;
                toast(e.message || 'Could not create the folder.', 'err');
              }
            }
          })
          : null
      ].filter(Boolean),
      onClose: () => { if (!settled) { settled = true; resolve('cancelled'); } }
    });
  });
}

/* --------------------------------------------------------------- explorer */

async function renderTree() {
  const host = $('treeRoot');
  if (!host) return;
  host.innerHTML = '';
  if (!workspace.ready) {
    host.append(el('div', { class: 'tree-empty' },
      el('div', { text: '📂' }),
      el('div', { style: { marginTop: '8px' }, text: 'No folder is open.' })
    ));
    return;
  }
  let nodes = [];
  if (workspace.mode === 'zip') nodes = buildZipTree();
  else nodes = await buildTree(workspace.root, { patterns: workspace.ignorePatterns, maxDepth: 3, maxEntries: 900 });
  const filter = ($('sidebarSearch').value || '').trim().toLowerCase();
  const rendered = filter ? pruneTree(nodes, filter) : nodes;
  if (!rendered.length) {
    host.append(el('div', { class: 'tree-empty', text: filter ? 'No files match your filter.' : 'This folder is empty.' }));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const node of rendered) frag.append(renderTreeNode(node, 0));
  host.append(frag);
}

function pruneTree(nodes, filter) {
  const out = [];
  for (const node of nodes) {
    if (node.kind === 'directory') {
      const kids = node.children ? pruneTree(node.children, filter) : [];
      if (kids.length) out.push({ ...node, children: kids });
      else if (node.name.toLowerCase().includes(filter)) out.push({ ...node, children: [] });
    } else if (node.path.toLowerCase().includes(filter)) {
      out.push(node);
    }
  }
  return out;
}

function renderTreeNode(node, depth) {
  const icon = kindIcon(node.path, node.kind);
  const isDir = node.kind === 'directory';
  const expanded = state.treeExpanded.has(node.path) || depth < 1;
  const btn = el('button', { class: 'tree-node', type: 'button', title: node.path },
    el('span', { class: 'twisty', text: isDir ? (expanded ? '▾' : '▸') : '' }),
    el('span', { class: `fkind-icon ${icon.cls}`, text: isDir ? '📁' : icon.glyph }),
    el('span', { class: 'fname', text: node.name }),
    !isDir ? el('span', { class: 'fkind', text: extname(node.path) || 'file' }) : null
  );
  const wrap = el('div', {}, btn);
  btn.addEventListener('click', async () => {
    if (isDir) {
      if (state.treeExpanded.has(node.path)) state.treeExpanded.delete(node.path);
      else state.treeExpanded.add(node.path);
      await renderTree();
    } else {
      document.querySelectorAll('.tree-node.is-active').forEach((n) => n.classList.remove('is-active'));
      btn.classList.add('is-active');
      await openPreview(node.path);
      closeMobileSidebar();
    }
  });
  if (isDir && expanded && node.children && node.children.length) {
    const box = el('div', { class: 'tree-children' });
    for (const child of node.children) box.append(renderTreeNode(child, depth + 1));
    wrap.append(box);
  }
  return wrap;
}

function buildZipTree() {
  const files = workspace.zipFiles.map((f) => f.path);
  const root = { children: new Map() };
  for (const path of files) {
    const parts = normalizePath(path).split('/').filter(Boolean);
    let cursor = root;
    parts.forEach((part, i) => {
      if (!cursor.children.has(part)) cursor.children.set(part, { children: new Map(), path: parts.slice(0, i + 1).join('/') });
      cursor = cursor.children.get(part);
    });
  }
  const walk = (node) => {
    const out = [];
    for (const [name, child] of node.children) {
      if (child.children.size) out.push({ name, kind: 'directory', path: child.path, children: walk(child) });
      else out.push({ name, kind: 'file', path: child.path });
    }
    return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
  };
  return walk(root);
}

/* --------------------------------------------------------------- preview */

async function openPreview(path) {
  try {
    const text = await workspace.readText(path);
    document.querySelector('.layout').classList.add('has-preview');
    $('previewDrawer').classList.remove('hidden');
    $('previewTitle').textContent = path;
    $('previewBody').innerHTML = text.split('\n').map((l) => highlight(l)).join('\n');
    state.currentPreview = path;
  } catch (e) {
    toast(`Could not open ${path}: ${e.message}`, 'err');
  }
}

function closePreview() {
  document.querySelector('.layout').classList.remove('has-preview');
  $('previewDrawer').classList.add('hidden');
  state.currentPreview = null;
}

/* ------------------------------------------------------- workspace actions */

async function refreshWorkspaceUI() {
  $('folderChipName').textContent = workspace.ready ? workspace.name : 'No folder open';
  $('folderChipPerm').textContent = workspace.ready ? (workspace.mode === 'zip' ? 'read-only' : 'read/write') : '';
  $('btn-open-folder-side').classList.toggle('hidden', workspace.ready);
  $('zipBar').classList.toggle('hidden', workspace.mode !== 'zip');
  $('zipBarLabel').textContent = workspace.mode === 'zip' ? `Read-only: ${workspace.name} (${workspace.zipFiles.length} files)` : '';
  const reconnect = $('btn-reconnect-folder');
  if (reconnect && workspace.ready) reconnect.classList.add('hidden');
  syncWorkspaceStatus();
  await renderTree();
}

async function openWorkspaceFolder() {
  try {
    const handle = await pickDirectory({ mode: 'readwrite' });
    workspace.root = handle;
    workspace.name = handle.name || 'workspace';
    workspace.mode = 'fsa';
    workspace.ready = true;
    await saveRootHandle(handle);
    state.treeExpanded = new Set();
    await refreshWorkspaceUI();
    toast(`Opened "${workspace.name}".`, 'ok', { title: 'Workspace ready —' });
  } catch (e) {
    if (e && (e.code === 'cancelled' || e.name === 'AbortError')) return;
    toast(e.message || 'Could not open the folder.', 'err');
  }
}

async function openZipMode() {
  const input = el('input', { type: 'file', webkitdirectory: '', multiple: true });
  input.style.display = 'none';
  document.body.append(input);
  const picked = await new Promise((resolve) => {
    input.addEventListener('change', () => resolve(input.files), { once: true });
    input.click();
    setTimeout(() => resolve(input.files), 60000);
  });
  input.remove();
  if (!picked || !picked.length) return;
  const files = await readFromFileList(picked, { patterns: workspace.ignorePatterns });
  if (!files.length) return toast('No readable text files were found in that folder.', 'warn');
  await zipModeStore.clear();
  for (const f of files) await zipModeStore.save(f.path, f.text);
  workspace.zipFiles = files;
  workspace.mode = 'zip';
  workspace.ready = true;
  workspace.name = (picked[0].webkitRelativePath || 'project').split('/')[0];
  workspace.overlay = new Map();
  state.treeExpanded = new Set();
  await refreshWorkspaceUI();
  toast(`Loaded ${files.length} files read-only. Use Download .zip to export changes.`, 'ok');
}

async function downloadZip() {
  const zip = new SimpleZip();
  const seen = new Set();
  for (const f of workspace.zipFiles) {
    if (workspace.overlay.has(f.path)) continue;
    zip.addFile(f.path, f.text);
    seen.add(f.path);
  }
  for (const [path, text] of workspace.overlay) {
    if (text == null || seen.has(path)) continue;
    zip.addFile(path, text);
    seen.add(path);
  }
  const blob = zip.toBlob();
  const a = el('a', { href: URL.createObjectURL(blob), download: `${workspace.name || 'project'}.zip` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  toast(`Downloaded ${(blob.size / 1024).toFixed(1)} KB .zip`, 'ok');
}

async function forgetWorkspace() {
  const ok = await confirmDialog({ title: 'Close workspace?', message: 'The folder stays on disk; this app just forgets the handle.', confirmText: 'Close workspace' });
  if (!ok) return;
  workspace.ready = false;
  workspace.root = null;
  workspace.name = '';
  workspace.mode = 'none';
  workspace.zipFiles = [];
  workspace.overlay = new Map();
  await forgetRootHandle();
  closePreview();
  await refreshWorkspaceUI();
}

/* ------------------------------------------------------------------ undo */

async function refreshUndoCount() {
  try {
    const all = await undoStore.all();
    const counter = $('undoCount');
    if (counter) counter.textContent = String(all.length);
  } catch { /* ignore */ }
}

async function revertPath(path) {
  const entries = await undoStore.all();
  const entry = entries.slice().reverse().find((e) => e.path === normalizePath(path));
  if (!entry) return toast('No snapshot found for this file.', 'warn');
  try {
    await workspace.writeText(entry.path, entry.text);
    await undoStore.remove(entry.id);
    await refreshUndoCount();
    await workspace.refresh();
    toast(`Restored ${entry.path}.`, 'ok');
  } catch (e) {
    toast(`Could not restore: ${e.message}`, 'err');
  }
}

async function openUndoPanel() {
  const all = (await undoStore.all()).slice().reverse();
  const list = el('div', { class: 'conn-list' });
  const rerender = () => {
    list.innerHTML = '';
    if (!all.length) list.append(el('div', { class: 'muted', text: 'No snapshots yet — they appear after the first edit.' }));
    for (const entry of all) {
      list.append(el('div', { class: 'conn-row' },
        el('div', { class: 'conn-main' },
          el('div', { class: 'conn-name mono', text: entry.path }),
          el('div', { class: 'conn-sub muted', text: `${entry.reason || 'edit'} · ${new Date(entry.at).toLocaleTimeString()}` })
        ),
        el('button', {
          class: 'mini-btn', type: 'button', text: 'Restore',
          onclick: async () => {
            try {
              await workspace.writeText(entry.path, entry.text);
              await undoStore.remove(entry.id);
              await refreshUndoCount();
              await workspace.refresh();
              toast(`Restored ${entry.path}.`, 'ok');
              panel.close();
            } catch (e) { toast(e.message, 'err'); }
          }
        })
      ));
    }
  };
  rerender();
  const panel = openModal({
    title: 'Undo history',
    sub: 'Snapshots of files before they were changed.',
    body: list,
    footer: [
      el('button', {
        class: 'btn btn-ghost', type: 'button', text: 'Clear history',
        onclick: async () => { await undoStore.clear(); await refreshUndoCount(); all.length = 0; rerender(); }
      }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', type: 'button', text: 'Done', onclick: () => panel.close() })
    ]
  });
}

/* ------------------------------------------------------------- model picker */

function currentModelMeta() {
  return state.catalog.find((m) => m.id === state.model) || null;
}

function renderModelPill() {
  const pill = $('modelPill');
  const meta = currentModelMeta();
  const label = meta ? meta.label : (state.model || 'Select model');
  $('modelPillLabel').textContent = label;
  const price = $('modelPillPrice');
  if (price) price.textContent = meta ? (meta.isFree ? 'FREE' : priceLabel(meta)) : '';
  if (pill) pill.title = state.model || 'Choose a model';
}

function modelRowView(m, onPick, onFav) {
  const fav = state.favourites.includes(m.id);
  const row = el('button', { class: `model-row${m.id === state.model ? ' is-active' : ''}`, type: 'button', onclick: () => onPick(m.id) },
    el('span', { class: 'model-fam', text: familyGlyph(m.family) }),
    el('span', { class: 'model-main' },
      el('span', { class: 'model-name' },
        m.label,
        m.isFree ? el('span', { class: 'badge free tiny', text: 'FREE' }) : null,
        m.tier === 'frontier' ? el('span', { class: 'badge tiny', text: 'frontier' }) : null),
      el('span', { class: 'model-id mono', text: m.id })
    ),
    el('span', { class: 'model-meta' },
      el('span', { text: priceLabel(m) }),
      m.contextLength ? el('span', { text: formatContext(m.contextLength) }) : null),
    el('button', {
      class: `model-fav${fav ? ' on' : ''}`, type: 'button', text: fav ? '★' : '☆', title: 'Favourite',
      onclick: (e) => { e.stopPropagation(); onFav(m.id); }
    })
  );
  return row;
}

/* ------------------------------------------------------------- connections */

function refreshConnections() {
  state.connections = getConnections();
  state.activeConnection = getActiveConnection();
}

function providerLabel(conn) {
  const preset = PROVIDER_PRESETS.find((p) => p.id === (conn && conn.provider));
  return preset ? preset.name : ((conn && conn.provider) || 'Custom');
}

function setActiveConnection(id) {
  const conn = state.connections.find((c) => c.id === id) || getConnections()[0];
  if (!conn) return;
  saveSettings({ activeConnectionId: conn.id });
  refreshConnections();
  seedCatalog();
  const settings = getSettings();
  const remembered = (settings.lastModelByConnection || {})[conn.id];
  const next = remembered || conn.defaultModel || (state.catalog[0] ? state.catalog[0].id : state.model);
  if (next) setModel(next, { silent: true });
  renderModelPill();
  refreshCatalog({ silent: true });
}

function connectionCard(conn, redraw = () => {}) {
  const active = state.activeConnection && state.activeConnection.id === conn.id;
  const preset = detectProvider(conn.apiKey, conn.baseUrl);
  const status = el('div', { class: 'conn-url', text: conn.baseUrl || preset.baseUrl || '' });
  return el('div', { class: `conn-card${active ? ' is-active' : ''}` },
    el('div', { class: 'conn-main' },
      el('div', { class: 'conn-name' },
        conn.name || preset.name,
        active ? el('span', { class: 'badge free tiny', text: 'ACTIVE' }) : null),
      el('div', { class: 'conn-key' },
        el('span', { class: 'badge tiny', text: providerLabel(conn) }),
        ` ${maskApiKey(conn.apiKey)}`),
      status),
    el('div', { class: 'conn-actions' },
      el('button', {
        class: 'mini-btn', type: 'button', text: 'Test',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          status.textContent = 'testing…';
          try {
            const res = await testConnection({ connection: conn, model: conn.defaultModel || state.model });
            status.textContent = `OK · ${res.latencyMs} ms · ${res.reply}`;
            toast(`${conn.name || 'Connection'} works.`, 'ok');
          } catch (err) {
            status.textContent = err.message || 'test failed';
            showApiBanner(err);
          } finally { btn.disabled = false; }
        }
      }),
      active
        ? el('span', { class: 'badge free tiny', text: 'IN USE' })
        : el('button', {
          class: 'mini-btn', type: 'button', text: 'Use',
          onclick: () => { setActiveConnection(conn.id); redraw(); }
        }),
      el('button', { class: 'mini-btn', type: 'button', text: 'Edit', onclick: () => openConnectionEditor(conn.id, redraw) }),
      el('button', {
        class: 'mini-btn danger', type: 'button', text: 'Delete',
        onclick: async () => {
          if (state.connections.length <= 1) return toast('Keep at least one connection.', 'warn');
          const ok = await confirmDialog({
            title: 'Delete connection?',
            message: conn.name || conn.id,
            confirmText: 'Delete', danger: true
          });
          if (!ok) return;
          deleteConnection(conn.id);
          const wasActive = state.activeConnection && state.activeConnection.id === conn.id;
          refreshConnections();
          if (wasActive && state.connections.length) setActiveConnection(state.connections[0].id);
          redraw();
          toast('Connection removed.', 'ok');
        }
      })
    )
  );
}

function openConnectionEditor(connId, redraw = () => {}) {
  const existing = connId ? state.connections.find((c) => c.id === connId) : null;
  const nameInput = el('input', { class: 'input', value: existing ? existing.name : '', placeholder: 'e.g. My TokenHarbor key' });
  const keyInput = el('input', { class: 'input mono', value: existing ? existing.apiKey : '', placeholder: 'Paste any API key', spellcheck: 'false', autocomplete: 'off' });
  const baseInput = el('input', { class: 'input mono', value: existing ? existing.baseUrl : '', placeholder: 'https://…', spellcheck: 'false' });
  const styleSelect = el('select', { class: 'input' },
    el('option', { value: 'openai', text: 'OpenAI-compatible (/chat/completions)' }),
    el('option', { value: 'anthropic', text: 'Anthropic-style (/messages)' }));
  styleSelect.value = existing ? existing.apiStyle : 'openai';
  const detectEl = el('div', { class: 'hint' });
  const refreshDetect = () => {
    const probe = detectProvider(keyInput.value, baseInput.value);
    detectEl.textContent = keyInput.value.trim()
      ? `Detected: ${probe.name}`
      : 'Paste a key to auto-detect its provider.';
    if (!existing && !baseInput.value) baseInput.value = probe.baseUrl;
    if (!existing && styleSelect.dataset.touched !== '1') styleSelect.value = probe.apiStyle;
  };
  styleSelect.addEventListener('change', () => { styleSelect.dataset.touched = '1'; });
  keyInput.addEventListener('input', refreshDetect);
  refreshDetect();

  const dialog = openModal({
    title: existing ? 'Edit connection' : 'New connection',
    sub: 'Keys stay in this browser except when calling the provider.',
    body: el('div', {},
      el('div', { class: 'field' }, el('label', { text: 'Name' }), nameInput),
      el('div', { class: 'field' }, el('label', { text: 'API key' }), keyInput, detectEl),
      el('div', { class: 'field' }, el('label', { text: 'Base URL' }), baseInput),
      el('div', { class: 'field' }, el('label', { text: 'API style' }), styleSelect)
    ),
    footer: [
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => dialog.close() }),
      el('button', {
        class: 'btn btn-primary', type: 'button', text: 'Save',
        onclick: () => {
          const raw = normalizeApiKey(keyInput.value);
          if (!raw) return toast('Paste an API key first.', 'warn');
          const probe = detectProvider(raw, baseInput.value);
          const fields = {
            name: nameInput.value.trim() || probe.name,
            apiKey: raw,
            baseUrl: (baseInput.value.trim() || probe.baseUrl).replace(/\/+$/, ''),
            apiStyle: styleSelect.value
          };
          const conn = existing ? { ...existing, ...fields } : makeConnection(fields);
          upsertConnection(conn);
          refreshConnections();
          if (state.activeConnection && state.activeConnection.id === conn.id) {
            seedCatalog();
            refreshCatalog({ silent: true });
          }
          renderModelPill();
          redraw();
          dialog.close();
          toast(`Saved ${conn.name}.`, 'ok');
        }
      })
    ]
  });
}

async function importConnections(redraw = () => {}) {
  const input = el('input', { type: 'file', accept: 'application/json' });
  input.style.display = 'none';
  document.body.append(input);
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : (parsed.connections || []);
      let n = 0;
      for (const raw of list) {
        if (!raw || !raw.apiKey) continue;
        const preset = detectProvider(raw.apiKey, raw.baseUrl || '');
        upsertConnection(makeConnection({
          name: raw.name || `${preset.name} key`,
          apiKey: normalizeApiKey(raw.apiKey),
          baseUrl: raw.baseUrl || preset.baseUrl,
          apiStyle: raw.apiStyle || preset.apiStyle,
          defaultModel: raw.defaultModel || raw.model || ''
        }));
        n += 1;
      }
      refreshConnections();
      redraw();
      toast(`Imported ${n} connection${n === 1 ? '' : 's'}.`, 'ok');
    } catch { toast('Could not read that file.', 'err'); }
  });
  input.click();
}

function openConnectionsModal({ firstRun = false } = {}) {
  const keyArea = el('textarea', { class: 'input mono', rows: '3', placeholder: 'Paste one key, or several — one per line…' });
  const listHost = el('div', { class: 'conn-list' });
  const draw = () => {
    refreshConnections();
    listHost.innerHTML = '';
    if (!state.connections.length) {
      listHost.append(el('div', { class: 'picker-empty', text: 'No connections yet.' }));
      return;
    }
    for (const conn of state.connections) listHost.append(connectionCard(conn, draw));
  };

  const addKeys = el('button', {
    class: 'btn btn-primary', type: 'button', text: 'Add key(s)',
    onclick: () => {
      const lines = keyArea.value.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return toast('Paste at least one key first.', 'warn');
      let added = 0;
      for (const line of lines) {
        const clean = normalizeApiKey(line);
        if (!clean) continue;
        const preset = detectProvider(clean);
        upsertConnection(makeConnection({
          name: `${preset.name} ${maskApiKey(clean)}`,
          apiKey: clean,
          baseUrl: preset.baseUrl,
          apiStyle: preset.apiStyle
        }));
        added += 1;
      }
      if (!added) return toast('Those lines did not look like keys.', 'warn');
      keyArea.value = '';
      refreshConnections();
      draw();
      refreshCatalog({ silent: true });
      toast(`Added ${added} connection${added === 1 ? '' : 's'}.`, 'ok');
    }
  });

  const body = el('div', {},
    firstRun ? el('p', { class: 'muted', style: { marginTop: 0 }, text: 'Paste any provider key — the provider is detected from the key format.' }) : null,
    el('div', { class: 'field' },
      el('label', { text: 'Add API key(s)' }),
      keyArea,
      el('div', { class: 'hint', text: 'TokenHarbor · BazaarLink · Anthropic · OpenRouter · OpenAI · Groq · xAI · Gemini.' })),
    el('div', { class: 'key-row' },
      addKeys,
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'New connection…', onclick: () => openConnectionEditor(null, draw) }),
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Import JSON', onclick: () => importConnections(draw) }),
      el('button', {
        class: 'btn btn-ghost', type: 'button', text: 'Copy JSON',
        onclick: async () => {
          const data = JSON.stringify(state.connections.map((c) => ({ ...c, apiKey: '' })), null, 2);
          try { await navigator.clipboard.writeText(data); toast('Connections copied (keys excluded).', 'ok'); }
          catch { toast('Clipboard blocked by the browser.', 'err'); }
        }
      }),
      el('div', { class: 'spacer' })),
    el('div', { class: 'field' }, el('label', { text: 'Connections' }), listHost),
    switchControl(getStorageMode() === 'local', (v) => {
      const settings = getSettings();
      const conns = getConnections();
      setStorageMode(v ? 'local' : 'session');
      saveSettings(settings);
      saveConnections(conns);
      toast(v ? 'Keys stay on this device.' : 'Keys are forgotten when the tab closes.', 'info', { title: 'Storage —' });
    }, 'Remember on this device', 'Off = forget keys when the tab closes.')
  );

  const panel = openModal({
    title: 'Connections',
    sub: 'Keys never leave your browser except to the provider.',
    size: 'wide',
    body
  });
  draw();
  return panel;
}

/* ---------------------------------------------------------- model catalog */

function seedCatalog() {
  const provider = state.activeConnection ? state.activeConnection.provider : APP_CONFIG.defaultProvider;
  state.catalog = DEFAULT_CATALOG[provider] || DEFAULT_CATALOG[APP_CONFIG.defaultProvider] || [];
  state.catalogByProvider[provider] = state.catalog;
  state.catalogLive = false;
  state.catalogUpdatedAt = 0;
}

function ensureCurrentModelKnown() {
  if (!state.model) return;
  if (state.catalog.some((m) => m.id === state.model)) { clearBanner('model-unknown'); return; }
  const suggestion = suggestModel(state.model, state.catalog);
  banner('model-unknown', {
    kind: 'warn',
    title: 'Unknown model id.',
    message: `"${state.model}" is not in this provider's catalog.`,
    hint: suggestion ? `Did you mean "${suggestion}"? Open the model picker to switch.` : 'Open the model picker to choose a known model.'
  });
}

async function refreshCatalog({ silent = false, force = false } = {}) {
  const conn = state.activeConnection;
  if (!conn) { seedCatalog(); renderModelPill(); return; }
  const provider = conn.provider || APP_CONFIG.defaultProvider;
  if (!force && state.catalogByProvider[provider] && state.catalogByProvider[provider].length) {
    state.catalog = state.catalogByProvider[provider];
    renderModelPill();
    return;
  }
  if (!conn.apiKey) { seedCatalog(); renderModelPill(); return; }
  try {
    const live = await listModels(conn);
    if (live && live.length) {
      state.catalog = live;
      state.catalogByProvider[provider] = live;
      state.catalogLive = true;
      state.catalogUpdatedAt = Date.now();
    } else {
      seedCatalog();
    }
  } catch (e) {
    seedCatalog();
    if (force) showApiBanner(e);
    else if (!silent) toast(`Model list failed: ${e.message}`, 'warn');
  }
  ensureCurrentModelKnown();
  renderModelPill();
}

function setModel(id, { silent = false } = {}) {
  if (!id) return;
  state.model = id;
  pushRecentModel(id);
  state.recents = getRecents();
  const settings = getSettings();
  if (state.activeConnection) {
    const map = { ...(settings.lastModelByConnection || {}) };
    map[state.activeConnection.id] = id;
    saveSettings({ lastModelByConnection: map });
  }
  clearBanner('model-unknown');
  renderModelPill();
  if (!silent) toast(`Model: ${id}`, 'info', { title: 'Switched —', timeout: 2600 });
}

function toggleFavourite(id) {
  const i = state.favourites.indexOf(id);
  if (i >= 0) state.favourites.splice(i, 1);
  else state.favourites.push(id);
  saveSettings({ favourites: state.favourites });
}


function openModelPicker() {
  clearBanner('model-unknown');
  const search = el('input', { class: 'input', placeholder: 'Search models, families, ids…', spellcheck: 'false' });
  const freeOnly = el('input', { type: 'checkbox' });
  const listHost = el('div', { class: 'picker-list' });
  const note = el('div', { class: 'muted small', style: { marginTop: '10px' } });
  const customInput = el('input', { class: 'input mono', placeholder: 'custom-model-id', spellcheck: 'false' });
  const useCustom = () => {
    const id = String(customInput.value || '').trim();
    if (!id) return;
    setModel(id);
    dialog.close();
    toast(`Using custom model "${id}".`, 'ok');
  };

  const dialog = openModal({
    title: 'Select a model',
    sub: state.activeConnection
      ? `${providerLabel(state.activeConnection)} · ${state.catalogLive ? 'live catalog' : 'bundled catalog'}`
      : 'No connection selected',
    size: 'wide',
    body: el('div', {},
      el('div', { class: 'field' }, search),
      el('div', { class: 'key-row' },
        el('label', { class: 'hint' }, freeOnly, ' Free only'),
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'mini-btn', type: 'button', text: '⟳ Refresh catalog',
          onclick: async () => { await refreshCatalog({ force: true }); draw(); }
        })),
      listHost,
      el('div', { class: 'field', style: { marginTop: '12px' } },
        el('label', { text: 'Use a custom model id' }),
        el('div', { class: 'key-row' }, customInput,
          el('button', { class: 'btn btn-ghost', type: 'button', text: 'Use', onclick: useCustom })),
        el('div', { class: 'hint', text: 'Press Enter to use an id not in the catalog yet.' }))
    )
  });
  customInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    useCustom();
  });

  const draw = () => {
    listHost.innerHTML = '';
    const rows = filterModels(state.catalog, {
      query: search.value,
      freeOnly: freeOnly.checked,
      favourites: state.favourites,
      recents: state.recents.models
    });
    if (!rows.length) {
      listHost.append(el('div', { class: 'picker-empty', text: 'No models match. Try a different search, or use a custom id below.' }));
    } else {
      for (const group of groupModels(rows)) {
        listHost.append(el('div', { class: 'picker-group-title', text: group.title }));
        for (const m of group.items) {
          listHost.append(modelRowView(m,
            (id) => { setModel(id); dialog.close(); },
            (id) => { toggleFavourite(id); draw(); }));
        }
      }
      const guess = search.value.trim() && !rows.some((m) => m.id === search.value.trim())
        ? suggestModel(search.value.trim(), state.catalog) : null;
      if (guess) {
        listHost.append(el('button', {
          class: 'model-row', type: 'button',
          onclick: () => { setModel(guess); dialog.close(); }
        }, el('span', { class: 'model-main' }, el('span', { class: 'model-name', text: `Did you mean ${guess}?` }))));
      }
    }
    note.textContent = state.catalogLive
      ? `Live catalog · ${state.catalog.length} models · updated ${new Date(state.catalogUpdatedAt).toLocaleTimeString()}`
      : `Bundled catalog · ${state.catalog.length} models`;
    listHost.append(note);
  };
  search.addEventListener('input', draw);
  freeOnly.addEventListener('change', draw);
  draw();
  setTimeout(() => search.focus(), 40);
}


/* ------------------------------------------------------------- usage bar */

function updateUsageBar(usage) {
  const meta = currentModelMeta();
  const u = usage || { input: 0, output: 0 };
  $('usageModel').textContent = meta ? meta.label : (state.model || '');
  $('usageTokens').textContent = `${(u.input || 0).toLocaleString()} in · ${(u.output || 0).toLocaleString()} out`;
  let cost = 0;
  if (meta) cost = ((u.input || 0) / 1e6) * (meta.priceIn || 0) + ((u.output || 0) / 1e6) * (meta.priceOut || 0);
  $('usageCost').textContent = `$${cost.toFixed(4)}`;
  const badge = $('cacheBadge');
  badge.classList.toggle('hidden', !state.cacheLayer);
  badge.textContent = state.cacheLayer ? `cache ${state.cacheLayer}` : '';
}

/* ---------------------------------------------------------------- errors */

function showApiBanner(err) {
  if (!err) return;
  const status = err.status || 0;
  if (status === 401) {
    banner('api', { kind: 'err', title: 'Invalid API key (401).', message: err.message || '', hint: 'Open Connections (🔑) and check the key for typos, or rotate it.' });
  } else if (status === 402) {
    banner('api', { kind: 'warn', title: 'Out of credits (402).', message: err.message || '', hint: 'Top up, or switch to a FREE model from the picker.' });
  } else if (status === 403) {
    banner('api', { kind: 'err', title: 'Request denied (403).', message: err.message || '', hint: err.hint || 'Check email verification or key permissions in the provider dashboard.' });
  } else if (status === 429) {
    banner('api', { kind: 'warn', title: 'Rate limited (429).', message: err.retryAfter ? `Retry in ${err.retryAfter}s.` : (err.message || ''), hint: 'The app already backs off automatically.' });
  } else if (status === 404) {
    banner('api', { kind: 'err', title: 'Not found (404).', message: err.message || '', hint: 'The model id or endpoint may be wrong — pick a catalog model.' });
  } else {
    banner('api', { kind: 'err', title: `Request failed${status ? ` (${status})` : ''}.`, message: err.message || String(err), hint: err.hint || '' });
  }
}

/* -------------------------------------------------------- context + input */

function renderContextChips() {
  const host = $('contextChips');
  host.innerHTML = '';
  for (const path of state.contextFiles) {
    host.append(el('span', { class: 'context-chip' },
      el('span', { class: 'mono', text: path }),
      el('button', { type: 'button', text: '✕', title: 'Remove from context', onclick: () => removeContextFile(path) })
    ));
  }
  host.classList.toggle('hidden', !state.contextFiles.length);
}

function addContextFile(path) {
  if (!path || state.contextFiles.includes(path)) return;
  state.contextFiles.push(path);
  renderContextChips();
  toast(`Added context: ${path}`, 'info', { timeout: 2000 });
}

function removeContextFile(path) {
  state.contextFiles = state.contextFiles.filter((p) => p !== path);
  renderContextChips();
}

function renderAttachments() {
  const host = $('attachments');
  host.innerHTML = '';
  state.attachments.forEach((a, i) => {
    host.append(el('span', { class: 'chip' },
      el('img', { src: a.dataUrl, alt: a.name || 'attachment', style: { width: '16px', height: '16px', borderRadius: '4px', objectFit: 'cover' } }),
      el('span', { text: a.name || 'image' }),
      el('button', {
        type: 'button', text: '✕', title: 'Remove attachment',
        onclick: () => { state.attachments.splice(i, 1); renderAttachments(); }
      })
    ));
  });
}

function autosizeInput() {
  const input = $('promptInput');
  input.style.height = 'auto';
  input.style.height = `${Math.min(180, Math.max(56, input.scrollHeight))}px`;
}


function openContextPicker() {
  if (!workspace.ready) return toast('Open a folder first, then add context files.', 'warn');
  const filter = el('input', { class: 'input', placeholder: 'Filter files…', spellcheck: 'false' });
  const host = el('div', { class: 'picker-list' });
  const dialog = openModal({
    title: 'Add context files',
    sub: 'Reference files without editing them.',
    body: el('div', {}, el('div', { class: 'field' }, filter), host)
  });

  async function collect(prefix = '', handle = workspace.root, depth = 0) {
    if (workspace.mode === 'zip') return workspace.zipFiles.map((f) => f.path);
    const out = [];
    if (depth > 4) return out;
    for await (const [name, entry] of handle.entries()) {
      const path = joinPath(prefix, name);
      if (entry.kind === 'directory') {
        if (workspace.ignorePatterns.some((re) => re.test(name))) continue;
        out.push(...await collect(path, entry, depth + 1));
      } else {
        out.push(path);
      }
      if (out.length > 500) break;
    }
    return out;
  }

  collect().then((all) => {
    const draw = () => {
      host.innerHTML = '';
      const q = filter.value.trim().toLowerCase();
      const rows = all.filter((p) => !q || p.toLowerCase().includes(q)).slice(0, 200);
      if (!rows.length) { host.append(el('div', { class: 'picker-empty', text: 'No files match.' })); return; }
      for (const path of rows) {
        const inCtx = state.contextFiles.includes(path);
        host.append(el('button', {
          class: `model-row${inCtx ? ' is-active' : ''}`, type: 'button',
          onclick: () => { if (inCtx) removeContextFile(path); else addContextFile(path); draw(); }
        },
        el('span', { class: 'model-main' }, el('span', { class: 'model-id mono', text: path })),
        el('span', { class: 'model-fav', text: inCtx ? '✓' : '+' })));
      }
    };
    filter.addEventListener('input', draw);
    draw();
    filter.focus();
  }).catch((e) => toast(e.message, 'err'));
}

/* --------------------------------------------------------------- settings */

function openSettings() {
  const settings = getSettings();
  const tempRow = el('div', { class: 'field' },
    el('label', { text: `Temperature · ${Number(settings.temperature).toFixed(2)}` }),
    el('input', { class: 'input mono', type: 'number', min: 0, max: 2, step: 0.05, value: settings.temperature }));
  const maxRow = el('div', { class: 'field' },
    el('label', { text: 'Max output tokens' }),
    el('input', { class: 'input mono', type: 'number', min: 256, max: 65536, step: 256, value: settings.maxTokens }));
  const stepRow = el('div', { class: 'field' },
    el('label', { text: 'Max agent steps (loop guard)' }),
    el('input', { class: 'input mono', type: 'number', min: 1, max: 25, value: settings.maxSteps }));
  const ignoreRow = el('div', { class: 'field' },
    el('label', { text: 'Ignored files (comma globs)' }),
    el('textarea', { class: 'input mono', rows: 2 }, settings.ignoreGlobs));
  const body = el('div', {},
    tempRow, maxRow, stepRow,
    switchControl(settings.stream, (v) => saveSettings({ stream: v }), 'Stream responses', 'Token-by-token output.'),
    switchControl(settings.autoCreateFolder, (v) => saveSettings({ autoCreateFolder: v }), 'Auto-create project folder', 'Name the workspace from your first prompt.'),
    switchControl(settings.theme === 'light', (v) => { saveSettings({ theme: v ? 'light' : 'dark' }); applyTheme(); }, 'Light theme', 'Or keep the deep-space dark theme.'),
    el('div', { class: 'field' }, el('label', { text: 'Auto-approve' })),
    switchControl(settings.autoApprove.file, (v) => saveSettings({ autoApprove: { ...getSettings().autoApprove, file: v } }), 'New files', 'Apply file: blocks without asking.'),
    switchControl(settings.autoApprove.edit, (v) => saveSettings({ autoApprove: { ...getSettings().autoApprove, edit: v } }), 'Edits', 'Apply edit: patches without asking.'),
    switchControl(settings.autoApprove.folder, (v) => saveSettings({ autoApprove: { ...getSettings().autoApprove, folder: v } }), 'Folders', 'Apply folder: blocks without asking.'),
    switchControl(settings.autoApprove.delete, (v) => saveSettings({ autoApprove: { ...getSettings().autoApprove, delete: v } }), 'Deletes', 'Off is strongly recommended.'),
    ignoreRow);

  const dialog = openModal({
    title: 'Settings',
    sub: 'Generation, approvals and the explorer ignore list.',
    body,
    footer: [
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-primary', type: 'button', text: 'Save',
        onclick: () => {
          saveSettings({
            temperature: Number(tempRow.querySelector('input').value) || 0.2,
            maxTokens: Math.max(256, Number(maxRow.querySelector('input').value) || 4096),
            maxSteps: Math.min(25, Math.max(1, Number(stepRow.querySelector('input').value) || 6)),
            ignoreGlobs: ignoreRow.querySelector('textarea').value
          });
          renderModelPill();
          renderTree();
          dialog.close();
          toast('Settings saved.', 'ok');
        }
      })
    ]
  });
}

function applyTheme() {
  const theme = getSettings().theme || 'dark';
  document.body.dataset.theme = theme;
  document.documentElement.dataset.theme = theme;
}


async function restoreWorkspace() {
  if (!supportsFileSystemAccess()) { await refreshWorkspaceUI(); return; }
  try {
    const handle = await loadRootHandle();
    if (!handle) { await refreshWorkspaceUI(); return; }
    const ok = await verifyPermission(handle, 'readwrite', false);
    if (!ok) {
      workspace.ready = false;
      const reconnect = $('btn-reconnect-folder');
      if (reconnect) reconnect.classList.remove('hidden');
      banner('workspace', {
        kind: 'warn',
        title: 'Workspace needs permission again.',
        message: `“${handle.name}” was open last time.`,
        hint: 'Use “Reconnect folder” in the sidebar to grant access again.'
      });
      await refreshWorkspaceUI();
      return;
    }
    workspace.root = handle;
    workspace.name = handle.name || 'workspace';
    workspace.mode = 'fsa';
    workspace.ready = true;
    await refreshWorkspaceUI();
  } catch { await refreshWorkspaceUI(); }
}

async function reconnectWorkspace() {
  try {
    const handle = await loadRootHandle();
    if (!handle) return openWorkspaceFolder();
    const ok = await verifyPermission(handle, 'readwrite', true);
    if (!ok) return toast('Permission was not granted.', 'warn');
    workspace.root = handle;
    workspace.name = handle.name || 'workspace';
    workspace.mode = 'fsa';
    workspace.ready = true;
    clearBanner('workspace');
    const reconnect = $('btn-reconnect-folder');
    if (reconnect) reconnect.classList.add('hidden');
    await refreshWorkspaceUI();
    toast(`Reconnected to "${workspace.name}".`, 'ok');
  } catch (e) { toast(e.message || 'Could not reconnect.', 'err'); }
}

/* ------------------------------------------------------------------ boot */

function bindStaticUI() {
  const layout = document.querySelector('.layout');
  const scrim = document.querySelector('.scrim');
  if (scrim) scrim.addEventListener('click', () => layout.classList.remove('sidebar-open'));
  $('btn-toggle-sidebar').addEventListener('click', () => {
    if (window.matchMedia('(max-width: 900px)').matches) layout.classList.toggle('sidebar-open');
    else layout.classList.toggle('no-sidebar');
  });
  $('btn-new-chat').addEventListener('click', () => { newChat(); closeMobileSidebar(); });
  $('modelPill').addEventListener('click', openModelPicker);
  $('folderChip').addEventListener('click', () => {
    if (workspace.mode === 'zip') openZipMode();
    else openWorkspaceFolder();
  });
  $('btn-connections').addEventListener('click', () => openConnectionsModal());
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-theme').addEventListener('click', () => {
    saveSettings({ theme: getSettings().theme === 'light' ? 'dark' : 'light' });
    applyTheme();
  });
  $('btn-undo').addEventListener('click', openUndoPanel);
  $('btn-refresh-tree').addEventListener('click', renderTree);
  $('sidebarSearch').addEventListener('input', renderTree);
  $('btn-open-folder-side').addEventListener('click', openWorkspaceFolder);
  $('btn-reconnect-folder').addEventListener('click', reconnectWorkspace);
  $('btn-zip-mode').addEventListener('click', openZipMode);
  $('btn-download-zip').addEventListener('click', downloadZip);
  $('btn-stop').addEventListener('click', () => agent.stop());
  $('btn-close-preview').addEventListener('click', closePreview);
  $('btn-add-context').addEventListener('click', () => {
    if (state.currentPreview) addContextFile(state.currentPreview);
  });

  $('btn-attach').addEventListener('click', () => $('attachInput').click());
  $('attachInput').addEventListener('change', async () => {
    for (const file of $('attachInput').files) {
      if (!file.type.startsWith('image/')) { toast(`${file.name} is not an image — skipped.`, 'warn'); continue; }
      try { state.attachments.push({ name: file.name, dataUrl: await readFileAsDataUrl(file) }); }
      catch { toast(`Could not read ${file.name}.`, 'err'); }
    }
    $('attachInput').value = '';
    renderAttachments();
  });

  $('btn-send').addEventListener('click', () => runPrompt($('promptInput').value));
  $('promptInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runPrompt($('promptInput').value);
    }
  });
  $('promptInput').addEventListener('input', autosizeInput);
}

async function init() {
  applyTheme();
  bindStaticUI();
  renderStarters();
  renderAttachments();
  renderContextChips();
  updateUsageBar(state.usage);
  setStorageMode(getStorageMode() || 'local');
  refreshConnections();
  const settings = getSettings();
  state.favourites = settings.favourites || [];
  state.recents = getRecents();
  state.model = (state.activeConnection && (settings.lastModelByConnection || {})[state.activeConnection.id])
    || (state.activeConnection && state.activeConnection.defaultModel)
    || '';
  seedCatalog();
  if (!state.model && state.catalog.length) state.model = state.catalog[0].id;
  renderModelPill();
  await refreshUndoCount();
  await restoreWorkspace();
  await refreshCatalog({ silent: true });
  renderModelPill();
  autosizeInput();
  syncWorkspaceStatus();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => {
    console.error(e);
    toast('Something went wrong during startup — check the console.', 'err');
  });
});

