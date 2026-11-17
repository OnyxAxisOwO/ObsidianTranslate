import { activeModel, defaults, modelKey, protocols } from '../shared/settings.js';
import { icon } from '../shared/icons.js';
import { api } from './api.js';
import { escape, iconButton, languageOptions, option } from './helpers.js';
import { parseFile } from './files.js';

const container = document.querySelector('#settings');
const navigation = document.querySelector('#navigation');
const editor = document.querySelector('#editor');
const toast = document.querySelector('#toast');
const sections = {
  models: ['服务商与模型', 'stack'],
  reading: ['网页翻译', 'globe'],
  rules: ['网站规则', 'sliders'],
  files: ['文件翻译', 'file'],
  cache: ['本地缓存', 'disk'],
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
        <p>${protocols[provider.protocol].name}</p></div></div>${button('edit-provider', '编辑连接', 'sliders')}</div>
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

function renderReading() {
  return heading('网页翻译', '调整阅读方式、鼠标操作和发给模型的提示词。') + `<div class="preferences">
    <section class="preference-group"><h2>阅读方式</h2>
      ${select('target', '目标语言', '', languageOptions(settings.target))}
      ${select('view', '显示方式', '', option('translation', '仅译文', settings.view) + option('bilingual', '双语对照', settings.view))}
      ${select('scope', '翻译范围', '正文模式会优先识别文章和页面主区。',
        option('reading', '正文', settings.scope) + option('whole', '整页', settings.scope))}
      ${select('inputTarget', '输入框目标语言', '在输入框内按 Option / Alt + Shift + I 翻译。',
        languageOptions(settings.inputTarget))}
    </section>
    <section class="preference-group"><h2>网页工具</h2>
      ${toggle('floating', '悬浮窗', '在网页右下角打开翻译菜单。')}
      ${toggle('selection', '划词翻译', '选中文字后显示翻译按钮。')}
      ${toggle('hover', '悬停翻译', '鼠标指向文段时按 Shift 翻译。')}
      ${toggle('captions', '双语视频字幕', '支持 YouTube 和使用标准 HTML 字幕轨的播放器。请先打开播放器字幕。')}
    </section>
    <form class="preference-group prompt" data-form="translation">
      <h2>文段与提示词</h2>
      <div class="prompt-fields">
        <label class="editor-fields">每次请求最多文段<input name="batchSize" type="number" min="1" max="20" required value="${settings.batchSize}"></label>
        <label class="editor-fields">每次请求最大字符数<input name="maxLength" type="number" min="300" max="12000" required value="${settings.maxLength}"></label>
      </div>
      <label class="editor-fields">默认翻译提示词<textarea name="prompt" rows="4" maxlength="6000" required>${escape(settings.prompt)}</textarea></label>
      <p class="help"><code>{{language}}</code> 会替换为目标语言名称。过长的文段会按句子或空格拆分。</p>
      <div class="actions">${button('reset-prompt', '恢复默认提示词', '', 'ghost')}<button class="button primary">保存</button></div>
    </form>
  </div>`;
}

function renderRules() {
  const entries = Object.entries(settings.sites);
  return heading('网站规则', '为指定网站开启自动翻译，或停用翻译工具。', button('new-site', '添加规则', 'plus', 'primary')) +
    `<div class="preferences">${entries.length ? entries.map(([host, rule], index) => row(escape(host),
      rule === 'always' ? '总是翻译' : '永不翻译', iconButton('delete-site', '移除站点规则', 'trash', index))).join('')
      : '<div class="empty">还没有网站规则。也可以在工具栏弹窗中设置当前网站。</div>'}</div>`;
}

function renderCache() {
  return heading('本地缓存', '同一模型、目标语言和提示词下的重复文段会复用已保存译文。') +
    `<div class="preferences"><section class="preference-group">
      ${toggle('cache', '保存译文', '译文保存在当前浏览器，每个浏览器最多保留 3,500 个文段。')}
      ${row('已缓存文段', '<span id="cache-count">正在读取…</span>', button('clear-cache', '清除缓存', 'trash', 'danger'))}
    </section></div>`;
}

function renderFiles() {
  const selection = activeModel(settings);
  return heading('文件翻译', '翻译 TXT、Markdown、SRT 或 WebVTT，字幕保留编号与时间轴。') +
    `<form class="preferences" data-form="file">
      ${row('原始文件', 'UTF-8，最大 1 MB', '<input name="file" type="file" aria-label="原始文件" accept=".txt,.md,.srt,.vtt" required>')}
      ${row('翻译模型', escape(selection?.model.name || '请先添加翻译模型'), '')}
      ${select('fileTarget', '目标语言', '', languageOptions(settings.target))}
      ${row('保留原文', '把译文附加到每一段或字幕条目。', `<input type="checkbox" role="switch" class="switch" name="bilingual" aria-label="保留原文"${settings.view === 'bilingual' ? ' checked' : ''}>`)}
      <div class="actions"><button class="button primary" ${selection ? '' : 'disabled'}>${icon('translate')} 翻译文件</button>
        <button type="button" class="button ghost" data-action="stop-file" hidden>停止</button></div>
      <div class="file-result"><p class="form-status" role="status"></p><a class="button" id="download" hidden>下载译文</a></div>
    </form>`;
}

const screens = { models: renderModels, reading: renderReading, rules: renderRules, files: renderFiles, cache: renderCache };
function draw() {
  const next = location.hash.slice(1);
  section = Object.hasOwn(sections, next) ? next : 'models';
  navigation.innerHTML = Object.entries(sections).map(([id, [name, glyph]]) =>
    `<a class="nav-item" href="#${id}"${id === section ? ' aria-current="page"' : ''}>${icon(glyph)}${name}</a>`).join('');
  container.innerHTML = `<div class="screen">${screens[section]()}</div>`;
  container.setAttribute('aria-busy', 'false');
  if (section === 'cache') countCache();
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
    <label>每秒最大请求数<input name="rps" type="number" required min="0.2" max="20" step="0.1" value="${item.rps}"></label>
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

function siteForm() {
  modal('添加站点规则', `<form data-form="site" class="editor-fields">
    <label>域名或完整网址<input name="host" placeholder="example.com" required autofocus></label>
    <label>翻译规则<select name="rule"><option value="always">总是翻译</option><option value="never">永不翻译</option></select></label>
    <div class="dialog-actions">${button('close', '取消', '', 'ghost')}<button class="button primary">保存</button></div>
    <p class="form-status" role="status"></p></form>`);
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
    case 'reset-prompt': container.querySelector('[name="prompt"]').value = defaults.prompt; return;
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
      const results = await api('translate', { texts, target });
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
    } else if (type === 'translation') {
      settings = await api('preferences', { patch: Object.fromEntries(data) });
      notify('文段设置已保存');
    } else if (type === 'file') {
      await translateFile(form, data.get('file'), data.has('bilingual'));
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
