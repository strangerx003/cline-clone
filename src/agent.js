// The agent loop: stream a completion, extract file operations, apply them with
// approval, auto-fulfil `read:` requests, and continue until the task is done.

import { streamChat, ApiError } from './api.js';
import { parseOps, stripOps, OP_META, summarizeOps, applyEdits, diffLines, diffStats, buildTranscript } from './tools.js';

export const AgentEvents = {
  STEP_START: 'step-start',
  DELTA: 'delta',
  REASONING: 'reasoning',
  ASSISTANT_DONE: 'assistant-done',
  OPS: 'ops',
  OP_RESULT: 'op-result',
  CONTINUE: 'continue',
  DONE: 'done',
  ERROR: 'error',
  USAGE: 'usage',
  META: 'meta'
};

/**
 * ctx adapter supplied by the UI:
 *   {
 *     getConnection(): connection,
 *     getModel(): string,
 *     getSettings(): settings,
 *     workspace: {
 *       ready: boolean,
 *       name: string,
 *       exists(path) -> Promise<boolean>,
 *       readText(path) -> Promise<string>,
 *       writeText(path, text) -> Promise<void>,
 *       makeFolder(path) -> Promise<void>,
 *       remove(path) -> Promise<void>,
 *       snapshot(path) -> Promise<string|null>,  // previous content (undo journal)
 *       refresh() -> Promise<void>
 *     }
 *   }
 */
export class Agent {
  constructor(ctx) {
    this.ctx = ctx;
    this.messages = [];
    this.abortController = null;
    this.running = false;
    this.pending = [];
    this.filesChanged = [];
    this.startedAt = new Date();
    this.step = 0;
    this.listeners = new Map();
    this.pendingWaiters = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
    return this;
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) || []) {
      try { fn(payload); } catch (e) { console.error('[agent] listener failed', e); }
    }
  }

  reset() {
    this.messages = [];
    this.pending = [];
    this.filesChanged = [];
    this.step = 0;
    this.startedAt = new Date();
  }

  get isRunning() {
    return this.running;
  }

  stop() {
    if (this.abortController) this.abortController.abort();
    this.running = false;
  }

  setAutoApprove(patch) {
    const settings = this.ctx.getSettings();
    return { ...settings.autoApprove, ...patch };
  }

  /**
   * Runs the agent loop for one user prompt.
   * Resolves when the loop finishes, is stopped, or fails.
   */
  async send(userText) {
    if (this.running) throw new Error('Agent is already running.');
    const settings = this.ctx.getSettings();
    const connection = this.ctx.getConnection();
    const model = this.ctx.getModel();
    const workspace = this.ctx.workspace;

    if (!connection || !connection.apiKey) {
      this.emit(AgentEvents.ERROR, new ApiError('No API key configured.', {
        status: 401, hint: 'Open Connections and add a key (any format works).'
      }));
      return;
    }

    this.messages.push({ role: 'user', content: userText });
    this.abortController = new AbortController();
    this.running = true;
    this.filesChanged = [];
    const maxSteps = Math.max(1, Number(settings.maxSteps) || 6);

    try {
      for (this.step = 1; this.step <= maxSteps; this.step++) {
        this.emit(AgentEvents.STEP_START, { step: this.step, of: maxSteps });

        const { content } = await streamChat({
          connection,
          model,
          messages: this.buildPayload(settings, model),
          temperature: Number(settings.temperature),
          maxTokens: Number(settings.maxTokens) || 4096,
          stream: settings.stream !== false,
          signal: this.abortController.signal,
          onDelta: (t) => this.emit(AgentEvents.DELTA, t),
          onReasoning: (t) => this.emit(AgentEvents.REASONING, t),
          onUsage: (u, replace) => this.emit(AgentEvents.USAGE, { usage: u, replace }),
          onMeta: (m) => this.emit(AgentEvents.META, m)
        });

        if (this.abortController.signal.aborted) break;

        this.messages.push({ role: 'assistant', content });
        const ops = parseOps(content);
        this.emit(AgentEvents.ASSISTANT_DONE, { content, prose: stripOps(content, ops), summary: summarizeOps(ops), step: this.step });

        if (!ops.length) {
          await this.maybeWriteTranscript();
          this.emit(AgentEvents.DONE, { filesChanged: this.filesChanged, step: this.step });
          return;
        }

        const results = await this.runOps(ops);
        if (this.abortController.signal.aborted) break;

        const pending = results.filter((r) => r.status === 'pending');
        if (pending.length) {
          // Wait for the user's decisions before continuing the loop.
          const resolved = await this.awaitPending(pending.map((p) => p.id));
          results.length = 0;
          results.push(...resolved);
        }

        const readRequests = results.filter((r) => r.kind === 'read' && r.needsContent);
        const failures = results.filter((r) => r.status === 'failed' || r.status === 'partial');

        if (!readRequests.length && !failures.length) {
          await this.maybeWriteTranscript();
          this.emit(AgentEvents.DONE, { filesChanged: this.filesChanged, step: this.step });
          return;
        }

        this.messages.push({ role: 'user', content: this.buildFeedback({ results, readRequests, failures }) });
        this.emit(AgentEvents.CONTINUE, { step: this.step, reason: readRequests.length ? 'read' : 'failure' });
      }

      await this.maybeWriteTranscript();
      this.emit(AgentEvents.DONE, { filesChanged: this.filesChanged, maxReached: true, step: this.step - 1 });
    } catch (e) {
      if (e && e.name === 'AbortError') this.emit(AgentEvents.DONE, { stopped: true, filesChanged: this.filesChanged });
      else this.emit(AgentEvents.ERROR, e);
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

// ------------------------------------------------------------- approvals

/** Waits for every pending op to be approved/rejected by the UI. */
awaitPending(ids) {
  return new Promise((resolve) => {
    const resolved = new Map();
    const done = () => {
      if (resolved.size >= ids.length) {
        this.pendingWaiters.delete(ids.join(','));
        resolve(ids.map((id) => resolved.get(id)).filter(Boolean));
      }
    };
    if (!this.pendingWaiters) this.pendingWaiters = new Map();
    this.pendingWaiters.set(ids.join(','), (res) => {
      resolved.set(res.id, res);
      done();
    });
    // Fallback: if nothing arrives, resolve with rejections after 10 minutes.
    setTimeout(() => {
      for (const id of ids) {
        if (!resolved.has(id)) {
          const item = this.pending.find((p) => p.id === id);
          if (item) resolved.set(id, { ...item, status: 'rejected', message: 'Timed out waiting for approval.' });
        }
      }
      done();
    }, 600000);
  });
}

/** Called by the UI after approve()/reject() so the loop can continue. */
_notifyWaiter(res) {
  if (!this.pendingWaiters) return;
  for (const fn of this.pendingWaiters.values()) fn(res);
}

// ------------------------------------------------------------- prompt assembly

/** Builds the outbound message array (system prompt + trimmed history). */
buildPayload(settings, model) {
  const ws = this.ctx.workspace;
  const workspaceName = ws && ws.ready ? ws.name : null;
  const system = [
    settings.systemPrompt,
    workspaceName
      ? `\nThe workspace folder "${workspaceName}" is open and writable. Write files into it using relative paths.`
      : '\nNo workspace folder is open yet. Use relative paths; the app creates the root folder from the first prompt.',
    `\nCurrently selected model id: ${model}.`
  ].join('\n');

  return [{ role: 'system', content: system }, ...this.messages.slice(-24)];
}

/** Builds the follow-up user message describing the outcome of each op. */
buildFeedback({ results, readRequests, failures }) {
  const lines = ['[workspace] Results of your last file operations:'];

  for (const r of results) {
    const tag = r.status === 'applied' ? 'OK'
      : r.status === 'rejected' ? 'REJECTED'
        : r.status === 'partial' ? 'PARTIAL'
          : r.status === 'failed' ? 'FAILED' : 'PENDING';
    lines.push(`- ${tag} ${r.kind}:${r.path}${r.message ? ` — ${r.message}` : ''}`);
  }

  if (readRequests.length) {
    lines.push('', 'File contents you requested:');
    for (const r of readRequests) {
      lines.push('', `--- ${r.path} ---`, '```', r.fileContent == null ? '(file does not exist)' : r.fileContent, '```');
    }
    lines.push('', 'Use these contents and continue. Prefer `edit:` blocks with exact SEARCH anchors for changes.');
  }

  if (failures.length) {
    lines.push('', 'Some operations failed. Re-read the affected files and retry with corrected content or exact SEARCH anchors.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------- approvals

/**
 * Executes a batch of ops. Auto-approved ops run immediately; others are queued
 * for the UI to accept/reject (see approve() / reject()).
 */
async runOps(ops) {
  const settings = this.ctx.getSettings();
  const auto = settings.autoApprove || {};
  const workspace = this.ctx.workspace;

  const batch = ops.map((op) => this.prepareOp(op, workspace));
  this.emit(AgentEvents.OPS, { batch });

  const results = [];
  for (const item of batch) {
    const isAuto = item.kind === 'read' ? auto.read !== false
      : item.kind === 'delete' ? !!auto.delete
        : item.kind === 'folder' ? auto.folder !== false
          : item.kind === 'edit' ? auto.edit !== false
            : item.kind === 'file' ? auto.create !== false
              : false;

    if (!workspace.ready && item.kind !== 'read') {
      const res = { ...item, status: 'failed', message: 'No workspace folder is open.' };
      results.push(res);
      this.emit(AgentEvents.OP_RESULT, res);
      continue;
    }

    if (item.kind === 'read' && !isAuto) {
      item.status = 'pending';
      this.pending.push(item);
      results.push(item);
      continue;
    }

    if (isAuto) {
      const res = await this.applyOp(item, workspace);
      this._feedDiff(res, workspace);
      results.push(res);
      this.emit(AgentEvents.OP_RESULT, res);
    } else {
      item.status = 'pending';
      this.pending.push(item);
      results.push(item);
      this.emit(AgentEvents.OP_RESULT, item);
    }
  }
  return results;
}

/** Computes the preview/diff shown on an approval card. */
prepareOp(op, workspace) {
  const meta = OP_META[op.kind] || {};
  const base = {
    id: op.id,
    kind: op.kind,
    path: op.path,
    body: op.body,
    label: meta.label || op.kind,
    tone: meta.tone || 'edit',
    icon: meta.icon || '•',
    status: 'ready',
    message: '',
    created: false,
    diff: [],
    stats: { added: 0, removed: 0 },
    fileContent: null,
    needsContent: false
  };

  if (op.kind === 'file') {
    base.created = false; // refined in applyOp after checking the filesystem
    base.diff = diffLines('', op.body);
    base.stats = diffStats(base.diff);
  }
  return base;
}

/** Runs one prepared op against the workspace and reports the outcome. */
async applyOp(item, workspace) {
  try {
    if (item.kind === 'folder') {
      await workspace.makeFolder(item.path);
      return { ...item, status: 'applied', message: 'Folder created.' };
    }

    if (item.kind === 'read') {
      const exists = await workspace.exists(item.path);
      const text = exists ? await workspace.readText(item.path) : null;
      return {
        ...item,
        status: 'applied',
        needsContent: true,
        fileContent: text,
        message: exists ? `Read ${text.length} chars.` : 'File does not exist.'
      };
    }

    if (item.kind === 'delete') {
      if (!(await workspace.exists(item.path))) {
        return { ...item, status: 'failed', message: 'File does not exist.' };
      }
      const prev = await workspace.snapshot(item.path);
      await workspace.remove(item.path);
      this.noteChanged(item.path);
      const diff = diffLines(prev == null ? '' : prev, '');
      return { ...item, status: 'applied', diff, stats: diffStats(diff), message: 'Deleted (undo snapshot saved).' };
    }

    if (item.kind === 'file') {
      const existed = await workspace.exists(item.path);
      if (existed) await workspace.snapshot(item.path);
      await workspace.writeText(item.path, item.body);
      this.noteChanged(item.path);
      const diff = item.diff && item.diff.length ? item.diff : diffLines('', item.body);
      return {
        ...item,
        created: !existed,
        status: 'applied',
        diff,
        stats: diffStats(diff),
        message: existed ? 'File overwritten.' : 'File created.'
      };
    }

    if (item.kind === 'edit') {
      if (!(await workspace.exists(item.path))) {
        return { ...item, status: 'failed', message: `File not found: ${item.path}. Create it with a \`file:\` block first.` };
      }
      const before = await workspace.readText(item.path);
      const result = applyEdits(before, item.body);
      if (!result.applied) {
        return {
          ...item,
          status: 'failed',
          message: result.failed[0] ? result.failed[0].reason : 'No patches applied.',
          failedPatches: result.failed || []
        };
      }
      await workspace.snapshot(item.path);
      await workspace.writeText(item.path, result.content);
      this.noteChanged(item.path);
      const diff = diffLines(before, result.content);
      return {
        ...item,
        status: result.failed.length ? 'partial' : 'applied',
        applied: result.applied,
        failedPatches: result.failed || [],
        diff,
        stats: diffStats(diff),
        message: result.failed.length
          ? `${result.applied} patch(es) applied, ${result.failed.length} failed.`
          : `${result.applied} patch(es) applied.`
      };
    }

    return { ...item, status: 'failed', message: `Unsupported operation: ${item.kind}` };
  } catch (e) {
    return { ...item, status: 'failed', message: e && e.message ? e.message : String(e) };
  }
}

/** Attaches a diff to a result that was applied without one (create/overwrite). */
_feedDiff(res, workspace) {
  if (!res || res.diff && res.diff.length) return;
  if (res.kind === 'file' && res.body != null) {
    res.diff = diffLines('', res.body);
    res.stats = diffStats(res.diff);
  }
}

/** Applies a queued op the user just approved. */
async approve(opId) {
  const idx = this.pending.findIndex((p) => p.id === opId);
  if (idx < 0) return null;
  const item = this.pending.splice(idx, 1)[0];
  const res = await this.applyOp(item, this.ctx.workspace);
  this._feedDiff(res, this.ctx.workspace);
  this.emit(AgentEvents.OP_RESULT, res);
  this._notifyWaiter(res);
  return res;
}

/** Rejects a queued op. */
reject(opId, reason = 'Rejected by user.') {
  const idx = this.pending.findIndex((p) => p.id === opId);
  if (idx < 0) return null;
  const item = this.pending.splice(idx, 1)[0];
  const res = { ...item, status: 'rejected', message: reason };
  this.emit(AgentEvents.OP_RESULT, res);
  this._notifyWaiter(res);
  return res;
}

/** Approves or rejects every queued op at once. */
async resolveAll(decision) {
  const ids = this.pending.map((p) => p.id);
  const out = [];
  for (const id of ids) {
    out.push(decision === 'approve' ? await this.approve(id) : this.reject(id));
  }
  return out;
}

noteChanged(path) {
  if (path && !this.filesChanged.includes(path)) this.filesChanged.push(path);
  if (this.ctx.workspace && this.ctx.workspace.refresh) this.ctx.workspace.refresh();
}

/** Writes the prompt/response transcript into <root>/_chat/transcript.md. */
async maybeWriteTranscript() {
  const settings = this.ctx.getSettings();
  const workspace = this.ctx.workspace;
  if (!workspace || !workspace.ready || settings.autoCreateFolder === false) return;
  try {
    const md = buildTranscript({
      folderName: workspace.name,
      messages: this.messages,
      filesChanged: this.filesChanged,
      model: this.ctx.getModel(),
      startedAt: this.startedAt
    });
    await workspace.writeText('_chat/transcript.md', md);
  } catch { /* the transcript is best-effort */ }
}
}