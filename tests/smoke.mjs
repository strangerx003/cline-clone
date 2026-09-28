// Smoke test: static integrity of the app sources.
// Run with: node tests/smoke.mjs   (npm test)

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
let failures = 0;

function fail(msg) {
  failures += 1;
  console.error(`FAIL  ${msg}`);
}

function pass(msg) {
  console.log(`ok    ${msg}`);
}

// 1. Every source file parses.
const files = readdirSync(srcDir).filter((f) => f.endsWith('.js'));
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', join(srcDir, f)], { stdio: 'pipe' });
    pass(`node --check src/${f}`);
  } catch (e) {
    fail(`syntax error in src/${f}\n${e.stderr || e.message}`);
  }
}

// 2. index.html wires ui.js as a module and defines every id the UI looks up.
const html = readFileSync(join(root, 'index.html'), 'utf8');
if (html.includes('src="./src/ui.js"')) pass('index.html loads ./src/ui.js');
else fail('index.html does not load ./src/ui.js');

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const ui = readFileSync(join(srcDir, 'ui.js'), 'utf8');
const usedIds = new Set([...ui.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
const missingIds = [...usedIds].filter((id) => !htmlIds.has(id));
if (missingIds.length) fail(`ui.js looks up ids missing from index.html: ${missingIds.join(', ')}`);
else pass(`all ${usedIds.size} $('…') ids exist in index.html`);

// 3. No duplicate top-level function declarations (merge regressions).
const declared = [...ui.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
const seen = new Set();
const dupes = new Set();
for (const name of declared) {
  if (seen.has(name)) dupes.add(name);
  seen.add(name);
}
if (dupes.size) fail(`duplicate top-level functions: ${[...dupes].join(', ')}`);
else pass(`no duplicate functions among ${declared.length} declarations`);

// 4. Every named import resolves to an export in its module.
let importOk = true;
for (const m of ui.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([\w-]+)\.js'/g)) {
  const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  const modSrc = readFileSync(join(srcDir, `${m[2]}.js`), 'utf8');
  for (const name of names) {
    const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class|let)\\s+${name}\\b`);
    if (!re.test(modSrc)) {
      fail(`import { ${name} } not exported by src/${m[2]}.js`);
      importOk = false;
    }
  }
}
if (importOk) pass('all named imports resolve');

// 5. Boot wiring exists.
for (const fn of ['bindStaticUI', 'init', 'openConnectionsModal', 'openModelPicker', 'openSettings', 'openUndoPanel']) {
  if (!declared.includes(fn)) fail(`missing required function: ${fn}`);
}
if (!ui.includes("DOMContentLoaded")) fail('no DOMContentLoaded bootstrap');
else pass('bootstrap + required entry points present');

// 6. Stylesheet covers the layout classes the UI relies on.
const css = readFileSync(join(root, 'styles.css'), 'utf8');
for (const cls of ['conn-card', 'model-row', 'picker-list', 'context-chips', 'usage-bar', 'toast-host', 'banner-host', 'modal-host']) {
  if (!css.includes(`.${cls}`)) fail(`styles.css missing .${cls}`);
}
pass('styles.css covers key component classes');

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 7. Boot test: import the real ui.js against a stubbed DOM and run init().
// ---------------------------------------------------------------------------

class Node {}
globalThis.Node = Node;

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  };
}

function makeEl(tag = 'div') {
  const n = new Node();
  const classes = new Set();
  const obj = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    childNodes: [],
    style: {},
    dataset: {},
    textContent: '',
    title: '',
    value: '',
    checked: false,
    disabled: false,
    scrollTop: 0,
    scrollHeight: 120,
    files: [],
    listeners: {},
    classList: {
      add(...cs) { cs.forEach((c) => classes.add(c)); },
      remove(...cs) { cs.forEach((c) => classes.delete(c)); },
      toggle(c, force) {
        if (force === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); }
        else if (force) classes.add(c); else classes.delete(c);
      },
      contains(c) { return classes.has(c); }
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    append(...nodes) { this.children.push(...nodes.flat()); },
    prepend(...nodes) { this.children.unshift(...nodes.flat()); },
    remove() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    focus() {},
    click() {}
  };
  Object.assign(n, obj);
  // keep className <-> classList in sync, like a real DOM element
  Object.defineProperty(n, 'className', {
    get() { return [...classes].join(' '); },
    set(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    configurable: true
  });
  // setting innerHTML replaces children, like a real DOM element
  let html = '';
  Object.defineProperty(n, 'innerHTML', {
    get() { return html; },
    set(v) { html = String(v); n.children.length = 0; },
    configurable: true
  });
  return n;
}

const elements = new Map();
const docListeners = {};
globalThis.document = {
  addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
  removeEventListener() {},
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeEl());
    return elements.get(id);
  },
  createElement: (tag) => makeEl(tag),
  createDocumentFragment: () => makeEl('#fragment'),
  createTextNode: (text) => { const n = new Node(); n.nodeType = 3; n.textContent = String(text); return n; },
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  body: makeEl('body'),
  documentElement: makeEl('html')
};

globalThis.window = {
  localStorage: makeStorage(),
  sessionStorage: makeStorage(),
  isSecureContext: false,
  showDirectoryPicker: undefined,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} }, userAgent: 'smoke-test' },
  configurable: true
});
globalThis.requestAnimationFrame = (fn) => { fn(0); return 0; };
globalThis.cancelAnimationFrame = () => {};
globalThis.fetch = async () => { throw new Error('offline (smoke test)'); };

const consoleErrors = [];
const origError = console.error;
console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')); origError(...args); };

try {
  await import('../src/ui.js');
  pass('ui.js module evaluates');

  const handlers = docListeners.DOMContentLoaded || [];
  if (!handlers.length) fail('DOMContentLoaded handler was not registered');
  else {
    handlers.forEach((fn) => fn());
    // init() ends by autosizing the composer — poll for that marker.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !elements.get('promptInput').style.height) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (!elements.get('promptInput').style.height) fail('init() did not complete within 5s');
    else pass('init() completed against stubbed DOM');
  }

  const pill = elements.get('modelPillLabel');
  if (!pill || !pill.textContent) fail('modelPillLabel was not populated by renderModelPill');
  else pass(`model pill shows "${pill.textContent}"`);

  const folder = elements.get('folderChipName');
  if (!folder || folder.textContent !== 'No folder open') fail(`folderChipName = "${folder ? folder.textContent : ''}"`);
  else pass('folder chip reflects closed workspace');

  const starters = elements.get('starterList');
  if (!starters || starters.children.length !== 3) fail('starter prompts not rendered');
  else pass('3 starter prompts rendered');

  const tree = elements.get('treeRoot');
  if (!tree || !tree.children.length) fail('explorer not rendered');
  else pass('explorer tree rendered');

  if (consoleErrors.length) fail(`init() logged errors: ${consoleErrors.join(' | ')}`);
  else pass('no console.error during boot');

  // --- interaction tests: fire the real handlers wired by bindStaticUI() ---
  const fire = (id, type = 'click', event = {}) => {
    const node = elements.get(id);
    const list = (node && node.listeners && node.listeners[type]) || [];
    list.forEach((fn) => fn({ currentTarget: node, target: node, preventDefault() {}, stopPropagation() {}, ...event }));
    return list.length;
  };
  const modalHostNode = () => document.getElementById('modalHost');
  const modalOpen = () => modalHostNode().children.length > 0;

  // 1. Connections modal
  const wired1 = fire('btn-connections');
  if (!wired1) fail('btn-connections has no click handler');
  else if (!modalOpen()) fail('Connections modal did not open');
  else {
    pass('Connections modal opens via real click handler');
    const host = modalHostNode();
    // exercise Add: fill textarea, click the add button inside the modal
    const findBtn = (root, label) => {
      const stack = [...root.children];
      while (stack.length) {
        const n = stack.shift();
        if (n && (n.textContent === label) && n.listeners && n.listeners.click) return n;
        if (n && n.children) stack.push(...n.children);
      }
      return null;
    };
    const addBtn = findBtn(host, 'Add key(s)');
    if (!addBtn) fail('Connections modal missing "Add key(s)" button');
    else {
      // locate the key textarea within the modal
      const findTA = (root) => {
        const stack = [...root.children];
        while (stack.length) {
          const n = stack.shift();
          if (n && n.tagName === 'TEXTAREA') return n;
          if (n && n.children) stack.push(...n.children);
        }
        return null;
      };
      const ta = findTA(host);
      if (!ta) fail('Connections modal missing key textarea');
      else {
        ta.value = 'sk-test-123';
        addBtn.listeners.click.forEach((fn) => fn({ currentTarget: addBtn, preventDefault() {}, stopPropagation() {} }));
        const stored = JSON.parse(window.localStorage.getItem('cline-web.connections.v1') || '[]');
        const mine = stored.find((c) => c.apiKey === 'sk-test-123');
        if (!mine) fail(`connection not persisted under cline-web.connections.v1 (got ${stored.length} entries)`);
        else pass(`connection added & persisted (id=${mine.id.slice(0, 8)}…, provider=${mine.provider})`);
      }
    }
    host.children.length = 0; // close for next test
  }

  // 2. Model picker
  const wired2 = fire('modelPill');
  if (!wired2) fail('modelPill has no click handler');
  else if (!modalOpen()) fail('Model picker did not open');
  else {
    const rows = [];
    const walk = (n) => { if (!n || !n.children) return; for (const c of n.children) { if (c.classList && c.classList.contains('model-row')) rows.push(c); walk(c); } };
    walk(modalHostNode());
    if (!rows.length) fail('Model picker rendered 0 model rows');
    else pass(`Model picker opens with ${rows.length} model rows`);
    modalHostNode().children.length = 0;
  }

  // 3. Settings modal
  const wired3 = fire('btn-settings');
  if (!wired3) fail('btn-settings has no click handler');
  else if (!modalOpen()) fail('Settings modal did not open');
  else { pass('Settings modal opens via real click handler'); modalHostNode().children.length = 0; }

  // 4. Theme toggle round-trip
  fire('btn-theme');
  const theme1 = document.documentElement.dataset.theme;
  fire('btn-theme');
  const theme2 = document.documentElement.dataset.theme;
  if (!theme1 || !theme2 || theme1 === theme2) fail(`theme toggle broken: ${theme1} -> ${theme2}`);
  else pass(`theme toggles ${theme1} -> ${theme2}`);

  if (consoleErrors.length) fail(`interaction tests logged errors: ${consoleErrors.join(' | ')}`);
  else pass('no console.error during interactions');
} catch (e) {
  fail(`boot threw: ${e && e.stack ? e.stack : e}`);
} finally {
  console.error = origError;
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
process.exit(0);
