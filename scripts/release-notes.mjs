import { readFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const headings = [...changelog.matchAll(/^##[ \t]+([^\r\n]+)\r?$/gm)];
const matches = headings.filter(([, heading]) =>
  heading.trim() === `[${version}]` || heading.startsWith(`[${version}] - `),
);

if (matches.length !== 1) {
  console.error(`CHANGELOG.md must contain exactly one section for version ${version}.`);
  process.exit(1);
}

const [heading] = matches;
const nextHeading = headings[headings.indexOf(heading) + 1];
const notes = changelog.slice(heading.index + heading[0].length, nextHeading?.index).trim();
if (!notes) {
  console.error(`The changelog section for version ${version} is empty.`);
  process.exit(1);
}

console.log(notes);
