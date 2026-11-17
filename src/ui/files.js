const timestamps = /^\s*(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->/;

export function parseFile(source, extension) {
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
