import { cache } from './cache.js';
import { clearCache, discover, translate } from './translate.js';
import { languages, normalizeProvider, normalizeSettings, modelRevision, own, pageSettings } from './shared/settings.js';
import { ext, reply } from './shared/webext.js';

const uiProtocol = ext.runtime.getURL('/');
const prefs = ['target', 'inputTarget', 'activeModel', 'view', 'scope', 'maxLength', 'batchSize',
  'prompt', 'floating', 'selection', 'hover', 'captions', 'cache'];
let writes = Promise.resolve();

async function load() {
  const stored = await ext.storage.local.get('settings');
  return normalizeSettings(stored.settings);
}

function update(fn) {
  const work = writes.then(async () => {
    const settings = await load();
    const edited = normalizeSettings(fn(settings));
    await ext.storage.local.set({ settings: edited });
    return edited;
  });
  writes = work.catch(() => {});
  return work;
}

function draftProvider(item, settings) {
  const prior = settings.providers.find(provider => provider.id === item.id);
  return normalizeProvider({
    ...item,
    id: prior?.id || '',
    apiKey: item.apiKey ?? prior?.apiKey ?? '',
    updated: Date.now(),
  });
}

ext.runtime.onMessage.addListener(reply(async (message, sender) => {
  const page = sender.url?.startsWith(uiProtocol) ? null : sender.tab?.url || sender.url;
  const ui = sender.url?.startsWith(uiProtocol);
  const settings = await load();
  const hostname = page ? new URL(page).hostname : '';
  switch (message.type) {
    case 'settings': return ui ? settings : pageSettings(settings, hostname);
    case 'translate': {
      const { texts, target } = message;
      if (!own(languages, target) || !Array.isArray(texts) || !texts.length || texts.length > 20 ||
          texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 100000) ||
          texts.reduce((sum, text) => sum + text.length, 0) > 160000) {
        throw new Error('待翻译的文本或语言超出支持范围。');
      }
      if (hostname && settings.sites[hostname] === 'never') {
        throw new Error('此网站已设为永不翻译。');
      }
      if (message.revision != null && message.revision !== modelRevision(settings)) {
        throw new Error('翻译模型已更新，请重试。');
      }
      return translate(settings, target, texts);
    }
    case 'options': return ext.runtime.openOptionsPage();
    default:
      if (!ui) throw new Error('请在扩展设置中执行此操作。');
  }
  switch (message.type) {
    case 'preferences':
      return update(current => Object.assign(current, Object.fromEntries(
        Object.entries(message.patch || {}).filter(([key]) => prefs.includes(key)),
      )));
    case 'site-rule':
      return update(current => {
        const sites = { ...current.sites };
        delete sites[message.host];
        if (message.rule && /^[-\w.:[\]]{1,255}$/.test(message.host)) {
          Object.defineProperty(sites, message.host, { value: message.rule, enumerable: true });
        }
        return { ...current, sites };
      });
    case 'provider-save':
      return update(current => {
        const provider = draftProvider(message.provider, current);
        const index = current.providers.findIndex(item => item.id === provider.id);
        if (index < 0) {
          current.providers.push(provider);
        } else {
          const previous = current.providers[index];
          if (previous.baseUrl === provider.baseUrl && previous.protocol === provider.protocol &&
            previous.apiKey === provider.apiKey) provider.updated = previous.updated;
          current.providers[index] = provider;
        }
        if (message.replaceActive && current.activeModel === message.replaceActive.from) {
          current.activeModel = message.replaceActive.to;
        }
        return current;
      });
    case 'provider-delete':
      return update(current => ({ ...current, providers: current.providers.filter(item => item.id !== message.id) }));
    case 'discover':
      return discover(draftProvider(message.provider, settings));
    case 'test': {
      const provider = draftProvider(message.provider, settings);
      const [result] = await translate(settings, 'zh-CN', ['Good morning.'],
        { provider, model: { id: message.model } }, true);
      if (result.error) throw new Error(result.error);
      return result.text;
    }
    case 'cache-count': return cache.count();
    case 'cache-clear': return clearCache();
    default: throw new Error('无法识别的扩展操作。');
  }
}));

function activate(tab, action, details = {}) {
  if (tab?.id != null) {
    ext.tabs.sendMessage(tab.id, { type: 'page-action', action, ...details }, { frameId: 0 }).catch(() => {});
  }
}

ext.commands?.onCommand.addListener(async command => {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  activate(tab, command);
});

if (ext.contextMenus) {
  ext.runtime.onInstalled.addListener(() => {
    ext.contextMenus.removeAll().then(() => {
      ext.contextMenus.create({ id: 'toggle', title: '翻译网页 / 显示原文', contexts: ['page'] });
      ext.contextMenus.create({ id: 'selection', title: '翻译所选文字', contexts: ['selection'] });
      ext.contextMenus.create({ id: 'input', title: '翻译当前输入框', contexts: ['editable'] });
    }).catch(() => {});
  });
  ext.contextMenus.onClicked.addListener((info, tab) =>
    activate(tab, info.menuItemId, { text: info.selectionText }));
}
