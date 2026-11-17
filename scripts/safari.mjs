import { mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
await mkdir('dist/xcode', { recursive: true });
const project = 'dist/xcode/Obsidian Translate/Obsidian Translate.xcodeproj';
if ((await stat(project).catch(() => null))?.isDirectory()) {
  console.log(project);
  process.exit(0);
}
const result = spawnSync('xcrun', ['safari-web-extension-converter', 'dist/safari',
  '--project-location', 'dist/xcode', '--app-name', 'Obsidian Translate',
  '--bundle-identifier', 'dev.onyxaxis.ObsidianTranslate', '--swift', '--no-open', '--no-prompt'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
