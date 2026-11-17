import { demoBrowser } from './demo-api.js';

globalThis.browser = demoBrowser();
browser.connectArticle();

const popup = document.querySelector('.demo-aside iframe');
window.addEventListener('message', event => {
  if (event.origin === location.origin && event.source === popup?.contentWindow &&
      event.data?.type === 'obsidian-preview-size' && Number.isFinite(event.data.height)) {
    popup.style.height = Math.min(600, Math.max(155, event.data.height)) + 'px';
  }
});
