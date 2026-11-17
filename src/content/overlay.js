import { icon } from '../shared/icons.js';
import panelStyle from '../shared/panel.css';
import { mountPanel } from '../shared/panel.js';

const style = `
:host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color-scheme: light dark; }
*,*::before,*::after { box-sizing: border-box; }
.root { --surface: #fff; --text: #18181b; --muted: #606068; --soft: #f2f2f4; --strong: #18181b; --on-strong: #fff; color: var(--text); }
button { border: 0; border-radius: 9px; background: none; font: inherit; font-weight: 550; color: inherit; cursor: pointer; padding: 8px 10px; transition: background .17s, transform .2s; }
button:hover { background: var(--soft); } button:active { transform: scale(.96); }
button:focus-visible { outline: 2px solid #858591; outline-offset: 2px; }
svg { width: 18px; height: 18px; vertical-align: middle; flex: none; }
.anchor, .tip { position: fixed; pointer-events: auto; }
.anchor { right: 0; top: 55%; transform: translateY(-50%); width: 52px; padding: 13px 0 13px 13px; }
.anchor[data-side="left"] { left: 0; right: auto; padding: 13px 13px 13px 0; }
.dock { display: grid; justify-items: center; gap: 5px; opacity: var(--idle-opacity, .35); transform: translateX(8px); transition: opacity .2s, transform .24s cubic-bezier(.2,.75,.2,1); }
.anchor[data-side="left"] .dock { transform: translateX(-8px); }
.anchor:is(:hover, :has(:focus-visible), [data-open]) .dock { opacity: 1; transform: none; }
.orb { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border-radius: 50%; color: var(--on-strong); background: var(--strong); box-shadow: 0 2px 9px #0002; }
.orb:hover { background: var(--strong); }
.orb svg { width: 18px; height: 18px; }
.dock-settings { display: grid; place-items: center; padding: 0; width: 23px; height: 23px; border-radius: 50%; background: var(--surface); box-shadow: 0 2px 8px #0002; opacity: 0; visibility: hidden; transition: opacity .18s, visibility .18s; }
.dock-settings svg { width: 13px; height: 13px; }
.anchor:is(:hover, :has(:focus-visible), [data-open]) .dock-settings { opacity: 1; visibility: visible; }
.ot-floating { position: fixed; right: 48px; z-index: 1; max-width: calc(100vw - 60px); max-height: calc(100dvh - 16px); pointer-events: auto; }
.ot-floating .ot-main, .ot-floating .ot-details { max-width: calc(100vw - 64px); }
.ot-floating .ot-main { max-height: calc(100dvh - 16px); overflow: auto; }
@media (hover: none) {
  .dock { opacity: .85; transform: none !important; }
  .dock-settings { opacity: 1; visibility: visible; }
}
.tip { background: var(--surface); border-radius: 16px; box-shadow: 0 6px 35px #0002, 0 2px 7px #0001; animation: reveal .22s cubic-bezier(.2,.8,.2,1) both; }
.ot-floating { animation: reveal .22s cubic-bezier(.2,.8,.2,1) both; }
.ot-floating[data-side="right"] .ot-details { order: -1; }
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
  shadow.innerHTML = `<style>${style}
${panelStyle}</style><div class="root"><div class="anchor" data-side="right" hidden>
    <div class="dock">
      <button type="button" class="orb" data-action="toggle" aria-label="翻译网页" title="翻译网页">${icon('translate')}</button>
      <button type="button" class="dock-settings" data-action="panel" aria-label="打开翻译菜单" title="打开翻译菜单" aria-expanded="false">${icon('settings')}</button>
    </div>
  </div><div class="ot-floating" data-side="right" hidden></div><div class="tip" hidden></div><div class="caption" hidden></div></div>`;
  document.documentElement.append(host);
  const find = selector => shadow.querySelector(selector);
  const anchor = find('.anchor');
  const panel = find('.ot-floating');
  const controls = mountPanel(panel, action);
  const orb = find('.orb');
  const settingsButton = find('.dock-settings');

  function placePanel() {
    if (panel.hidden) return;
    const side = anchor.dataset.side;
    panel.dataset.side = side;
    panel.style.right = side === 'right' ? '48px' : 'auto';
    panel.style.left = side === 'left' ? '48px' : 'auto';
    const top = Math.max(8, Math.min(anchor.getBoundingClientRect().top, innerHeight - panel.offsetHeight - 8));
    panel.style.top = top + 'px';
  }

  function closePanel() {
    panel.hidden = true;
    anchor.removeAttribute('data-open');
    settingsButton.setAttribute('aria-expanded', 'false');
  }

  new ResizeObserver(placePanel).observe(panel);
  window.addEventListener('resize', placePanel, { passive: true });
  document.addEventListener('pointerdown', event => {
    if (!event.composedPath().includes(host)) closePanel();
  }, { passive: true });
  const tip = find('.tip');
  const caption = find('.caption');

  shadow.addEventListener('click', event => {
    const command = event.target.closest('button')?.dataset.action;
    if (!command) return;
    if (command === 'panel') {
      panel.hidden = !panel.hidden;
      anchor.toggleAttribute('data-open', !panel.hidden);
      settingsButton.setAttribute('aria-expanded', String(!panel.hidden));
      placePanel();
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
    showStatus(settings, state) {
      anchor.hidden = !state.floating;
      anchor.dataset.side = settings.floatingSide;
      anchor.style.top = settings.floatingPosition + '%';
      anchor.style.setProperty('--idle-opacity', settings.floatingOpacity);
      const label = state.paused ? '重试翻译' : state.canRestore ? '还原网页' : '翻译网页';
      orb.setAttribute('aria-label', label);
      orb.title = label;
      if (!state.floating) closePanel();
      controls.update(settings, state);
      placePanel();
    },
    closePanel,
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
