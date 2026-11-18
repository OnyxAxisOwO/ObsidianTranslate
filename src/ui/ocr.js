import { escape } from './helpers.js';

export const ocrLanguages = {
  eng: '英语', chi_sim: '简体中文', chi_tra: '繁体中文', jpn: '日语', kor: '韩语',
  deu: '德语', fra: '法语', spa: '西班牙语', rus: '俄语', por: '葡萄牙语',
};

const dataUrl = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd';
const asset = path => new URL('ocr/' + path, document.baseURI).href;

function withDeadline(promise, signal) {
  const timeout = AbortSignal.timeout(90000);
  const stop = AbortSignal.any([signal, timeout]);
  return new Promise((resolve, reject) => {
    function abort() {
      reject(timeout.aborted ? new Error('文字识别超时，请尝试缩小图片或检查识别语言数据的连接。') : signal.reason);
    }
    if (stop.aborted) abort();
    else stop.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => stop.removeEventListener('abort', abort));
  });
}

export function createOcr(language, signal) {
  if (!Object.hasOwn(ocrLanguages, language)) throw new Error('请选择受支持的识别语言。');
  let worker;
  let opening;
  let closed = false;

  function initialize() {
    return new Promise((resolve, reject) => {
      import(asset('tesseract.mjs')).then(({ default: tesseract }) => tesseract.createWorker(language, 1, {
        workerPath: asset('worker.min.js'),
        corePath: asset(''),
        workerBlobURL: false,
        langPath: language === 'eng' ? asset('') : dataUrl,
        gzip: language === 'eng',
        errorHandler: error => reject(new Error('无法载入文字识别组件：' + String(error))),
      })).then(instance => {
        if (closed) {
          instance.terminate();
          return;
        }
        worker = instance;
        resolve(instance);
      }, error => reject(new Error('无法启动文字识别：' + String(error?.message || error))));
    });
  }

  return {
    async recognize(canvas, withLayout = false) {
      signal.throwIfAborted();
      opening ||= initialize();
      const instance = await withDeadline(opening, signal);
      const result = await withDeadline(instance.recognize(canvas, {}, { text: true, blocks: withLayout }), signal);
      return result.data;
    },
    async close() {
      closed = true;
      await worker?.terminate();
    },
  };
}

export async function readImage(file, language, signal) {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const ocr = createOcr(language, signal);
  let data;
  try {
    data = await ocr.recognize(canvas, true);
  } finally {
    await ocr.close();
  }
  const parts = (data.blocks || []).flatMap(block => block.paragraphs)
    .map(paragraph => ({ original: paragraph.text.trim(), bbox: paragraph.bbox })).filter(part => /\p{L}/u.test(part.original));
  if (!parts.length && /\p{L}/u.test(data.text)) parts.push({ original: data.text.trim() });
  if (!parts.length) throw new Error('未识别到可翻译的文字。请检查识别语言或图片清晰度。');
  return { parts, format(translations, bilingual, target) {
    const photo = '<img src="' + canvas.toDataURL('image/png') + '" alt="">';
    const percent = (position, dimension) => Math.max(0, Math.min(100, position / dimension * 100)).toFixed(2) + '%';
    const labels = parts.map(({ bbox }, i) => bbox ?
      '<span class="label" lang="' + escape(target) + '" dir="auto" style="left:' + percent(bbox.x0, canvas.width) +
        ';top:' + percent(bbox.y0, canvas.height) + ';max-width:' + percent(canvas.width - bbox.x0, canvas.width) +
        '">' + escape(translations[i]) + '</span>' : '').join('');
    const sentences = parts.map(({ original }, i) => '<li>' + (bilingual ? '<p dir="auto">' + escape(original) + '</p>' : '') +
      '<p lang="' + escape(target) + '" dir="auto">' + escape(translations[i]) + '</p></li>').join('');
    const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
      '<title>' + escape(file.name) + '</title><style>body{max-width:65rem;margin:2rem auto;padding:0 1rem;font:16px/1.5 system-ui,sans-serif}' +
      '.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,21rem),1fr));gap:1rem;align-items:start}' +
      'figure{margin:0;position:relative;overflow:hidden}img{width:100%;display:block}.label{position:absolute;background:#fff;' +
      'border:1px solid #ccc;border-radius:.25rem;padding:.05rem .3rem;font-size:clamp(.64rem,1.6vw,1rem);overflow-wrap:anywhere}' +
      'p{white-space:pre-wrap;overflow-wrap:anywhere}</style><body><h1>' + escape(file.name) + '</h1><div class="images">' +
      (bilingual ? '<figure>' + photo + '</figure>' : '') + '<figure>' + photo + labels + '</figure></div>' +
      '<ol>' + sentences + '</ol></body></html>';
    return { extension: 'html', blob: new Blob([html], { type: 'text/html;charset=utf-8' }), preview: true };
  } };
}
