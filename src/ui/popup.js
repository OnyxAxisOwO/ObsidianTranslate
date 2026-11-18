import { defaults, pageSettings } from '../shared/settings.js';
import style from '../shared/panel.css';
import { mountPanel } from '../shared/panel.js';
import { api, tabs } from './api.js';

const stylesheet = document.createElement('style');
stylesheet.textContent = style;
document.head.prepend(stylesheet);
const container = document.querySelector('#popup');
const panel = mountPanel(container, (action, value) => act(action, value));
if (DEMO && parent !== window) {
  document.body.classList.add('demo-popup');
  new ResizeObserver(() => {
    parent.postMessage({ type: 'obsidian-preview-size', height: container.offsetHeight }, location.origin);
  }).observe(container);
}
let tab;
let settings = defaults;
let page = null;
let busy = false;
let error = '';

function onlinePdf() {
  try {
    const url = new URL(tab?.url);
    return ['http:', 'https:'].includes(url.protocol) && /\.pdf$/i.test(url.pathname) ? url.href : '';
  } catch {
    return '';
  }
}

async function pageRequest(type, payload = {}) {
  const response = await tabs.sendMessage(tab.id, { type, ...payload }, { frameId: 0 });
  if (!response?.ok) throw new Error(response?.error || '当前网页暂不可翻译。');
  return response.value;
}

function draw() {
  panel.update(pageSettings(settings, page?.url || tab?.url || ''), page || (onlinePdf() ? { pdf: true } : null), error);
}

async function getPage() {
  try {
    page = await pageRequest('page-state');
  } catch {
    page = null;
  }
}

async function act(action, value) {
  if (busy) return;
  busy = true;
  error = '';
  try {
    const pdfUrl = onlinePdf();
    if (pdfUrl && ['translate-page', 'files'].includes(action)) {
      await api('options', { section: 'files', pdfUrl });
    } else if (['models', 'floating', 'text', 'files', 'advanced', 'advanced/rules'].includes(action)) {
      await api('options', { section: action });
    } else if (action === 'translate-page' && !pageSettings(settings, page?.url || tab?.url || '').configured) {
      await api('options', { section: 'models' });
    } else if (['translate-page', 'original', 'export-captions'].includes(action)) {
      page = await pageRequest('page-action', { action });
    } else if (page) {
      page = await pageRequest('page-setting', { action, value });
      settings = await api('settings');
    } else {
      const patch = action === 'hide-floating-all' ? { floating: false } : { [action]: action === 'captions' ? value === 'true' : value };
      settings = await api('preferences', { patch });
    }
  } catch (problem) {
    error = problem.message;
  } finally {
    busy = false;
    draw();
  }
}

(async () => {
  [settings, [tab]] = await Promise.all([api('settings'), tabs.query({ active: true, currentWindow: true })]);
  await getPage();
  draw();
  setInterval(async () => {
    if (busy || document.hidden) return;
    await getPage();
    if (!busy) draw();
  }, 700);
})().catch(problem => {
  error = problem.message;
  draw();
});
