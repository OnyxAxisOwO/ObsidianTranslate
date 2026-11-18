const timestamps = /^\s*(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->/;

export function parseFile(source, extension) {
  if (extension === 'ass') return parseAss(source);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const ending = source.match(/(?:\r?\n)+$/)?.[0] || '';
  const blocks = source.slice(0, source.length - ending.length).split(/(\r?\n\s*\r?\n)/);
  const parts = [];
  blocks.forEach((block, index) => {
    if (index % 2 || !/\p{L}/u.test(block)) return;
    if (extension === 'srt' || extension === 'vtt') {
      const lines = block.split(/\r?\n/);
      const timing = lines.findIndex(line => timestamps.test(line));
      if (timing < 0) return;
      const original = lines.slice(timing + 1).join(newline);
      if (original.trim()) parts.push({ index, original, prefix: lines.slice(0, timing + 1).join(newline) + newline });
    } else {
      parts.push({ index, original: block, prefix: '' });
    }
  });
  return { parts, format(translations, bilingual) {
    const result = [...blocks];
    parts.forEach(({ index, prefix, original }, i) => {
      result[index] = prefix + (bilingual ? original + newline : '') + translations[i].replace(/\r?\n/g, newline);
    });
    return result.join('') + ending;
  } };
}

function parseAss(source) {
  const lines = source.split(/(\r?\n)/);
  const parts = [];
  let events = false;
  let fields = 0;
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index];
    const section = line.trim().match(/^\[([^\]]+)\]$/);
    if (section) {
      events = section[1].toLowerCase() === 'events';
      fields = 0;
    }
    if (!events) continue;
    const format = line.match(/^\s*Format:\s*(.+)$/i);
    if (format) {
      const columns = format[1].split(',').map(value => value.trim().toLowerCase());
      fields = columns.at(-1) === 'text' ? columns.length : 0;
    }
    const dialogue = line.match(/^\s*Dialogue:\s*/i);
    if (!dialogue || !fields) continue;
    let offset = dialogue[0].length;
    for (let i = 1; i < fields && offset > 0; i++) offset = line.indexOf(',', offset) + 1;
    if (!offset) continue;
    const raw = line.slice(offset);
    if (/\{[^}]*\\p[1-9][^}]*\}/i.test(raw)) continue;
    const original = raw.replace(/\{[^}]*\}/g, '').replace(/\\[nN]/g, '\n').replace(/\\h/g, ' ').trim();
    if (/\p{L}/u.test(original)) parts.push({ index, prefix: line.slice(0, offset), raw, original });
  }
  return { parts, format(translations, bilingual) {
    const result = [...lines];
    parts.forEach(({ index, prefix, raw }, i) => {
      const value = translations[i].replace(/\r?\n/g, '\\N').replace(/[{}]/g, character => character === '{' ? '｛' : '｝');
      const leading = raw.match(/^(?:\{[^}]*\})+/)?.[0] || '';
      result[index] = prefix + (bilingual ? raw + '\\N' : leading) + value;
    });
    return result.join('');
  } };
}
