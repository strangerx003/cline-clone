// Cline-style file-operation protocol: parsing, applying edits, and unified diffs.
//
// Supported blocks (fenced, path on the opening line):
//   ```file:src/app.js      -> create / overwrite
//   ```edit:src/app.js      -> SEARCH/REPLACE patches
//   ```delete:old.txt
//   ```read:src/app.js      -> auto-fulfilled by the app
//   ```folder:assets/img

export const OP_TYPES = ['file', 'edit', 'delete', 'read', 'folder'];

const OPEN_RE = /^\s{0,3}```\s*(file|edit|delete|read|folder)\s*(?::|\s)\s*(.*)$/i;
const CLOSE_RE = /^\s{0,3}```\s*$/;

/**
 * Scans assistant text and extracts every operation block.
 * Returns { ops: [...], bare: [ids] } where `bare` are read paths requested
 * without a body (also accepted as ```read:path on their own line).
 */
export function parseOps(text) {
  const lines = String(text || '').split(/\r?\n/);
  const ops = [];

  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(OPEN_RE);
    if (!open) continue;

    const kind = open[1].toLowerCase();
    let path = String(open[2] || '').trim().replace(/^["'`]|["'`]$/g, '');

    // Optional `path:` line as the first body line.
    const body = [];
    let j = i + 1;
    const firstIsPath = j < lines.length && /^\s*(path|file|filename|dir|folder)\s*:\s*.+$/i.test(lines[j]);
    if (!path && firstIsPath) {
      path = lines[j].replace(/^\s*(path|file|filename|dir|folder)\s*:\s*/i, '').trim();
      j++;
    } else if (path && firstIsPath && /^\s*(path|file|filename)\s*:/i.test(lines[j])) {
      j++; // tolerate a redundant path: line
    }

    for (; j < lines.length; j++) {
      if (CLOSE_RE.test(lines[j])) break;
      body.push(lines[j]);
    }

    // Trim leading/trailing blank lines from the captured body.
    while (body.length && body[0].trim() === '') body.shift();
    while (body.length && body[body.length - 1].trim() === '') body.pop();

    path = path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!path && kind !== 'edit') continue;

    ops.push({
      id: `op-${ops.length}-${kind}`,
      kind,
      path,
      body: body.join('\n'),
      raw: lines.slice(i, Math.min(j + 1, lines.length)).join('\n')
    });

    i = j;
  }

  // De-duplicate exact repeats (models sometimes echo the same block twice).
  const seen = new Set();
  return ops.filter((op) => {
    const key = `${op.kind}|${op.path}|${op.body.length}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Removes operation blocks so the chat bubble shows prose, not fences. */
export function stripOps(text, ops = parseOps(text)) {
  let out = String(text || '');
  for (const op of ops) {
    if (out.includes(op.raw)) out = out.replace(op.raw, '');
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Numeric/color metadata for each op type (used by the action cards). */
export const OP_META = {
  file: { label: 'Create file', verb: 'wrote', icon: '✚', tone: 'create' },
  edit: { label: 'Edit file', verb: 'edited', icon: '✎', tone: 'edit' },
  delete: { label: 'Delete file', verb: 'deleted', icon: '✖', tone: 'delete' },
  read: { label: 'Read file', verb: 'read', icon: '👁', tone: 'read' },
  folder: { label: 'Create folder', verb: 'created', icon: '📁', tone: 'folder' }
};

/** Groups ops for the summary card. */
export function summarizeOps(ops) {
  const counts = { file: 0, edit: 0, delete: 0, read: 0, folder: 0 };
  for (const op of ops) if (counts[op.kind] !== undefined) counts[op.kind]++;
  const changed = counts.file + counts.edit + counts.delete;
  return { counts, changed };
}
// ------------------------------------------------------- SEARCH/REPLACE blocks

/**
 * Extracts Cline-style SEARCH/REPLACE pairs from an edit block body.
 * Accepts the classic 7-angle-bracket markers plus light variants.
 */
export function parseSearchReplace(body) {
  const text = String(body || '');
  const pairs = [];
  const re = /^[ \t]*(<{3,})\s*SEARCH\s*\r?\n([\s\S]*?)^[ \t]*={3,}\s*\r?\n([\s\S]*?)^[ \t]*(>{3,})\s*(?:REPLACE)?\s*$/gm;

  let m;
  while ((m = re.exec(text)) !== null) {
    pairs.push({
      search: m[2].replace(/\r\n/g, '\n').replace(/\n$/, ''),
      replace: m[3].replace(/\r\n/g, '\n').replace(/\n$/, '')
    });
  }
  return pairs;
}

/** Leading-whitespace-insensitive search, preserving the file's own indentation. */
export function fuzzyReplace(content, search, replace) {
  const lines = content.split('\n');
  const sLines = search.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (!sLines.length) return null;

  for (let i = 0; i < lines.length; i++) {
    let matched = true;
    let k = 0;
    for (let j = i; j < lines.length && k < sLines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (lines[j].trim() !== sLines[k]) { matched = false; break; }
      k++;
    }
    if (!matched || k !== sLines.length) continue;

    // Find the last line consumed by the match, then reuse the matched indent.
    let end = i;
    let seen = 0;
    while (end < lines.length && seen < sLines.length) {
      if (lines[end].trim() !== '') seen++;
      end++;
    }
    const indent = (lines[i].match(/^[ \t]*/) || [''])[0];
    const rep = replace.split('\n').map((l) => (l.trim() === '' ? l : indent + l.replace(/^[ \t]*/, ''))).join('\n');
    return { content: [...lines.slice(0, i), ...rep.split('\n'), ...lines.slice(end)].join('\n'), mode: 'fuzzy', line: i + 1 };
  }
  return null;
}

/**
 * Applies one edit op to `current` content.
 * Returns { ok, content, applied, failed } — failures are reported, not thrown,
 * so the remaining patches still get a chance to apply.
 */
export function applyEdits(current, body) {
  const pairs = parseSearchReplace(body);
  if (!pairs.length) {
    return { ok: false, content: current, applied: 0, failed: [{ index: 0, reason: 'No SEARCH/REPLACE blocks found in the edit block.' }] };
  }

  let content = current == null ? '' : String(current);
  let applied = 0;
  const failed = [];

  pairs.forEach((pair, index) => {
    if (pair.search === '') {
      content = pair.replace; // empty SEARCH means "replace the entire file"
      applied++;
      return;
    }
    if (content.includes(pair.search)) {
      content = content.replace(pair.search, pair.replace);
      applied++;
      return;
    }
    const fuzzy = fuzzyReplace(content, pair.search, pair.replace);
    if (fuzzy) {
      content = fuzzy.content;
      applied++;
      return;
    }
    failed.push({
      index,
      reason: 'SEARCH anchor not found in the file.',
      searchPreview: pair.search.split('\n').slice(0, 3).join('\n')
    });
  });

  return { ok: failed.length === 0, content, applied, failed };
}
// ------------------------------------------------------------------- diffs

/** Standard LCS table for line diffing. */
function lcsMatrix(a, b) {
  const n = a.length, m = b.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

/**
 * Produces an ordered diff: [{ type:'context'|'add'|'del', text, oldLine, newLine }]
 */
export function diffLines(oldText, newText, { maxLines = 4000 } = {}) {
  const a = String(oldText == null ? '' : oldText).split('\n');
  const b = String(newText == null ? '' : newText).split('\n');

  if (a.length > maxLines || b.length > maxLines) {
    // Coarse fallback for very large inputs: treat it as a whole-file replace.
    return [
      ...a.map((t, i) => ({ type: 'del', text: t, oldLine: i + 1, newLine: null })),
      ...b.map((t, i) => ({ type: 'add', text: t, oldLine: null, newLine: i + 1 }))
    ];
  }

  const dp = lcsMatrix(a, b);
  const out = [];
  let i = 0, j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i], oldLine: i + 1, newLine: null });
      i++;
    } else {
      out.push({ type: 'add', text: b[j], oldLine: null, newLine: j + 1 });
      j++;
    }
  }
  while (i < a.length) { out.push({ type: 'del', text: a[i], oldLine: i + 1, newLine: null }); i++; }
  while (j < b.length) { out.push({ type: 'add', text: b[j], oldLine: null, newLine: j + 1 }); j++; }

  return out;
}

/** Collapses long runs of unchanged lines into hunks with N lines of context. */
export function toHunks(diff, context = 3) {
  const keep = new Array(diff.length).fill(false);

  diff.forEach((row, idx) => {
    if (row.type === 'context') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(diff.length - 1, idx + context); k++) keep[k] = true;
  });

  const hunks = [];
  let current = null;
  diff.forEach((row, idx) => {
    if (keep[idx]) {
      if (!current) { current = []; hunks.push(current); }
      current.push(row);
    } else {
      current = null;
    }
  });
  return hunks;
}

/** +N / -M counters for the diff badge. */
export function diffStats(diff) {
  let added = 0, removed = 0;
  for (const row of diff) {
    if (row.type === 'add') added++;
    else if (row.type === 'del') removed++;
  }
  return { added, removed };
}
// ------------------------------------------------------- lightweight highlight

const KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|class|new|import|from|export|def|elif|try|except|finally|async|await|public|private|static|void|int|string|bool|null|None|True|False|self|this|switch|case|break|continue|type|interface|extends|implements|package|then|do|fi|esac|echo|pip|npm|git|cd)\b/g;
const STRING_RE = /(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g;
const COMMENT_RE = /(\/\/.*$|#.*$)/;

/** Escapes first, then wraps tokens in spans (XSS-safe for model output). */
export function highlight(line) {
  let out = String(line)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const strings = [];
  out = out.replace(STRING_RE, (m) => {
    strings.push(m);
    return `\u0000${strings.length - 1}\u0000`;
  });
  out = out.replace(COMMENT_RE, '<span class="tk-comment">$1</span>');
  out = out.replace(KEYWORDS, '<span class="tk-keyword">$1</span>');
  out = out.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tk-number">$1</span>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, n) => `<span class="tk-string">${strings[Number(n)]}</span>`);
  return out;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Minimal, XSS-safe markdown renderer for chat bubbles. */
export function renderMarkdown(text) {
  const blocks = [];
  let src = String(text == null ? '' : text);

  // Pull fenced code out first, leaving placeholders behind.
  src = src.replace(/```([a-zA-Z0-9_+-]*)\r?\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push({ lang: lang || 'text', code });
    return `\u0001CODE${blocks.length - 1}\u0001`;
  });

  let html = escapeHtml(src);

  html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

  html = html.replace(/^####\s+(.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/^\s*\d+\.\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/(?:<li>[\s\S]*?<\/li>\s*)+/g, (m) => `<ul>${m}</ul>`);

  html = html.split(/\n{2,}/).map((chunk) => {
    const t = chunk.trim();
    if (!t) return '';
    if (/^<(h[1-4]|ul|blockquote|pre|div)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  html = html.replace(/\u0001CODE(\d+)\u0001/g, (_, n) => {
    const b = blocks[Number(n)];
    if (!b) return '';
    return `<pre class="code-block"><div class="code-block-head"><span>${escapeHtml(b.lang)}</span>` +
      `<button class="mini-btn copy-code" type="button">Copy</button></div>` +
      `<code>${escapeHtml(b.code)}</code></pre>`;
  });

  return html;
}

/** Builds the plain-text transcript written to <folder>/_chat/transcript.md. */
export function buildTranscript({ folderName, messages, filesChanged = [], model = '', startedAt = new Date() }) {
  const lines = [
    `# Chat transcript — ${folderName}`,
    '',
    `- Model: \`${model}\``,
    `- Started: ${startedAt.toISOString()}`,
    ''
  ];
  for (const m of messages) {
    lines.push(`## ${m.role === 'user' ? 'User' : 'Assistant'}`);
    lines.push('');
    lines.push(String(m.content || '').trim());
    lines.push('');
  }
  if (filesChanged.length) {
    lines.push('## Files changed');
    lines.push('');
    for (const f of filesChanged) lines.push(`- \`${f}\``);
    lines.push('');
  }
  return lines.join('\n');
}