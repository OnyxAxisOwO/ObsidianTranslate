import { icon } from '../shared/icons.js';

const style = `
:host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color-scheme: light dark; }
*,*::before,*::after { box-sizing: border-box; }
.root { --surface: #fff; --text: #18181b; --muted: #606068; --soft: #f2f2f4; --strong: #18181b; --on-strong: #fff; color: var(--text); }
button { border: 0; border-radius: 9px; background: none; font: inherit; font-weight: 550; color: inherit; cursor: pointer; padding: 8px 10px; transition: background .17s, transform .2s; }
button:hover { background: var(--soft); } button:active { transform: scale(.96); }
button:focus-visible { outline: 2px solid #858591; outline-offset: 2px; }
svg { width: 18px; height: 18px; vertical-align: middle; flex: none; }
.anchor, .tip { position: fixed; pointer-events: auto; }
.anchor { right: max(20px, env(safe-area-inset-right)); bottom: max(28px, env(safe-area-inset-bottom)); display: grid; justify-items: end; gap: 9px; }
.orb { width: 45px; height: 45px; border-radius: 16px; color: var(--on-strong); background: var(--strong); box-shadow: 0 4px 18px #0003; }
.orb:hover { background: var(--strong); transform: translateY(-2px); }
.orb svg { width: 22px; height: 22px; }
.panel, .tip { background: var(--surface); border-radius: 16px; box-shadow: 0 6px 35px #0002, 0 2px 7px #0001; animation: reveal .22s cubic-bezier(.2,.8,.2,1) both; }
.panel { width: min(258px, calc(100vw - 40px)); padding: 12px; }
.header { display: flex; align-items: center; justify-content: space-between; margin: 1px 0 9px 5px; font-weight: 700; }
.header button { padding: 5px; } .header svg { width: 16px; height: 16px; }
.status { color: var(--muted); font-size: 12px; margin: 0 5px 10px; max-height: 84px; overflow: auto; }
.actions { display: grid; gap: 4px; }
.actions button { display: flex; align-items: center; gap: 7px; }
.primary { background: var(--strong); color: var(--on-strong); } .primary:hover { opacity: .84; background: var(--strong); }
.tip { left: 0; top: 0; max-width: min(350px, calc(100vw - 16px)); max-height: min(48vh, 420px); padding: 5px; overflow: auto; }
.tip header { display: flex; align-items: center; justify-content: space-between; padding-left: 9px; font-weight: 650; }
.tip p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 3px 9px 8px; }
.caption { position: fixed; transform: translate(-50%, -100%); text-align: center; color: white; background: #17171be8; padding: .32em .6em; border-radius: 6px; font: 650 clamp(13px, 2vw, 23px)/1.45 -apple-system, sans-serif; white-space: pre-line; max-width: 82vw; }
[hidden] { display: none !important; }
@keyframes reveal { from { opacity: 0; transform: translateY(6px) scale(.98); } }
@media (prefers-color-scheme: dark) { .root { --surface: #222225; --text: #fafafa; --muted: #b0b0b8; --soft: #343437; --strong: #fff; --on-strong: #171719; } }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation: none !important; transition: none !important; } }
`;

export function overlay(action) {
  const host = document.createElement('div');
  host.dataset.obsidianInterface = '';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>${style}</style><div class="root"><div class="anchor" hidden>
    <div class="panel" hidden><div class="header">Obsidian Translate
      <button type="button" data-action="options" aria-label="打开设置">${icon('settings')}</button></div>
      <p class="status" aria-live="polite"></p>
      <div class="actions">
        <button type="button" class="primary" data-action="toggle">${icon('translate')}<span></span></button>
        <button type="button" data-action="original" hidden>${icon('back')}显示原文</button>
        <button type="button" data-action="whole">${icon('layers')}翻译整页</button>
        <button type="button" data-action="view">${icon('sliders')}<span></span></button>
      </div>
    </div>
    <button type="button" class="orb" data-action="panel" aria-label="网页翻译菜单" aria-expanded="false">${icon('translate')}</button>
  </div><div class="tip" hidden></div><div class="caption" hidden></div></div>`;
  document.documentElement.append(host);
  const find = selector => shadow.querySelector(selector);
  const anchor = find('.anchor');
  const panel = find('.panel');
  const orb = find('.orb');
  const tip = find('.tip');
  const caption = find('.caption');

  shadow.addEventListener('click', event => {
    const command = event.target.closest('button')?.dataset.action;
    if (!command) return;
    if (command === 'panel') {
      panel.hidden = !panel.hidden;
      orb.setAttribute('aria-expanded', String(!panel.hidden));
    } else if (command === 'close-tip') {
      tip.hidden = true;
    } else {
      action(command);
    }
  });
  tip.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) event.preventDefault();
  });

  return {
    showStatus(state) {
      anchor.hidden = !state.floating;
      find('.status').textContent = state.note;
      const retry = state.running && state.paused;
      find('[data-action="toggle"] span').textContent = retry ? '重试翻译' : state.running ? '显示原文' : '翻译网页';
      find('[data-action="original"]').hidden = !retry;
      find('[data-action="view"] span').textContent = state.view === 'bilingual' ? '切换为仅译文' : '切换为双语对照';
    },
    closePanel() {
      panel.hidden = true;
      orb.setAttribute('aria-expanded', 'false');
    },
    selection(rect, text) {
      tip.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - (text == null ? 115 : 358)))}px`;
      tip.style.top = `${Math.max(8, Math.min(rect.bottom + 9, innerHeight - (text == null ? 54 : 160)))}px`;
      if (text == null) {
        tip.innerHTML = `<button type="button" data-action="selection">${icon('translate')} 翻译所选</button>`;
      } else {
        tip.innerHTML = `<header>选中文字<button type="button" data-action="close-tip" aria-label="关闭">${icon('close')}</button></header><p role="status"></p>`;
        tip.querySelector('p').textContent = text;
      }
      tip.hidden = false;
    },
    hint(text) {
      this.selection({ left: innerWidth / 2 - 110, bottom: 40 }, text);
    },
    hideSelection() { tip.hidden = true; },
    caption(rect, text, fullscreen) {
      const parent = fullscreen && fullscreen.tagName !== 'VIDEO' ? fullscreen : document.documentElement;
      if (host.parentNode !== parent) parent.append(host);
      caption.hidden = !text;
      if (!text) return;
      caption.textContent = text;
      caption.style.left = `${rect.left + rect.width / 2}px`;
      caption.style.top = `${rect.bottom - Math.min(85, rect.height * .22)}px`;
      caption.style.maxWidth = Math.max(120, rect.width * .9) + 'px';
    },
  };
}
