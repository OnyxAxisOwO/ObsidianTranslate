import { defaults, own } from '../shared/settings.js';
import { ext, reply, request } from '../shared/webext.js';
import { connectCaptions } from './captions.js';
import { overlay } from './overlay.js';

const reading = 'p,h1,h2,h3,h4,h5,h6,li,dt,dd,td,th,figcaption,caption,blockquote,summary';
const block = `${reading},div,span,a,button,label`;
const ignored = 'script,style,noscript,textarea,input,select,option,pre,code,svg,math,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[translate="no"],[data-obsidian-interface]';
const peripheral = 'nav,aside,footer,[role="navigation"],[role="complementary"],[role="banner"]';
const primary = 'main,article,[role="main"]';
let settings = defaults;
let running = false;
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
let selectionTimer;
const rows = new Map();
const queue = new Set();
const urgent = new Set();
const changes = new Set();
const ui = overlay(action => handle(action).catch(showError));
const captions = connectCaptions(translateOne, ui);
const near = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!queue.has(entry.target)) continue;
    if (entry.isIntersecting) urgent.add(entry.target);
    else urgent.delete(entry.target);
  }
  schedulePump(0);
}, { rootMargin: '280px 0px' });

function siteRule() {
  return own(settings.sites, location.hostname) ? settings.sites[location.hostname] : '';
}

function state() {
  return { running, scope, view, note, translated, failures, paused, floating: ready && settings.floating && siteRule() !== 'never',
    hostname: location.hostname, site: siteRule() };
}

function status(message) {
  note = message ?? (!settings.activeModel ? '请先在设置中添加翻译模型。' : !running
    ? '当前显示网页原文'
    : failures ? `已翻译 ${translated} 段 · ${failures} 段失败`
      : held || queue.size ? `翻译中 · 已完成 ${translated} 段`
        : translated ? `已翻译 ${translated} 段` : '暂无可翻译的文段');
  ui.showStatus(state());
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

function sourceText(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node instanceof Element && node.matches(ignored)) return NodeFilter.FILTER_REJECT;
      if (node.nodeType === Node.TEXT_NODE || node.nodeName === 'BR') return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    },
  });
  const parts = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    parts.push(node.nodeName === 'BR' ? '\n' : node.data);
  }
  return parts.join('').trim();
}

function inScope(el) {
  if (scope === 'whole') return true;
  if (el.closest(peripheral)) return false;
  return !hasPrimary || !!el.closest(primary);
}

function qualifies(el, force = false) {
  if (!el.isConnected || el.closest(ignored) || el.closest('[role="dialog"][aria-modal="true"]')) return false;
  if (!force && !inScope(el)) return false;
  if (el.matches(reading)) return !el.querySelector(reading);
  if (el.parentElement?.closest(reading) || !el.matches(block)) return false;
  if (!rows.has(el) && el.querySelector(block)) return false;
  return true;
}

function erase(el, row) {
  row.output?.remove();
  if (row.source?.parentNode === el) row.source.replaceWith(...row.source.childNodes);
  row.source = row.output = null;
}

function render(el, row) {
  if (!row.text || !el.isConnected) return;
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
  if (row.text === row.original && view === 'bilingual') {
    row.output?.remove();
    row.output = null;
    return;
  }
  if (!row.output) {
    row.output = document.createElement('span');
    row.output.dataset.obsidianTranslation = '';
    row.output.translate = false;
    row.output.lang = settings.target;
    row.output.dir = 'auto';
    row.output.textContent = row.text;
  }
  if (row.output.parentNode !== el) el.append(row.output);
  row.output.dataset.view = view;
}

function readOriginal(el, row) {
  if (row?.source?.parentNode === el) {
    const children = [...el.childNodes];
    if (children.every(node => node === row.source || node === row.output)) return sourceText(row.source);
    erase(el, row);
  }
  return sourceText(el);
}

function add(el, force = false) {
  if (!qualifies(el, force)) return;
  const old = rows.get(el);
  const original = readOriginal(el, old);
  if (old && original === old.original) {
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
  rows.set(el, { original });
  queue.add(el);
  if (force) urgent.add(el);
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

function start(nextScope) {
  if (siteRule() === 'never') throw new Error('此网站已设为永不翻译。');
  if (!settings.activeModel) throw new Error('请先在设置中添加翻译模型。');
  reset();
  running = true;
  scope = nextScope;
  hasPrimary = !!document.querySelector(primary);
  scan(document.body);
  schedulePump(55);
  status();
}

function stop() {
  running = false;
  reset();
  status();
}

function schedulePump(delay = 110) {
  clearTimeout(pumpTimer);
  if (!paused && (running || urgent.size) && queue.size && held < 2) pumpTimer = setTimeout(pump, delay);
}

async function pump() {
  if (paused || held >= 2 || (!running && !urgent.size)) return;
  const chunk = [];
  let length = 0;
  for (const el of [...new Set([...urgent, ...(running ? queue : [])])]) {
    const row = rows.get(el);
    if (row && el.isConnected) {
      if (chunk.length && (chunk.length >= settings.batchSize || length + row.original.length > settings.maxLength)) break;
      chunk.push([el, row]);
      length += row.original.length;
    }
    urgentlyRemove(el);
  }
  if (!chunk.length) return;
  const version = generation;
  held++;
  status();
  schedulePump(0);
  try {
    const results = await request('translate', { texts: chunk.map(([, row]) => row.original),
      target: settings.target, revision: settings.revision });
    if (version !== generation) return;
    let firstError = '';
    results.forEach((result, i) => {
      const [el, row] = chunk[i];
      if (!el.isConnected || rows.get(el) !== row) return;
      if (result.error) {
        rows.delete(el);
        failures++;
        firstError ||= result.error;
      } else {
        row.text = result.text;
        translated++;
        render(el, row);
      }
    });
    if (firstError) {
      paused = true;
      status(firstError);
      if (!running) ui.hint(firstError);
    }
  } catch (error) {
    if (version !== generation) return;
    for (const [el, row] of chunk) {
      if (rows.get(el) === row) rows.delete(el);
    }
    failures += chunk.length;
    paused = true;
    status(error.message);
    if (!running) ui.hint(error.message);
  } finally {
    held--;
    if (!paused) status();
    schedulePump(urgent.size ? 0 : 120);
  }
}

function urgentlyRemove(el) {
  queue.delete(el);
  urgent.delete(el);
  near.unobserve(el);
}

async function translateOne(text, target = settings.target) {
  const [result] = await request('translate', { texts: [text], target, revision: settings.revision });
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
  const text = (selected || chosen || before).trim();
  if (!text) throw new Error('输入框里没有可翻译的文字。');
  const from = isField && chosen ? field.selectionStart : 0;
  const to = isField && chosen ? field.selectionEnd : before.length;
  const range = !isField && chosen && getSelection()?.rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
  const result = await translateOne(text, settings.inputTarget);
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

let settingsRead = 0;

async function sync() {
  const read = ++settingsRead;
  const previous = settings;
  const next = await request('settings');
  if (read !== settingsRead) return;
  const previousRule = siteRule();
  settings = next;
  ready = true;
  const restart = previous.revision !== settings.revision || previous.target !== settings.target ||
    previous.prompt !== settings.prompt || previous.scope !== settings.scope ||
    previous.maxLength !== settings.maxLength;
  if (previous.view !== settings.view) {
    view = settings.view;
    for (const [el, row] of rows) render(el, row);
  }
  if (restart) captions(false);
  captions(!!settings.activeModel && settings.captions && siteRule() !== 'never');
  if (siteRule() === 'never' || !settings.activeModel) {
    stop();
  } else if ((!running && previousRule !== 'always' && siteRule() === 'always') || (running && restart)) {
    start(previous.scope !== settings.scope ? settings.scope : scope);
  } else if (restart && rows.size) {
    stop();
  } else {
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
    if (running || (siteRule() === 'always' && settings.activeModel)) start(running ? scope : settings.scope);
  }
  if (!running) return;
  for (const { target, addedNodes } of records) {
    const element = target instanceof Element ? target : target.parentElement;
    const el = element?.closest('[data-obsidian-source]')?.parentElement || element;
    if (!el || el.closest(ignored)) continue;
    if (addedNodes.length && [...addedNodes].every(node =>
      node instanceof Element && node.matches('[data-obsidian-translation],[data-obsidian-source],[data-obsidian-interface]'))) continue;
    changes.add(el);
  }
  if (!changes.size || mutationTimer) return;
  mutationTimer = setTimeout(() => {
    mutationTimer = undefined;
    for (const [el] of rows) {
      if (el.isConnected) continue;
      urgentlyRemove(el);
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
  hoverTarget = event.target instanceof Element ? event.target.closest(reading) || event.target.closest(block) : null;
}, { passive: true });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    ui.closePanel();
    ui.hideSelection();
  }
  if (event.key !== 'Shift' || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
      !settings.hover || !settings.activeModel || siteRule() === 'never' || !hoverTarget || editable(document.activeElement)) return;
  paused = false;
  add(hoverTarget, true);
  if (queue.has(hoverTarget)) urgent.add(hoverTarget);
  schedulePump(0);
});

sync().catch(showError);
