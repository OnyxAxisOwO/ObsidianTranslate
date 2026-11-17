export const promptDefaults = {
  systemPrompt: 'You are a professional translator. Write fluent, faithful translations in {{to}}.',
  translationPrompt: 'Preserve meaning, tone, terminology, names, and formatting. Leave text that is already in the target language as it is.',
  userPrompt: '{{text}}',
  batchSystemPrompt: 'Translate each item independently. Keep the original order and the same number of items.',
  batchUserPrompt: '{{text}}',
  subtitlePrompt: 'Translate this subtitle into {{to}}. Use natural, concise phrasing suitable for reading during playback.\n\n{{text}}',
};

const openAI = {
  id: 'openai',
  name: 'OpenAI',
  protocol: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  rps: 2,
  models: [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' }],
  updated: 1,
};

export const loadingStyles = {
  spinner: '转圈',
  dots: '三点',
  text: '自定义文字',
  off: '不显示',
};

export const loadingTextLimit = 60;

export const defaults = {
  providers: [openAI],
  activeModel: '',
  source: 'auto',
  target: 'zh-CN',
  inputTarget: 'en',
  view: 'translation',
  order: 'original-first',
  style: 'soft',
  loadingStyle: 'spinner',
  loadingText: '翻译中…',
  scope: 'reading',
  maxLength: 5000,
  batchSize: 6,
  ...promptDefaults,
  glossary: '',
  floating: true,
  selection: true,
  hover: true,
  inputSpaces: false,
  captions: false,
  cache: true,
  sites: {},
  languageRules: {},
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
  cs: ['Čeština', 'Czech'],
  da: ['Dansk', 'Danish'],
  el: ['Ελληνικά', 'Greek'],
  fa: ['فارسی', 'Persian'],
  fi: ['Suomi', 'Finnish'],
  he: ['עברית', 'Hebrew'],
  hu: ['Magyar', 'Hungarian'],
  ms: ['Bahasa Melayu', 'Malay'],
  no: ['Norsk', 'Norwegian'],
  ro: ['Română', 'Romanian'],
  sv: ['Svenska', 'Swedish'],
  tl: ['Filipino', 'Filipino'],
};

export const own = (object, key) => Object.hasOwn(object, key);
export const modelKey = (provider, model) => JSON.stringify([provider.id, model.id]);

export function languageCode(value) {
  if (typeof value !== 'string') return '';
  if (own(languages, value)) return value;
  const code = value.toLowerCase().replaceAll('_', '-');
  const base = code.split('-')[0];
  if (base === 'zh') return /-(tw|hk|mo|hant)(-|$)/.test(code) ? 'zh-TW' : 'zh-CN';
  return own(languages, base) ? base : '';
}

export function needsKey(provider) {
  return ['api.openai.com', 'api.anthropic.com'].includes(new URL(provider.baseUrl).hostname) && !provider.apiKey;
}

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
  const active = activeModel({ providers, activeModel: settings.activeModel });
  return {
    ...settings,
    sites: own(sites, hostname) ? { [hostname]: sites[hostname] } : {},
    models: providers.flatMap(provider => provider.models.map(model => ({
      key: modelKey(provider, model),
      name: model.name,
      provider: provider.name,
    }))),
    configured: !!active && !needsKey(active.provider),
    requestsPerSecond: active?.provider.rps ?? openAI.rps,
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
  const rps = Number(item.rps);
  return {
    id: text(item.id, 80) || crypto.randomUUID(),
    name: text(item.name, 80),
    protocol: item.protocol,
    baseUrl,
    apiKey: text(item.apiKey, 4000),
    rps: Number.isFinite(rps) && rps > 0 ? rps : openAI.rps,
    models: [...models.values()],
    updated: Number(item.updated) || Date.now(),
  };
}

export function normalizeSettings(input = {}) {
  const settings = { ...defaults };
  settings.providers = [];
  const providerIds = new Set();
  const providers = Array.isArray(input.providers) ? input.providers.slice(0, 100) : defaults.providers;
  for (const item of providers) {
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
  if (own(languages, input.source)) settings.source = input.source;
  if (['bilingual', 'translation'].includes(input.view)) settings.view = input.view;
  if (['original-first', 'translation-first'].includes(input.order)) settings.order = input.order;
  if (['plain', 'soft', 'accent'].includes(input.style)) settings.style = input.style;
  if (own(loadingStyles, input.loadingStyle)) settings.loadingStyle = input.loadingStyle;
  settings.loadingText = text(input.loadingText, loadingTextLimit) || defaults.loadingText;
  if (['reading', 'whole'].includes(input.scope)) settings.scope = input.scope;
  settings.maxLength = number(input.maxLength, defaults.maxLength, 300, 12000);
  settings.batchSize = number(input.batchSize, defaults.batchSize, 1, 20);
  for (const [key, fallback] of Object.entries(promptDefaults)) {
    settings[key] = text(input[key] ?? (key === 'translationPrompt' ? input.prompt : ''), 6000) || fallback;
  }
  settings.glossary = text(input.glossary, 4000);
  for (const key of ['floating', 'selection', 'hover', 'inputSpaces', 'captions', 'cache']) {
    if (typeof input[key] === 'boolean') settings[key] = input[key];
  }
  settings.sites = Object.fromEntries(Object.entries(input.sites || {}).filter(([host, rule]) =>
    host.length < 256 && /^[\w.:[\]-]+$/.test(host) && ['always', 'never'].includes(rule)
  ).slice(0, 300));
  settings.languageRules = Object.fromEntries(Object.entries(input.languageRules || {}).filter(([language, rule]) =>
    own(languages, language) && ['always', 'never'].includes(rule)
  ));
  settings.activeModel = text(input.activeModel, 500);
  if (!activeModel(settings)) {
    const provider = settings.providers.find(item => item.models.length && !needsKey(item)) ||
      settings.providers.find(item => item.models.length);
    settings.activeModel = provider ? modelKey(provider, provider.models[0]) : '';
  }
  return settings;
}
