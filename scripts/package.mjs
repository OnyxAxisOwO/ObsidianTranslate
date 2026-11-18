import './build.mjs';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const destination = resolve('dist', 'release', `v${version}`);
await mkdir(destination, { recursive: true });
const staging = await mkdtemp(join(destination, '.pack-'));
const files = ['manifest.json', 'background.js', 'content.js', 'page.css',
  'popup.html', 'popup.js', 'options.html', 'options.js', 'ui.css', 'icons', 'LICENSE', 'pdfjs', 'FFLATE-LICENSE', 'ocr'];

try {
  for (const browser of ['chrome', 'firefox', 'safari']) {
    const name = `obsidian-translate-${browser}-v${version}.zip`;
    const temp = join(staging, name);
    const result = spawnSync('zip', ['-q', '-X', '-r', temp, ...files], {
      cwd: resolve('dist', browser), stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`zip failed for ${browser}`);
    await rename(temp, join(destination, name));
    console.log(join(destination, name));
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
