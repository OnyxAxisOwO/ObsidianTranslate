import { markupMatches, stripMarkup } from '../shared/markup.js';

const inline = 'a,abbr,b,bdi,bdo,cite,del,dfn,em,font,i,ins,kbd,mark,q,s,samp,small,span,strike,strong,sub,sup,time,u,var';
const styles = ['color', 'background-color', 'font-size', 'font-style', 'font-weight', 'text-decoration-line', 'vertical-align'];
export const pageControls = 'button,label,[role="button"],[role="tab"],[role="tablist"],[role="menuitem"],[role="menubar"],[role="toolbar"],.mw-editsection,#p-personal,#p-views,#p-namespaces,.vector-page-toolbar';
export const protectedContent = 'img,picture,video,audio,iframe,canvas,embed,object,input,select,textarea,svg,math,code,pre,script,style,noscript,template,ruby,br,wbr,[role="img"],[data-icon],.material-icons,.reference,[role="doc-noteref"]';
const owned = '[data-obsidian-translation],[data-obsidian-loading],[data-obsidian-interface]';
const constrained = 'a,button,label,summary,td,th,figcaption,caption,.gallerytext,.thumbcaption,.mw-heading,.vector-toc';

function inlineTree(node, blocked) {
  if (!node.matches(inline) || node.matches(blocked + ',' + pageControls) || node.shadowRoot) return false;
  if (!node.textContent.trim()) return false;
  const { display, visibility } = getComputedStyle(node);
  if (visibility === 'hidden') return false;
  if (!['inline', 'inline-block'].includes(display)) return false;
  return [...node.children].every(child => inlineTree(child, blocked));
}

function serialize(nodes, rich) {
  const slots = new Map();
  let original = '';
  function visit(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      original += node.data;
      return node.data;
    }
    let name;
    if (node.matches('a[href]') || rich) {
      name = (node.matches('a[href]') ? 'ot-link-' : 'ot-fmt-') + slots.size;
      slots.set(name, node);
    }
    const text = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE || child instanceof HTMLElement)
      .map(visit).join('');
    return name ? '<' + name + '>' + text + '</' + name + '>' : text;
  }
  const input = nodes.map(visit).join('').trim();
  return { input, original: original.trim(), slots, leading: original.match(/^\s*/)[0], trailing: original.match(/\s*$/)[0] };
}

export function textRuns(element, { rich, limit, skip }) {
  const blocked = skip + ',' + protectedContent;
  const parts = [];
  function collect(parent) {
    let run = [];
    function flush() {
      if (!run.length) return;
      const part = serialize(run, rich);
      if (/\p{L}/u.test(part.original) && part.original.length <= 100000) {
        parts.push({ ...part, parent, nodes: run, input: part.input.length <= limit ? part.input : part.original });
      }
      run = [];
    }
    const children = [...parent.childNodes].flatMap(node =>
      node instanceof HTMLElement && node.hasAttribute('data-obsidian-source') ? [...node.childNodes] : [node]);
    for (const node of children) {
      if (node.nodeType === Node.TEXT_NODE) {
        run.push(node);
      } else if (node instanceof HTMLElement && !node.matches(owned)) {
        if (inlineTree(node, blocked)) run.push(node);
        else {
          flush();
          if (!node.matches(blocked) && !node.shadowRoot) {
            const { display, visibility } = getComputedStyle(node);
            if (display !== 'none' && visibility !== 'hidden') collect(node);
          }
        }
      } else if (node instanceof Element) {
        flush();
      }
    }
    flush();
  }
  collect(element);
  return parts;
}

export function sameRuns(left, right) {
  return left.length === right.length && left.every((part, i) => {
    const next = right[i];
    return part.input === next.input && part.leading === next.leading && part.trailing === next.trailing &&
      part.parent === next.parent && part.nodes.length === next.nodes.length &&
      part.nodes.every((node, index) => node === next.nodes[index]) &&
      part.slots.size === next.slots.size && [...part.slots].every(([name, node]) => next.slots.get(name) === node);
  });
}

function copyInline(original) {
  const copy = document.createElement(original.localName);
  for (const name of ['class', 'title', 'dir']) {
    const value = original.getAttribute(name);
    if (value != null) copy.setAttribute(name, value);
  }
  for (const property of styles) {
    const value = original.style.getPropertyValue(property);
    if (value) copy.style.setProperty(property, value);
  }
  if (original.matches('a[href]')) {
    for (const name of ['href', 'target', 'rel', 'download']) {
      const value = original.getAttribute(name);
      if (value != null && !(name === 'href' && /^\s*(javascript|data):/i.test(value))) copy.setAttribute(name, value);
    }
    copy.addEventListener('click', event => {
      if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      original.click();
    });
  }
  return copy;
}

function restoreMarkup(text, slots) {
  const output = document.createDocumentFragment();
  const stack = [{ node: output }];
  const used = new Set();
  let offset = 0;
  for (const match of markupMatches(text)) {
    const [, close, rawName] = match;
    const name = rawName.toLowerCase();
    const parent = stack.at(-1);
    parent.node.append(text.slice(offset, match.index));
    offset = match.index + match[0].length;
    if (close) {
      if (parent.name !== name) return null;
      stack.pop();
    } else {
      const original = slots.get(name);
      if (!original || used.has(name) || (name.startsWith('ot-link-') && stack.some(item => item.name?.startsWith('ot-link-')))) return null;
      const node = copyInline(original);
      parent.node.append(node);
      stack.push({ name, node });
      used.add(name);
    }
  }
  if (stack.length !== 1) return null;
  output.append(text.slice(offset));
  return { output, used };
}

function paint(part, output) {
  const rich = restoreMarkup(part.text, part.slots);
  if (rich) output.append(rich.output);
  else output.textContent = stripMarkup(part.text);
  for (const [name, original] of part.slots) {
    if (!name.startsWith('ot-link-') || rich?.used.has(name)) continue;
    const link = copyInline(original);
    link.textContent = '↗';
    link.setAttribute('aria-label', original.textContent.trim());
    output.append(' ', link);
  }
}

export function restoreRun(part) {
  part.output?.remove();
  if (part.source?.parentNode === part.parent) part.source.replaceWith(...part.source.childNodes);
  part.source = part.output = null;
}

export function renderRun(part, { view, target, style, order, bilingualLayout, forceInline }) {
  if (part.text === part.input || part.text === part.original) return restoreRun(part);
  const { parent, nodes } = part;
  if (!nodes.every(node => node.parentNode === parent || (part.source && node.parentNode === part.source))) return;
  if (part.source && part.source.parentNode !== parent) return;
  if (view === 'translation' && !part.source) {
    const source = document.createElement('span');
    source.dataset.obsidianSource = '';
    source.hidden = true;
    nodes[0].before(source);
    source.append(...nodes);
    part.source = source;
  } else if (view === 'bilingual' && part.source) {
    part.source.replaceWith(...part.source.childNodes);
    part.source = null;
  }
  if (!part.output) {
    part.output = document.createElement('span');
    part.output.dataset.obsidianTranslation = '';
    part.output.translate = false;
    part.output.lang = target;
    part.output.dir = 'auto';
    paint(part, part.output);
    part.leadingText = document.createTextNode('');
    part.trailingText = document.createTextNode('');
    part.output.prepend(part.leadingText);
    part.output.append(part.trailingText);
  }
  const output = part.output;
  part.leadingText.data = view === 'translation' ? part.leading : '';
  part.trailingText.data = view === 'translation' ? part.trailing : '';
  const first = view === 'bilingual' && order === 'translation-first';
  const inline = view === 'translation' || bilingualLayout === 'inline' ||
    (bilingualLayout === 'auto' && (forceInline || parent.closest(constrained) || getComputedStyle(parent).display === 'inline'));
  output.dataset.view = view;
  output.dataset.style = style;
  output.dataset.layout = inline ? 'inline' : 'block';
  output.toggleAttribute('data-first', first);
  if (part.source) {
    if (part.source.nextSibling !== output) part.source.after(output);
  } else if (first) {
    if (nodes[0].previousSibling !== output) nodes[0].before(output);
  } else if (nodes.at(-1).nextSibling !== output) nodes.at(-1).after(output);
}
