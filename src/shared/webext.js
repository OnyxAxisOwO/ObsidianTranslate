export const ext = globalThis.browser ?? globalThis.chrome;

export async function request(type, payload = {}) {
  const result = await ext.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || '扩展暂时无法连接，请刷新页面后重试。');
  return result.value;
}

export async function requestParagraphs(payload, onResult, signal) {
  if (signal?.aborted) throw new DOMException('已还原原文。', 'AbortError');
  if (!ext.runtime.connect) {
    const results = await request('translate', payload);
    results.forEach((result, index) => onResult(index, result));
    return;
  }
  return new Promise((resolve, reject) => {
    const port = ext.runtime.connect({ name: 'translate-paragraphs' });
    const finish = error => {
      signal?.removeEventListener('abort', abort);
      port.onDisconnect.removeListener(disconnected);
      port.onMessage.removeListener(receive);
      port.disconnect();
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new DOMException('已还原原文。', 'AbortError'));
    const disconnected = () => finish(new Error(ext.runtime.lastError?.message || '翻译连接已断开，请重试。'));
    const receive = message => {
      if (message.error) finish(new Error(message.error));
      else if (message.done) finish();
      else onResult(message.index, message.result);
    };
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(disconnected);
    signal?.addEventListener('abort', abort, { once: true });
    port.postMessage({ type: 'translate', ...payload });
  });
}

export function reply(handler) {
  return (message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    Promise.resolve().then(() => handler(message, sender)).then(
      value => sendResponse({ ok: true, value }),
      error => sendResponse({ ok: false, error: error.message || '操作失败，请重试。' }),
    );
    return true;
  };
}
