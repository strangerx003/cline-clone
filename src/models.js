// Embedded model catalog for TokenHarbor and BazaarLink + live catalog normalizer.
// Used as an offline fallback so the picker works even if GET /v1/models fails.

export const DEFAULT_CATALOG = {
  tokenharbor: [
    { id: 'deepseek-v4.1-flash:free', label: 'DeepSeek V4.1 Flash', family: 'deepseek', tier: 'free', isFree: true, priceIn: 0, priceOut: 0, contextLength: 128000, modalities: ['text', 'image'], description: 'Ultra-fast DeepSeek V4.1 Flash at zero cost on TokenHarbor.' },
    { id: 'mimo-v2.6-flash:free', label: 'MiMo V2.6 Flash', family: 'xiaomi', tier: 'free', isFree: true, priceIn: 0, priceOut: 0, contextLength: 128000, modalities: ['text', 'image', 'audio', 'video'], description: 'Xiaomi MiMo V2.6 multimodal model, free on TokenHarbor.' },
    { id: 'qwen3.8-flash:free', label: 'Qwen3.8 Flash', family: 'qwen', tier: 'free', isFree: true, priceIn: 0, priceOut: 0, contextLength: 128000, modalities: ['text', 'image', 'video'], description: 'Alibaba Qwen3.8 Flash (promotional free variant).' },
    { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', family: 'deepseek', tier: 'value', isFree: false, priceIn: 0.3, priceOut: 1.2, contextLength: 128000, modalities: ['text', 'image'], description: 'Paid priority tier of DeepSeek V4.1 Flash.' },
    { id: 'mimo-v2.6-flash', label: 'MiMo V2.6 Flash', family: 'xiaomi', tier: 'value', isFree: false, priceIn: 0.14, priceOut: 0.28, contextLength: 128000, modalities: ['text', 'image', 'audio', 'video'], description: 'Xiaomi MiMo V2.6 Flash with paid rate limits.' },
    { id: 'mimo-v2.6-pro', label: 'MiMo V2.6 Pro', family: 'xiaomi', tier: 'value', isFree: false, priceIn: 0.435, priceOut: 0.87, contextLength: 128000, modalities: ['text', 'image', 'audio', 'video'], description: 'Flagship MiMo reasoning model.' },
    { id: 'qwen3.8-flash', label: 'Qwen3.8 Flash', family: 'qwen', tier: 'value', isFree: false, priceIn: 0.15, priceOut: 0.47, contextLength: 128000, modalities: ['text', 'image', 'video'], description: 'Fast multimodal Qwen3.8.' },
    { id: 'qwen3.8-max', label: 'Qwen3.8 Max', family: 'qwen', tier: 'frontier', isFree: false, priceIn: 2, priceOut: 6, contextLength: 1000000, modalities: ['text', 'image', 'video'], description: 'Qwen3.8 flagship frontier model.' },
    { id: 'qwen3.8-27b', label: 'Qwen3.8 27B', family: 'qwen', tier: 'value', isFree: false, priceIn: 0.35, priceOut: 2.1, contextLength: 128000, modalities: ['text', 'image', 'video'], description: 'Open-weight Qwen3.8 27B.' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', family: 'openai', tier: 'value', isFree: false, priceIn: 0.1, priceOut: 0.5, contextLength: 1050000, modalities: ['text', 'image', 'file'], description: 'OpenAI lightweight next-gen model.' },
    { id: 'gpt-6-sol', label: 'GPT-6 Sol', family: 'openai', tier: 'frontier', isFree: false, priceIn: 2, priceOut: 10, contextLength: 1050000, modalities: ['text', 'image', 'file'], description: 'High-reasoning frontier OpenAI model.' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', family: 'openai', tier: 'frontier', isFree: false, priceIn: 10, priceOut: 50, contextLength: 1050000, modalities: ['text', 'image', 'file'], description: 'Most capable OpenAI frontier model.' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', family: 'openai', tier: 'frontier', isFree: false, priceIn: 2, priceOut: 12, contextLength: 1050000, modalities: ['text', 'image', 'file'], description: 'OpenAI GPT-5.6 Terra.' },
    { id: 'glm-5.3', label: 'GLM-5.3', family: 'z-ai', tier: 'frontier', isFree: false, priceIn: 1.4, priceOut: 4.4, contextLength: 200000, modalities: ['text', 'image'], description: 'Zhipu AI GLM-5.3 flagship.' },
    { id: 'glm-5.3-flash', label: 'GLM 5.3 Flash', family: 'z-ai', tier: 'value', isFree: false, priceIn: 0.15, priceOut: 0.5, contextLength: 200000, modalities: ['text', 'image'], description: 'Zhipu AI high-speed Flash model.' },
    { id: 'claude-opus-5.5', label: 'Claude Opus 5.5', family: 'anthropic', tier: 'frontier', isFree: false, priceIn: 4, priceOut: 20, contextLength: 200000, modalities: ['text', 'image', 'file'], description: 'Anthropic state-of-the-art coding model.' },
    { id: 'claude-fable-5.1', label: 'Claude Fable 5.1', family: 'anthropic', tier: 'frontier', isFree: false, priceIn: 10, priceOut: 50, contextLength: 200000, modalities: ['text', 'image', 'file'], description: 'Anthropic Claude Fable 5.1.' },
    { id: 'grok-4.7', label: 'Grok 4.7', family: 'xai', tier: 'frontier', isFree: false, priceIn: 2, priceOut: 6, contextLength: 256000, modalities: ['text', 'image'], description: 'xAI Grok 4.7.' },
    { id: 'kimi-k3', label: 'Kimi K3', family: 'moonshot', tier: 'frontier', isFree: false, priceIn: 3, priceOut: 15, contextLength: 256000, modalities: ['text', 'image'], description: 'Moonshot Kimi K3 long-context model.' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', family: 'google', tier: 'value', isFree: false, priceIn: 0.75, priceOut: 3.75, contextLength: 1000000, modalities: ['text', 'image', 'audio', 'file'], description: 'Google Gemini 3.8 Flash.' },
    { id: 'muse-spark-1-3', label: 'Muse Spark 1.3', family: 'muse', tier: 'frontier', isFree: false, priceIn: 1.25, priceOut: 4.25, contextLength: 200000, modalities: ['text', 'image'], description: 'Muse Spark 1.3.' }
  ],
  bazaarlink: [
    { id: 'deepseek/deepseek-v4-flash-0731free:free', label: 'DeepSeek V4 Flash (Free)', family: 'deepseek', tier: 'free', isFree: true, priceIn: 0, priceOut: 0, contextLength: 1048576, modalities: ['text'], description: 'Free DeepSeek V4 Flash with 1M context window and code reasoning.' },
    { id: 'qwen/qwen3.7-flash:free', label: 'Qwen3.7 Flash (Free)', family: 'qwen', tier: 'free', isFree: true, priceIn: 0, priceOut: 0, contextLength: 1000000, modalities: ['text', 'image', 'video'], description: 'Free Qwen3.7 Flash with a 1M context window.' },
    { id: 'auto:free', label: 'Auto Free Router', family: 'bazaarlink', tier: 'free', isFree: true, priceIn: 0, priceOut: 0, contextLength: 1000000, modalities: ['text'], description: 'Automatically routes to an active free coding model.' },
    { id: 'deepseek/deepseek-v4-flash-0731free', label: 'DeepSeek V4 Flash 0731 (Free)', family: 'deepseek', tier: 'free', isFree: true, priceIn: 0, priceOut: 0, contextLength: 1048576, modalities: ['text'], description: 'Free DeepSeek V4 Flash with a 1M context window.' },
    { id: 'qwen/qwen3.7-flash', label: 'Qwen3.7 Flash', family: 'qwen', tier: 'free', isFree: true, priceIn: 0, priceOut: 0, contextLength: 1000000, modalities: ['text', 'image', 'video'], description: 'Qwen3.7 Flash with a 1M context window.' },
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', family: 'deepseek', tier: 'value', isFree: false, priceIn: 0.2, priceOut: 0.4, contextLength: 1000000, modalities: ['text'], description: 'BazaarLink DeepSeek V4 Flash, 1M context.' },
    { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', family: 'deepseek', tier: 'value', isFree: false, priceIn: 0.2, priceOut: 0.8, contextLength: 128000, modalities: ['text'], description: 'DeepSeek Chat general-purpose model.' },
    { id: 'qwen3.8-max', label: 'Qwen3.8 Max', family: 'qwen', tier: 'frontier', isFree: false, priceIn: 2, priceOut: 6, contextLength: 1000000, modalities: ['text', 'image', 'video'], description: 'Flagship Qwen3.8 reasoning model.' },
    { id: 'openai/gpt-4o', label: 'GPT-4o', family: 'openai', tier: 'frontier', isFree: false, priceIn: 2.5, priceOut: 10, contextLength: 128000, modalities: ['text', 'image', 'file'], description: 'OpenAI GPT-4o multimodal model.' },
    { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna', family: 'openai', tier: 'value', isFree: false, priceIn: 0.1, priceOut: 0.5, contextLength: 1050000, modalities: ['text', 'image', 'file'], description: 'OpenAI GPT-6 Luna.' },
    { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', family: 'anthropic', tier: 'frontier', isFree: false, priceIn: 3, priceOut: 15, contextLength: 200000, modalities: ['text', 'image', 'file'], description: 'Anthropic Claude Sonnet 4.6 agentic coder.' },
    { id: 'openai/gpt-5.3-codex', label: 'GPT-5.3 Codex', family: 'openai', tier: 'frontier', isFree: false, priceIn: 1.75, priceOut: 14, contextLength: 400000, modalities: ['text'], description: 'OpenAI coding-focused Codex model.' }
  ]
};

const FAMILY_HINTS = [
  ['deepseek', 'deepseek'], ['mimo', 'xiaomi'], ['xiaomi', 'xiaomi'], ['qwen', 'qwen'],
  ['gpt', 'openai'], ['openai', 'openai'], ['claude', 'anthropic'], ['anthropic', 'anthropic'],
  ['gemini', 'google'], ['google', 'google'], ['gemma', 'google'], ['grok', 'xai'],
  ['kimi', 'moonshot'], ['glm', 'z-ai'], ['llama', 'meta'], ['mistral', 'mistral'], ['phi', 'microsoft']
];

export function guessFamily(id, ownedBy) {
  const src = `${ownedBy || ''} ${id || ''}`.toLowerCase();
  for (const [needle, family] of FAMILY_HINTS) {
    if (src.includes(needle)) return family;
  }
  return (ownedBy || 'custom').toLowerCase();
}

/** True when a model id/name marks a zero-price variant. */
export function isFreeModel(id, name, priceIn, priceOut) {
  const src = `${id || ''} ${name || ''}`.toLowerCase();
  if (src.includes(':free') || src.includes('free')) return true;
  if (priceIn === 0 && priceOut === 0) return true;
  return false;
}

/**
 * Normalizes a live GET /v1/models response into our internal model shape.
 * Handles the OpenAI shape ({ data: [...] }) and plain arrays, plus BazaarLink
 * extras (per-token pricing strings, context_length, aliases, architecture).
 */
export function normalizeLiveModels(apiData) {
  const rows = Array.isArray(apiData) ? apiData : (apiData && Array.isArray(apiData.data) ? apiData.data : []);
  const out = [];

  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || item.name || '').trim();
    if (!id) continue;

    const label = String(item.name || item.label || id);
    const pricing = item.pricing || {};
    const rawIn = parseFloat(pricing.prompt != null ? pricing.prompt : item.priceIn);
    const rawOut = parseFloat(pricing.completion != null ? pricing.completion : item.priceOut);
    // BazaarLink publishes per-token prices; our UI works in per-1M-token units.
    const priceIn = Number.isFinite(rawIn) ? (pricing.prompt != null ? rawIn * 1e6 : rawIn) : 0;
    const priceOut = Number.isFinite(rawOut) ? (pricing.completion != null ? rawOut * 1e6 : rawOut) : 0;

    const arch = item.architecture || {};
    const mods = new Set();
    (arch.input_modalities || item.inputModalities || []).forEach((m) => mods.add(String(m).toLowerCase()));
    if (typeof arch.modality === 'string' && arch.modality.includes('->')) {
      arch.modality.split('->')[0].split('+').forEach((m) => mods.add(m.trim().toLowerCase()));
    }
    mods.delete('');
    if (mods.size === 0) mods.add('text');

    const free = isFreeModel(id, label, priceIn, priceOut);

    out.push({
      id,
      label,
      family: guessFamily(id, item.owned_by),
      tier: free ? 'free' : (item.tier || 'value'),
      isFree: free,
      priceIn: free ? 0 : priceIn,
      priceOut: free ? 0 : priceOut,
      contextLength: item.context_length || item.contextWindow || 128000,
      modalities: Array.from(mods),
      description: String(item.description || ''),
      aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : []
    });
  }

  // De-duplicate by id, keeping the richest entry.
  const seen = new Map();
  for (const m of out) {
    const prev = seen.get(m.id);
    if (!prev || (m.description || '').length > (prev.description || '').length) seen.set(m.id, m);
  }
  return Array.from(seen.values());
}

/** Sorted + filtered view used by the picker UI. */
export function filterModels(models, { query = '', freeOnly = false, favourites = [], recents = [] } = {}) {
  const q = query.trim().toLowerCase();
  let list = models.slice();

  if (freeOnly) list = list.filter((m) => m.isFree);

  if (q) {
    list = list.filter((m) =>
      m.id.toLowerCase().includes(q) ||
      m.label.toLowerCase().includes(q) ||
      (m.family || '').toLowerCase().includes(q) ||
      (m.description || '').toLowerCase().includes(q)
    );
  }

  const rank = (m) => {
    if (favourites.includes(m.id)) return 0;
    const r = recents.indexOf(m.id);
    if (r >= 0) return 1 + r;
    if (m.isFree) return 100;
    if (m.tier === 'frontier') return 200;
    return 300;
  };

  return list.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });
}

/** Groups a model list for the picker (Free / Frontier / Value / by family). */
export function groupModels(models) {
  const groups = [
    { key: 'free', title: 'Free ($0)', items: [] },
    { key: 'frontier', title: 'Frontier', items: [] },
    { key: 'value', title: 'Value', items: [] }
  ];
  const byFamily = new Map();

  for (const m of models) {
    const bucket = groups.find((g) => g.key === (m.isFree ? 'free' : m.tier));
    if (bucket) bucket.items.push(m);
    else {
      const fam = m.family || 'other';
      if (!byFamily.has(fam)) byFamily.set(fam, []);
      byFamily.get(fam).push(m);
    }
  }

  for (const [fam, items] of byFamily) {
    groups.push({ key: `family:${fam}`, title: fam, items });
  }
  return groups.filter((g) => g.items.length > 0);
}

/** Best-guess model id suggestion for an unknown id. */
export function suggestModel(id, models) {
  const target = String(id || '').toLowerCase();
  let best = null, bestScore = Infinity;
  for (const m of models) {
    const cand = m.id.toLowerCase();
    if (cand === target) continue;
    const score = Math.abs(cand.length - target.length) + (cand.startsWith(target.slice(0, 6)) ? 0 : 20);
    if (score < bestScore) { bestScore = score; best = m.id; }
  }
  return best;
}

/** Pretty price label used in the picker + status bar. */
export function priceLabel(model) {
  if (!model) return '';
  if (model.isFree) return 'FREE';
  const fmt = (n) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
  return `${fmt(model.priceIn)} / ${fmt(model.priceOut)} per 1M`;
}

export function formatContext(n) {
  if (!n) return '';
  if (n >= 1000000) return `${Math.round(n / 100000) / 10}M ctx`;
  return `${Math.round(n / 1000)}K ctx`;
}