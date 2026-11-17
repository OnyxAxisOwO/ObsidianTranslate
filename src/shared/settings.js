export const defaults = {
  providers: [],
  activeModel: '',
  target: 'zh-CN',
  inputTarget: 'en',
  view: 'translation',
  scope: 'reading',
  maxLength: 5000,
  batchSize: 6,
  prompt: 'Translate naturally and accurately into {{language}}. Preserve meaning, tone, names, terminology, punctuation, and formatting. Leave text that is already in the target language as it is.',
  floating: true,
  selection: true,
  hover: true,
  captions: false,
  cache: true,
  sites: {},
};

export const protocols = {
  openai: { name: 'OpenAI 兼容', url: 'https://api.openai.com/v1', route: '/chat/completions' },
  responses: { name: 'OpenAI Responses', url: 'https://api.openai.com/v1', route: '/responses' },
  anthropic: { name: 'Anthropic Messages', url: 'https://api.anthropic.com/v1', route: '/messages' },
};

export const languages = {
  'zh-CN': ['简体中文', 'Simplified Chinese'],
  'zh-TW': ['繁體中文', 'Traditional Chinese'],
  en: ['English', 'English'],
  ja: ['日本語', 'Japanese'],
  ko: ['한국어', 'Korean'],
  fr: ['Français', 'French'],
  de: ['Deutsch', 'German'],
  es: ['Español', 'Spanish'],
  pt: ['Português', 'Portuguese'],
  ru: ['Русский', 'Russian'],
  it: ['Italiano', 'Italian'],
  ar: ['العربية', 'Arabic'],
  tr: ['Türkçe', 'Turkish'],
  vi: ['Tiếng Việt', 'Vietnamese'],
  th: ['ไทย', 'Thai'],
  id: ['Bahasa Indonesia', 'Indonesian'],
  hi: ['हिन्दी', 'Hindi'],
  uk: ['Українська', 'Ukrainian'],
  nl: ['Nederlands', 'Dutch'],
  pl: ['Polski', 'Polish'],
};

export const own = (object, key) => Object.hasOwn(object, key);
export const modelKey = (provider, model) => JSON.stringify([provider.id, model.id]);

export function activeModel(settings) {
  for (const provider of settings.providers) {
    const model = provider.models.find(item => modelKey(provider, item) === settings.activeModel);
    if (model) return { provider, model };
  }
  return null;
}

export function modelRevision(settings) {
  const active = activeModel(settings);
  return active ? JSON.stringify([active.provider.id, active.provider.updated, active.model.id]) : '';
}

export function pageSettings({ providers, sites, ...settings }, hostname) {
  return {
    ...settings,
    sites: own(sites, hostname) ? { [hostname]: sites[hostname] } : {},
    revision: modelRevision({ providers, activeModel: settings.activeModel }),
  };
}

export function normalizeUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('请输入有效的 HTTP 或 HTTPS 服务地址。');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname || '/v1';
  return url.toString();
}

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function number(value, fallback, min, max, step = 1) {
  const parsed = Number(value);
  if (value === '' || value == null || !Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed / step) * step));
}

export function normalizeProvider(item) {
  if (!own(protocols, item.protocol)) throw new Error('请选择有效的 API 格式。');
  if (!text(item.name, 80)) throw new Error('请填写服务商名称。');
  const models = new Map();
  for (const model of Array.isArray(item.models) ? item.models.slice(0, 500) : []) {
    const id = text(model?.id, 200);
    if (id) models.set(id, { id, name: text(model.name, 100) || id });
  }
  let baseUrl;
  try {
    baseUrl = normalizeUrl(text(item.baseUrl, 2000));
  } catch {
    throw new Error('请输入有效的 Base URL，例如 https://api.openai.com/v1。');
  }
  return {
    id: text(item.id, 80) || crypto.randomUUID(),
    name: text(item.name, 80),
    protocol: item.protocol,
    baseUrl,
    apiKey: text(item.apiKey, 4000),
    rps: number(item.rps, 2, 0.2, 20, 0.1),
    models: [...models.values()],
    updated: Number(item.updated) || Date.now(),
  };
}

export function normalizeSettings(input = {}) {
  const settings = { ...defaults };
  settings.providers = [];
  const providerIds = new Set();
  for (const item of Array.isArray(input.providers) ? input.providers.slice(0, 100) : []) {
    try {
      const provider = normalizeProvider(item);
      if (providerIds.has(provider.id)) continue;
      providerIds.add(provider.id);
      settings.providers.push(provider);
    } catch {
      // One invalid provider should not prevent opening settings.
    }
  }
  for (const key of ['target', 'inputTarget']) {
    if (own(languages, input[key])) settings[key] = input[key];
  }
  if (['bilingual', 'translation'].includes(input.view)) settings.view = input.view;
  if (['reading', 'whole'].includes(input.scope)) settings.scope = input.scope;
  settings.maxLength = number(input.maxLength, defaults.maxLength, 300, 12000);
  settings.batchSize = number(input.batchSize, defaults.batchSize, 1, 20);
  settings.prompt = text(input.prompt, 6000) || defaults.prompt;
  for (const key of ['floating', 'selection', 'hover', 'captions', 'cache']) {
    if (typeof input[key] === 'boolean') settings[key] = input[key];
  }
  settings.sites = Object.fromEntries(Object.entries(input.sites || {}).filter(([host, rule]) =>
    host.length < 256 && /^[\w.:[\]-]+$/.test(host) && ['always', 'never'].includes(rule)
  ).slice(0, 300));
  settings.activeModel = text(input.activeModel, 500);
  if (!activeModel(settings)) {
    const provider = settings.providers.find(item => item.models.length);
    settings.activeModel = provider ? modelKey(provider, provider.models[0]) : '';
  }
  return settings;
}
