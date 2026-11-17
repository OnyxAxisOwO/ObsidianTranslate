import { languages } from '../shared/settings.js';
import { icon } from '../shared/icons.js';

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = value => String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
export const option = (value, label, selected) =>
  `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`;
export const languageOptions = selected =>
  Object.entries(languages).map(([id, [label]]) => option(id, label, selected)).join('');
export const iconButton = (action, label, name, index = '') =>
  `<button type="button" class="icon-button" data-action="${action}" data-index="${index}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
