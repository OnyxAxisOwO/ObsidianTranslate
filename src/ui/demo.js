import { demoBrowser } from './demo-api.js';

globalThis.browser = demoBrowser();
browser.connectArticle();
