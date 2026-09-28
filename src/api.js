// TokenHarbor / BazaarLink / any OpenAI- or Anthropic-compatible chat client.
// Streams SSE deltas, maps errors to friendly messages, and lists models.

import { normalizeLiveModels } from './models.js';

export function buildHeaders(connection) {
  const headers = { 'Content-Type': 'application/json' };
  const key = connection.apiKey || '';

  if (connection.apiStyle === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    // TokenHarbor also accepts Bearer on /v1/messages; harmless for real Anthropic.
    headers['Authorization'] = `Bearer ${key}`;
  } else {
    headers['Authorization'] = `Bearer ${key}`;
  }
  headers['Accept'] = 'text/event-stream, application/json';

  if (connection.headers && typeof connection.headers === 'object') {
    for (const [k, v] of Object.entries(connection.headers)) {
      if (k && v) headers[k] = String(v);
    }
  }
  return headers;
}

/** `https://host/v1` -> `https://host/v1/chat/completions` (or `/messages`). */
export function endpointFor(connection) {
  const base = String(connection.baseUrl || '').replace(/\/+$/, '');
  if (connection.apiStyle === 'anthropic') {
    // Anthropic SDKs append /v1/messages themselves; accept a root or /v1 base.
    return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  }
  return `${base}/chat/completions`;
}

export function modelsEndpointFor(connection) {
  const base = String(connection.baseUrl || '').replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', retryAfter = 0, hint = '', raw = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.hint = hint;
    this.raw = raw;
  }
}

/** Turns an HTTP failure body into a friendly, actionable ApiError. */
export function classifyError(status, body, retryAfterHeader, statusText = '') {
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  let parsed = null;
  try { parsed = typeof body === 'string' ? JSON.parse(body) : body; } catch { /* keep null */ }

  const err = (parsed && (parsed.error || parsed)) || {};
  const code = String(err.code || err.type || '').toLowerCase();
  const rawMsg = String(err.message || statusText || '').trim();
  const retryAfter = parseInt(retryAfterHeader || '0', 10) || 0;

  const opts = { status, code, retryAfter, raw: text.slice(0, 2000) };

  if (code === 'email_verification_required') {
    return new ApiError(
      'Your account email is not verified yet, so the gateway refuses API calls.',
      { ...opts, hint: 'Verify your email (check the signup link, or open the provider dashboard) and then retry.' }
    );
  }
  if (status === 401 || code === 'invalid_api_key') {
    return new ApiError('Invalid or revoked API key.', {
      ...opts,
      hint: 'Open Settings → Connections and check the key, or rotate it in the provider dashboard.'
    });
  }
  if (status === 402 || code === 'insufficient_credits' || code.includes('credit')) {
    return new ApiError('Not enough credits on this account for this request.', {
      ...opts,
      hint: 'Top up the account, or switch to a free model in the model picker.'
    });
  }
  if (status === 403) {
    return new ApiError(rawMsg || 'The provider refused this request (403).', {
      ...opts,
      hint: 'This can mean a blocked model, an unverified account, or a moderation block.'
    });
  }
  if (status === 404 || code === 'model_not_found') {
    return new ApiError(rawMsg || 'Model not found on this provider.', {
      ...opts,
      hint: 'Pick another model, or refresh the catalog in the model picker.'
    });
  }
  if (status === 429 || code.includes('rate')) {
    return new ApiError('Rate limit reached.', {
      ...opts,
      hint: retryAfter ? `Wait ${retryAfter}s and retry — the app will back off automatically.` : 'Wait a moment and retry.'
    });
  }
  if (status === 413) {
    return new ApiError('Request body is too large.', { ...opts, hint: 'Reduce the amount of attached context.' });
  }
  if (code.includes('context_length')) {
    return new ApiError('This conversation exceeded the model context window.', { ...opts, hint: 'Start a new chat, or pick a model with a larger context.' });
  }
  if (status === 500 || status === 502 || status === 503) {
    return new ApiError(rawMsg || `Provider temporarily unavailable (${status}).`, { ...opts, hint: 'Retry in a few seconds.' });
  }
  if (status === 0) {
    return new ApiError('Network request failed.', { ...opts, hint: 'Check your connection, the base URL, or whether the provider allows browser (CORS) requests.' });
  }
  return new ApiError(rawMsg || `Request failed with HTTP ${status}.`, opts);
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    }
  });
}

/** Builds the provider-specific request body. */
export function buildBody({ connection, model, messages, temperature, maxTokens, stream }) {
  if (connection.apiStyle === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    const body = { model, max_tokens: maxTokens || 4096, messages: rest, stream: !!stream };
    if (system) body.system = system;
    if (typeof temperature === 'number') body.temperature = temperature;
    return body;
  }
  return {
    model,
    messages,
    stream: !!stream,
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {})
  };
}

/** Async iterator over SSE lines from a fetch Response body. */
export async function* sseLines(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.trim()) yield line;
    }
  }
  const tail = buffer.replace(/\r$/, '').trim();
  if (tail) yield tail;
}

function extractOpenAIDelta(json, acc) {
  const choice = json.choices && json.choices[0];
  if (!choice) return;
  const delta = choice.delta || {};
  if (typeof delta.content === 'string' && delta.content) acc.onDelta(delta.content);
  const reasoning = delta.reasoning_content || delta.reasoning;
  if (typeof reasoning === 'string' && reasoning) acc.onReasoning(reasoning);
  if (typeof choice.text === 'string' && choice.text) acc.onDelta(choice.text);
}

function extractAnthropicDelta(json, acc) {
  if (json.type === 'content_block_delta' && json.delta) {
    if (typeof json.delta.text === 'string') acc.onDelta(json.delta.text);
    if (typeof json.delta.thinking === 'string') acc.onReasoning(json.delta.thinking);
  }
  if (json.type === 'message_start' && json.message && json.message.usage) {
    acc.onUsage({ input_tokens: json.message.usage.input_tokens || 0, output_tokens: 0, cache: json.message.usage.cache_read_input_tokens || 0 });
  }
  if (json.type === 'message_delta' && json.usage) {
    acc.onUsage({ input_tokens: 0, output_tokens: json.usage.output_tokens || 0, cache: 0 });
  }
  if (json.type === 'error' && json.error) {
    throw new ApiError(json.error.message || 'Upstream error', { code: json.error.type || 'upstream_error' });
  }
}
/**
 * Streams a chat completion. Calls onDelta(chunk) / onReasoning(chunk) as tokens
 * arrive and resolves with { content, usage, model }.
 */
export async function streamChat({
  connection, model, messages, temperature, maxTokens, signal,
  onDelta = () => {}, onReasoning = () => {}, onUsage = () => {}, onMeta = () => {},
  stream = true, retries = 2
}) {
  const url = endpointFor(connection);
  let attempt = 0;

  while (true) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(connection),
        body: JSON.stringify(buildBody({ connection, model, messages, temperature, maxTokens, stream })),
        signal
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new ApiError('Network request failed.', {
        status: 0,
        hint: 'Check the base URL, and whether the provider allows browser (CORS) requests.',
        raw: String(e && e.message)
      });
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      const err = classifyError(response.status, raw, response.headers.get('retry-after'), response.statusText);
      if (err.status === 429 && attempt < retries) {
        attempt++;
        await sleep(Math.max(err.retryAfter * 1000, 1500 * attempt), signal);
        continue;
      }
      throw err;
    }

    onMeta({
      cacheLayer: response.headers.get('x-th-cache-layer') || '',
      steering: response.headers.get('x-th-steering-applied') || ''
    });

    // Non-streaming, or a provider that ignored stream:true and sent plain JSON.
    const ctype = response.headers.get('content-type') || '';
    if (!stream || ctype.includes('application/json')) {
      const json = await response.json();
      const content = connection.apiStyle === 'anthropic'
        ? (json.content && json.content[0] && json.content[0].text) || ''
        : (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
      const usage = json.usage || {};
      onDelta(content);
      onUsage({
        input_tokens: usage.input_tokens || usage.prompt_tokens || 0,
        output_tokens: usage.output_tokens || usage.completion_tokens || 0,
        cache: usage.cache_read_input_tokens || 0
      }, true);
      return { content, usage, model: json.model || model };
    }

    let content = '';
    const usage = { input_tokens: 0, output_tokens: 0, cache: 0 };
    const acc = {
      onDelta: (t) => { content += t; onDelta(t); },
      onReasoning: (t) => onReasoning(t),
      onUsage: (u, replace) => {
        if (replace) {
          usage.input_tokens = Math.max(usage.input_tokens, u.input_tokens || 0);
          usage.output_tokens = Math.max(usage.output_tokens, u.output_tokens || 0);
        } else {
          usage.input_tokens += u.input_tokens || 0;
          usage.output_tokens += u.output_tokens || 0;
        }
        usage.cache += u.cache || 0;
        onUsage({ ...usage }, false);
      }
    };

    try {
      for await (const line of sseLines(response)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let json;
        try { json = JSON.parse(payload); } catch { continue; }

        if (json.usage) {
          acc.onUsage({ input_tokens: json.usage.prompt_tokens || 0, output_tokens: json.usage.completion_tokens || 0, cache: 0 }, true);
        }
        if (json.error) {
          throw new ApiError(json.error.message || 'Upstream error', { code: json.error.code || json.error.type || 'upstream_error' });
        }
        if (json.choices) extractOpenAIDelta(json, acc);
        if (typeof json.type === 'string') extractAnthropicDelta(json, acc);
      }
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (e instanceof ApiError) throw e;
      throw new ApiError(`Stream interrupted: ${e && e.message ? e.message : 'unknown error'}`, { raw: String(e) });
    }

    return { content, usage, model };
  }
}

/** Fetches and normalizes a provider's model catalog. */
export async function listModels(connection, { signal } = {}) {
  const res = await fetch(modelsEndpointFor(connection), { headers: buildHeaders(connection), signal });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw classifyError(res.status, raw, res.headers.get('retry-after'), res.statusText);
  }
  const json = await res.json();
  return normalizeLiveModels(json);
}

/** Tiny request used by the "Test connection" button. */
export async function testConnection({ connection, model, signal }) {
  const started = performance.now();
  const result = await streamChat({
    connection,
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    temperature: 0,
    maxTokens: 8,
    stream: false,
    retries: 0,
    signal
  });
  return {
    latencyMs: Math.round(performance.now() - started),
    reply: String(result.content || '').trim().slice(0, 40),
    model: result.model
  };
}