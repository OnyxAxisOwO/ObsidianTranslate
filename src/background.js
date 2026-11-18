import { cache } from './cache.js';
import { clearCache, discover, translate } from './translate.js';
import { activeModel, applyPagePreferences, effectiveSettings, languages, modelKey, modelRevision, needsKey,
  normalizeProvider, normalizeSettings, normalizeSiteProfile, own, pageSettings, profiledPreferences, promptDefaults, restoreSettings, resolvePage } from './shared/settings.js';
import { ext, reply } from './shared/webext.js';
import { pageAddress } from './shared/site-rules.js';

const uiProtocol = ext.runtime.getURL('/');
const pagePrefs = [...profiledPreferences, 'floating'];
const prefs = [...pagePrefs, 'inputTarget', 'order', 'style', 'loadingStyle', 'loadingText', 'maxLength', 'batchSize',
  'glossary', 'floatingSide', 'floatingPosition', 'floatingOpacity', 'selection', 'hover', 'inputSpaces', 'cache', 'translateFrames', ...Object.keys(promptDefaults)];
const optionPages = ['models', 'reading', 'floating', 'text', 'files', 'advanced', 'advanced/models', 'advanced/prompts', 'advanced/rules', 'advanced/cache', 'advanced/backup'];
let writes = Promise.resolve();

function optionsUrl(section, { pdfUrl, imageUrl } = {}) {
  const url = section === 'files' && pageAddress(imageUrl || pdfUrl || '');
  const search = url && !url.username && !url.password
    ? '?' + (imageUrl ? 'image' : 'pdf') + '=' + encodeURIComponent(url.href) : '';
  return ext.runtime.getURL('options.html' + search + '#' + section);
}

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
  const ui = sender.url?.startsWith(uiProtocol) === true;
  const child = !ui && sender.frameId > 0;
  const page = ui ? '' : sender.tab?.url || sender.url || '';
  const settings = await load();
  const resolved = resolvePage(settings, page);
  const hostname = resolved.url?.hostname || '';
  const frameBlocked = child && (!settings.translateFrames || resolvePage(settings, sender.url || '').policy === 'never');
  const scopedSettings = edited => ({ ...pageSettings(edited, page), frameBlocked });
  switch (message.type) {
    case 'settings': return ui ? settings : scopedSettings(settings);
    case 'frame-state': {
      if (!child || frameBlocked || sender.tab?.id == null) return null;
      const result = await ext.tabs.sendMessage(sender.tab.id, { type: 'page-state' }, { frameId: 0 }).catch(() => null);
      return result?.value || null;
    }
    case 'sync-frames': {
      if (ui || child || sender.tab?.id == null || !settings.translateFrames) return null;
      await ext.tabs.sendMessage(sender.tab.id, { type: 'sync-frame' }).catch(() => {});
      return null;
    }
    case 'translate': {
      const { texts, target } = message;
      if (!own(languages, target) || !Array.isArray(texts) || !texts.length || texts.length > 20 ||
          texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 100000) ||
          texts.reduce((sum, text) => sum + text.length, 0) > 160000) {
        throw new Error('待翻译的文本或语言超出支持范围。');
      }
      if (resolved.policy === 'never' || frameBlocked) {
        throw new Error('此网站已设为永不翻译。');
      }
      const effective = effectiveSettings(settings, resolved);
      if (message.revision != null && message.revision !== modelRevision(effective)) {
        throw new Error('翻译模型已更新，请重试。');
      }
      return translate(effective, target, texts, undefined, false, message.context, onResult);
    }
    case 'options':
      return optionPages.includes(message.section)
        ? ext.tabs.create({ url: optionsUrl(message.section, message) }).then(() => null)
        : ext.runtime.openOptionsPage();
    case 'preferences': {
      const allowed = ui ? prefs : pagePrefs;
      if (!ui && (!hostname || child)) throw new Error('请在主页面中修改偏好。');
      const patch = Object.fromEntries(Object.entries(message.patch || {}).filter(([key]) => allowed.includes(key)));
      const edited = await update(current => applyPagePreferences(current, ui ? null : resolvePage(current, page), patch));
      return ui ? edited : scopedSettings(edited);
    }
    case 'site-rule': {
      const host = ui ? message.host : hostname;
      const edited = await update(current => {
        if (!/^[-\w.:[\]]{1,255}$/.test(host || '')) return current;
        if (child) return current;
        const profile = !ui && resolvePage(current, page).profiles.findLast(item => own(item.overrides, 'policy'));
        if (profile) {
          profile.overrides.policy = message.rule || 'manual';
          return current;
        }
        const sites = { ...current.sites };
        delete sites[host];
        if (message.rule) Object.defineProperty(sites, host, { value: message.rule, enumerable: true });
        return { ...current, sites };
      });
      return ui ? edited : scopedSettings(edited);
    }
    case 'floating-site': {
      const host = ui ? message.host : hostname;
      if (!/^[-\w.:[\]]{1,255}$/.test(host || '')) throw new Error('请填写有效的网站域名。');
      const edited = await update(current => ({
        ...current,
        hiddenFloatingSites: [...(message.hidden ? [host] : []),
          ...current.hiddenFloatingSites.filter(item => item !== host)],
      }));
      return ui ? edited : scopedSettings(edited);
    }
    default:
      if (!ui) throw new Error('请在扩展设置中执行此操作。');
  }
  switch (message.type) {
    case 'site-profile-save': return update(current => {
      const profile = normalizeSiteProfile(message.profile, current);
      if (current.siteProfiles.some(item => item.pattern === profile.pattern && item.pattern !== message.previous)) {
        throw new Error('已存在相同的网址规则。');
      }
      const remaining = current.siteProfiles.filter(item => item.pattern !== message.previous);
      if (remaining.length >= 300) throw new Error('最多可保存 300 条网址规则。');
      return { ...current, siteProfiles: [...remaining, profile] };
    });
    case 'site-profile-delete':
      return update(current => ({ ...current, siteProfiles: current.siteProfiles.filter(item => item.pattern !== message.pattern) }));
    case 'settings-import': return update(current => {
      const restored = restoreSettings(message.backup);
      for (const provider of restored.providers) {
        const previous = current.providers.find(item => item.id === provider.id);
        const same = previous && ['protocol', 'baseUrl', 'apiKey'].every(key => previous[key] === provider[key]);
        provider.updated = same ? previous.updated : Date.now();
      }
      return restored;
    });
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
        if (message.replaceActive) {
          const { from, to } = message.replaceActive;
          if (current.activeModel === from) current.activeModel = to;
          for (const profile of current.siteProfiles) {
            if (profile.overrides.activeModel === from) profile.overrides.activeModel = to;
          }
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

function activate(tab, action, details = {}, frameId = 0) {
  if (tab?.id != null) {
    ext.tabs.sendMessage(tab.id, { type: 'page-action', action, ...details }, { frameId }).catch(() => {});
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
      ext.contextMenus.create({ id: 'image', title: '翻译这张图片', contexts: ['image'],
        targetUrlPatterns: ['http://*/*', 'https://*/*'] });
    }).catch(() => {});
  });
  ext.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'image') {
      ext.tabs.create({ url: optionsUrl('files', { imageUrl: info.srcUrl }) }).catch(() => {});
    } else {
      activate(tab, info.menuItemId, { text: info.selectionText }, info.menuItemId === 'toggle' ? 0 : info.frameId ?? 0);
    }
  });
}
