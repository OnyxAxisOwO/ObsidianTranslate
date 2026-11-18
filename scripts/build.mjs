import { build } from 'esbuild';
import { mkdir, readdir, readFile, writeFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const targets = ['chrome', 'firefox', 'safari', 'demo'];
const icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/${size}.png`]));
const entries = {
  background: 'src/background.js',
  content: 'src/content/index.js',
  popup: 'src/ui/popup.js',
  options: 'src/ui/options.js',
};
const manifest = {
  manifest_version: 3,
  name: 'Obsidian Translate',
  version,
  description: '开源双语浏览器翻译扩展，支持自定义模型、机器翻译和文档翻译。',
  icons,
  permissions: ['storage', 'contextMenus'],
  host_permissions: ['http://*/*', 'https://*/*'],
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
  action: { default_title: 'Obsidian Translate', default_popup: 'popup.html', default_icon: icons },
  options_ui: { page: 'options.html', open_in_tab: true },
  content_scripts: [{
    matches: ['http://*/*', 'https://*/*'],
    js: ['content.js'],
    css: ['page.css'],
    run_at: 'document_idle',
    all_frames: true,
  }],
  commands: {
    toggle: { suggested_key: { default: 'Alt+Shift+T' }, description: '翻译网页 / 显示原文' },
    whole: { description: '翻译整页' },
    input: { suggested_key: { default: 'Alt+Shift+I' }, description: '翻译当前输入框' },
  },
};
const backgrounds = {
  chrome: { service_worker: 'background.js' },
  firefox: { scripts: ['background.js'] },
  safari: { service_worker: 'background.js' },
};

await Promise.all(targets.map(async target => {
  const outdir = `dist/${target}`;
  await mkdir(outdir, { recursive: true });
  const demo = target === 'demo';
  const entryPoints = demo
    ? { ...entries, demo: 'src/ui/demo.js' }
    : entries;
  await Promise.all([
    build({
      entryPoints,
      bundle: true,
      loader: { '.css': 'text' },
      minify: !demo,
      target: ['chrome120', 'firefox121', 'safari17.4'],
      outdir,
      define: { DEMO: JSON.stringify(demo) },
    }),
    cp('src/icons', `${outdir}/icons`, { recursive: true }),
    ...(await readdir('src/ui')).filter(name => /\.(css|html)$/.test(name) &&
      (demo || !['index.html', 'demo.css'].includes(name))).map(name => cp(`src/ui/${name}`, `${outdir}/${name}`)),
    cp('src/content/page.css', `${outdir}/page.css`),
    mkdir(`${outdir}/pdfjs`, { recursive: true }).then(() => Promise.all([
      cp('node_modules/pdfjs-dist/legacy/build/pdf.min.mjs', `${outdir}/pdfjs/pdf.mjs`),
      cp('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', `${outdir}/pdfjs/pdf.worker.mjs`),
      cp('node_modules/pdfjs-dist/LICENSE', `${outdir}/pdfjs/LICENSE`),
      cp('node_modules/pdfjs-dist/cmaps', `${outdir}/pdfjs/cmaps`, { recursive: true }),
      cp('node_modules/pdfjs-dist/standard_fonts', `${outdir}/pdfjs/standard_fonts`, { recursive: true }),
    ])),
    cp('node_modules/fflate/LICENSE', `${outdir}/FFLATE-LICENSE`),
    mkdir(`${outdir}/ocr`, { recursive: true }).then(() => Promise.all([
      cp('node_modules/tesseract.js/dist/tesseract.esm.min.js', `${outdir}/ocr/tesseract.mjs`),
      cp('node_modules/tesseract.js/dist/worker.min.js', `${outdir}/ocr/worker.min.js`),
      ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'LICENSE'].map(name =>
        cp(`node_modules/tesseract.js-core/${name}`, `${outdir}/ocr/${name}`)),
      cp('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${outdir}/ocr/eng.traineddata.gz`),
    ])),
    ...(demo ? [] : [cp('LICENSE', `${outdir}/LICENSE`), writeFile(`${outdir}/manifest.json`, JSON.stringify({
      ...manifest,
      background: backgrounds[target],
      ...(target === 'safari' ? { options_ui: { page: 'options.html' } } : {}),
      ...(target === 'firefox' ? {
        browser_specific_settings: { gecko: {
          id: 'obsidian-translate@onyxaxis.dev',
          strict_min_version: '142.0',
          data_collection_permissions: { required: ['websiteContent'], optional: [] },
        } },
      } : {}),
    }, null, 2) + '\n')]),
  ]);
}));
