import { activeModel, applyPagePreferences, defaults, normalizeProvider, normalizeSettings, normalizeSiteProfile,
  pageSettings, resolvePage, restoreSettings } from '../shared/settings.js';

const key = 'obsidian-translate-demo-v2';
const sampleSettings = () => ({
  ...defaults,
  providers: [
    { id: 'openai-demo', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'demo',
      rps: 3, updated: 1, models: [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' }, { id: 'gpt-4.1', name: 'GPT-4.1' }] },
  ],
});
const phrases = /* @__PURE__ */ new Map([
  ['Where the forest meets the tide', '当森林与潮汐相遇'],
  ['Field notes from the Pacific Northwest', '来自太平洋西北地区的观察笔记'],
  ['At low tide, the coast reveals a landscape that seems to belong to another world. Kelp drapes over dark rocks, and the tide pools hold small reflections of the sky.', '退潮时，海岸显露出仿佛来自另一个世界的景致。海带覆在深色的礁石上，潮池里倒映着一小片天空。'],
  ['Beyond the tree line', '林线之外'],
  ['The trail winds past stands of Sitka spruce before turning toward the ocean. As the trees thin out, the air takes on the scent of salt, and the sound of the surf grows louder.', '小径蜿蜒穿过一片西加云杉，随即转向大海。树木渐稀，空气里开始带着海盐的气息，浪涛声也越来越清晰。'],
  ['On a clear morning, the horizon is almost indistinguishable from the water. Walk slowly enough, and familiar details become reasons to stop.', '晴朗的早晨，海天几乎连成一线。只要放慢脚步，那些熟悉的细节也会成为停下来的理由。'],
]);
let count = 0;

export async function demoRequest(type, message = {}) {
  const stored = localStorage.getItem(key);
  const settings = normalizeSettings(stored ? JSON.parse(stored) : sampleSettings());
  let provider;
  switch (type) {
    case 'settings': return settings;
    case 'preferences':
      applyPagePreferences(settings, message.url ? resolvePage(settings, message.url) : null, message.patch);
      break;
    case 'site-rule':
      if (message.url) {
        const profile = resolvePage(settings, message.url).profiles.findLast(item => Object.hasOwn(item.overrides, 'policy'));
        if (profile) {
          profile.overrides.policy = message.rule || 'manual';
          break;
        }
      }
      delete settings.sites[message.host];
      if (message.rule) settings.sites[message.host] = message.rule;
      break;
    case 'floating-site':
      settings.hiddenFloatingSites = settings.hiddenFloatingSites.filter(host => host !== message.host);
      if (message.hidden) settings.hiddenFloatingSites.push(message.host);
      break;
    case 'language-rule':
      delete settings.languageRules[message.language];
      if (message.rule) settings.languageRules[message.language] = message.rule;
      break;
    case 'site-profile-save': {
      const profile = normalizeSiteProfile(message.profile, settings);
      if (settings.siteProfiles.some(item => item.pattern === profile.pattern && item.pattern !== message.previous)) {
        throw new Error('已存在相同的网址规则。');
      }
      settings.siteProfiles = [...settings.siteProfiles.filter(item => item.pattern !== message.previous), profile];
      break;
    }
    case 'site-profile-delete':
      settings.siteProfiles = settings.siteProfiles.filter(item => item.pattern !== message.pattern);
      break;
    case 'settings-import': Object.assign(settings, restoreSettings(message.backup)); break;
    case 'provider-save':
      provider = normalizeProvider({ ...message.provider, updated: Date.now(), apiKey: 'demo' });
      if (settings.providers.some(item => item.id === provider.id)) {
        settings.providers = settings.providers.map(item => item.id === provider.id ? provider : item);
      } else settings.providers.push(provider);
      if (message.replaceActive && settings.activeModel === message.replaceActive.from) {
        settings.activeModel = message.replaceActive.to;
      }
      break;
    case 'provider-delete': settings.providers = settings.providers.filter(item => item.id !== message.id); break;
    case 'discover':
      return sampleSettings().providers.find(item => item.protocol === message.provider.protocol)?.models ||
        [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' }];
    case 'test': return '早上好。';
    case 'options': window.open('options.html' + (message.section ? '#' + message.section : ''), '_blank', 'noopener'); return;
    case 'cache-count': return count;
    case 'cache-clear': count = 0; return;
    case 'translate':
      if (!activeModel(settings)) throw new Error('请先添加翻译模型。');
      await new Promise(resolve => setTimeout(resolve, 270));
      count += message.texts.length;
      return message.texts.map(text => ({ text: phrases.get(text) || `[演示] ${text}` }));
    default: throw new Error('无法识别的预览操作。');
  }
  localStorage.setItem(key, JSON.stringify(normalizeSettings(settings)));
  return normalizeSettings(settings);
}

export function demoBrowser() {
  const listeners = [];
  const article = parent !== window ? parent : window;
  let notifyStorage;
  return {
    runtime: {
      async sendMessage(message) {
        try {
          const scoped = ['site-rule', 'floating-site'].includes(message.type);
          const value = await demoRequest(message.type, { ...message, url: location.href,
            ...(scoped ? { host: location.hostname } : {}) });
          const writes = ['preferences', 'site-rule', 'floating-site'].includes(message.type);
          if (writes) notifyStorage?.({ settings: true }, 'local');
          return { ok: true, value: message.type === 'settings' || writes ? pageSettings(value, location.href) : value };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      },
      onMessage: { addListener(listener) { listeners.push(listener); } },
    },
    storage: { onChanged: { addListener(listener) {
      notifyStorage = listener;
      window.addEventListener('storage', event => {
        if (event.key === key) listener({ settings: true }, 'local');
      });
    } } },
    tabs: {
      async query() { return [{ id: 1, url: location.href }]; },
      async sendMessage(id, message) { return article.obsidianPageMessage(message); },
    },
    connectArticle() {
      window.obsidianPageMessage = message => new Promise((resolve, reject) => {
        if (!listeners.length) reject(new Error('预览正在加载。'));
        listeners.forEach(listener => listener(message, {}, resolve));
      });
    },
  };
}
