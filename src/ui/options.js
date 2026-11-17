import { activeModel, languages, loadingStyles, loadingTextLimit, modelKey, needsKey, promptDefaults, protocols } from '../shared/settings.js';
import { icon } from '../shared/icons.js';
import { api } from './api.js';
import { escape, iconButton, languageOptions, option } from './helpers.js';
import { parseFile } from './files.js';

const container = document.querySelector('#settings');
const navigation = document.querySelector('#navigation');
const editor = document.querySelector('#editor');
const toast = document.querySelector('#toast');
const sections = {
  reading: ['网页翻译', 'globe'],
  text: ['文本翻译', 'translate'],
  files: ['文件翻译', 'file'],
  advanced: ['高级设置', 'settings'],
};
const advancedSections = {
  models: ['服务商与模型', 'stack', '设置 OpenAI 等翻译服务及其模型。'],
  prompts: ['AI 提示词', 'sliders', '调整系统指令、用户输入、字幕和术语。'],
  rules: ['网站与语言', 'globe', '选择总是翻译的网站和语言。'],
  cache: ['本地缓存', 'disk', '查看或清除已存的译文。'],
};

let settings;
let selected;
let section;
let toastTimer;
let fileRun;
let download;

if (DEMO) document.querySelector('#demo-link').hidden = false;
for (const link of document.querySelectorAll('.external-link')) link.insertAdjacentHTML('beforeend', icon('external'));

function notify(text) {
  clearTimeout(toastTimer);
  toast.textContent = text;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

function heading(title, description, action = '') {
  return `<div class="screen-head"><div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}

function button(action, text, glyph, variant = '') {
  return `<button type="button" class="button ${variant}" data-action="${action}">${glyph ? icon(glyph) : ''}${text}</button>`;
}

function mark(provider) {
  return `<span class="provider-letter ${provider.protocol}" aria-hidden="true">${escape([...provider.name][0]?.toUpperCase())}</span>`;
}

function renderModels() {
  const provider = settings.providers.find(item => item.id === selected) || settings.providers[0];
  selected = provider?.id;
  const head = heading('服务商与模型', '在服务商中配置连接，同一服务商下的模型共用地址和密钥。',
    button('new-provider', '添加服务商', 'plus', 'primary'));
  if (!provider) return head + `<div class="empty">${icon('stack')}<h2>添加你的第一个服务商</h2>
    <p>可接入 OpenAI 兼容、OpenAI Responses 或 Anthropic Messages 接口。</p>
    ${button('new-provider', '配置 API', 'arrow')}</div>`;
  return head + `<div class="provider-workspace">
    <div class="provider-list">
      <div class="provider-list-label">服务商</div>
      ${settings.providers.map((item, index) => `<button type="button" class="provider-item" data-action="provider" data-index="${index}" aria-pressed="${item.id === selected}">
        ${mark(item)}<span class="provider-copy"><strong>${escape(item.name)}</strong><small>${item.models.length} 个模型</small></span>${icon('right')}</button>`).join('')}
    </div>
    <div class="provider-detail">
      <div class="detail-head"><div class="detail-title">${mark(provider)}<div><h2 class="shorten">${escape(provider.name)}</h2>
        <p>${protocols[provider.protocol].name}</p></div></div>${button('edit-provider', needsKey(provider) ? '填写 API Key' : '编辑连接', 'sliders')}</div>
      <dl class="connection">
        <div><dt>Base URL</dt><dd class="mono" title="${escape(provider.baseUrl)}">${escape(provider.baseUrl)}</dd></div>
        <div><dt>请求速率</dt><dd>${provider.rps} 次 / 秒</dd></div>
        <div><dt>API 密钥</dt><dd>${provider.apiKey ? '已保存' : '未填写'}</dd></div>
      </dl>
      <div class="group-head"><h3>翻译模型</h3><div class="actions">${button('discover', '从 API 导入', 'search', 'ghost')}${button('new-model', '添加模型', 'plus')}</div></div>
      <div class="model-list">${provider.models.map((model, index) => `<div class="model-row">
        <span class="model-mark">${icon('cube')}</span><div class="model-copy"><strong class="shorten">${escape(model.name)}</strong>
        <small class="mono shorten" title="${escape(model.id)}">${escape(model.id)}</small></div>
        ${settings.activeModel === modelKey(provider, model)
          ? `<span class="current-model">${icon('check')} 默认</span>`
          : `<button type="button" class="button ghost" data-action="default-model" data-index="${index}">设为默认</button>`}
        ${iconButton('test', '试译', 'play', index)}
        ${iconButton('edit-model', '编辑模型', 'sliders', index)}
      </div>`).join('') || '<p class="empty">从 API 导入模型，或手动填写模型 ID。</p>'}</div>
    </div>
  </div>`;
}

function row(title, description, control) {
  return `<div class="preference-row"><div><h3>${title}</h3>${description ? `<p>${description}</p>` : ''}</div>${control}</div>`;
}
function toggle(key, title, description) {
  return row(title, description,
    `<input type="checkbox" role="switch" class="switch" data-pref="${key}" aria-label="${title}"${settings[key] ? ' checked' : ''}>`);
}
function select(key, title, description, choices) {
  return row(title, description, `<select data-pref="${key}" aria-label="${title}">${choices}</select>`);
}

function group(title, contents) {
  return `<section class="preference-group">${title ? `<h2>${title}</h2>` : ''}<div class="settings-group">${contents}</div></section>`;
}

function showOptions(key, ...items) {
  return items.map(([value, label]) => option(value, label, settings[key])).join('');
}

function renderReading() {
  return heading('网页翻译', '选择打开网页时的翻译方式。') + `<div class="preferences">
    ${group('阅读', `
      ${select('target', '目标语言', '', languageOptions(settings.target))}
      ${select('source', '源语言', '', option('auto', '自动识别', settings.source) + languageOptions(settings.source))}
      ${select('view', '显示方式', '', showOptions('view', ['translation', '仅译文'], ['bilingual', '双语对照']))}
      ${select('order', '双语顺序', '', showOptions('order', ['original-first', '原文在前'], ['translation-first', '译文在前']))}
      ${select('style', '双语译文样式', '', showOptions('style', ['plain', '与正文相同'], ['soft', '淡化'], ['accent', '淡色底纹']))}
      ${select('loadingStyle', '翻译中提示', '显示在等待译文的段落后面。', showOptions('loadingStyle', ...Object.entries(loadingStyles)))}
      <div id="loading-text-row" ${settings.loadingStyle === 'text' ? '' : 'hidden'}>
        ${row('提示文字', '', `<input type="text" data-pref="loadingText" aria-label="提示文字" maxlength="${loadingTextLimit}" value="${escape(settings.loadingText)}">`)}
      </div>
      ${select('scope', '翻译范围', '正文优先翻译文章和页面主区。', showOptions('scope', ['reading', '正文'], ['whole', '整页']))}
    `)}
    ${group('网页工具', `
      ${toggle('floating', '网页悬浮窗', '在网页右下角打开翻译菜单。')}
      ${toggle('selection', '划词翻译', '选中文字后显示翻译按钮。')}
      ${toggle('hover', '悬停翻译', '鼠标指向文段时按 Shift 翻译。')}
      ${toggle('captions', '双语字幕', '在 YouTube 和兼容播放器打开原字幕后显示译文。')}
    `)}
    ${group('输入框', `
      ${select('inputTarget', '输入框目标语言', '在输入框中按 Option / Alt + Shift + I 翻译。', languageOptions(settings.inputTarget))}
      ${toggle('inputSpaces', '连按三次空格翻译', '也可以输入 /ja 或 /en 指定目标语言，或用 // 标记只翻译其后的文字。')}
    `)}
  </div>`;
}

function promptField(key, title, description, size = 3, limit = 6000) {
  return `<label class="prompt-field"><strong>${title}</strong><small>${description}</small>
    <textarea name="${key}" rows="${size}" maxlength="${limit}">${escape(settings[key])}</textarea></label>`;
}

function renderPrompts() {
  return heading('AI 提示词', '设定模型收到的指令，以及单段、多段和字幕各自的输入格式。') + `<form class="preferences" data-form="prompts">
    ${group('翻译指令', `
      ${promptField('systemPrompt', '系统提示词', '定义模型的角色，在所有翻译请求中使用。')}
      ${promptField('translationPrompt', '翻译提示词', '补充语气、用词和翻译要求，随系统提示词一起发送。')}
      ${promptField('userPrompt', '用户提示词', '单段翻译时发送给模型的内容。使用 {{text}} 插入原文。')}
    `)}
    ${group('批量翻译与字幕', `
      ${promptField('batchSystemPrompt', '多段落系统提示词', '一次请求包含多个文段时补充给模型的指令。', 2)}
      ${promptField('batchUserPrompt', '多段落用户提示词', '使用 {{text}} 插入原文数组。', 2)}
      ${promptField('subtitlePrompt', '字幕提示词', '视频和字幕文件翻译使用这段用户提示词。', 3)}
    `)}
    ${group('术语', promptField('glossary', '术语对照', '每行填写一组，写成「原词 → 译法」。', 3, 4000))}
    ${group('每次请求', `
      ${row('最多文段数', '控制一次发送多少段。', `<input aria-label="最多文段数" name="batchSize" type="number" min="1" max="20" required value="${settings.batchSize}">`)}
      ${row('最多字符数', '超长文段会按句子或空格拆分。', `<input aria-label="最多字符数" name="maxLength" type="number" min="300" max="12000" required value="${settings.maxLength}">`)}
    `)}
    <p class="help">可用变量包括 <code>{{from}}</code>、<code>{{to}}</code>、<code>{{title}}</code> 和 <code>{{content_type}}</code>。用户提示词中的 <code>{{text}}</code> 会替换为待翻译内容。</p>
    <div class="actions end">${button('reset-prompt', '恢复默认', '', 'ghost')}<button class="button primary">保存提示词</button></div>
  </form>`;
}

function renderRules() {
  const sites = Object.entries(settings.sites);
  const languagesWithRules = Object.entries(settings.languageRules);
  return heading('网站与语言', '设定哪些网站或语言会自动翻译。网站规则优先。') + `<div class="preferences">
    ${group('网站', `
      ${sites.map(([host, rule], index) => row(escape(host), rule === 'always' ? '总是翻译' : '停用翻译',
        iconButton('delete-site', '移除网站规则', 'trash', index))).join('')}
      ${row('网站规则', sites.length ? '' : '你也可以在网页悬浮窗中设置当前网站。', button('new-site', '添加网站', 'plus'))}
    `)}
    ${group('语言', `
      ${languagesWithRules.map(([language, rule], index) => row(languages[language][0],
        rule === 'always' ? '总是自动翻译' : '仅手动翻译', iconButton('delete-language', '移除语言规则', 'trash', index))).join('')}
      ${row('语言规则', '根据网页源语言决定是否自动翻译。', button('new-language', '添加语言', 'plus'))}
    `)}
  </div>`;
}

function renderCache() {
  return heading('本地缓存', '再次遇到相同的内容时，可以直接使用以前的译文。') +
    `<div class="preferences">${group('已保存的译文', `
      ${toggle('cache', '复用译文', '译文保存在这台设备的浏览器中。')}
      ${row('缓存内容', '<span id="cache-count">正在读取…</span>', button('clear-cache', '清除缓存', 'trash', 'danger'))}
    `)}</div>`;
}

function activeLabel() {
  const selection = activeModel(settings);
  return selection && !needsKey(selection.provider)
    ? `<strong class="row-value">${escape(selection.model.name)}</strong>`
    : '<a class="button" href="#advanced/models">设置翻译模型</a>';
}

function renderFiles() {
  const selection = activeModel(settings);
  return heading('文件翻译', '添加文件，下载译文或双语版本。') +
    `<form class="preferences" data-form="file">
      <label class="file-picker"><input name="file" type="file" aria-label="选择文件" accept=".txt,.md,.srt,.vtt" required>
        <span class="file-icon">${icon('file')}</span><strong id="file-name">选择或拖入文件</strong>
        <small>TXT、Markdown、SRT 和 WebVTT · 最大 1 MB</small>
      </label>
      ${group('翻译选项', `
        ${row('翻译模型', '', activeLabel())}
        ${select('fileTarget', '目标语言', '', languageOptions(settings.target))}
        ${row('输出内容', '', `<select aria-label="输出内容" name="output">${showOptions('view', ['translation', '仅译文'], ['bilingual', '双语对照'])}</select>`)}
      `)}
      <div class="actions end"><button type="button" class="button ghost" data-action="stop-file" hidden>停止</button>
        <button class="button primary" ${selection && !needsKey(selection.provider) ? '' : 'disabled'}>${icon('translate')} 翻译文件</button></div>
      <div class="file-result"><p class="form-status" role="status"></p><a class="button" id="download" hidden>下载译文</a></div>
    </form>`;
}

function renderText() {
  return heading('文本翻译', '粘贴一段文字，翻译后直接复制。') + `<form class="preferences text-workspace" data-form="text">
    <div class="text-panes">
      <label><span>原文</span><textarea name="text" rows="8" maxlength="30000" required placeholder="在此输入或粘贴"></textarea></label>
      <label><span>译文</span><textarea name="result" rows="8" readonly placeholder="译文会显示在这里"></textarea></label>
    </div>
    ${group('', `
      ${row('翻译模型', '', activeLabel())}
      ${row('源语言', '', `<select name="source" aria-label="源语言">${option('auto', '自动识别', settings.source) + languageOptions(settings.source)}</select>`)}
      ${row('目标语言', '', `<select name="target" aria-label="目标语言">${languageOptions(settings.target)}</select>`)}
    `)}
    <div class="actions end">${button('copy-text', '复制译文', 'copy', 'ghost')}<button class="button primary">${icon('translate')} 翻译</button></div>
    <p class="form-status" role="status"></p>
  </form>`;
}

function renderAdvanced() {
  return heading('高级设置', '管理翻译服务、AI 提示词、规则和本地数据。') + `<div class="preferences">
    ${group('', Object.entries(advancedSections).map(([id, [name, glyph, description]]) =>
      `<a class="settings-link" href="#advanced/${id}"><span class="settings-link-icon">${icon(glyph)}</span>
        <span><strong>${name}</strong><small>${description}</small></span>${icon('right')}</a>`).join(''))}</div>`;
}

const screens = { reading: renderReading, text: renderText, files: renderFiles, advanced: renderAdvanced,
  models: renderModels, prompts: renderPrompts, rules: renderRules, cache: renderCache };

function draw() {
  const next = location.hash.slice(1).replace(/^advanced\//, '');
  section = Object.hasOwn(screens, next) ? next : 'reading';
  const advanced = Object.hasOwn(advancedSections, section);
  navigation.innerHTML = Object.entries(sections).map(([id, [name, glyph]]) =>
    `<a class="nav-item" href="#${id}"${id === section ? ' aria-current="page"' : ''}>${icon(glyph)}${name}</a>
    ${id === 'advanced' && advanced ? `<div class="subnav">${Object.entries(advancedSections).map(([key, [label]]) =>
      `<a class="nav-item" href="#advanced/${key}"${key === section ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div>` : ''}`).join('');
  container.innerHTML = `<div class="screen">${advanced ? `<a class="settings-back" href="#advanced">${icon('back')} 高级设置</a>` : ''}
    ${screens[section]()}</div>`;
  container.setAttribute('aria-busy', 'false');
  if (section === 'cache') countCache();
  if (section === 'files') wireFilePicker();
}

async function countCache() {
  const count = document.querySelector('#cache-count');
  if (!count) return;
  try {
    count.textContent = `${await api('cache-count')} 段`;
  } catch (error) {
    count.textContent = error.message;
  }
}

function modal(title, html) {
  editor.innerHTML = `<div class="dialog-head"><h2>${title}</h2>${iconButton('close', '关闭', 'close')}</div>${html}`;
  if (!editor.open) editor.showModal();
}

function providerForm(provider) {
  const item = provider || { name: '', protocol: 'openai', baseUrl: protocols.openai.url, rps: 2, models: [] };
  modal(provider ? '编辑服务商' : '添加服务商', `<form data-form="provider" class="editor-fields">
    <label>名称<input name="name" required maxlength="80" value="${escape(item.name)}" placeholder="例如 OpenAI 或本地模型" autofocus></label>
    <label>API 格式<select name="protocol">${Object.entries(protocols).map(([key, value]) => option(key, value.name, item.protocol)).join('')}</select></label>
    <label>Base URL<input name="baseUrl" type="url" required maxlength="2000" value="${escape(item.baseUrl)}"></label>
    <label>API Key<input name="apiKey" type="password" maxlength="4000" autocomplete="off" value="${DEMO ? '' : escape(item.apiKey)}" placeholder="无鉴权的本地服务可留空"></label>
    <label>每秒最大请求数<input name="rps" type="number" required min="0" step="any" value="${item.rps}"></label>
    <div class="dialog-actions">${provider ? button('delete-provider', '删除服务商', 'trash', 'danger ghost') : ''}
      ${button('close', '取消', '', 'ghost')}<button class="button primary">保存</button></div>
    <p class="form-status" role="status"></p></form>`);
  const form = editor.querySelector('form');
  form.dataset.id = provider?.id || '';
  form.elements.protocol.addEventListener('change', () => {
    if (Object.values(protocols).some(value => form.elements.baseUrl.value === value.url)) {
      form.elements.baseUrl.value = protocols[form.elements.protocol.value].url;
    }
  });
}

function modelForm(index) {
  const provider = settings.providers.find(item => item.id === selected);
  const existing = provider.models[index];
  modal(existing ? '编辑模型' : '添加模型', `<form data-form="model" data-index="${existing ? index : ''}" class="editor-fields">
    <label>模型 ID<input name="id" required maxlength="200" value="${escape(existing?.id)}" placeholder="填写服务商提供的模型 ID" autofocus></label>
    <label>展示名称<input name="name" maxlength="100" value="${escape(existing?.name)}" placeholder="留空则显示模型 ID"></label>
    <div class="dialog-actions">${existing ? button('delete-model', '删除模型', 'trash', 'danger ghost') : ''}
      ${button('close', '取消', '', 'ghost')}<button class="button primary">保存</button></div>
    <p class="form-status" role="status"></p></form>`);
}

function siteForm(language = false) {
  modal(language ? '添加语言规则' : '添加网站规则', `<form data-form="${language ? 'language' : 'site'}" class="editor-fields">
    ${language
      ? `<label>源语言<select name="language">${languageOptions('en')}</select></label>`
      : '<label>域名或完整网址<input name="host" placeholder="example.com" required autofocus></label>'}
    <label>翻译规则<select name="rule"><option value="always">总是翻译</option>
      <option value="never">${language ? '仅手动翻译' : '停用翻译'}</option></select></label>
    <div class="dialog-actions">${button('close', '取消', '', 'ghost')}<button class="button primary">保存</button></div>
    <p class="form-status" role="status"></p></form>`);
}

function wireFilePicker() {
  const picker = container.querySelector('.file-picker');
  const input = picker.querySelector('input');
  const name = picker.querySelector('#file-name');
  input.addEventListener('change', () => { name.textContent = input.files[0]?.name || '选择或拖入文件'; });
  picker.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    picker.classList.add('dragover');
  });
  picker.addEventListener('dragleave', () => picker.classList.remove('dragover'));
  picker.addEventListener('drop', event => {
    event.preventDefault();
    picker.classList.remove('dragover');
    if (!event.dataTransfer.files.length) return;
    if (event.dataTransfer.files.length !== 1) {
      notify('请一次选择一个文件。');
      return;
    }
    input.files = event.dataTransfer.files;
    input.dispatchEvent(new Event('change'));
  });
}

function formStatus(form, text, error = false) {
  const element = form.querySelector('.form-status');
  element.textContent = text;
  element.dataset.error = String(error);
}

async function importModels(provider) {
  modal('从 API 导入模型', '<p class="form-status" role="status">正在读取模型列表…</p>');
  const marker = editor.querySelector('.form-status');
  try {
    const items = await api('discover', { provider });
    if (!editor.open || editor.querySelector('.form-status') !== marker) return;
    const existing = new Set(provider.models.map(model => model.id));
    const available = items.filter(model => !existing.has(model.id));
    if (!available.length) {
      marker.textContent = '服务商没有返回新的模型，可手动添加模型 ID。';
      return;
    }
    modal('从 API 导入模型', `<form data-form="import">
      <input type="search" id="model-filter" placeholder="搜索模型" aria-label="搜索模型">
      <div class="choices">${available.map((item, i) => `<label><input type="checkbox" name="model" value="${i}">${escape(item.id)}</label>`).join('')}</div>
      <div class="dialog-actions">${button('close', '取消', '', 'ghost')}<button class="button primary">添加所选</button></div>
      <p class="form-status" role="status"></p></form>`);
    editor.querySelector('form').models = available;
    editor.querySelector('#model-filter').addEventListener('input', event => {
      const query = event.target.value.trim().toLowerCase();
      for (const label of editor.querySelectorAll('.choices label')) label.hidden = !label.textContent.toLowerCase().includes(query);
    });
  } catch (error) {
    if (marker.isConnected) {
      marker.dataset.error = 'true';
      marker.textContent = error.message;
    }
  }
}

async function saveProvider(provider, replaceActive) {
  settings = await api('provider-save', { provider, replaceActive });
  selected = settings.providers.find(item => item.id === provider.id)?.id || settings.providers.at(-1)?.id;
  editor.close();
  draw();
}

async function action(name, index, control) {
  const provider = settings.providers.find(item => item.id === selected);
  switch (name) {
    case 'close': return editor.close();
    case 'new-provider': return providerForm();
    case 'edit-provider': return providerForm(provider);
    case 'provider': selected = settings.providers[index].id; return draw();
    case 'new-model': return modelForm();
    case 'edit-model': return modelForm(index);
    case 'discover': return importModels(provider);
    case 'new-site': return siteForm();
    case 'new-language': return siteForm(true);
    case 'delete-language':
      settings = await api('language-rule', { language: Object.keys(settings.languageRules)[index] });
      return draw();
    case 'delete-site':
      settings = await api('site-rule', { host: Object.keys(settings.sites)[index] });
      return draw();
    case 'default-model':
      settings = await api('preferences', { patch: { activeModel: modelKey(provider, provider.models[index]) } });
      return draw();
    case 'test':
      control.disabled = true;
      notify('正在试译 “Good morning.”');
      try {
        notify(`试译成功 · ${await api('test', { provider, model: provider.models[index].id })}`);
      } finally {
        control.disabled = false;
      }
      return;
    case 'delete-provider':
      if (!confirm(`删除 ${provider.name} 及其所有模型？`)) return;
      settings = await api('provider-delete', { id: provider.id });
      editor.close();
      return draw();
    case 'delete-model': {
      const i = Number(editor.querySelector('form').dataset.index);
      const models = provider.models.filter((_, index) => index !== i);
      return saveProvider({ ...provider, models });
    }
    case 'reset-prompt':
      for (const [key, value] of Object.entries(promptDefaults)) container.querySelector(`[name="${key}"]`).value = value;
      return;
    case 'copy-text': {
      const value = container.querySelector('[name="result"]')?.value;
      if (!value) return;
      await navigator.clipboard.writeText(value);
      return notify('已复制译文');
    }
    case 'clear-cache':
      await api('cache-clear');
      await countCache();
      return notify('翻译缓存已清除');
    case 'stop-file': fileRun?.abort(); return;
  }
}

document.addEventListener('click', event => {
  const control = event.target.closest('button[data-action]');
  if (control) action(control.dataset.action, Number(control.dataset.index), control).catch(error => notify(error.message));
});
document.addEventListener('change', async event => {
  const field = event.target;
  if (!field.dataset.pref || field.dataset.pref === 'fileTarget') return;
  try {
    settings = await api('preferences', { patch: { [field.dataset.pref]: field.type === 'checkbox' ? field.checked : field.value } });
    if (field.dataset.pref === 'loadingStyle') {
      container.querySelector('#loading-text-row')?.toggleAttribute('hidden', settings.loadingStyle !== 'text');
    }
    if (field.dataset.pref === 'loadingText') field.value = settings.loadingText;
  } catch (error) {
    notify(error.message);
    draw();
  }
});

async function translateFile(form, file, bilingual) {
  if (!file?.size || file.size > 1000000) throw new Error('请选择不超过 1 MB 的 UTF-8 文件。');
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (!['txt', 'md', 'srt', 'vtt'].includes(extension)) throw new Error('请选择 TXT、Markdown、SRT 或 WebVTT 文件。');
  const text = new TextDecoder('utf8', { fatal: true }).decode(await file.arrayBuffer());
  const { parts, format } = parseFile(text, extension);
  if (!parts.length) throw new Error('没有找到可翻译的文段。');
  const target = form.querySelector('[data-pref="fileTarget"]').value;
  const stop = form.querySelector('[data-action="stop-file"]');
  const link = form.querySelector('#download');
  link.hidden = true;
  if (download) URL.revokeObjectURL(download);
  const controller = new AbortController();
  fileRun = controller;
  stop.hidden = false;
  const outputs = [];
  try {
    for (let offset = 0; offset < parts.length;) {
      if (controller.signal.aborted) return formStatus(form, '已停止。');
      formStatus(form, `正在翻译 · ${offset} / ${parts.length} 段`);
      const texts = [];
      let size = 0;
      while (offset < parts.length && texts.length < settings.batchSize) {
        const original = parts[offset].original.trim();
        if (original.length > 100000) throw new Error('文件包含超长段落，请用空行拆开后重试。');
        if (texts.length && size + original.length > settings.maxLength) break;
        texts.push(original);
        size += original.length;
        offset++;
      }
      const context = ['srt', 'vtt'].includes(extension) ? { kind: 'subtitle' } : {};
      const results = await api('translate', { texts, target, context });
      for (const result of results) {
        if (result.error) throw new Error(result.error);
        outputs.push(result.text);
      }
    }
    if (controller.signal.aborted) return formStatus(form, '已停止。');
    download = URL.createObjectURL(new Blob([format(outputs, bilingual)], { type: 'text/plain;charset=utf-8' }));
    link.href = download;
    link.download = file.name.replace(/\.[^.]+$/, `.${target}.${extension}`);
    link.hidden = false;
    formStatus(form, `翻译完成 · ${parts.length} 段`);
  } finally {
    if (fileRun === controller) fileRun = null;
    stop.hidden = true;
  }
}

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const submit = event.submitter || form.querySelector('button:not([type])');
  if (submit?.disabled) return;
  if (submit) submit.disabled = true;
  try {
    const data = new FormData(form);
    const type = form.dataset.form;
    if (type === 'provider') {
      if (!(form.elements.rps.valueAsNumber > 0)) throw new Error('每秒最大请求数必须大于 0。');
      const prior = settings.providers.find(item => item.id === form.dataset.id);
      await saveProvider({ ...prior, ...Object.fromEntries(data) });
    } else if (type === 'model' || type === 'import') {
      const provider = settings.providers.find(item => item.id === selected);
      const models = [...provider.models];
      let replaceActive;
      if (type === 'import') {
        const added = data.getAll('model').map(index => form.models[index]);
        if (!added.length) throw new Error('请选择要添加的模型。');
        models.push(...added);
      } else {
        const index = form.dataset.index;
        const id = data.get('id').trim();
        if (!id) throw new Error('请输入模型 ID。');
        if (models.some((model, i) => model.id === id && String(i) !== index)) throw new Error('这个模型 ID 已经存在。');
        const model = { id, name: data.get('name').trim() || id };
        if (index !== '') {
          replaceActive = { from: modelKey(provider, models[index]), to: modelKey(provider, model) };
          models[index] = model;
        } else models.push(model);
      }
      await saveProvider({ ...provider, models }, replaceActive);
    } else if (type === 'site') {
      const address = data.get('host').trim();
      const url = new URL(address.includes('://') ? address : 'https://' + address);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) throw new Error('请输入有效的网页域名。');
      settings = await api('site-rule', { host: url.hostname, rule: data.get('rule') });
      editor.close();
      draw();
    } else if (type === 'language') {
      settings = await api('language-rule', { language: data.get('language'), rule: data.get('rule') });
      editor.close();
      draw();
    } else if (type === 'prompts') {
      settings = await api('preferences', { patch: Object.fromEntries(data) });
      for (const key of Object.keys(promptDefaults)) form.elements[key].value = settings[key];
      notify('已保存 AI 提示词');
    } else if (type === 'file') {
      await translateFile(form, data.get('file'), data.get('output') === 'bilingual');
    } else if (type === 'text') {
      const text = data.get('text').trim();
      if (!text) throw new Error('请输入要翻译的文字。');
      form.elements.result.value = '';
      formStatus(form, '翻译中…');
      const [result] = await api('translate', { texts: [text], target: data.get('target'), context: { source: data.get('source') } });
      if (result.error) throw new Error(result.error);
      form.elements.result.value = result.text;
      formStatus(form, '');
    }
  } catch (error) {
    if (form.querySelector('.form-status')) formStatus(form, error.message, true);
    else notify(error.message);
  } finally {
    if (submit) submit.disabled = false;
  }
});

window.addEventListener('hashchange', () => {
  fileRun?.abort();
  if (editor.open) editor.close();
  if (settings) draw();
});
api('settings').then(value => {
  settings = value;
  draw();
}).catch(error => { container.textContent = error.message; });
