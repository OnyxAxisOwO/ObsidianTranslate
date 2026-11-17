import { cache } from './cache.js';
import { activeModel } from './shared/settings.js';
import { promptSignature, translationContext } from './shared/prompts.js';
import { translateBatch, upstream } from './shared/upstream.js';

const queues = new Map();
const pending = new Map();
let cacheEpoch = 0;

function pumpRequests(queue) {
  if (queue.timer !== undefined) return;
  const now = performance.now();
  // Account for a timer waking slightly late at high rates without catching up after a long suspension.
  const timerSlack = Math.max(0, 4 - queue.interval);
  while (queue.waiting.length && queue.nextAt <= now) {
    const { run, resolve, reject } = queue.waiting.shift();
    queue.lastStart = now;
    queue.nextAt = Math.max(queue.nextAt, now - timerSlack) + queue.interval;
    Promise.resolve().then(run).then(resolve, reject);
  }
  if (queue.waiting.length) {
    const delay = Math.min(0x7fff_ffff, Math.ceil(queue.nextAt - now));
    queue.timer = setTimeout(() => {
      queue.timer = undefined;
      pumpRequests(queue);
    }, delay);
  }
}

export function schedule(provider, run) {
  const interval = 1000 / provider.rps;
  let queue = queues.get(provider.id);
  if (!queue) {
    queue = { interval, nextAt: 0, lastStart: undefined, waiting: [], timer: undefined };
    queues.set(provider.id, queue);
  } else if (queue.interval !== interval) {
    queue.interval = interval;
    queue.nextAt = queue.lastStart === undefined ? 0 : queue.lastStart + interval;
    clearTimeout(queue.timer);
    queue.timer = undefined;
    pumpRequests(queue);
  }
  return new Promise((resolve, reject) => {
    if (queue.waiting.length >= 100) return reject(new Error('翻译请求过多，请稍候重试。'));
    if (!queue.waiting.length) queue.nextAt = Math.max(queue.nextAt, performance.now());
    queue.waiting.push({ run, resolve, reject });
    pumpRequests(queue);
  });
}

export async function discover(provider) {
  const found = new Map();
  let cursor;
  for (let page = 0; page < 5; page++) {
    const data = await schedule(provider, () => upstream(provider, '/models', undefined, cursor));
    if (!Array.isArray(data.data)) throw new Error('服务商未返回可用的模型列表，可手动填写模型 ID。');
    for (const item of data.data) {
      if (typeof item?.id === 'string' && item.id) found.set(item.id, { id: item.id, name: item.display_name || item.id });
    }
    if (provider.protocol !== 'anthropic' || !data.has_more || !data.last_id) break;
    cursor = { after_id: data.last_id };
  }
  return [...found.values()].slice(0, 500);
}

export function splitText(text, size) {
  const parts = [];
  while (text.length > size) {
    const window = text.slice(0, size);
    const breaks = /[。！？；\n]|[.!?;](?=\s)|\s/g;
    let end = 0;
    for (const match of window.matchAll(breaks)) end = match.index + match[0].length;
    if (end < size / 2) end = size;
    const final = text.charCodeAt(end - 1);
    if (final >= 0xd800 && final <= 0xdbff) end--;
    parts.push(text.slice(0, end));
    text = text.slice(end);
  }
  return [...parts, text];
}

async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function group(items, count, size) {
  const batches = [];
  let batch = [];
  let length = 0;
  for (const item of items) {
    if (batch.length && (batch.length >= count || length + item.text.length > size)) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(item);
    length += item.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function fetchBatch(provider, model, settings, target, batch, context) {
  const run = texts => schedule(provider, () => translateBatch(provider, model, settings, target, texts, context));
  try {
    const outputs = await run(batch.map(item => item.text));
    return outputs.map(value => ({ status: 'fulfilled', value }));
  } catch (error) {
    if (!error.invalidBatch) return batch.map(() => ({ status: 'rejected', reason: error }));
    return Promise.allSettled(batch.map(({ text }) => run([text]).then(([output]) => output)));
  }
}

export async function translate(settings, target, texts, selection = activeModel(settings), uncached = false, rawContext, onResult) {
  if (!selection) throw new Error('请先在设置中添加服务商和翻译模型。');
  const { provider, model } = selection;
  const useCache = settings.cache && !uncached;
  const epoch = cacheEpoch;
  const size = settings.maxLength;
  const context = translationContext(rawContext);
  const signatureParts = [2, provider.id, provider.baseUrl, provider.protocol, provider.updated, model.id,
    target, promptSignature(settings, context)];
  if (Object.keys(model.parameters || {}).length) signatureParts.push(model.parameters);
  const signature = await hash(signatureParts);
  const lists = await Promise.all(texts.map(async text => Promise.all(splitText(text, size).map(async part => ({
    key: await hash([signature, part.trim()]),
    text: part.trim(),
    separator: part.endsWith('\n') ? '\n' : /\s$/.test(part) ? ' ' : '',
  })))));
  const unique = new Map(lists.flat().filter(item => item.text).map(item => [item.key, item]));
  const hits = useCache ? await cache.read([...unique.keys()]).catch(() => new Map()) : new Map();
  if (epoch !== cacheEpoch) hits.clear();
  const results = new Map();
  const fresh = [];
  for (const [key, item] of unique) {
    if (hits.has(key)) {
      results.set(key, Promise.resolve({ status: 'fulfilled', value: hits.get(key) }));
      continue;
    }
    const pendingKey = `${epoch}:${useCache}:${key}`;
    let promise = !uncached && pending.get(pendingKey);
    if (!promise) {
      promise = new Promise(resolve => fresh.push({ ...item, pendingKey, resolve }));
      if (!uncached) pending.set(pendingKey, promise);
    }
    results.set(key, promise);
  }
  const delivered = Promise.all(lists.map(async (list, index) => {
    const parts = await Promise.all(list.map(({ key, text }) => text ? results.get(key) : { value: '' }));
    const failure = parts.find(part => part.status === 'rejected');
    const result = failure ? { error: failure.reason.message } : {
      text: parts.map((part, i) => part.value + (i < parts.length - 1 ? list[i].separator : '')).join('').trim(),
      cached: list.every(item => !item.text || hits.has(item.key)),
    };
    onResult?.(index, result);
    return result;
  }));
  const work = group(fresh, settings.batchSize, size).map(async batch => {
    const outputs = await fetchBatch(provider, model, settings, target, batch, context);
    const saved = [];
    batch.forEach(({ key }, i) => {
      if (outputs[i].status === 'fulfilled') saved.push([key, outputs[i].value]);
    });
    batch.forEach(({ resolve }, i) => {
      resolve(outputs[i]);
    });
    if (useCache && saved.length && epoch === cacheEpoch) {
      await cache.write(saved, () => epoch === cacheEpoch).catch(() => {});
    }
    if (!uncached) {
      for (const { pendingKey } of batch) pending.delete(pendingKey);
    }
  });
  await Promise.all(work);
  return delivered;
}

export function clearCache() {
  cacheEpoch++;
  return cache.clear();
}
