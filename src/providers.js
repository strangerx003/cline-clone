// Provider detection, API key format parsing, and Connection management

export const PROVIDER_PRESETS = [
  {
    id: 'tokenharbor',
    name: 'TokenHarbor',
    baseUrl: 'https://tokenharbor.ai/v1',
    apiStyle: 'openai',
    keyPrefixes: ['thk_live_', 'thk_test_'],
    authHeaderType: 'bearer',
    helpUrl: 'https://tokenharbor.ai/dashboard/api-keys'
  },
  {
    id: 'bazaarlink',
    name: 'BazaarLink',
    baseUrl: 'https://api.bazaarlink.ai/v1',
    apiStyle: 'openai',
    keyPrefixes: ['sk-bl-'],
    authHeaderType: 'bearer',
    helpUrl: 'https://bazaarlink.ai/keys'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiStyle: 'anthropic',
    keyPrefixes: ['sk-ant-'],
    authHeaderType: 'x-api-key',
    helpUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiStyle: 'openai',
    keyPrefixes: ['sk-or-v1-'],
    authHeaderType: 'bearer',
    helpUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiStyle: 'openai',
    keyPrefixes: ['gsk_'],
    authHeaderType: 'bearer',
    helpUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    apiStyle: 'openai',
    keyPrefixes: ['xai-'],
    authHeaderType: 'bearer',
    helpUrl: 'https://console.x.ai/'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiStyle: 'openai',
    keyPrefixes: ['sk-proj-', 'sk-'],
    authHeaderType: 'bearer',
    helpUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiStyle: 'openai',
    keyPrefixes: ['AIza'],
    authHeaderType: 'bearer',
    helpUrl: 'https://aistudio.google.com/app/apikey'
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    baseUrl: 'http://localhost:11434/v1',
    apiStyle: 'openai',
    keyPrefixes: [],
    authHeaderType: 'bearer',
    helpUrl: ''
  }
];

/**
 * Normalizes user-inputted API key:
 * Trims whitespace, removes "Bearer " prefix, strips quotes/newlines
 */
export function normalizeApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return '';
  let key = rawKey.trim();
  if (key.startsWith('Bearer ')) {
    key = key.slice(7).trim();
  }
  // Remove wrapping quotes
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  // Strip internal newlines / tabs
  key = key.replace(/[\r\n\t]/g, '');
  return key;
}

/**
 * Detects the provider preset based on key prefix or baseUrl
 */
export function detectProvider(apiKey = '', baseUrl = '') {
  const cleanKey = normalizeApiKey(apiKey);

  for (const preset of PROVIDER_PRESETS) {
    if (preset.id === 'custom') continue;
    for (const prefix of preset.keyPrefixes) {
      if (cleanKey.startsWith(prefix)) {
        return preset;
      }
    }
  }

  // Fallback to checking baseUrl
  if (baseUrl) {
    const urlLower = baseUrl.toLowerCase();
    for (const preset of PROVIDER_PRESETS) {
      if (preset.id === 'custom') continue;
      const host = new URL(preset.baseUrl).hostname.toLowerCase();
      if (urlLower.includes(host)) {
        return preset;
      }
    }
  }

  return PROVIDER_PRESETS.find(p => p.id === 'custom') || PROVIDER_PRESETS[0];
}

/**
 * Masks an API key for safe display (e.g. thk_live_...XaD7v9)
 */
export function maskApiKey(apiKey) {
  if (!apiKey) return '';
  const clean = normalizeApiKey(apiKey);
  if (clean.length <= 10) return '••••••••';
  const head = clean.slice(0, 9);
  const tail = clean.slice(-6);
  return `${head}••••${tail}`;
}
