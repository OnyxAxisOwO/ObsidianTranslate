import { demoBrowser, demoRequest } from './demo-api.js';
import { ext, request } from '../shared/webext.js';

export const api = DEMO ? demoRequest : request;
export const tabs = DEMO ? demoBrowser().tabs : ext.tabs;
