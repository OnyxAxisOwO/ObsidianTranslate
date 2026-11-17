import { icon } from './icons.js';
import { languages } from './settings.js';

const languageChoices = Object.entries(languages).map(([value, [label]]) => ({ value, label }));
const choices = {
  source: [{ value: 'auto', label: '自动识别' }, ...languageChoices],
  target: languageChoices,
  view: [{ value: 'translation', label: '仅译文' }, { value: 'bilingual', label: '双语对照' }],
  scope: [{ value: 'reading', label: '正文' }, { value: 'whole', label: '整页' }],
  site: [{ value: '', label: '手动' }, { value: 'always', label: '总是翻译' }, { value: 'never', label: '永不翻译' }],
  captions: [{ value: 'false', label: '关闭' }, { value: 'true', label: '开启' }],
};

function field(key, label) {
  return `<label class="ot-field"><span>${label}</span><select data-field="${key}" aria-label="${label}"></select></label>`;
}

function button(action, text, name, className = '') {
  return `<button type="button" class="${className}" data-panel-action="${action}">${icon(name)}<span>${text}</span></button>`;
}

export function mountPanel(host, emit) {
  host.innerHTML = `<div class="ot-panel">
    <section class="ot-main" aria-label="网页翻译">
      <header class="ot-head"><span class="ot-heading">${icon('translate')}网页翻译</span>
        <button class="ot-model-settings" type="button" data-panel-action="models" aria-label="服务商与模型" title="服务商与模型">模型设置</button>
        <button class="ot-expand" type="button" data-panel-action="expand" aria-expanded="false" aria-label="展开高级面板" title="展开高级面板">${icon('sliders')}</button></header>
      <div class="ot-fields">${field('activeModel', '翻译模型')}${field('target', '目标语言')}</div>
      <div class="ot-actions">${button('translate-page', '翻译', 'translate', 'ot-primary')}${button('original', '还原', 'back')}</div>
      <p class="ot-note" role="status"></p>
    </section>
    <section class="ot-details" aria-label="高级面板" hidden>
      <header class="ot-head"><span class="ot-heading">高级面板</span></header>
      <div class="ot-fields">${field('source', '源语言')}${field('view', '显示方式')}${field('scope', '翻译范围')}
        ${field('site', '此网站')}${field('captions', '双语字幕')}</div>
      <div class="ot-links">${button('models', '服务商与模型', 'stack', 'ot-link')}
        ${button('text', '翻译一段文字', 'translate', 'ot-link')}
        ${button('toggle-floating-site', '在此网站隐藏悬浮窗', 'close', 'ot-link')}
        ${button('hide-floating-all', '在所有网站隐藏悬浮窗', 'close', 'ot-link')}
        ${button('floating', '悬浮窗设置', 'sliders', 'ot-link')}
        ${button('files', '翻译文件', 'file', 'ot-link')}${button('advanced', '高级设置', 'settings', 'ot-link')}</div>
    </section>
  </div>`;
  const panels = host.querySelector('.ot-panel');
  const details = host.querySelector('.ot-details');
  const expander = host.querySelector('[data-panel-action="expand"]');
  const primary = host.querySelector('[data-panel-action="translate-page"]');
  const original = host.querySelector('[data-panel-action="original"]');
  const note = host.querySelector('.ot-note');
  const fields = Object.fromEntries([...host.querySelectorAll('[data-field]')].map(element => [element.dataset.field, element]));
  let modelSignature;

  function setChoices(select, entries) {
    select.replaceChildren(...entries.map(({ value, label }) => new Option(label, value)));
  }
  for (const [key, entries] of Object.entries(choices)) setChoices(fields[key], entries);
  setChoices(fields.activeModel, [{ value: '', label: '尚未配置' }]);

  function expand(open) {
    details.hidden = !open;
    panels.classList.toggle('ot-expanded', open);
    expander.setAttribute('aria-expanded', String(open));
    const label = open ? '收起高级面板' : '展开高级面板';
    expander.setAttribute('aria-label', label);
    expander.title = label;
  }

  host.addEventListener('click', event => {
    const action = event.target.closest('[data-panel-action]')?.dataset.panelAction;
    if (action === 'expand') {
      expand(details.hidden);
    } else if (action) {
      emit(action);
    }
  });
  host.addEventListener('change', event => {
    if (event.target.dataset.field) emit(event.target.dataset.field, event.target.value);
  });

  return {
    expand,
    update(settings, page, error = '') {
      const models = settings.models || [];
      const signature = JSON.stringify(models);
      if (signature !== modelSignature) {
        modelSignature = signature;
        setChoices(fields.activeModel, models.length
          ? models.map(({ key, name, provider }) => ({ value: key, label: `${name} · ${provider}` }))
          : [{ value: '', label: '尚未配置' }]);
      }
      fields.activeModel.value = settings.activeModel || '';
      fields.activeModel.disabled = !models.length;
      fields.target.value = settings.target;
      fields.source.value = settings.source;
      fields.view.value = page?.view ?? settings.view;
      fields.scope.value = page?.scope ?? settings.scope;
      fields.site.value = page?.site || '';
      fields.site.disabled = !page?.hostname;
      fields.captions.value = String(settings.captions);
      const blocked = page?.site === 'never';
      const hideSite = host.querySelector('[data-panel-action="toggle-floating-site"]');
      hideSite.disabled = !page?.hostname;
      hideSite.querySelector('span').textContent = page?.floatingHidden ? '在此网站显示悬浮窗' : '在此网站隐藏悬浮窗';
      host.querySelector('[data-panel-action="hide-floating-all"]').disabled = !settings.floating;
      primary.disabled = blocked || (!page && !!settings.configured);
      original.disabled = !page?.canRestore;
      primary.querySelector('span').textContent = page?.paused ? '重试翻译' : '翻译';
      note.textContent = error || (blocked ? '已对此网站停用翻译。' : !settings.configured ? '请先在高级设置中配置模型。' :
        page?.canRestore ? page.note : !page ? '此页面暂不可翻译。' : '');
    },
  };
}
