export const ext = globalThis.browser ?? globalThis.chrome;

export async function request(type, payload = {}) {
  const result = await ext.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || '扩展暂时无法连接，请刷新页面后重试。');
  return result.value;
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
