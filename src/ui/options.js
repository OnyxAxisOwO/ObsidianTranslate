import { activeModel, bilingualLayouts, booleanPagePreferences, languages, loadingStyles, loadingTextLimit, modelKey,
  needsKey, pagePreferenceValue, promptDefaults, protocols, requestParameters } from '../shared/settings.js';
import { icon } from '../shared/icons.js';
import { api } from './api.js';
import { escape, iconButton, languageOptions, option } from './helpers.js';
import { parseFile } from './files.js';
import { fetchFile, readDocument } from './documents.js';
import { ocrLanguages, readImage } from './ocr.js';

const container = document.querySelector('#settings');
const navigation = document.querySelector('#navigation');
const editor = document.querySelector('#editor');
const toast = document.querySelector('#toast');
const sections = {
  models: ['服务商与模型', 'stack'],
  reading: ['网页翻译', 'globe'],
  floating: ['悬浮窗', 'sliders'],
  text: ['文本翻译', 'translate'],
  files: ['文件翻译', 'file'],
  advanced: ['高级设置', 'settings'],
};
const advancedSections = {
  prompts: ['AI 提示词', 'sliders', '调整系统指令、用户输入、字幕和术语。'],
  rules: ['网站与语言', 'globe', '选择总是翻译的网站和语言。'],
  cache: ['本地缓存', 'disk', '查看或清除已存的译文。'],
  backup: ['配置导入与导出', 'disk', '迁移连接、提示词、网站规则和界面偏好。'],
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
  const machine = provider && protocols[provider.protocol].machine;
  selected = provider?.id;
  const head = heading('服务商与模型', '在服务商中配置连接，同一服务商下的模型共用地址和密钥。',
    button('new-provider', '添加服务商', 'plus', 'primary'));
  if (!provider) return head + `<div class="empty">${icon('stack')}<h2>添加你的第一个服务商</h2>
    <p>可接入大语言模型、DeepL、Google Cloud Translation 或自托管 LibreTranslate。</p>
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
      <div class="group-head"><h3>${machine ? '翻译引擎' : '翻译模型'}</h3>
        ${machine ? '<p class="help">使用原生翻译接口，AI 提示词和模型参数不生效。</p>'
          : '<div class="actions">' + button('discover', '从 API 导入', 'search', 'ghost') + button('new-model', '添加模型', 'plus') + '</div>'}</div>
      <div class="model-list">${provider.models.map((model, index) => `<div class="model-row">
        <span class="model-mark">${icon('cube')}</span><div class="model-copy"><strong class="shorten">${escape(model.name)}</strong>
        <small class="mono shorten" title="${escape(model.id)}">${escape(model.id)}</small></div>
        ${settings.activeModel === modelKey(provider, model)
          ? `<span class="current-model">${icon('check')} 默认</span>`
          : `<button type="button" class="button ghost" data-action="default-model" data-index="${index}">设为默认</button>`}
        ${iconButton('test', '试译', 'play', index)}
        ${machine ? '' : iconButton('edit-model', '编辑模型', 'sliders', index)}
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
      ${select('bilingualLayout', '双语排版', '自动模式会在表格、图注和其他空间紧凑的位置使用行内译文。', showOptions('bilingualLayout', ...Object.entries(bilingualLayouts)))}
      ${toggle('richText', '富文本翻译', '保留译文中的粗体、斜体、上下标和行内样式。')}
      ${toggle('protectControls', '保护网页控件', '跳过工具栏、标签、按钮和维基页面的编辑链接。')}
      ${select('loadingStyle', '翻译中提示', '显示在等待译文的段落后面。', showOptions('loadingStyle', ...Object.entries(loadingStyles)))}
      <div id="loading-text-row" ${settings.loadingStyle === 'text' ? '' : 'hidden'}>
        ${row('提示文字', '', `<input type="text" data-pref="loadingText" aria-label="提示文字" maxlength="${loadingTextLimit}" value="${escape(settings.loadingText)}">`)}
      </div>
      ${select('scope', '翻译范围', '正文优先翻译文章和页面主区。', showOptions('scope', ['reading', '正文'], ['whole', '整页']))}
    `)}
    ${group('网页工具', `
      ${toggle('floating', '网页悬浮窗', '单击侧边悬浮球翻译，靠近后可打开设置菜单。')}
      ${row('悬浮窗设置', '调整停靠位置、透明度和隐藏的网站。', '<a class="button" href="#floating">打开设置</a>')}
      ${toggle('selection', '划词翻译', '选中文字后显示翻译按钮。')}
      ${toggle('hover', '悬停翻译', '鼠标指向文段时按 Shift 翻译。')}
      ${toggle('captions', '双语字幕', '在 YouTube 和兼容播放器打开原字幕后显示译文。')}
      ${toggle('translateFrames', '翻译嵌入框架', '让嵌入网页和播放器使用主页面设置。需有权访问框架所在网站。')}
    `)}
    ${group('输入框', `
      ${select('inputTarget', '输入框目标语言', '在输入框中按 Option / Alt + Shift + I 翻译。', languageOptions(settings.inputTarget))}
      ${toggle('inputSpaces', '连按三次空格翻译', '也可以输入 /ja 或 /en 指定目标语言，或用 // 标记只翻译其后的文字。')}
    `)}
  </div>`;
}

function renderFloating() {
  return heading('悬浮窗', '在浏览器侧边快速翻译，鼠标靠近时显示设置按钮。') + `<div class="preferences">
    ${group('显示与位置', `
      ${toggle('floating', '显示悬浮球', '关闭后仍可通过工具栏和快捷键翻译。')}
      ${select('floatingSide', '停靠侧边', '', showOptions('floatingSide', ['left', '左侧'], ['right', '右侧']))}
      ${select('floatingPosition', '垂直位置', '', [25, 55, 80].map(value =>
        option(String(value), {25:'靠上',55:'居中',80:'靠下'}[value], String(settings.floatingPosition))).join(''))}
      ${select('floatingOpacity', '闲置透明度', '鼠标靠近或用键盘聚焦时完全显示。', [0.2,0.35,0.5,0.7,1].map(value =>
        option(String(value), Math.round(value * 100) + '%', String(settings.floatingOpacity))).join(''))}
    `)}
    ${group('在这些网站隐藏', `
      ${settings.hiddenFloatingSites.map((host, index) => row(escape(host), '',
        `<button class="button ghost" type="button" data-action="show-floating-site" data-index="${index}">恢复显示</button>`)).join('')}
      ${row('隐藏的网站', '隐藏后仍可使用浏览器工具栏和快捷键翻译。',
        button('new-floating-site', '添加网站', 'plus'))}
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
  return heading('网站与语言', '按网站、网址路径或源语言决定翻译方式。') + `<div class="preferences">
    ${group('网址规则', `
      ${settings.siteProfiles.map(({ pattern, overrides }, index) => row(escape(pattern), profileSummary(overrides),
        '<div class="actions">' + iconButton('edit-profile', '编辑网址规则', 'sliders', index) +
        iconButton('delete-profile', '移除网址规则', 'trash', index) + '</div>')).join('')}
      ${row('自定义规则', '更具体的网址继承并覆盖域名规则中的对应项目。', button('new-profile', '添加网址规则', 'plus'))}
    `)}
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

function profileSummary(overrides) {
  const model = settings.providers.flatMap(provider => provider.models.map(item =>
    [modelKey(provider, item), provider.name + ' / ' + item.name])).find(([key]) => key === overrides.activeModel)?.[1];
  return [
    { always: '总是翻译', never: '停用翻译', manual: '仅手动翻译' }[overrides.policy],
    overrides.target && '目标 ' + languages[overrides.target][0],
    model,
    overrides.include && '指定正文',
    overrides.exclude && '排除指定元素',
  ].filter(Boolean).map(escape).join(' · ');
}

function renderBackup() {
  return heading('配置导入与导出', '在浏览器或设备之间迁移扩展设置。') + `<div class="preferences">
    ${group('配置文件', `
      ${row('导出配置', '包含服务商地址、API 密钥、模型、网站规则和偏好。', button('export-settings', '下载 JSON', 'file'))}
      ${row('导入配置', '从 JSON 备份恢复设置，并替换当前配置。', button('import-settings', '选择备份', 'back'))}
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
    : '<a class="button" href="#models">设置翻译模型</a>';
}

function renderFiles() {
  const selection = activeModel(settings);
  const query = new URLSearchParams(location.search);
  const presetUrl = query.get('pdf') || query.get('image') || '';
  const mode = query.has('pdf') ? 'url' : query.has('image') ? 'image' : 'file';
  const online = mode !== 'file';
  return heading('文件翻译', '翻译文档和字幕，下载译文或双语版本。') +
    `<form class="preferences" data-form="file">
      ${group('来源', row('导入方式', '', '<select name="fileSource" aria-label="导入方式">' +
        option('file', '本地文件', mode) + option('url', '在线 PDF', mode) + option('image', '在线图片', mode) + '</select>'))}
      <label class="file-picker" ${online ? 'hidden' : ''}>
        <input name="file" type="file" aria-label="选择文件" accept=".txt,.md,.srt,.vtt,.ass,.pdf,.epub,.docx,.png,.jpg,.jpeg,.webp" ${online ? 'disabled' : 'required'}>
        <span class="file-icon">${icon('file')}</span><strong id="file-name">选择或拖入文件</strong>
        <small>PDF、EPUB、DOCX、文本、字幕、PNG、JPEG 和 WebP</small>
      </label>
      <label class="online-file" ${online ? '' : 'hidden'}><span>${mode === 'image' ? '图片网址' : 'PDF 网址'}</span>
        <input name="fileUrl" type="url" placeholder="https://example.com/file" value="${escape(presetUrl)}" ${online ? 'required' : 'disabled'}>
      </label>
      <p class="help">文档和图片最大 25 MB，文本和字幕最大 1 MB。PDF 按页导出 HTML，可在预览中打印或存为 PDF。</p>
      ${group('翻译选项', `
        ${row('翻译模型', '', activeLabel())}
        ${row('源语言', '', '<select name="source" aria-label="源语言">' +
          option('auto', '自动识别', settings.source) + languageOptions(settings.source) + '</select>')}
        ${row('图片与扫描页识别', '英文数据已随扩展安装，其他识别语言首次使用时下载。', '<select name="ocrLanguage" aria-label="识别语言">' +
          option('', '关闭扫描页识别') + Object.entries(ocrLanguages).map(([code, label]) => option(code, label, 'eng')).join('') + '</select>')}
        ${select('fileTarget', '目标语言', '', languageOptions(settings.target))}
        ${row('输出内容', '', `<select aria-label="输出内容" name="output">${showOptions('view', ['translation', '仅译文'], ['bilingual', '双语对照'])}</select>`)}
      `)}
      <div class="actions end"><button type="button" class="button ghost" data-action="stop-file" hidden>停止</button>
        <button class="button primary" ${selection && !needsKey(selection.provider) ? '' : 'disabled'}>${icon('translate')} 翻译文件</button></div>
      <div class="file-result"><p class="form-status" role="status"></p>
        <a class="button" id="preview-file" target="_blank" rel="noopener" hidden>预览 / 打印</a>
        <a class="button" id="download" hidden>下载译文</a></div>
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

const screens = { reading: renderReading, floating: renderFloating, text: renderText, files: renderFiles, advanced: renderAdvanced,
  models: renderModels, prompts: renderPrompts, rules: renderRules, cache: renderCache, backup: renderBackup };

function draw() {
  const next = location.hash.slice(1).replace(/^advanced\//, '');
  section = Object.hasOwn(screens, next) ? next : 'models';
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
    <label>API 格式<select name="protocol">${Object.entries(protocols).map(([key, value]) => option(key, value.name, item.protocol)).join('')}</select></label>
    <label>名称<input name="name" required maxlength="80" value="${escape(item.name)}" placeholder="例如 OpenAI 或本地模型"></label>
    <label>Base URL<input name="baseUrl" type="url" required maxlength="2000" value="${escape(item.baseUrl)}"></label>
    <label>API Key<input name="apiKey" type="password" maxlength="4000" autocomplete="off" value="${DEMO ? '' : escape(item.apiKey)}" placeholder="无鉴权的本地服务可留空"></label>
    <label>每秒最大请求数<input name="rps" type="number" required min="0" step="any" value="${item.rps}"></label>
    <p class="help" data-provider-help></p>
    <div class="dialog-actions">${provider ? button('delete-provider', '删除服务商', 'trash', 'danger ghost') : ''}
      ${button('close', '取消', '', 'ghost')}<button class="button primary">保存</button></div>
    <p class="form-status" role="status"></p></form>`);
  const form = editor.querySelector('form');
  form.dataset.id = provider?.id || '';
  function describe() {
    const protocol = form.elements.protocol.value;
    form.elements.apiKey.required = !!protocols[protocol].key;
    form.querySelector('[data-provider-help]').textContent = {
      deepl: '默认使用 DeepL API Free；若使用 API Pro，将地址改为 https://api.deepl.com/v2。',
      google: '填写已启用 Cloud Translation API 的 Google Cloud 项目的 API Key。',
      libre: '默认连接本机的 LibreTranslate。服务启用鉴权时填写该服务的 API Key。',
    }[protocol] || '';
  }
  describe();
  form.elements.protocol.addEventListener('change', () => {
    const protocol = protocols[form.elements.protocol.value];
    if (!form.elements.name.value || Object.values(protocols).some(value => value.name === form.elements.name.value)) {
      form.elements.name.value = protocol.name;
    }
    if (Object.values(protocols).some(value => form.elements.baseUrl.value === value.url)) {
      form.elements.baseUrl.value = protocol.url;
    }
    describe();
  });
}

function modelForm(index) {
  const provider = settings.providers.find(item => item.id === selected);
  const existing = provider.models[index];
  modal(existing ? '编辑模型' : '添加模型', `<form data-form="model" data-index="${existing ? index : ''}" class="editor-fields">
    <label>模型 ID<input name="id" required maxlength="200" value="${escape(existing?.id)}" placeholder="填写服务商提供的模型 ID" autofocus></label>
    <label>展示名称<input name="name" maxlength="100" value="${escape(existing?.name)}" placeholder="留空则显示模型 ID"></label>
    <label>额外请求 JSON<textarea name="parameters" rows="7" spellcheck="false" placeholder='{"reasoning_effort":"low"}'>${escape(JSON.stringify(existing?.parameters || {}, null, 2))}</textarea></label>
    <p class="help">填写服务商支持的额外参数，例如 <code>reasoning_effort</code>、<code>reasoning</code>、<code>thinking</code> 或 <code>temperature</code>。模型名、待译文本和流式开关由扩展生成。参数会用于网页翻译、试译和文件翻译。</p>
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

function profileForm(index) {
  const current = settings.siteProfiles[index];
  const profile = current?.overrides || {};
  const inherited = '<option value="">继承</option>';
  const choose = (key, entries) => inherited + entries.map(([value, label]) => option(value, label, String(profile[key]))).join('');
  const models = settings.providers.flatMap(provider => provider.models.map(model =>
    [modelKey(provider, model), provider.name + ' / ' + model.name]));
  modal(current ? '编辑网址规则' : '添加网址规则', `<form data-form="profile" class="editor-fields">
    <label>域名或网址路径<input name="pattern" required maxlength="600" value="${escape(current?.pattern)}"
      placeholder="*.example.com/docs/*" autofocus></label>
    <p class="help">可填写完整页面路径。子域名开头和路径末尾可使用 *。</p>
    <label>自动翻译<select name="policy">${choose('policy', [['always', '总是翻译'], ['manual', '仅手动翻译'], ['never', '停用翻译']])}</select></label>
    <label>翻译引擎<select name="activeModel">${choose('activeModel', models)}</select></label>
    <label>源语言<select name="source">${inherited}${option('auto', '自动识别', profile.source)}${languageOptions(profile.source)}</select></label>
    <label>目标语言<select name="target">${inherited}${languageOptions(profile.target)}</select></label>
    <label>范围<select name="scope">${choose('scope', [['reading', '正文'], ['whole', '整页']])}</select></label>
    <label>显示<select name="view">${choose('view', [['translation', '仅译文'], ['bilingual', '双语对照']])}</select></label>
    <label>双语字幕<select name="captions">${choose('captions', [['true', '开启'], ['false', '关闭']])}</select></label>
    <label>双语排版<select name="bilingualLayout">${choose('bilingualLayout', Object.entries(bilingualLayouts))}</select></label>
    <label>富文本翻译<select name="richText">${choose('richText', [['true', '开启'], ['false', '关闭']])}</select></label>
    <label>保护网页控件<select name="protectControls">${choose('protectControls', [['true', '开启'], ['false', '关闭']])}</select></label>
    <label>正文 CSS 选择器<input name="include" maxlength="500" value="${escape(profile.include)}" placeholder="例如 main .article"></label>
    <label>排除 CSS 选择器<input name="exclude" maxlength="500" value="${escape(profile.exclude)}" placeholder="例如 .advertisement, .references"></label>
    <div class="dialog-actions">${button('close', '取消', '', 'ghost')}<button class="button primary">保存</button></div>
    <p class="form-status" role="status"></p></form>`);
  editor.querySelector('form').dataset.previous = current?.pattern || '';
}

function exportSettings() {
  const backup = { format: 'obsidian-translate-settings', version: 1, settings };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'obsidian-translate-settings.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function wireFilePicker() {
  const form = container.querySelector('[data-form="file"]');
  const picker = form.querySelector('.file-picker');
  const input = picker.querySelector('input');
  const name = picker.querySelector('#file-name');
  const online = form.querySelector('.online-file');
  const url = online.querySelector('input');
  form.elements.fileSource.addEventListener('change', () => {
    const source = form.elements.fileSource.value;
    const isOnline = source !== 'file';
    picker.hidden = input.disabled = url.required = isOnline;
    online.hidden = url.disabled = input.required = !isOnline;
    online.querySelector('span').textContent = source === 'image' ? '图片网址' : 'PDF 网址';
  });
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
    case 'new-profile': return profileForm();
    case 'edit-profile': return profileForm(index);
    case 'delete-profile':
      settings = await api('site-profile-delete', { pattern: settings.siteProfiles[index].pattern });
      return draw();
    case 'export-settings': return exportSettings();
    case 'import-settings':
      return modal('导入配置', `<form data-form="backup" class="editor-fields">
        <label>备份文件<input type="file" name="file" accept=".json,application/json" required></label>
        <div class="dialog-actions">${button('close', '取消', '', 'ghost')}<button class="button primary">替换当前配置</button></div>
        <p class="form-status" role="status"></p></form>`);
    case 'new-floating-site':
      return modal('在网站隐藏悬浮窗', `<form data-form="floating-site" class="editor-fields">
        <label>域名或完整网址<input name="host" placeholder="example.com" required autofocus></label>
        <div class="dialog-actions">${button('close', '取消', '', 'ghost')}<button class="button primary">保存</button></div>
        <p class="form-status" role="status"></p></form>`);
    case 'show-floating-site':
      settings = await api('floating-site', { host: settings.hiddenFloatingSites[index], hidden: false });
      return draw();
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

async function translateFile(form, data) {
  const file = data.get('file');
  const source = data.get('fileSource');
  const url = source === 'file' ? '' : data.get('fileUrl').trim();
  const name = url ? (new URL(url).pathname.split('/').at(-1) || 'online') : file?.name || '';
  const extension = source === 'url' ? 'pdf' : name.split('.').at(-1).toLowerCase();
  const document = ['pdf', 'docx', 'epub'].includes(extension);
  const image = source === 'image' || (source === 'file' && ['png', 'jpg', 'jpeg', 'webp'].includes(extension));
  const rich = document || image;
  const subtitles = ['srt', 'vtt', 'ass'].includes(extension);
  const bilingual = data.get('output') === 'bilingual';
  if (!rich && !subtitles && !['txt', 'md'].includes(extension)) throw new Error('请选择受支持的文档、字幕或图片。');
  if (!url && (!file?.size || file.size > (rich ? 25_000_000 : 1_000_000))) {
    throw new Error(rich ? '请选择不超过 25 MB 的文档或图片。' : '请选择不超过 1 MB 的 UTF-8 文件。');
  }
  const ocrLanguage = data.get('ocrLanguage');
  if (image && !ocrLanguage) throw new Error('请为图片选择识别语言。');
  const target = form.querySelector('[data-pref="fileTarget"]').value;
  const stop = form.querySelector('[data-action="stop-file"]');
  const link = form.querySelector('#download');
  const preview = form.querySelector('#preview-file');
  link.hidden = true;
  preview.hidden = true;
  if (download) URL.revokeObjectURL(download);
  const controller = new AbortController();
  fileRun = controller;
  stop.hidden = false;
  const outputs = [];
  try {
    formStatus(form, image ? '正在识别图片文字…' : '正在读取文件…');
    const remoteImage = source === 'image' && await fetchFile(url, controller.signal);
    if (remoteImage && remoteImage.type && !/^(?:image\/(?:png|jpeg|webp)|application\/octet-stream)$/.test(remoteImage.type)) {
      throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
    }
    const picture = remoteImage ? new File([remoteImage.bytes], name, { type: remoteImage.type }) : file;
    const parsed = image ? await readImage(picture, ocrLanguage, controller.signal) :
      document ? await readDocument({ file, url, extension, name, ocrLanguage }, controller.signal, text => formStatus(form, text)) :
        parseFile(new TextDecoder('utf8', { fatal: true }).decode(await file.arrayBuffer()), extension);
    const { parts, format } = parsed;
    if (!parts.length) throw new Error('没有找到可翻译的文段。');
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
      const context = { kind: subtitles ? 'subtitle' : 'text', source: data.get('source'), title: name };
      const results = await api('translate', { texts, target, context });
      for (const result of results) {
        if (result.error) throw new Error(result.error);
        outputs.push(result.text);
      }
    }
    if (controller.signal.aborted) return formStatus(form, '已停止。');
    const formatted = rich ? format(outputs, bilingual, target) :
      { extension, blob: new Blob([format(outputs, bilingual)], { type: 'text/plain;charset=utf-8' }) };
    download = URL.createObjectURL(formatted.blob);
    link.href = download;
    link.download = name.replace(/\.[^.]+$/, '') + '.' + target + '.' + formatted.extension;
    link.hidden = false;
    if (formatted.preview) {
      preview.href = download;
      preview.hidden = false;
    }
    formStatus(form, '翻译完成 · ' + parts.length + ' 段' +
      (parsed.scannedPages ? ' · 识别 ' + parsed.scannedPages + ' 页' : '') +
      (parsed.skippedPages ? ' · ' + parsed.skippedPages + ' 页无可提取文本' : ''));
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    formStatus(form, '已停止。');
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
      const protocol = data.get('protocol');
      const models = prior && !protocols[prior.protocol].machine ? prior.models : [];
      await saveProvider({ ...prior, ...Object.fromEntries(data), models });
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
        const model = { id, name: data.get('name').trim() || id, parameters: requestParameters(data.get('parameters')) };
        if (index !== '') {
          replaceActive = { from: modelKey(provider, models[index]), to: modelKey(provider, model) };
          models[index] = model;
        } else models.push(model);
      }
      await saveProvider({ ...provider, models }, replaceActive);
    } else if (type === 'site' || type === 'floating-site') {
      const address = data.get('host').trim();
      const url = new URL(address.includes('://') ? address : 'https://' + address);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) throw new Error('请输入有效的网页域名。');
      settings = type === 'site'
        ? await api('site-rule', { host: url.hostname, rule: data.get('rule') })
        : await api('floating-site', { host: url.hostname, hidden: true });
      editor.close();
      draw();
    } else if (type === 'profile') {
      const { pattern, ...overrides } = Object.fromEntries([...data].filter(([, value]) => value.trim()));
      for (const key of ['include', 'exclude']) {
        try {
          if (overrides[key]) document.querySelector(overrides[key]);
        } catch {
          throw new Error(key === 'include' ? '正文 CSS 选择器格式无效。' : '排除 CSS 选择器格式无效。');
        }
      }
      for (const key of booleanPagePreferences) {
        if (Object.hasOwn(overrides, key)) overrides[key] = pagePreferenceValue(key, overrides[key]);
      }
      if (!Object.keys(overrides).length) throw new Error('请设置至少一项规则。');
      settings = await api('site-profile-save', { profile: { pattern, overrides }, previous: form.dataset.previous });
      editor.close();
      draw();
    } else if (type === 'backup') {
      const file = data.get('file');
      if (!file?.size || file.size > 20_000_000) throw new Error('请选择不超过 20 MB 的设置备份。');
      let backup;
      try {
        backup = JSON.parse(await file.text());
      } catch {
        throw new Error('设置备份必须是有效的 JSON 文件。');
      }
      settings = await api('settings-import', { backup });
      editor.close();
      draw();
      notify('配置已导入');
    } else if (type === 'language') {
      settings = await api('language-rule', { language: data.get('language'), rule: data.get('rule') });
      editor.close();
      draw();
    } else if (type === 'prompts') {
      settings = await api('preferences', { patch: Object.fromEntries(data) });
      for (const key of Object.keys(promptDefaults)) form.elements[key].value = settings[key];
      notify('已保存 AI 提示词');
    } else if (type === 'file') {
      await translateFile(form, data);
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

let settingsRead = 0;
async function refreshSettings() {
  const read = ++settingsRead;
  const value = await api('settings');
  if (read !== settingsRead) return;
  settings = value;
  draw();
}

window.addEventListener('hashchange', () => {
  fileRun?.abort();
  if (editor.open) editor.close();
  refreshSettings().catch(error => notify(error.message));
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && section === 'floating' && !editor.open) {
    refreshSettings().catch(error => notify(error.message));
  }
});
refreshSettings().catch(error => { container.textContent = error.message; });
