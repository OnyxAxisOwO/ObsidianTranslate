import { cache } from './cache.js';
import { clearCache, discover, translate } from './translate.js';
import { activeModel, languages, modelKey, modelRevision, needsKey, normalizeProvider, normalizeSettings, own, pageSettings, promptDefaults } from './shared/settings.js';
import { ext, reply } from './shared/webext.js';

const uiProtocol = ext.runtime.getURL('/');
const pagePrefs = ['source', 'target', 'activeModel', 'view', 'scope', 'captions'];
const prefs = [...pagePrefs, 'inputTarget', 'order', 'style', 'loadingStyle', 'loadingText', 'maxLength', 'batchSize',
  'glossary', 'floating', 'selection', 'hover', 'inputSpaces', 'cache', ...Object.keys(promptDefaults)];
const optionPages = ['models', 'reading', 'text', 'files', 'advanced', 'advanced/models', 'advanced/prompts', 'advanced/rules', 'advanced/cache'];
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

async function handleMessage(message, sender, onResult) {
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
      return translate(settings, target, texts, undefined, false, message.context, onResult);
    }
    case 'options':
      return optionPages.includes(message.section)
        ? ext.tabs.create({ url: ext.runtime.getURL(`options.html#${message.section}`) }).then(() => null)
        : ext.runtime.openOptionsPage();
    case 'preferences': {
      const allowed = ui ? prefs : pagePrefs;
      if (!ui && !hostname) throw new Error('无法识别当前网站。');
      const edited = await update(current => Object.assign(current, Object.fromEntries(
        Object.entries(message.patch || {}).filter(([key]) => allowed.includes(key)),
      )));
      return ui ? edited : pageSettings(edited, hostname);
    }
    case 'site-rule': {
      const host = ui ? message.host : hostname;
      const edited = await update(current => {
        if (!/^[-\w.:[\]]{1,255}$/.test(host || '')) return current;
        const sites = { ...current.sites };
        delete sites[host];
        if (message.rule) Object.defineProperty(sites, host, { value: message.rule, enumerable: true });
        return { ...current, sites };
      });
      return ui ? edited : pageSettings(edited, hostname);
    }
    default:
      if (!ui) throw new Error('请在扩展设置中执行此操作。');
  }
  switch (message.type) {
    case 'language-rule':
      return update(current => {
        const languageRules = { ...current.languageRules };
        delete languageRules[message.language];
        if (message.rule && own(languages, message.language)) languageRules[message.language] = message.rule;
        return { ...current, languageRules };
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
        const active = activeModel(current);
        if ((!active || needsKey(active.provider)) && provider.models.length && !needsKey(provider)) {
          current.activeModel = modelKey(provider, provider.models[0]);
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
        { provider, model: provider.models.find(model => model.id === message.model) || { id: message.model } }, true);
      if (result.error) throw new Error(result.error);
      return result.text;
    }
    case 'cache-count': return cache.count();
    case 'cache-clear': return clearCache();
    default: throw new Error('无法识别的扩展操作。');
  }
}

ext.runtime.onMessage.addListener(reply(handleMessage));
ext.runtime.onConnect.addListener(port => {
  if (port.name !== 'translate-paragraphs') return;
  let connected = true;
  port.onDisconnect.addListener(() => { connected = false; });
  const send = message => {
    if (!connected) return;
    try {
      port.postMessage(message);
    } catch {
      connected = false;
    }
  };
  const receive = message => {
    port.onMessage.removeListener(receive);
    handleMessage({ ...message, type: 'translate' }, port.sender,
      (index, result) => send({ index, result })).then(
      () => send({ done: true }),
      error => send({ error: error.message }),
    );
  };
  port.onMessage.addListener(receive);
});

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
