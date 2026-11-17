import { defaults, languageCode, own, promptDefaults } from '../shared/settings.js';
import { ext, reply, request, requestParagraphs } from '../shared/webext.js';
import { connectCaptions } from './captions.js';
import { overlay } from './overlay.js';

const reading = 'p,h1,h2,h3,h4,h5,h6,li,dt,dd,td,th,figcaption,caption,blockquote,summary';
const block = `${reading},div,span,a,button,label`;
const ignored = 'script,style,noscript,textarea,input,select,option,pre,code,svg,math,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[translate="no"],[data-obsidian-interface]';
const ownedNodes = '[data-obsidian-loading],[data-obsidian-translation],[data-obsidian-source],[data-obsidian-interface]';
const peripheral = 'nav,aside,footer,[role="navigation"],[role="complementary"],[role="banner"]';
const primary = 'main,article,[role="main"]';
const tocHeading = '.vector-toc-text > span:not(.vector-toc-numb), .toctext';
let settings = defaults;
let running = false;
let autoSession = false;
let detectedLanguage = '';
let scope = 'reading';
let view = defaults.view;
let generation = 0;
let held = 0;
let translated = 0;
let failures = 0;
let paused = false;
let note = '';
let lastUrl = location.pathname + location.search;
let hasPrimary;
let selection;
let hoverTarget;
let ready = false;
let mutationTimer;
let pumpTimer;
let nextDispatch = 0;
let firstBatch = true;
let translationRun = new AbortController();
let selectionTimer;
const rows = new Map();
const queue = new Set();
const urgent = new Set();
const changes = new Set();
const spaceKeys = new WeakMap();
const ui = overlay((action, value) => panelAction(action, value).catch(showError));
const captions = connectCaptions(text => translateOne(text, settings.target, { kind: 'subtitle' }), ui);
const near = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!queue.has(entry.target)) continue;
    if (entry.isIntersecting) urgent.add(entry.target);
    else urgent.delete(entry.target);
    updateLoading(entry.target, rows.get(entry.target));
  }
  schedulePump(0);
}, { rootMargin: '280px 0px' });

function siteRule() {
  return own(settings.sites, location.hostname) ? settings.sites[location.hostname] : '';
}

function sourceLanguage() {
  return settings.source === 'auto' ? detectedLanguage || 'auto' : settings.source;
}

function autoRule() {
  return siteRule() || settings.languageRules[sourceLanguage()] || '';
}

async function detectLanguage(preferences) {
  const declared = languageCode(document.documentElement.lang ||
    document.querySelector('meta[http-equiv="content-language" i]')?.content);
  if (declared || preferences.source !== 'auto') return declared;
  if (!Object.keys(preferences.languageRules).length || !ext.i18n?.detectLanguage) return '';
  const body = document.querySelector(primary) || document.body;
  const sample = [...body.querySelectorAll('p,h1,h2')].slice(0, 15).map(el => sourceText(el)).join(' ').slice(0, 1600);
  if (sample.length < 25) return '';
  try {
    const result = await ext.i18n.detectLanguage(sample);
    return result?.isReliable ? languageCode(result.languages[0]?.language) : '';
  } catch {
    return '';
  }
}

function context(extra) {
  return { source: sourceLanguage(), title: document.title, ...extra };
}

function state() {
  return { running, scope, view, note, translated, failures, paused, canRestore: running || !!rows.size,
    floatingHidden: settings.hiddenFloatingSites.includes(location.hostname),
    floating: ready && settings.floating && !settings.hiddenFloatingSites.includes(location.hostname) && siteRule() !== 'never',
    hostname: location.hostname, site: siteRule() };
}

function status(message) {
  note = message ?? (!settings.configured ? '请先在高级设置中配置模型。' : !running
    ? '当前显示网页原文'
    : failures ? `已翻译 ${translated} 段 · ${failures} 段失败`
      : held || queue.size ? `翻译中 · 已完成 ${translated} 段`
        : translated ? `已翻译 ${translated} 段` : '暂无可翻译的文段');
  ui.showStatus(settings, state());
}

function showError(error) {
  status(error.message);
  ui.hint(error.message);
}

function selectionText() {
  const current = getSelection();
  if (!current?.rangeCount || current.isCollapsed || current.anchorNode?.parentElement?.closest(ignored)) return null;
  const text = current.toString().trim();
  if (!text || text.length > 30000) return null;
  return { text, rect: current.getRangeAt(0).getBoundingClientRect() };
}

function sourceText(element, links) {
  let text = '';
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.data;
    } else if (child instanceof Element && !child.matches(ignored)) {
      if (child.tagName === 'BR') {
        text += '\n';
      } else if (links && child.matches('a[href]')) {
        const label = sourceText(child);
        if (!label.trim()) continue;
        const index = links.push(child) - 1;
        text += `<ot-link-${index}>${label}</ot-link-${index}>`;
      } else {
        text += sourceText(child, links);
      }
    }
  }
  return text;
}

function translatedLink(original, label) {
  const link = document.createElement('a');
  for (const name of ['href', 'target', 'rel', 'download']) {
    const value = original.getAttribute(name);
    if (value != null && !(name === 'href' && /^\s*(javascript|data):/i.test(value))) link.setAttribute(name, value);
  }
  link.textContent = label;
  link.setAttribute('aria-label', label === '↗' ? original.textContent.trim() : label);
  link.addEventListener('click', event => {
    if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    original.click();
  });
  return link;
}

function translatedContents(output, text, links) {
  if (!links.length) {
    output.textContent = text;
    return;
  }
  const stripTags = value => value.replace(/<\/?ot-link-\d+>/gi, '');
  const used = new Set();
  let offset = 0;
  for (const match of text.matchAll(/<ot-link-(\d+)>([\s\S]*?)<\/ot-link-\1>/gi)) {
    output.append(stripTags(text.slice(offset, match.index)));
    const index = Number(match[1]);
    const label = stripTags(match[2]);
    output.append(links[index] ? translatedLink(links[index], label) : label);
    used.add(index);
    offset = match.index + match[0].length;
  }
  output.append(stripTags(text.slice(offset)));
  for (const [index, original] of links.entries()) {
    if (!used.has(index)) output.append(' ', translatedLink(original, '↗'));
  }
}

function inScope(el) {
  if (scope === 'whole') return true;
  if (el.closest(peripheral)) return false;
  return !hasPrimary || !!el.closest(primary);
}

function qualifies(el, force = false) {
  if (!el.isConnected || el.closest(ignored) || el.closest('[role="dialog"][aria-modal="true"]')) return false;
  if (!force && !inScope(el)) return false;
  if (el.closest('.vector-toc')) {
    return el.matches(tocHeading + ', .ext-discussiontools-init-sidebar-meta') ||
      (el.matches('.vector-toc-text') && !el.querySelector('span'));
  }
  if (el.matches('.toctext')) return true;
  if (el.matches(reading)) return !el.querySelector(reading);
  if (el.parentElement?.closest(reading) || !el.matches(block)) return false;
  if (!rows.has(el) && el.querySelector(block)) return false;
  return true;
}

function clearLoading(row) {
  row.indicator?.remove();
  row.indicator = undefined;
}

function updateLoading(el, row) {
  if (!row) return;
  const style = settings.loadingStyle;
  if (style === 'off' || !el.isConnected || (!row.pending && (paused || !urgent.has(el)))) {
    clearLoading(row);
    return;
  }
  if (!row.indicator) {
    row.indicator = document.createElement('span');
    row.indicator.translate = false;
    row.indicator.dir = 'auto';
    row.indicator.setAttribute('aria-hidden', 'true');
  }
  const indicator = row.indicator;
  if (indicator.dataset.obsidianLoading !== style) {
    indicator.dataset.obsidianLoading = style;
    if (style === 'dots') {
      indicator.replaceChildren(...Array.from({ length: 3 }, () => document.createElement('span')));
    } else {
      indicator.replaceChildren();
    }
  }
  if (style === 'text' && indicator.textContent !== settings.loadingText) indicator.textContent = settings.loadingText;
  if (indicator.parentNode !== el) el.append(indicator);
}

function erase(el, row) {
  clearLoading(row);
  row.output?.remove();
  if (row.source?.parentNode === el) row.source.replaceWith(...row.source.childNodes);
  row.source = row.output = null;
}

function render(el, row) {
  if (!row.text || !el.isConnected) return;
  if (row.text === row.original) return erase(el, row);
  clearLoading(row);
  if (view === 'translation') {
    if (row.source?.parentNode !== el) {
      row.source = document.createElement('span');
      row.source.dataset.obsidianSource = '';
      row.source.hidden = true;
      const originals = [...el.childNodes].filter(node => node !== row.output);
      row.source.append(...originals);
      el.prepend(row.source);
    }
  } else if (row.source?.parentNode === el) {
    row.source.replaceWith(...row.source.childNodes);
    row.source = null;
  }
  if (!row.output) {
    row.output = document.createElement('span');
    row.output.dataset.obsidianTranslation = '';
    row.output.translate = false;
    row.output.lang = settings.target;
    row.output.dir = 'auto';
    translatedContents(row.output, row.text, row.links);
  }
  if (row.output.parentNode !== el) el.append(row.output);
  row.output.dataset.view = view;
  row.output.dataset.style = settings.style;
  if (el.matches(tocHeading + ', .vector-toc-text, .ext-discussiontools-init-sidebar-meta')) {
    row.output.dataset.layout = 'inline';
  }
  if (view === 'bilingual' && settings.order === 'translation-first') {
    if (row.output !== el.firstChild) el.prepend(row.output);
    row.output.dataset.first = '';
  } else {
    if (row.output !== el.lastChild) el.append(row.output);
    delete row.output.dataset.first;
  }
}

function readOriginal(el, row, links) {
  if (row?.source?.parentNode === el) {
    const children = [...el.childNodes];
    if (children.every(node => node === row.source || node === row.output)) return sourceText(row.source, links).trim();
    erase(el, row);
  }
  return sourceText(el, links).trim();
}

function add(el, force = false) {
  if (!qualifies(el, force)) return;
  const old = rows.get(el);
  const links = [];
  const original = readOriginal(el, old, links);
  if (old && original === old.original && links.length === old.links.length &&
      links.every((link, i) => link === old.links[i])) {
    if (old.text && old.output?.parentNode !== el && old.text !== old.original) render(el, old);
    return;
  }
  if (old) {
    if (old.text) translated = Math.max(0, translated - 1);
    erase(el, old);
    queue.delete(el);
    urgent.delete(el);
    near.unobserve(el);
    rows.delete(el);
  }
  if (original.length < (force || scope === 'whole' ? 1 : 2) || original.length > 100000 || !/\p{L}/u.test(original)) return;
  if (!force && el.getClientRects().length === 0) return;
  const row = { original, links };
  rows.set(el, row);
  queue.add(el);
  if (force) {
    urgent.add(el);
    updateLoading(el, row);
  }
  near.observe(el);
}

function scan(root) {
  if (!(root instanceof Element) || !root.isConnected || root.closest(ignored)) return;
  const selector = scope === 'whole' ? block : reading;
  const nearby = root.closest(selector);
  if (nearby) add(nearby);
  for (const el of root.querySelectorAll(selector)) add(el);
}

function reset() {
  generation++;
  translationRun.abort();
  translationRun = new AbortController();
  held = 0;
  nextDispatch = 0;
  firstBatch = true;
  clearTimeout(pumpTimer);
  near.disconnect();
  for (const [el, row] of rows) erase(el, row);
  rows.clear();
  queue.clear();
  urgent.clear();
  changes.clear();
  translated = failures = 0;
  paused = false;
}

function start(nextScope, automatic = false) {
  if (siteRule() === 'never') throw new Error('此网站已设为永不翻译。');
  if (!settings.configured) throw new Error('请先在高级设置中配置模型。');
  reset();
  running = true;
  autoSession = automatic;
  scope = nextScope;
  hasPrimary = !!document.querySelector(primary);
  scan(document.body);
  schedulePump(0);
  status();
}

function stop() {
  running = false;
  autoSession = false;
  reset();
  status();
}

function pumpCapacity() {
  // Keep requests moving for the duration of the API timeout, independently of response latency.
  return Math.max(2, Math.ceil((settings.requestsPerSecond ?? 2) * 25));
}

function schedulePump(delay = 110) {
  clearTimeout(pumpTimer);
  if (!paused && (running || urgent.size) && queue.size && held < pumpCapacity()) {
    const wait = Math.max(delay, nextDispatch - performance.now());
    pumpTimer = setTimeout(pump, Math.min(0x7fff_ffff, Math.max(0, wait)));
  }
}

function pauseAfterError(message) {
  paused = true;
  for (const el of urgent) updateLoading(el, rows.get(el));
  status(message);
  if (!running) ui.hint(message);
}

async function pump() {
  if (paused || held >= pumpCapacity() || (!running && !urgent.size)) return;
  const chunk = [];
  let length = 0;
  const visible = urgent.size > 0;
  const candidates = visible ? urgent : queue;
  for (const el of candidates) {
    const row = rows.get(el);
    if (row && el.isConnected) {
      if (chunk.length && (firstBatch || chunk.length >= settings.batchSize || length + row.original.length > settings.maxLength)) break;
      chunk.push([el, row]);
      length += row.original.length;
    }
    urgentlyRemove(el);
  }
  if (!chunk.length) return;
  firstBatch = false;
  nextDispatch = performance.now() + 1000 / (settings.requestsPerSecond ?? 2);
  const version = generation;
  held++;
  for (const [el, row] of chunk) {
    row.pending = true;
    updateLoading(el, row);
  }
  status();
  schedulePump(0);
  const completed = new Set();
  let allCached = true;
  try {
    await requestParagraphs({ texts: chunk.map(([, row]) => row.original),
      target: settings.target, revision: settings.revision, context: context() }, (i, result) => {
      if (version !== generation || completed.has(i)) return;
      completed.add(i);
      allCached &&= result.cached === true;
      const [el, row] = chunk[i];
      row.pending = false;
      clearLoading(row);
      if (!el.isConnected || rows.get(el) !== row) return;
      if (result.error) {
        rows.delete(el);
        failures++;
        pauseAfterError(result.error);
      } else {
        row.text = result.text;
        translated++;
        render(el, row);
      }
      if (!paused) status();
    }, translationRun.signal);
  } catch (error) {
    if (version !== generation) return;
    for (const [i, [el, row]] of chunk.entries()) {
      if (!completed.has(i) && rows.get(el) === row) {
        rows.delete(el);
        failures++;
      }
    }
    pauseAfterError(error.message);
  } finally {
    for (const [, row] of chunk) {
      row.pending = false;
      clearLoading(row);
    }
    if (version === generation) {
      held--;
      if (allCached && completed.size === chunk.length) nextDispatch = 0;
      if (!paused) status();
      schedulePump(0);
    }
  }
}

function urgentlyRemove(el) {
  queue.delete(el);
  urgent.delete(el);
  near.unobserve(el);
}

async function translateOne(text, target = settings.target, extra) {
  const [result] = await request('translate', { texts: [text], target, revision: settings.revision, context: context(extra) });
  if (result.error) throw new Error(result.error);
  return result.text;
}

function editable(element) {
  return element?.closest('textarea,input:not([type]),input[type="text"],input[type="search"],[contenteditable]:not([contenteditable="false"])');
}

async function translateInput(selected) {
  const field = editable(document.activeElement);
  if (!field || field.disabled || field.readOnly) throw new Error('请先点击要翻译的输入框。');
  const isField = 'value' in field;
  const before = isField ? field.value : field.innerText;
  const chosen = isField ? field.value.slice(field.selectionStart, field.selectionEnd) : getSelection()?.toString();
  let text = (selected || chosen || before).trim();
  let target = settings.inputTarget;
  const command = text.match(/^\/([a-z][\w-]*)\s+/i);
  if (command) {
    const language = languageCode(command[1] === 'zht' ? 'zh-TW' : command[1]);
    if (language) {
      target = language;
      text = text.slice(command[0].length);
    }
  }
  const marker = text.match(/(^|\s)\/\/(?=\S)/);
  const partialStart = marker ? marker.index + marker[1].length : -1;
  const prefix = partialStart < 0 ? '' : text.slice(0, partialStart);
  if (partialStart >= 0) text = text.slice(partialStart + 2);
  if (!text) throw new Error('输入框里没有可翻译的文字。');
  const from = isField && chosen ? field.selectionStart : 0;
  const to = isField && chosen ? field.selectionEnd : before.length;
  const range = !isField && chosen && getSelection()?.rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
  const result = prefix + await translateOne(text, target, { source: 'auto', title: '' });
  if (!field.isConnected || document.activeElement !== field || (isField ? field.value : field.innerText) !== before) {
    ui.hint(result);
    return;
  }
  if (isField) {
    const value = before.slice(0, from) + result + before.slice(to);
    const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
    field.setSelectionRange(from + result.length, from + result.length);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: result }));
    return;
  }
  const activeSelection = getSelection();
  if (range && field.contains(range.commonAncestorContainer)) {
    activeSelection.removeAllRanges();
    activeSelection.addRange(range);
  } else {
    activeSelection.selectAllChildren(field);
  }
  if (!document.execCommand('insertText', false, result)) ui.hint(result);
}

async function handle(action, message = {}) {
  if (action === 'options') return request('options');
  if (action === 'refresh') {
    await sync();
    return state();
  }
  if (action === 'translate-page' && (!running || paused)) start(settings.scope);
  if (action === 'original') stop();
  if (action === 'toggle') {
    if (running && paused) start(scope);
    else if (running || rows.size) stop();
    else start(settings.scope);
  }
  if (action === 'whole') {
    if (!running || paused) start('whole');
    else if (scope !== 'whole') {
      scope = 'whole';
      scan(document.body);
      schedulePump(0);
      status();
    }
  }
  if (action === 'reading') start('reading');
  if (action === 'view') {
    view = message.view || (view === 'bilingual' ? 'translation' : 'bilingual');
    for (const [el, row] of rows) render(el, row);
    status();
  }
  if (action === 'selection') {
    const selected = selectionText() || selection;
    const text = message.text || selected?.text;
    if (text) {
      const show = value => selected?.rect ? ui.selection(selected.rect, value) : ui.hint(value);
      show('翻译中…');
      try {
        show(await translateOne(text));
      } catch (error) {
        show(error.message);
      }
    }
  }
  if (action === 'input') await translateInput(message.text);
  return state();
}

async function panelAction(action, value) {
  if (['models', 'floating', 'text', 'files', 'advanced'].includes(action)) {
    return request('options', { section: action });
  }
  if (['translate-page', 'toggle'].includes(action) && !settings.configured) {
    return request('options', { section: 'models' });
  }
  if (action === 'site') {
    await request('site-rule', { rule: value });
    return sync();
  }
  if (action === 'toggle-floating-site') {
    await request('floating-site', { hidden: !settings.hiddenFloatingSites.includes(location.hostname) });
    return sync();
  }
  if (action === 'hide-floating-all') {
    await request('preferences', { patch: { floating: false } });
    return sync();
  }
  if (['source', 'target', 'activeModel', 'view', 'scope', 'captions'].includes(action)) {
    await request('preferences', { patch: { [action]: action === 'captions' ? value === 'true' : value } });
    return sync();
  }
  return handle(action);
}

let settingsRead = 0;

async function sync(navigated = false) {
  const read = ++settingsRead;
  const previous = settings;
  const next = await request('settings');
  const nextLanguage = await detectLanguage(next);
  if (read !== settingsRead) return;
  const previousRule = autoRule();
  const previousLanguage = sourceLanguage();
  detectedLanguage = nextLanguage;
  settings = next;
  ready = true;
  const restart = previous.revision !== settings.revision || previous.target !== settings.target ||
    previousLanguage !== sourceLanguage() || previous.scope !== settings.scope ||
    previous.maxLength !== settings.maxLength || previous.glossary !== settings.glossary ||
    Object.keys(promptDefaults).some(key => previous[key] !== settings[key]);
  if (previous.view !== settings.view || previous.order !== settings.order || previous.style !== settings.style) {
    view = settings.view;
    for (const [el, row] of rows) render(el, row);
  }
  if (previous.loadingStyle !== settings.loadingStyle || previous.loadingText !== settings.loadingText) {
    for (const [el, row] of rows) updateLoading(el, row);
  }
  if (previous.requestsPerSecond !== settings.requestsPerSecond) {
    nextDispatch = 0;
    schedulePump(0);
  }
  if (restart) captions(false);
  captions(!!settings.configured && settings.captions && siteRule() !== 'never');
  if (siteRule() === 'never' || !settings.configured || (autoSession && autoRule() === 'never')) {
    stop();
  } else if (running && (restart || navigated)) {
    start(previous.scope !== settings.scope ? settings.scope : scope, autoSession);
  } else if (!running && (navigated || previousRule !== 'always' || !previous.configured) && autoRule() === 'always') {
    start(settings.scope, true);
  } else if (restart && rows.size) {
    stop();
  } else {
    if (!running) scope = settings.scope;
    status();
  }
}

ext.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['page-state', 'page-action'].includes(message?.type)) return false;
  return reply(message => message.type === 'page-state' ? state() : handle(message.action, message))(message, sender, respond);
});
ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) sync().catch(showError);
});

const watcher = new MutationObserver(records => {
  const url = location.pathname + location.search;
  if (lastUrl !== url) {
    lastUrl = url;
    sync(true).catch(showError);
  }
  if (!running) return;
  for (const { target, addedNodes, removedNodes } of records) {
    const element = target instanceof Element ? target : target.parentElement;
    const el = element?.closest('[data-obsidian-source]')?.parentElement || element;
    if (!el || el.closest(ignored)) continue;
    if ((addedNodes.length || removedNodes.length) &&
      [...addedNodes, ...removedNodes].every(node => node instanceof Element && node.matches(ownedNodes))) continue;
    changes.add(el);
  }
  if (!changes.size || mutationTimer) return;
  mutationTimer = setTimeout(() => {
    mutationTimer = undefined;
    for (const [el, row] of rows) {
      if (el.isConnected) continue;
      urgentlyRemove(el);
      clearLoading(row);
      rows.delete(el);
    }
    hasPrimary = !!document.querySelector(primary);
    for (const el of changes) scan(el);
    changes.clear();
    schedulePump();
  }, 180);
});
watcher.observe(document.body, { childList: true, subtree: true, characterData: true });

document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  if (!settings.selection || siteRule() === 'never' || editable(document.activeElement)) {
    selection = null;
    return;
  }
  selectionTimer = setTimeout(() => {
    const value = selectionText();
    if (value) {
      if (value.text !== selection?.text) {
        selection = value;
        ui.selection(value.rect);
      }
    } else {
      selection = null;
      ui.hideSelection();
    }
  }, 160);
});
document.addEventListener('pointerover', event => {
  hoverTarget = event.target instanceof Element
    ? event.target.closest(tocHeading) || event.target.closest(reading) || event.target.closest(block) : null;
}, { passive: true });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    ui.closePanel();
    ui.hideSelection();
  }
  const field = editable(document.activeElement);
  if (field && settings.inputSpaces && settings.configured && !event.isComposing && !event.repeat) {
    const previous = spaceKeys.get(field);
    if (event.key !== ' ' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
      spaceKeys.delete(field);
    } else if (previous?.count === 2 && event.timeStamp - previous.time < 550) {
      event.preventDefault();
      spaceKeys.delete(field);
      translateInput().catch(showError);
    } else {
      const count = previous && event.timeStamp - previous.time < 550 ? previous.count + 1 : 1;
      spaceKeys.set(field, { count, time: event.timeStamp });
    }
  }
  if (event.key !== 'Shift' || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
      !settings.hover || !settings.configured || siteRule() === 'never' || !hoverTarget || field) return;
  paused = false;
  add(hoverTarget, true);
  if (queue.has(hoverTarget)) {
    urgent.add(hoverTarget);
    updateLoading(hoverTarget, rows.get(hoverTarget));
  }
  schedulePump(0);
});

sync().catch(showError);
