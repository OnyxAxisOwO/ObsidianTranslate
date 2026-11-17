import { modelKey } from '../shared/settings.js';
import { icon } from '../shared/icons.js';
import { api, tabs } from './api.js';
import { languageOptions, option } from './helpers.js';

const byId = id => document.getElementById(id);
const target = byId('target');
const model = byId('model');
const rule = byId('site-rule');
const status = byId('page-status');
const buttons = [...document.querySelectorAll('button[data-action]')];
let tab;
let settings;
let page;
let busy = false;

byId('globe').innerHTML = icon('globe');
byId('open-options').innerHTML = icon('settings');

async function pageRequest(type, payload = {}) {
  const response = await tabs.sendMessage(tab.id, { type, ...payload }, { frameId: 0 });
  if (!response?.ok) throw new Error(response?.error || '当前网页暂不可翻译。');
  return response.value;
}

function drawPage() {
  const allowed = !!page && page.site !== 'never';
  byId('hostname').textContent = DEMO ? 'Pacific Field Notes' : page?.hostname || '当前网页';
  status.textContent = page?.note || '请打开允许此扩展访问的 HTTP 或 HTTPS 网页。';
  rule.value = page?.site || '';
  rule.disabled = busy || !page;
  for (const button of buttons) {
    const action = button.dataset.action;
    if (action === 'options') continue;
    button.disabled = busy || !allowed || (!settings.activeModel && !['toggle', 'original'].includes(action));
    if (action === 'toggle') {
      const label = !settings.activeModel ? '添加翻译模型' : page?.running
        ? page.failures ? '重试翻译' : '显示原文' : '翻译网页';
      button.innerHTML = icon('translate') + label;
      if (!settings.activeModel) button.disabled = busy;
    }
    if (['bilingual', 'translation', 'original'].includes(action)) {
      button.setAttribute('aria-pressed', String(action === (page?.running ? page.view : 'original')));
    }
  }
}

async function getPage() {
  try {
    page = await pageRequest('page-state');
  } catch {
    page = null;
  }
}

function drawSettings() {
  target.innerHTML = languageOptions(settings.target);
  model.innerHTML = settings.activeModel ? settings.providers.filter(provider => provider.models.length).map(provider => {
    const group = document.createElement('optgroup');
    group.label = provider.name;
    group.innerHTML = provider.models.map(entry => option(modelKey(provider, entry), entry.name, settings.activeModel)).join('');
    return group.outerHTML;
  }).join('') : option('', '尚未配置', '');
  model.disabled = !settings.activeModel;
}

async function act(operation) {
  if (busy) return;
  busy = true;
  drawPage();
  let error;
  try {
    await operation();
    if (DEMO) await new Promise(resolve => setTimeout(resolve, 90));
    await getPage();
  } catch (problem) {
    error = problem;
  } finally {
    busy = false;
    drawPage();
    if (error) status.textContent = error.message;
  }
}

document.addEventListener('click', event => {
  const action = event.target.closest('button[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'options' || (action === 'toggle' && !settings?.activeModel)) {
    api('options').catch(error => { status.textContent = error.message; });
    return;
  }
  act(async () => {
    if (['bilingual', 'translation'].includes(action)) {
      settings = await api('preferences', { patch: { view: action } });
      page = await pageRequest('page-action', { action: 'view', view: action });
      if (!page.running) page = await pageRequest('page-action', { action: 'toggle' });
      return;
    }
    page = await pageRequest('page-action', { action });
  });
});

for (const [control, key] of [[target, 'target'], [model, 'activeModel']]) {
  control.addEventListener('change', () => act(async () => {
    settings = await api('preferences', { patch: { [key]: control.value } });
    drawSettings();
  }));
}
rule.addEventListener('change', () => {
  const value = rule.value;
  act(async () => {
    settings = await api('site-rule', { host: page.hostname, rule: value });
  });
});

(async () => {
  [settings, [tab]] = await Promise.all([api('settings'), tabs.query({ active: true, currentWindow: true })]);
  await getPage();
  drawSettings();
  drawPage();
  setInterval(async () => {
    if (busy || document.hidden) return;
    await getPage();
    if (!busy) drawPage();
  }, 850);
})().catch(error => { status.textContent = error.message; });
