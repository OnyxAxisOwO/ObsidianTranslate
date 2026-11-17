import { needsKey, protocols } from './settings.js';
import { translationMessages } from './prompts.js';

function endpoint(provider, route, query) {
  const url = new URL(provider.baseUrl);
  const base = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses|messages|models)$/, '');
  url.pathname = (base || '/v1') + route;
  for (const [key, value] of new URLSearchParams(query)) url.searchParams.set(key, value);
  return url;
}

export async function upstream(provider, route, data, query) {
  if (needsKey(provider)) throw new Error('请在服务商与模型中填写 API Key。');
  const headers = { Accept: 'application/json' };
  if (provider.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (new URL(provider.baseUrl).hostname === 'api.anthropic.com') {
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    if (provider.apiKey) headers['x-api-key'] = provider.apiKey;
  } else if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  if (data) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(endpoint(provider, route, query), {
      method: data ? 'POST' : 'GET',
      headers,
      body: data ? JSON.stringify(data) : undefined,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof json?.error?.message === 'string' ? json.error.message.slice(0, 350) : '';
      const error = new Error(`API 请求失败（HTTP ${response.status}）${detail ? ` · ${detail}` : ''}`);
      error.status = response.status;
      throw error;
    }
    if (!json) throw new Error('API 返回的内容不是 JSON，请检查 Base URL 和协议。');
    return json;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('API 响应超时，请减小文段长度或检查服务连接。');
    if (error instanceof TypeError) throw new Error('无法连接 API，请检查 Base URL、网络及浏览器对该站点的访问权限。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function textParts(parts, type) {
  if (typeof parts === 'string') return parts;
  return Array.isArray(parts) ? parts.filter(part => part.type === type).map(part => part.text).join('') : '';
}

export async function generate(provider, model, system, user, maxTokens) {
  const route = protocols[provider.protocol].route;
  const id = typeof model === 'string' ? model : model.id;
  const parameters = typeof model === 'string' ? {} : model.parameters ?? {};
  let body;
  if (provider.protocol === 'anthropic') {
    body = { model: id, system, max_tokens: maxTokens, messages: [{ role: 'user', content: user }] };
  } else if (provider.protocol === 'responses') {
    body = { model: id, instructions: system, input: user, max_output_tokens: maxTokens };
  } else {
    body = { model: id, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  }
  const result = await upstream(provider, route, { ...body, ...parameters });
  const choice = result.choices?.[0];
  if (choice?.finish_reason === 'length' || result.stop_reason === 'max_tokens' || result.status === 'incomplete') {
    throw new Error('译文超出了模型的输出上限，请调小文段长度。');
  }
  if (result.error) throw new Error('模型未能完成请求。');
  if (provider.protocol === 'anthropic') return textParts(result.content, 'text').trim();
  if (provider.protocol === 'responses') {
    return (result.output_text || (result.output || []).filter(item => item.type === 'message')
      .map(item => textParts(item.content, 'output_text')).join('')).trim();
  }
  return textParts(choice?.message?.content, 'text').trim();
}

export async function translateBatch(provider, model, settings, target, texts, context) {
  const many = texts.length > 1;
  const { system, user } = translationMessages(settings, target, texts, context);
  const length = texts.reduce((total, text) => total + text.length, 0);
  const output = await generate(provider, model, system, user, Math.min(16000, Math.max(1024, length * 2)));
  if (!many && output) return [output];
  if (!output) throw new Error('模型未返回译文，请检查模型或提示词。');
  try {
    const parsed = JSON.parse(output.replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, ''));
    if (Array.isArray(parsed) && parsed.length === texts.length &&
        parsed.every(item => typeof item === 'string' && item.trim())) return parsed.map(item => item.trim());
  } catch {
    // Some compatible models ignore the requested JSON format.
  }
  const error = new Error('模型未按顺序返回文段。');
  error.invalidBatch = true;
  throw error;
}
