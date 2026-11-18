import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { escape } from './helpers.js';
import { createOcr } from './ocr.js';

const xhtml = 'http://www.w3.org/1999/xhtml';
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const strictWord = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const zipLimit = 100_000_000;
const elements = (node, name) => [...node.getElementsByTagNameNS('*', name)];

function xml(source, name) {
  const encoding = source[0] === 0xff && source[1] === 0xfe ? 'utf-16le' :
    source[0] === 0xfe && source[1] === 0xff ? 'utf-16be' : 'utf-8';
  const document = new DOMParser().parseFromString(new TextDecoder(encoding).decode(source), 'application/xml');
  if (document.getElementsByTagNameNS('*', 'parsererror').length) throw new Error(name + ' 的 XML 无法读取。');
  return document;
}

function putText(node, text) {
  node.textContent = text;
  if ([word, strictWord].includes(node.namespaceURI)) node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
}

function readArchive(bytes) {
  let total = 0;
  let count = 0;
  return unzipSync(new Uint8Array(bytes), { filter(entry) {
    if (entry.name.includes('\\') || entry.name.startsWith('/') || entry.name === '__proto__' ||
        /(?:^|\/)\.\.(?:\/|$)/.test(entry.name)) {
      throw new Error('压缩文档包含无效的文件路径。');
    }
    if (++count > 15000) throw new Error('压缩文档中的文件数量过多。');
    total += entry.originalSize;
    if (total > zipLimit) throw new Error('文档解包后超过 100 MB。');
    return !entry.name.endsWith('/');
  } });
}

function archiveResult(files, documents, parts, extension, mime) {
  return { parts, format(translations, bilingual, target) {
    parts.forEach((part, index) => part.apply(translations[index], bilingual, target));
    const serializer = new XMLSerializer();
    for (const [name, document] of documents) files[name] = strToU8(serializer.serializeToString(document));
    const { mimetype, ...members } = files;
    const entry = extension === 'epub' ? { mimetype: [mimetype, { level: 0 }], ...members } : files;
    return { extension, blob: new Blob([zipSync(entry)], { type: mime }) };
  } };
}

function epubPath(base, reference) {
  const url = new URL(reference, 'https://epub.invalid/' + base);
  if (url.origin !== 'https://epub.invalid') return '';
  try {
    return decodeURIComponent(url.pathname.slice(1));
  } catch {
    return '';
  }
}

function epubDocument(bytes) {
  const files = readArchive(bytes);
  const container = files['META-INF/container.xml'];
  if (!container || !files.mimetype || strFromU8(files.mimetype).trim() !== 'application/epub+zip') {
    throw new Error('没有找到有效的 EPUB 容器。');
  }
  const rootfile = elements(xml(container, 'EPUB 容器'), 'rootfile')[0]?.getAttribute('full-path');
  if (!rootfile || !files[rootfile]) throw new Error('没有找到 EPUB 书籍清单。');
  const book = xml(files[rootfile], 'EPUB 书籍清单');
  const idRefs = new Set(elements(book, 'itemref').map(node => node.getAttribute('idref')));
  const paths = [...new Set(elements(book, 'item').filter(node => idRefs.has(node.getAttribute('id')) ||
    node.getAttribute('properties')?.split(/\s+/).includes('nav') ||
    node.getAttribute('media-type') === 'application/x-dtbncx+xml')
    .map(node => epubPath(rootfile, node.getAttribute('href') || '')))];
  const parts = [];
  const documents = new Map();
  for (const title of elements(book, 'title')) {
    const original = title.textContent.trim();
    if (!/\p{L}/u.test(original)) continue;
    documents.set(rootfile, book);
    parts.push({ original, apply(value, bilingual, target) {
      putText(title, bilingual ? original + ' / ' + value : value);
      if (!bilingual) for (const language of elements(book, 'language')) putText(language, target);
    } });
  }
  const blocks = 'p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,figcaption,caption,td,th,title,nav a,nav span';
  const skip = 'script,style,code,pre,svg,math,ruby rt,ruby rp,[translate="no"]';
  for (const name of paths) {
    if (!files[name]) continue;
    const chapter = xml(files[name], name);
    documents.set(name, chapter);
    if (chapter.documentElement.localName === 'ncx') {
      for (const node of elements(chapter, 'text')) {
        const original = node.textContent.trim();
        if (/\p{L}/u.test(original)) parts.push({ original, apply: (value, bilingual) =>
          putText(node, bilingual ? original + ' / ' + value : value) });
      }
      continue;
    }
    const covered = new Set();
    for (const block of chapter.querySelectorAll(blocks)) {
      if (block.closest(skip) || block.querySelector(blocks)) continue;
      const walker = chapter.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const runs = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const original = node.data.trim();
        if (!/\p{L}/u.test(original) || node.parentElement.closest(skip)) continue;
        runs.push({ node, original });
        covered.add(node);
      }
      if (!runs.length) continue;
      const values = [];
      runs.forEach(({ node, original }, index) => parts.push({ original, apply(value, bilingual, target) {
        values[index] = value;
        if (!bilingual) {
          node.data = node.data.match(/^\s*/)[0] + value + node.data.match(/\s*$/)[0];
        } else if (index === runs.length - 1) {
          const translation = values.join(' ');
          if (['title', 'a', 'span'].includes(block.localName)) block.append(' / ' + translation);
          else {
            const line = chapter.createElementNS(xhtml, 'span');
            line.setAttribute('lang', target);
            line.setAttribute('dir', 'auto');
            line.setAttribute('style', 'display:block');
            line.textContent = translation;
            block.append(line);
          }
        }
      } }));
    }
    const body = elements(chapter, 'body')[0];
    if (!body) continue;
    const rest = chapter.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (rest.nextNode()) {
      const node = rest.currentNode;
      const original = node.data.trim();
      if (covered.has(node) || !/\p{L}/u.test(original) || node.parentElement.closest(skip)) continue;
      parts.push({ original, apply(value, bilingual) {
        node.data = node.data.match(/^\s*/)[0] + (bilingual ? original + ' / ' : '') + value + node.data.match(/\s*$/)[0];
      } });
    }
  }
  return archiveResult(files, documents, parts, 'epub', 'application/epub+zip');
}

function docxDocument(bytes) {
  const files = readArchive(bytes);
  if (!files['word/document.xml'] || !files['[Content_Types].xml']) throw new Error('没有找到有效的 DOCX 文档。');
  const documents = new Map();
  const parts = [];
  for (const [name, source] of Object.entries(files)) {
    if (!/^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name)) continue;
    const document = xml(source, name);
    documents.set(name, document);
    const namespace = document.documentElement.namespaceURI;
    if (![word, strictWord].includes(namespace)) continue;
    for (const paragraph of document.getElementsByTagNameNS(namespace, 'p')) {
      const nodes = [...paragraph.getElementsByTagNameNS(namespace, 't')].filter(node =>
        node.closest('p') === paragraph && !node.closest('del') && elements(node.parentElement, 'instrText').length === 0);
      const original = nodes.map(node => node.textContent).join('').trim();
      if (!/\p{L}/u.test(original)) continue;
      parts.push({ original, apply(value, bilingual) {
        if (bilingual) {
          const run = document.createElementNS(namespace, 'w:r');
          const text = document.createElementNS(namespace, 'w:t');
          putText(text, value.replace(/\r?\n/g, ' '));
          run.append(document.createElementNS(namespace, 'w:br'), text);
          paragraph.append(run);
        } else {
          putText(nodes[0], value.replace(/\r?\n/g, ' '));
          for (const node of nodes.slice(1)) node.textContent = '';
        }
      } });
    }
  }
  return archiveResult(files, documents, parts, 'docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

export async function fetchFile(value, signal) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的文件网址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('在线文件需要使用 HTTP 或 HTTPS 网址。');
  }
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (!response.ok || !response.body) throw new Error('无法获取文件（HTTP ' + response.status + '）。');
  const limit = 25_000_000;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    if (Number(response.headers.get('Content-Length')) > limit) throw new Error('在线文件超过 25 MB。');
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new Error('在线文件超过 25 MB。');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, type: response.headers.get('Content-Type')?.split(';')[0] || '' };
}

function pdfParagraphs(items) {
  const paragraphs = [];
  let lines = [];
  let line = '';
  let prior;
  function finishLine() {
    if (line.trim()) lines.push(line.trim());
    line = '';
  }
  function finishParagraph() {
    finishLine();
    const text = lines.join(' ');
    if (/\p{L}/u.test(text)) paragraphs.push(text);
    lines = [];
  }
  for (const item of items) {
    if (!('str' in item)) continue;
    const [,,,, x, y] = item.transform;
    const height = Math.max(item.height, 2);
    if (prior) {
      const gap = Math.abs(y - prior.y);
      if (gap > Math.max(height, prior.height) * 1.55) finishParagraph();
      else if (gap > Math.min(height, prior.height) * .55) finishLine();
      else if (line && x - prior.end > height * .18 && !/\s$/.test(line)) line += ' ';
    }
    line += item.str;
    if (item.hasEOL) finishLine();
    if (lines.length > 20) finishParagraph();
    prior = { y, height, end: x + item.width };
  }
  finishParagraph();
  return paragraphs;
}

async function readScannedPage(page, ocr, signal) {
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2400 / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const render = page.render({ canvas, viewport });
  const abort = () => render.cancel();
  signal.addEventListener('abort', abort, { once: true });
  try {
    await render.promise;
    const { text } = await ocr.recognize(canvas);
    return text.split(/\n\s*\n/).map(block => block.replace(/\s*\n\s*/g, ' ').trim()).filter(block => /\p{L}/u.test(block));
  } finally {
    signal.removeEventListener('abort', abort);
    canvas.width = canvas.height = 1;
  }
}

async function pdfDocument(bytes, name, signal, ocrLanguage, progress) {
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('所选内容不是 PDF 文件。');
  const asset = path => new URL('pdfjs/' + path, document.baseURI).href;
  const pdf = await import(asset('pdf.mjs'));
  signal.throwIfAborted();
  pdf.GlobalWorkerOptions.workerSrc = asset('pdf.worker.mjs');
  const task = pdf.getDocument({ data: bytes, cMapUrl: asset('cmaps/'), cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts/'), useWasm: false, isEvalSupported: false });
  const abort = () => task.destroy().catch(() => {});
  signal.addEventListener('abort', abort, { once: true });
  const parts = [];
  let pageCount;
  let skippedPages = 0;
  let scannedPages = 0;
  const ocr = ocrLanguage ? createOcr(ocrLanguage, signal) : null;
  try {
    const file = await task.promise;
    pageCount = file.numPages;
    if (pageCount > 250) throw new Error('一次最多翻译 250 页 PDF。');
    for (let page = 1; page <= pageCount; page++) {
      signal.throwIfAborted();
      const current = await file.getPage(page);
      let paragraphs = pdfParagraphs((await current.getTextContent()).items);
      if (!paragraphs.length && ocr) {
        progress('正在识别扫描页 · ' + page + ' / ' + pageCount);
        paragraphs = await readScannedPage(current, ocr, signal);
        if (paragraphs.length) scannedPages++;
      }
      if (!paragraphs.length) skippedPages++;
      for (const original of paragraphs) parts.push({ page, original });
      current.cleanup();
    }
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('请先解除 PDF 的打开密码。');
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    await task.destroy().catch(() => {});
    await ocr?.close();
  }
  if (!parts.length) throw new Error(ocr ? '没有在 PDF 中识别到可翻译的文字。' : 'PDF 没有可选中文本。可选择识别语言后重试扫描页。');
  return { parts, skippedPages, scannedPages, format(translations, bilingual, target) {
    const pages = Array.from({ length: pageCount }, () => []);
    parts.forEach(({ page, original }, index) => {
      pages[page - 1].push((bilingual ? '<p class="original" dir="auto">' + escape(original) + '</p>' : '') +
        '<p lang="' + escape(target) + '" dir="auto">' + escape(translations[index]) + '</p>');
    });
    const content = pages.map((paragraphs, index) => '<section><h2>第 ' + (index + 1) + ' 页</h2>' +
      (paragraphs.join('\n') || '<p>本页没有可提取的文本。</p>') + '</section>').join('\n');
    const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
      '<title>' + escape(name) + '</title><style>body{max-width:48rem;margin:2rem auto;padding:0 1.1rem;font:16px/1.65 system-ui,sans-serif}' +
      'h2{font-size:1.05rem}section{border-top:1px solid #aaa;padding:1rem 0}p{white-space:pre-wrap;overflow-wrap:anywhere}' +
      '.original{color:#5a5a61}@media print{body{margin:0}h2{break-after:avoid}p{orphans:3;widows:3}}</style><body><h1>' +
      escape(name) + '</h1>' + content + '</body></html>';
    return { extension: 'html', blob: new Blob([html], { type: 'text/html;charset=utf-8' }), preview: true };
  } };
}

export async function readDocument({ file, url, extension, name, ocrLanguage }, signal, progress) {
  const bytes = url ? (await fetchFile(url, signal)).bytes : new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  if (extension === 'pdf') return pdfDocument(bytes, name, signal, ocrLanguage, progress);
  if (extension === 'epub') return epubDocument(bytes);
  return docxDocument(bytes);
}
